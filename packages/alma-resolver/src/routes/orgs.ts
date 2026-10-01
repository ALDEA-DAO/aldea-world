import { isAlmaId } from "@aldea/shared/alma";
import { tribes } from "@aldea/shared/catalog";
import { and, eq, isNull, sql } from "drizzle-orm";
import { Hono } from "hono";
import type { AnyDb } from "../auth/adapter";
import { bindings, relationships, souls } from "../db/schema";
import { ProblemError } from "../lib/problem";
import type { SoulActivity } from "./souls";

/**
 * `/v1/orgs/:almaId/members`: the souls that are `member_of` an organization (a tribe), oldest first, with the
 * on-chain evidence of each membership. Public: memberships are on-chain facts.
 */

interface CharacterEvidence {
  characterId?: number;
  characterClass?: number;
  tribe?: number;
  bornAt?: number | null;
  txHash?: string;
}

const MAX_LIMIT = 100;

export function createOrgRoutes(db: AnyDb) {
  const app = new Hono();

  app.get("/:almaId/members", async (c) => {
    const almaId = c.req.param("almaId");
    const limit = Number(c.req.query("limit") ?? 50);
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) throw new ProblemError(400, "invalid_limit", `limit must be between 1 and ${MAX_LIMIT}`);
    const [org] = isAlmaId(almaId, "org") ? await db.select({ almaId: souls.almaId }).from(souls).where(eq(souls.almaId, almaId)).limit(1) : [];
    if (!org) throw new ProblemError(404, "soul_not_found", "This organization does not exist");

    // Cursor: "<createdAt ISO>_<relationship id>" of the last item, compared as a pair
    const [after, afterId] = (c.req.query("cursor") ?? "").split("_");
    const validCursor = after && afterId && !Number.isNaN(Date.parse(after)) && /^[0-9a-f-]{36}$/.test(afterId);
    const rows = await db
      .select({ id: relationships.id, almaId: relationships.fromAlmaId, joinedAt: relationships.createdAt, evidence: relationships.evidence, character: bindings.evidence })
      .from(relationships)
      .leftJoin(bindings, and(eq(bindings.almaId, relationships.fromAlmaId), eq(bindings.type, "aldea-world:character"), isNull(bindings.revokedAt)))
      .where(
        and(
          eq(relationships.toAlmaId, almaId),
          eq(relationships.type, "member_of"),
          isNull(relationships.revokedAt),
          validCursor ? sql`(${relationships.createdAt}, ${relationships.id}) > (${after}::timestamptz, ${afterId}::uuid)` : undefined,
        ),
      )
      .orderBy(relationships.createdAt, relationships.id)
      .limit(limit + 1);

    const page = rows.slice(0, limit);
    const last = page.at(-1);
    return c.json({
      items: page.map((r) => ({
        almaId: r.almaId,
        characterClass: (r.character as CharacterEvidence | null)?.characterClass ?? null,
        joinedAt: r.joinedAt.toISOString(),
        evidence: r.evidence,
      })),
      nextCursor: rows.length > limit && last ? `${last.joinedAt.toISOString()}_${last.id}` : null,
    });
  });

  return app;
}

/**
 * What the Resolver knows about a soul in the world, from what the sync job recorded: its born character and its
 * tribe. (A gestating character is not here yet; clients follow the birth itself on-chain.)
 */
export function soulActivityFromDb(db: AnyDb) {
  return async (almaId: string): Promise<SoulActivity> => {
    const [binding] = await db
      .select({ evidence: bindings.evidence })
      .from(bindings)
      .where(and(eq(bindings.almaId, almaId), eq(bindings.type, "aldea-world:character"), isNull(bindings.revokedAt)))
      .limit(1);
    const character = binding?.evidence as CharacterEvidence | undefined;
    if (!character || character.characterId === undefined || character.characterClass === undefined) return { character: null, founder: null, tribe: null };
    const tribe = character.tribe === undefined ? undefined : tribes[character.tribe];
    return {
      character: {
        characterId: character.characterId,
        status: "born",
        characterClass: character.characterClass,
        tribe: character.tribe ?? null,
        bornTx: character.txHash,
        bornAt: character.bornAt ? new Date(character.bornAt * 1000).toISOString() : undefined,
      },
      founder: null,
      tribe: tribe ? { index: tribe.index, almaId: tribe.almaOrgId } : null,
    };
  };
}
