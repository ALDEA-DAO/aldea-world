import type { PreparedQuery } from "@pgtyped/runtime";
import { sql } from "../sql.ts";

/**
 * Births in the read model. Each STF is a pure function from its input to the SQL it applies (`Effect[]`), so it is
 * deterministic and testable without the engine; the state machine runs the effects with `World.resolve`.
 *
 * Every statement is idempotent: replaying the same event (same txHash/logIndex) leaves the same state, and no
 * statement can fail on chain data (a failed query halts the node, SPIKE.md finding 2).
 */

/** One SQL statement with its parameters (each query checks its own parameter types). */
export type Effect = readonly [PreparedQuery<any, any>, Record<string, unknown>];

/** The relay outbox key: one completion per character and target block (a reschedule makes a new one). */
export const completeBirthKey = (characterId: number, targetBlock: string | bigint) => `complete_birth:${characterId}:${targetBlock}`;

export interface BirthRequested {
  characterId: number;
  owner: string;
  almaIdHash: string;
  characterClass: number;
  targetBlock: string;
  txHash: string;
  blockNumber: number;
}

export interface BirthRescheduled {
  characterId: number;
  newTargetBlock: string;
}

export interface BirthCompleted {
  characterId: number;
  almaIdHash: string;
  characterClass: number;
  tribe: number;
  txHash: string;
  blockNumber: number;
}

/** Where an STF runs: the Effectstream block height and its timestamp (deterministic, from the main clock). */
export interface StfContext {
  height: number;
  timestampMs: number;
  /** Key of this world in world_activity_hourly. */
  worldId: string;
}

const insertBirth = sql<{
  character_id: number;
  owner: string;
  alma_id_hash: string;
  character_class: number;
  target_block: string;
  requested_block: number;
  requested_tx: string;
}>(`INSERT INTO births (character_id, owner, alma_id_hash, character_class, status, target_block, requested_block, requested_tx)
VALUES (:character_id!, :owner!, :alma_id_hash!, :character_class!, 'gestating', :target_block!, :requested_block!, :requested_tx!)
ON CONFLICT (character_id) DO NOTHING`);

/** Queues the completion for the Midwife, from the block after the target (no-op if already queued). */
const queueCompletion = sql<{ dedupe_key: string; character_id: number; not_before: string; height: number }>(
  `INSERT INTO relay_outbox (kind, dedupe_key, payload, not_before_base_block, created_height)
VALUES ('complete_birth', :dedupe_key!, jsonb_build_object('characterId', :character_id!::int), :not_before!::bigint, :height!)
ON CONFLICT (dedupe_key) DO NOTHING`,
);

const moveTarget = sql<{ character_id: number; target_block: string }>(
  `UPDATE births SET target_block = :target_block!::bigint WHERE character_id = :character_id! AND status = 'gestating'`,
);

/** Closes a character's pending completions, except `keep` (the current one after a reschedule). */
const closeCompletions = sql<{ prefix: string; keep: string; height: number }>(
  `UPDATE relay_outbox SET status = 'done', done_height = :height!
WHERE kind = 'complete_birth' AND status = 'pending' AND starts_with(dedupe_key, :prefix!) AND dedupe_key <> :keep!`,
);

/**
 * Marks the birth as born and, only when this event is what changed it, counts the birth in the world's hourly
 * activity: replaying the event changes nothing.
 */
const markBorn = sql<{ character_id: number; tribe: number; born_block: number; born_tx: string; born_ts: number; world_id: string }>(
  `WITH born AS (
  UPDATE births SET status = 'born', tribe = :tribe!, born_block = :born_block!, born_tx = :born_tx!, born_ts = :born_ts!
  WHERE character_id = :character_id! AND status = 'gestating'
  RETURNING born_ts
)
INSERT INTO world_activity_hourly (world_id, hour_start, births)
SELECT :world_id!, (born_ts / 3600) * 3600, 1 FROM born
ON CONFLICT (world_id, hour_start) DO UPDATE SET births = world_activity_hourly.births + 1`,
);

export function birthRequested(input: BirthRequested, ctx: StfContext): Effect[] {
  return [
    [
      insertBirth,
      {
        character_id: input.characterId,
        owner: input.owner.toLowerCase(),
        alma_id_hash: input.almaIdHash.toLowerCase(),
        character_class: input.characterClass,
        target_block: input.targetBlock,
        requested_block: input.blockNumber,
        requested_tx: input.txHash.toLowerCase(),
      },
    ],
    [
      queueCompletion,
      {
        dedupe_key: completeBirthKey(input.characterId, input.targetBlock),
        character_id: input.characterId,
        not_before: (BigInt(input.targetBlock) + 1n).toString(),
        height: ctx.height,
      },
    ],
  ];
}

export function birthRescheduled(input: BirthRescheduled, ctx: StfContext): Effect[] {
  const key = completeBirthKey(input.characterId, input.newTargetBlock);
  return [
    [moveTarget, { character_id: input.characterId, target_block: input.newTargetBlock }],
    [closeCompletions, { prefix: `complete_birth:${input.characterId}:`, keep: key, height: ctx.height }],
    [queueCompletion, { dedupe_key: key, character_id: input.characterId, not_before: (BigInt(input.newTargetBlock) + 1n).toString(), height: ctx.height }],
  ];
}

export function birthCompleted(input: BirthCompleted, ctx: StfContext): Effect[] {
  return [
    [
      markBorn,
      {
        character_id: input.characterId,
        tribe: input.tribe,
        born_block: input.blockNumber,
        born_tx: input.txHash.toLowerCase(),
        born_ts: Math.floor(ctx.timestampMs / 1000),
        world_id: ctx.worldId,
      },
    ],
    // keep "" matches no key: every pending completion of this character closes
    [closeCompletions, { prefix: `complete_birth:${input.characterId}:`, keep: "", height: ctx.height }],
  ];
}
