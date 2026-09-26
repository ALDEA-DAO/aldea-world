import { sql } from "../sql.ts";

/** Idempotent: replaying the same CharacterBirthRequested leaves one row. */
export const insertBirthRequested = sql<{
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
