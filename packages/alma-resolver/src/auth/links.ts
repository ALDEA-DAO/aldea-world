import { and, arrayContains, eq, isNull, ne, sql } from "drizzle-orm";
import { getAddress, isAddress } from "viem";
import { custody, links, soulMerges, souls, type linkRoles } from "../db/schema";
import { ProblemError } from "../lib/problem";
import type { AnyDb } from "./adapter";
import type { ChallengeStore } from "./interaction";
import type { LoginKey } from "./souls";

/**
 * The soul's linked keys (ADR 0006): every way to sign in or act is a link with roles and a proof.
 *
 * - A key belongs to one soul and never moves on its own: proving a key of another soul offers a merge, which needs
 *   proof of both (the session for this soul, a fresh signature or code for the other).
 * - The last `login` link can never be removed, and controller links (owners of the smart wallet) are not removed
 *   here: that is an on-chain change.
 */

export type LinkRole = (typeof linkRoles)[number];

export interface AlmaLink {
  id: string;
  kind: LoginKey["kind"];
  /** What the player sees: the account for chains, never the email or the passkey id. */
  display: string;
  roles: LinkRole[];
  label: string | null;
  visibility: "public" | "private";
  addedAt: string;
  lastUsedAt: string | null;
}

function display(kind: string, value: string) {
  if (kind === "evm" || kind === "cardano" || kind === "midnight") return value;
  return kind;
}

export async function listLinks(db: AnyDb, almaId: string): Promise<AlmaLink[]> {
  const rows = await db.select().from(links).where(and(eq(links.almaId, almaId), isNull(links.revokedAt))).orderBy(links.addedAt);
  return rows.map((l) => ({
    id: l.id,
    kind: l.kind,
    display: display(l.kind, l.value),
    roles: l.roles,
    label: l.label,
    visibility: l.visibility,
    addedAt: l.addedAt.toISOString(),
    lastUsedAt: l.lastUsedAt?.toISOString() ?? null,
  }));
}

const MERGE_TTL = "merge";

/** How long after linking a controller wallet (with a recent passkey) the gas for adding it as owner is sponsored. */
const OWNER_ADDITION_WINDOW_MS = 30 * 60 * 1000;

/**
 * Approves sponsoring `addOwnerAddress(owner)` on `sender`: the wallet must be this soul's smart wallet, and `owner`
 * a wallet the soul linked as controller (which requires a recent passkey sign-in) in the last 30 minutes.
 */
export async function canAddOwner(db: AnyDb, chainId: number, almaId: string, sender: string, owner: string) {
  const [wallet] = await db.select({ address: custody.smartAccountAddress }).from(custody).where(eq(custody.almaId, almaId)).limit(1);
  if (!wallet || wallet.address.toLowerCase() !== sender.toLowerCase()) return false;
  if (!isAddress(owner)) return false;
  const [link] = await db
    .select({ addedAt: links.addedAt })
    .from(links)
    .where(
      and(
        eq(links.almaId, almaId),
        eq(links.kind, "evm"),
        eq(links.value, `eip155:${chainId}:${getAddress(owner)}`),
        isNull(links.revokedAt),
        arrayContains(links.roles, ["controller"]),
      ),
    )
    .limit(1);
  return !!link && Date.now() - link.addedAt.getTime() <= OWNER_ADDITION_WINDOW_MS;
}

/**
 * Links a key the player just proved. The same key on this soul is a no-op (its roles are extended); a key of
 * another soul is remembered for a merge and answered with 409 `link_belongs_to_other_soul`.
 */
export async function addLink(db: AnyDb, challenges: ChallengeStore, almaId: string, key: LoginKey & { roles: LinkRole[] }) {
  const [existing] = await db.select().from(links).where(and(eq(links.kind, key.kind), eq(links.value, key.value))).limit(1);
  if (existing && existing.almaId !== almaId && !existing.revokedAt) {
    await challenges.put(almaId, MERGE_TTL, { kind: key.kind, value: key.value, from: existing.almaId, proof: key.proof });
    throw new ProblemError(409, "link_belongs_to_other_soul", "This key belongs to another soul", "If both are yours, you can merge them.");
  }
  if (existing && existing.almaId === almaId && !existing.revokedAt) {
    const roles = [...new Set([...existing.roles, ...key.roles])] as LinkRole[];
    const [updated] = await db.update(links).set({ roles, proof: key.proof }).where(eq(links.id, existing.id)).returning();
    return { link: updated!, created: false };
  }
  if (existing) await db.delete(links).where(eq(links.id, existing.id)); // a revoked link can be proven again
  const [link] = await db.insert(links).values({ almaId, kind: key.kind, value: key.value, roles: key.roles, proof: key.proof, label: key.label }).returning();
  return { link: link!, created: true };
}

export async function removeLink(db: AnyDb, almaId: string, linkId: string) {
  const [link] = await db.select().from(links).where(and(eq(links.id, linkId), eq(links.almaId, almaId), isNull(links.revokedAt))).limit(1);
  if (!link) throw new ProblemError(404, "not_found", "That key is not linked to your soul");
  if (link.roles.includes("controller")) {
    throw new ProblemError(409, "controller_link", "This key owns your smart wallet", "Removing an owner of your smart wallet is not available yet.");
  }
  if (link.roles.includes("login")) {
    const [{ others } = { others: 0 }] = await db
      .select({ others: sql<number>`count(*)::int` })
      .from(links)
      .where(and(eq(links.almaId, almaId), isNull(links.revokedAt), arrayContains(links.roles, ["login"]), ne(links.id, linkId)));
    if (others === 0) throw new ProblemError(409, "last_login_method", "This is your only way to sign in", "Add another one before removing it.");
  }
  await db.update(links).set({ revokedAt: new Date() }).where(eq(links.id, linkId));
}

/**
 * Merges the soul whose key the player just proved (remembered by `addLink`) into the signed-in soul: its keys move
 * here and it is revoked. Only a soul that was never anchored on-chain can be merged away.
 */
export async function mergeSouls(db: AnyDb, challenges: ChallengeStore, almaId: string) {
  const pending = await challenges.take<{ kind: LoginKey["kind"]; value: string; from: string; proof: Record<string, unknown> }>(almaId, MERGE_TTL);
  if (!pending) throw new ProblemError(401, "merge_proof_missing", "Prove a key of the other soul first");
  if (pending.from === almaId) throw new ProblemError(409, "same_soul", "Both keys belong to this soul");

  const [from] = await db.select().from(souls).where(eq(souls.almaId, pending.from)).limit(1);
  if (!from || from.status === "revoked") throw new ProblemError(404, "not_found", "The other soul no longer exists");
  if (from.status !== "prepared") throw new ProblemError(409, "soul_anchored", "The other soul was already born", "A soul that lives on-chain cannot be merged.");

  await db.transaction(async (tx) => {
    // Its keys move here, except its own smart wallet (a prepared soul's controller that never acted on-chain)
    const moved = await tx
      .select()
      .from(links)
      .where(and(eq(links.almaId, pending.from), isNull(links.revokedAt)));
    for (const link of moved) {
      if (link.roles.includes("controller") && link.proof && (link.proof as { type?: string }).type === "custody") {
        await tx.update(links).set({ revokedAt: new Date() }).where(eq(links.id, link.id));
        continue;
      }
      await tx.update(links).set({ almaId }).where(eq(links.id, link.id));
    }
    await tx.delete(custody).where(eq(custody.almaId, pending.from));
    await tx.update(souls).set({ status: "revoked", updatedAt: sql`now()` }).where(eq(souls.almaId, pending.from));
    await tx.insert(soulMerges).values({ fromAlmaId: pending.from, intoAlmaId: almaId, proofs: { session: almaId, key: { kind: pending.kind, value: pending.value, proof: pending.proof } } });
  });
  return { mergedFrom: pending.from };
}
