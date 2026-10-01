import { tribeByIndex } from "@aldea/shared/catalog";
import type { Deployment } from "@aldea/shared/deployments";
import { and, arrayContains, eq, inArray, isNull, sql } from "drizzle-orm";
import { hexToBytes, type Hex } from "viem";
import type { AnyDb } from "../auth/adapter";
import { bindings, links, relationships, souls, syncState } from "../db/schema";
import { logger } from "../lib/logger";
import { seedOrgs } from "../seed/orgs";

/**
 * Folds what Effectstream saw on Base into the Resolver, every 2 s:
 *
 * - souls anchored in AlmaAnchorRegistry move from `prepared` to `anchored`, but only when the on-chain controller is
 *   the soul's own controller (anyone can anchor an identifier; only its soul's anchor counts);
 * - born characters make their soul `active`, with the `aldea-world:character` binding and the `member_of`
 *   relationship to the tribe's organization, both with the birth transaction as evidence.
 *
 * Each page and its cursor commit together, and every write is idempotent (unique keys), so a crash or a replayed
 * page changes nothing.
 */

export interface AnchoredSoul {
  almaIdHash: string;
  almaId: string;
  subjectType: number;
  controller: string;
  anchoredBlock: number;
  txHash: string;
}

export interface BornBirth {
  characterId: number;
  almaIdHash: string;
  characterClass: number;
  tribe: number;
  bornBlock: number;
  bornTx: string;
  bornTs: number | null;
}

/** Effectstream's read API feeds (pages end on a whole Base block; `since` is exclusive). */
export interface EffectstreamFeeds {
  anchoredSouls(since: number): Promise<{ items: AnchoredSoul[]; nextSince: number }>;
  bornBirths(since: number): Promise<{ items: BornBirth[]; nextSince: number }>;
}

export function effectstreamFeeds(apiUrl: string, fetchFn: typeof fetch = fetch): EffectstreamFeeds {
  const get = async <T>(path: string): Promise<T> => {
    const res = await fetchFn(`${apiUrl}${path}`, { signal: AbortSignal.timeout(5_000) });
    if (!res.ok) throw new Error(`Effectstream answered ${res.status} for ${path}`);
    return (await res.json()) as T;
  };
  return {
    anchoredSouls: (since) => get(`/api/v1/souls/anchored?since=${since}&limit=200`),
    bornBirths: (since) => get(`/api/v1/births?status=born&since=${since}&limit=200`),
  };
}

export interface SyncDeps {
  db: AnyDb;
  feeds: EffectstreamFeeds;
  /** The deployment for the Resolver's chain, once it exists (locally it appears after `pnpm dev` deploys). */
  deployment: () => Deployment | undefined;
}

const HUMAN = 1;
const bytes = (hex: string) => Buffer.from(hexToBytes(hex as Hex));

export function createSyncJob({ db, feeds, deployment }: SyncDeps) {
  let orgsSeeded = false;
  let running = false;

  const cursor = async (key: string) => (await db.select().from(syncState).where(eq(syncState.key, key)).limit(1))[0]?.since ?? -1;
  const saveCursor = (tx: AnyDb, key: string, since: number) =>
    tx
      .insert(syncState)
      .values({ key, since })
      .onConflictDoUpdate({ target: syncState.key, set: { since, updatedAt: sql`now()` } });

  async function syncAnchored(chainId: number) {
    const since = await cursor("souls_anchored");
    const page = await feeds.anchoredSouls(since);
    if (page.nextSince === since) return 0;
    const humans = page.items.filter((s) => s.subjectType === HUMAN);
    let anchored = 0;
    await db.transaction(async (tx) => {
      for (const soul of humans) {
        // Only the soul's own controller (its smart wallet, or locally its development key) anchors it
        const [controller] = await tx
          .select({ id: links.id })
          .from(links)
          .where(and(eq(links.almaId, soul.almaId), eq(links.kind, "evm"), isNull(links.revokedAt), arrayContains(links.roles, ["controller"]), sql`lower(${links.value}) = ${`eip155:${chainId}:${soul.controller}`.toLowerCase()}`))
          .limit(1);
        if (!controller) {
          const [known] = await tx.select({ almaId: souls.almaId }).from(souls).where(eq(souls.almaId, soul.almaId)).limit(1);
          if (known) logger.warn({ almaId: soul.almaId, controller: soul.controller, tx: soul.txHash }, "soul anchored on-chain by an address that is not its controller");
          continue;
        }
        const updated = await tx
          .update(souls)
          .set({ status: "anchored", anchoredTx: soul.txHash, anchoredBlock: BigInt(soul.anchoredBlock), anchoredAt: sql`now()`, updatedAt: sql`now()` })
          .where(and(eq(souls.almaId, soul.almaId), eq(souls.status, "prepared")))
          .returning({ almaId: souls.almaId });
        anchored += updated.length;
      }
      await saveCursor(tx, "souls_anchored", page.nextSince);
    });
    return anchored;
  }

  async function syncBirths(chainId: number, worldAddress: string) {
    const since = await cursor("births_born");
    const page = await feeds.bornBirths(since);
    if (page.nextSince === since) return 0;
    let born = 0;
    await db.transaction(async (tx) => {
      for (const birth of page.items) {
        const tribe = tribeByIndex(birth.tribe);
        const [soul] = await tx.select({ almaId: souls.almaId }).from(souls).where(eq(souls.almaIdHash, bytes(birth.almaIdHash))).limit(1);
        if (!soul || !tribe) continue; // a soul this Resolver does not know (anchored elsewhere)
        const evidence = { chainId, txHash: birth.bornTx, event: "CharacterBorn" };
        await tx
          .update(souls)
          .set({ status: "active", updatedAt: sql`now()` })
          .where(and(eq(souls.almaId, soul.almaId), inArray(souls.status, ["prepared", "anchored"])));
        await tx
          .insert(bindings)
          .values({
            almaId: soul.almaId,
            type: "aldea-world:character",
            value: `base:${chainId}:${worldAddress}:${birth.characterId}`,
            visibility: "public",
            evidence: { ...evidence, characterId: birth.characterId, characterClass: birth.characterClass, tribe: birth.tribe, bornAt: birth.bornTs },
          })
          .onConflictDoNothing();
        const inserted = await tx
          .insert(relationships)
          .values({ fromAlmaId: soul.almaId, toAlmaId: tribe.almaOrgId, type: "member_of", evidence })
          .onConflictDoNothing()
          .returning({ id: relationships.id });
        born += inserted.length;
      }
      await saveCursor(tx, "births_born", page.nextSince);
    });
    return born;
  }

  return {
    /** One pass over both feeds. Overlapping calls are dropped (the next tick catches up). */
    async tick(): Promise<{ anchored: number; born: number } | undefined> {
      if (running) return undefined;
      running = true;
      try {
        const current = deployment();
        if (!current?.world) return undefined; // the World is not deployed yet
        if (!orgsSeeded) {
          await seedOrgs(db, current);
          orgsSeeded = true;
        }
        const anchored = await syncAnchored(current.chainId);
        const born = await syncBirths(current.chainId, current.world.address);
        if (anchored || born) logger.info({ anchored, born }, "synced from Effectstream");
        return { anchored, born };
      } finally {
        running = false;
      }
    },
  };
}
