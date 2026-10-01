import type { AlmaCoreDoc, AlmaDocument, Evidence, RelationshipType } from "@aldea/shared/alma";
import { almaIdHash } from "@aldea/shared/alma";
import { and, eq, isNull } from "drizzle-orm";
import { bytesToHex } from "viem";
import type { AnyDb } from "../auth/adapter";
import { bindings, relationships, souls } from "../db/schema";

/**
 * ALMA documents as the Resolver serves them: the anchored core (whose keccak256(JCS) is on-chain) plus the soul's
 * status, bindings and relationships with their on-chain evidence.
 */

export type SoulRow = typeof souls.$inferSelect;

export async function findSoul(db: AnyDb, almaId: string): Promise<SoulRow | undefined> {
  const [soul] = await db.select().from(souls).where(eq(souls.almaId, almaId)).limit(1);
  return soul;
}

/** The anchoring material: the core document and the hashes `anchorHuman` receives. */
export function anchorMaterial(soul: SoulRow) {
  return {
    almaId: soul.almaId,
    almaIdHash: almaIdHash(soul.almaId),
    doc: soul.doc as AlmaCoreDoc,
    docHash: bytesToHex(soul.docHash),
  };
}

/** The full document; `publicOnly` leaves out private bindings (relationships are always public: they are on-chain). */
export async function almaDocument(db: AnyDb, soul: SoulRow, { publicOnly = false } = {}): Promise<AlmaDocument> {
  const [soulBindings, soulRelationships] = await Promise.all([
    db
      .select()
      .from(bindings)
      .where(and(eq(bindings.almaId, soul.almaId), isNull(bindings.revokedAt))),
    db
      .select()
      .from(relationships)
      .where(and(eq(relationships.fromAlmaId, soul.almaId), isNull(relationships.revokedAt))),
  ]);
  return {
    ...(soul.doc as AlmaCoreDoc),
    status: soul.status,
    bindings: soulBindings
      .filter((b) => !publicOnly || b.visibility === "public")
      .map((b) => ({ type: b.type, value: b.value, visibility: b.visibility, ...(b.evidence ? { evidence: b.evidence as Evidence } : {}) })),
    relationships: soulRelationships.map((r) => ({ type: r.type as RelationshipType, to: r.toAlmaId, evidence: r.evidence as Evidence })),
  };
}
