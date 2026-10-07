import { sql } from "../sql.ts";
import type { Effect } from "./births.ts";

/**
 * Founder seals in the read model (FounderSystem's FounderClaimed): the soul, the Cardano credential it claimed with
 * and the $ALDEA it held then. One seal per soul and per credential, as on-chain; a replay changes nothing.
 */

export interface FounderClaimed {
  almaIdHash: string;
  cardanoStakeCredential: string;
  aldeaBalance: string;
  snapshotSlot: string;
  txHash: string;
  blockNumber: number;
}

const insertFounder = sql<{ alma_id_hash: string; stake_credential: string; aldea_balance: string; snapshot_slot: string; claimed_block: number; tx_hash: string }>(
  `INSERT INTO founders (alma_id_hash, stake_credential, aldea_balance, snapshot_slot, claimed_block, tx_hash)
VALUES (:alma_id_hash!, :stake_credential!, :aldea_balance!::numeric, :snapshot_slot!::bigint, :claimed_block!, :tx_hash!)
ON CONFLICT DO NOTHING`,
);

export function founderClaimed(input: FounderClaimed): Effect[] {
  return [
    [
      insertFounder,
      {
        alma_id_hash: input.almaIdHash.toLowerCase(),
        // 28 bytes as hex, without 0x: the same form the holdings use after `stake:`
        stake_credential: input.cardanoStakeCredential.toLowerCase().replace(/^0x/, ""),
        aldea_balance: input.aldeaBalance,
        snapshot_slot: input.snapshotSlot,
        claimed_block: input.blockNumber,
        tx_hash: input.txHash.toLowerCase(),
      },
    ],
  ];
}
