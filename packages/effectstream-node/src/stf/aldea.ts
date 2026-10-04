import { credentialOf } from "../cardano/credentials.ts";
import { sql } from "../sql.ts";
import type { Effect, StfContext } from "./births.ts";

/**
 * $ALDEA holdings in the read model, from the asset's UTxOs on Cardano (the delayed-asset primitive): an output that
 * holds the asset adds to its credential's balance, and spending that output takes it away.
 *
 * Like every STF here: pure, idempotent on replay, and no statement can fail on chain data.
 */

/** The delayed-asset primitive's input: `amount` is the quantity for a new output and "" for a spent one. */
export interface AldeaUtxo {
  /** The output's address, as hex bytes. */
  address: string;
  txId: string;
  outputIndex: string;
  amount: string;
}

/** Counts the output once: a replay finds it already there and changes nothing. */
const addUtxo = sql<{ tx_id: string; output_index: number; credential: string; amount: string; height: number }>(
  `WITH utxo AS (
  INSERT INTO aldea_utxos (tx_id, output_index, credential, amount, created_height)
  VALUES (:tx_id!, :output_index!, :credential!, :amount!::numeric, :height!)
  ON CONFLICT (tx_id, output_index) DO NOTHING
  RETURNING credential, amount
)
INSERT INTO aldea_holdings (credential, balance, updated_height)
SELECT credential, amount, :height!::bigint FROM utxo
ON CONFLICT (credential) DO UPDATE SET balance = aldea_holdings.balance + EXCLUDED.balance, updated_height = EXCLUDED.updated_height`,
);

/** Takes the output's amount away once; an output this node never saw (created before it started) is ignored. */
const spendUtxo = sql<{ tx_id: string; output_index: number; height: number }>(
  `WITH utxo AS (
  UPDATE aldea_utxos SET spent_height = :height!
  WHERE tx_id = :tx_id! AND output_index = :output_index! AND spent_height IS NULL
  RETURNING credential, amount
)
UPDATE aldea_holdings h SET balance = h.balance - utxo.amount, updated_height = :height!
FROM utxo WHERE h.credential = utxo.credential`,
);

export function aldeaUtxo(input: AldeaUtxo, ctx: StfContext): Effect[] {
  const key = { tx_id: input.txId.toLowerCase(), output_index: Number(input.outputIndex), height: ctx.height };
  if (input.amount === "") return [[spendUtxo, key]];
  // Quantities are integers in base units; anything else is not this asset's amount
  if (!/^\d+$/.test(input.amount)) return [];
  return [[addUtxo, { ...key, credential: credentialOf(input.address), amount: input.amount }]];
}
