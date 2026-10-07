import postgres from "postgres";
import type { Hex } from "viem";

/**
 * The relay's view of Effectstream's read model: it reads the outbox the STFs fill (deterministically: births to
 * complete, Council results to queue and to execute) and writes only
 * `relay_attempts`. Its Postgres role should be read-only on everything else. Outbox rows are closed by the STFs
 * themselves, when they observe the resulting on-chain event; the relay never marks them done.
 */

export interface PendingCompletion {
  /** relay_outbox.id */
  id: number;
  characterId: number;
  /** First Base block at which the completion can succeed (the target block + 1). */
  notBeforeBlock: bigint;
}

/** An approved Council result waiting to be queued on-chain. */
export interface PendingQueue {
  id: number;
  proposalId: Hex;
  versionId: Hex;
  /** keccak256 of the canonical tally, as the STF computed it at the close. */
  tallyHash: Hex;
}

/** A queued Council result waiting for its delay to pass. */
export interface PendingExecution {
  id: number;
  proposalId: Hex;
  /** Unix seconds from which it can be executed. */
  eta: number;
}

export interface Outbox {
  pendingCompletions(): Promise<PendingCompletion[]>;
  pendingQueues(): Promise<PendingQueue[]>;
  pendingExecutions(): Promise<PendingExecution[]>;
  recordAttempt(outboxId: number, attempt: { txHash?: string; error?: string }): Promise<void>;
}

export function createOutbox(databaseUrl: string): Outbox & { close: () => Promise<void> } {
  const sql = postgres(databaseUrl, { max: 2 });
  return {
    async pendingCompletions() {
      const rows = await sql<{ id: string; character_id: number; not_before_base_block: string | null }[]>`
        SELECT id, (payload->>'characterId')::int AS character_id, not_before_base_block
        FROM relay_outbox
        WHERE kind = 'complete_birth' AND status = 'pending'
        ORDER BY id`;
      return rows.map((r) => ({ id: Number(r.id), characterId: r.character_id, notBeforeBlock: BigInt(r.not_before_base_block ?? 0) }));
    },
    async pendingQueues() {
      const rows = await sql<{ id: string; payload: { proposalId: Hex; versionId: Hex; tallyHash: Hex } }[]>`
        SELECT id, payload FROM relay_outbox WHERE kind = 'council_queue' AND status = 'pending' ORDER BY id`;
      return rows.map((r) => ({ id: Number(r.id), ...r.payload }));
    },
    async pendingExecutions() {
      const rows = await sql<{ id: string; proposal_id: Hex; not_before_ts: string | null }[]>`
        SELECT id, payload->>'proposalId' AS proposal_id, not_before_ts FROM relay_outbox WHERE kind = 'council_execute' AND status = 'pending' ORDER BY id`;
      return rows.map((r) => ({ id: Number(r.id), proposalId: r.proposal_id, eta: Number(r.not_before_ts ?? 0) }));
    },
    async recordAttempt(outboxId, { txHash, error }) {
      await sql`INSERT INTO relay_attempts (outbox_id, tx_hash, error) VALUES (${outboxId}, ${txHash ?? null}, ${error ?? null})`;
    },
    close: () => sql.end(),
  };
}
