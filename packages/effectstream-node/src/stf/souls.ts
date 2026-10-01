import { sql } from "../sql.ts";
import type { Effect } from "./births.ts";

/** Souls anchored in AlmaAnchorRegistry (humans, organizations, agents): the Resolver learns about anchors here. */

export interface SoulAnchored {
  almaIdHash: string;
  almaId: string;
  subjectType: number;
  controller: string;
  txHash: string;
  blockNumber: number;
}

/** An anchor never changes identity; controller rotations are separate events. Replays are no-ops. */
const insertAnchor = sql<{ alma_id_hash: string; alma_id: string; subject_type: number; controller: string; anchored_block: number; tx_hash: string }>(
  `INSERT INTO souls_anchored (alma_id_hash, alma_id, subject_type, controller, anchored_block, tx_hash)
VALUES (:alma_id_hash!, :alma_id!, :subject_type!, :controller!, :anchored_block!, :tx_hash!)
ON CONFLICT (alma_id_hash) DO NOTHING`,
);

export function soulAnchored(input: SoulAnchored): Effect[] {
  return [
    [
      insertAnchor,
      {
        alma_id_hash: input.almaIdHash.toLowerCase(),
        alma_id: input.almaId,
        subject_type: input.subjectType,
        controller: input.controller.toLowerCase(),
        anchored_block: input.blockNumber,
        tx_hash: input.txHash.toLowerCase(),
      },
    ],
  ];
}
