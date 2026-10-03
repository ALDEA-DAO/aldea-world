import { sql } from "../sql.ts";
import type { Effect, StfContext } from "./births.ts";

/**
 * Building visits in the read model (MovementSystem's BuildingEntered and BuildingLeft): one row per entry, closed
 * when the character leaves or goes into another building, and the world's hourly activity (visits and the souls
 * seen that hour). Like every STF here: pure, idempotent on replay, and no statement can fail on chain data.
 */

export interface BuildingEntered {
  characterId: number;
  buildingId: string;
  almaIdHash: string;
  txHash: string;
  logIndex: number;
  blockNumber: number;
}

export interface BuildingLeft {
  characterId: number;
  buildingId: string;
  txHash: string;
  logIndex: number;
  blockNumber: number;
}

/**
 * Records the visit and, only when this event is what inserted it: closes the character's other open visit (an
 * entry while inside overwrites the on-chain Location) and counts the visit in the hour, and the soul too when it is
 * its first visit that hour. Data-modifying CTEs do not see each other's rows, so both checks only see older visits.
 */
const recordVisit = sql<{ character_id: number; alma_id_hash: string; building_id: string; base_block: number; base_ts: number; tx_hash: string; log_index: number; world_id: string }>(
  `WITH visit AS (
  INSERT INTO building_visits (character_id, alma_id_hash, building_id, base_block, base_ts, tx_hash, log_index)
  VALUES (:character_id!, :alma_id_hash!, :building_id!, :base_block!, :base_ts!, :tx_hash!, :log_index!)
  ON CONFLICT (tx_hash, log_index) DO NOTHING
  RETURNING character_id, alma_id_hash, base_ts
), closed AS (
  UPDATE building_visits previous SET left_ts = visit.base_ts
  FROM visit WHERE previous.character_id = visit.character_id AND previous.left_ts IS NULL
  RETURNING previous.id
), counted AS (
  SELECT (visit.base_ts / 3600) * 3600 AS hour_start,
    NOT EXISTS (
      SELECT 1 FROM building_visits earlier
      WHERE earlier.alma_id_hash = visit.alma_id_hash AND earlier.base_ts >= (visit.base_ts / 3600) * 3600 AND earlier.base_ts < (visit.base_ts / 3600) * 3600 + 3600
    ) AS first_this_hour
  FROM visit
)
INSERT INTO world_activity_hourly (world_id, hour_start, visits, unique_souls)
SELECT :world_id!, hour_start, 1, CASE WHEN first_this_hour THEN 1 ELSE 0 END FROM counted
ON CONFLICT (world_id, hour_start) DO UPDATE
SET visits = world_activity_hourly.visits + 1, unique_souls = world_activity_hourly.unique_souls + EXCLUDED.unique_souls`,
);

/** Closes the character's latest open visit to that building, once per BuildingLeft event. */
const closeVisit = sql<{ character_id: number; building_id: string; left_ts: number; left_tx: string; left_log_index: number }>(
  `UPDATE building_visits SET left_ts = :left_ts!, left_tx = :left_tx!, left_log_index = :left_log_index!
WHERE id = (
  SELECT id FROM building_visits
  WHERE character_id = :character_id! AND building_id = :building_id! AND left_ts IS NULL
  ORDER BY base_block DESC, log_index DESC LIMIT 1
)
AND NOT EXISTS (SELECT 1 FROM building_visits WHERE left_tx = :left_tx! AND left_log_index = :left_log_index!)`,
);

export function buildingEntered(input: BuildingEntered, ctx: StfContext): Effect[] {
  return [
    [
      recordVisit,
      {
        character_id: input.characterId,
        alma_id_hash: input.almaIdHash.toLowerCase(),
        building_id: input.buildingId.toLowerCase(),
        base_block: input.blockNumber,
        base_ts: Math.floor(ctx.timestampMs / 1000),
        tx_hash: input.txHash.toLowerCase(),
        log_index: input.logIndex,
        world_id: ctx.worldId,
      },
    ],
  ];
}

export function buildingLeft(input: BuildingLeft, ctx: StfContext): Effect[] {
  return [
    [
      closeVisit,
      {
        character_id: input.characterId,
        building_id: input.buildingId.toLowerCase(),
        left_ts: Math.floor(ctx.timestampMs / 1000),
        left_tx: input.txHash.toLowerCase(),
        left_log_index: input.logIndex,
      },
    ],
  ];
}
