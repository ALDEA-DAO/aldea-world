import { almaIdHash, docHash, evmControllerId, newHumanAlmaId, ALMA_CONTEXT, type AlmaCoreDoc } from "@aldea/shared/alma";
import { and, arrayContains, eq, isNull, sql } from "drizzle-orm";
import { getAddress, hexToBytes, type Address } from "viem";
import { custody, links, souls, type linkKinds } from "../db/schema";
import { logger } from "../lib/logger";
import { ProblemError } from "../lib/problem";
import type { AnyDb } from "./adapter";

/**
 * The soul behind a login key. A key already linked with the `login` role signs in to its soul; an unknown key
 * creates a new soul (`prepared`), links the key with its proof and provisions the soul's custody: the Turnkey
 * sub-organization and the Coinbase Smart Wallet, linked as its `controller`. A key never moves between souls.
 */

export interface LoginKey {
  kind: (typeof linkKinds)[number];
  value: string;
  /** Evidence that the person controls the key, stored with the link. */
  proof: Record<string, unknown>;
  label?: string;
}

export interface ProvisionedCustody {
  subOrganizationId: string;
  walletId: string;
  ownerAddress: Address;
  smartAccountAddress: Address;
}

export interface SoulDeps {
  db: AnyDb;
  /** Base chain of the soul's controller (84532 on staging, 8453 in production, 31337 locally). */
  chainId: number;
  /** Creates the soul's custody, or undefined when custody is not configured (local development). */
  provisionCustody?: (almaId: string) => Promise<ProvisionedCustody | undefined>;
}

export async function findSoulByLoginKey(db: AnyDb, kind: LoginKey["kind"], value: string): Promise<string | undefined> {
  const [link] = await db
    .select({ id: links.id, almaId: links.almaId })
    .from(links)
    .where(and(eq(links.kind, kind), eq(links.value, value), isNull(links.revokedAt), arrayContains(links.roles, ["login"])))
    .limit(1);
  if (!link) return undefined;
  await db.update(links).set({ lastUsedAt: new Date() }).where(eq(links.id, link.id));
  return link.almaId;
}

function coreDoc(almaId: string, createdAt: string, chainId: number, controller?: Address): AlmaCoreDoc {
  return {
    "@context": ALMA_CONTEXT,
    id: almaId,
    type: "human",
    createdAt,
    controllers: controller ? [{ id: evmControllerId(chainId, controller), kind: "evm", primary: true }] : [],
  };
}

/** Signs in with a key, creating the soul on its first use. */
export async function loginWithKey(deps: SoulDeps, key: LoginKey): Promise<{ almaId: string; created: boolean }> {
  const existing = await findSoulByLoginKey(deps.db, key.kind, key.value);
  if (existing) return { almaId: existing, created: false };
  // Linked without the login role, or revoked: it belongs to a soul but cannot sign in, and never moves on its own
  const [taken] = await deps.db.select({ id: links.id }).from(links).where(and(eq(links.kind, key.kind), eq(links.value, key.value))).limit(1);
  if (taken) throw new ProblemError(409, "link_belongs_to_other_soul", "This key belongs to a soul but cannot be used to sign in");

  const almaId = newHumanAlmaId();
  const createdAt = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  const doc = coreDoc(almaId, createdAt, deps.chainId);
  await deps.db.transaction(async (tx) => {
    await tx.insert(souls).values({
      almaId,
      almaIdHash: Buffer.from(hexToBytes(almaIdHash(almaId))),
      subjectType: "human",
      doc,
      docHash: Buffer.from(hexToBytes(docHash(doc))),
    });
    await tx.insert(links).values({ almaId, kind: key.kind, value: key.value, roles: ["login"], proof: key.proof, label: key.label, lastUsedAt: new Date() });
  });

  // Custody is provisioned after the soul exists; if Turnkey is down, the soul is still usable and custody is retried
  // when the player prepares their birth.
  await ensureCustody(deps, almaId).catch((err: unknown) => logger.error({ err, almaId }, "custody provisioning failed"));
  return { almaId, created: true };
}

/** Provisions the soul's custody once, links its smart account as controller and puts it in the ALMA document. */
export async function ensureCustody(deps: SoulDeps, almaId: string): Promise<ProvisionedCustody | undefined> {
  const [current] = await deps.db.select().from(custody).where(eq(custody.almaId, almaId)).limit(1);
  if (current) {
    return {
      subOrganizationId: current.subOrganizationId,
      walletId: current.walletId,
      ownerAddress: getAddress(current.ownerAddress),
      smartAccountAddress: getAddress(current.smartAccountAddress),
    };
  }
  const provisioned = await deps.provisionCustody?.(almaId);
  if (!provisioned) return undefined;

  await deps.db.transaction(async (tx) => {
    await tx.insert(custody).values({ almaId, ...provisioned });
    await setController(tx, deps.chainId, almaId, provisioned.smartAccountAddress, {
      label: "Coinbase Smart Wallet",
      proof: { type: "custody", provider: "turnkey", subOrganizationId: provisioned.subOrganizationId, owner: provisioned.ownerAddress, verifiedAt: new Date().toISOString() },
    });
  });
  return provisioned;
}

/**
 * Local development only (no custody provider): the browser's development key becomes the soul's controller. A soul
 * keeps the first controller it gets.
 */
export async function ensureDevelopmentController(deps: SoulDeps, almaId: string, controller: Address) {
  const [existing] = await deps.db
    .select({ value: links.value })
    .from(links)
    .where(and(eq(links.almaId, almaId), eq(links.kind, "evm"), isNull(links.revokedAt), arrayContains(links.roles, ["controller"])))
    .limit(1);
  const value = `eip155:${deps.chainId}:${getAddress(controller)}`;
  if (existing) {
    if (existing.value !== value) throw new ProblemError(409, "controller_mismatch", "This soul already has another controller");
    return;
  }
  await deps.db.transaction((tx) => setController(tx, deps.chainId, almaId, getAddress(controller), { label: "Development key", proof: { type: "development", verifiedAt: new Date().toISOString() } }));
}

/** Links the soul's controller and writes it into the ALMA document (whose hash is what gets anchored). */
async function setController(db: AnyDb, chainId: number, almaId: string, controller: Address, link: { label: string; proof: Record<string, unknown> }) {
  const [soul] = await db.select({ doc: souls.doc }).from(souls).where(eq(souls.almaId, almaId)).limit(1);
  if (!soul) throw new Error(`soul ${almaId} not found`);
  const doc = coreDoc(almaId, (soul.doc as AlmaCoreDoc).createdAt, chainId, controller);
  await db.insert(links).values({ almaId, kind: "evm", value: `eip155:${chainId}:${controller}`, roles: ["controller"], ...link });
  await db
    .update(souls)
    .set({ doc, docHash: Buffer.from(hexToBytes(docHash(doc))), updatedAt: sql`now()` })
    .where(eq(souls.almaId, almaId));
}
