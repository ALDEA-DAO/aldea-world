import type { Outbox } from "../db";

/**
 * What every relay job does with its rows of the outbox: run each one once, retry failures with a backoff of 2, 4, 8
 * and 16 s, and raise an alert after three in a row.
 *
 * A row is never marked done here: the STF closes it when it sees the resulting on-chain event. Until then the job
 * remembers which rows it already settled, and after a restart the chain itself says so (each job simulates first).
 */

export interface JobDeps {
  /** Called when a row failed three times in a row. */
  alert: (message: string, context: Record<string, unknown>) => void;
  now?: () => number;
  log?: (message: string, context?: Record<string, unknown>) => void;
}

export interface OutboxJob<Row extends { id: number }> {
  /** Names the job in alerts. */
  name: string;
  pending(): Promise<Row[]>;
  /** Narrows the rows due in this pass to the ones that can run now. Not called when none is due. */
  ready?(due: Row[]): Promise<Row[]>;
  /** Does the row's work and records its attempt. "wait" leaves it for a later pass without counting a failure. */
  run(row: Row): Promise<"settled" | "wait">;
  /** What identifies the row in an alert. */
  describe(row: Row): Record<string, unknown>;
}

const BACKOFF_MS = [2_000, 4_000, 8_000, 16_000];
const ALERT_AFTER = 3;

export function createOutboxJob<Row extends { id: number }>(job: OutboxJob<Row>, outbox: Pick<Outbox, "recordAttempt">, { alert, now = Date.now }: JobDeps) {
  /** Outbox rows this process already resolved. */
  const settled = new Set<number>();
  const inFlight = new Set<number>();
  const failures = new Map<number, { count: number; retryAt: number }>();
  let ticking = false;
  let again = false;

  async function attempt(row: Row) {
    inFlight.add(row.id);
    try {
      if ((await job.run(row)) === "wait") return;
      settled.add(row.id);
      failures.delete(row.id);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const count = (failures.get(row.id)?.count ?? 0) + 1;
      failures.set(row.id, { count, retryAt: now() + BACKOFF_MS[Math.min(count, BACKOFF_MS.length) - 1]! });
      await outbox.recordAttempt(row.id, { error: message.slice(0, 500) }).catch(() => undefined);
      if (count === ALERT_AFTER) alert(`${job.name} failed 3 times in a row`, { ...job.describe(row), outboxId: row.id, error: message });
    } finally {
      inFlight.delete(row.id);
    }
  }

  async function pass() {
    const pending = await job.pending();
    const live = new Set(pending.map((p) => p.id));
    for (const id of settled) if (!live.has(id)) settled.delete(id);
    for (const id of failures.keys()) if (!live.has(id)) failures.delete(id);
    const due = pending.filter((p) => !settled.has(p.id) && !inFlight.has(p.id) && (failures.get(p.id)?.retryAt ?? 0) <= now());
    if (due.length === 0) return;
    await Promise.all((job.ready ? await job.ready(due) : due).map(attempt));
  }

  return {
    /**
     * Runs a pass over the outbox. Safe to call concurrently: a call that arrives during a pass (a new block, the
     * timer) does not start a second one, but makes the running one go around again, so no trigger is lost.
     */
    async tick() {
      if (ticking) {
        again = true;
        return;
      }
      ticking = true;
      try {
        do {
          again = false;
          await pass();
        } while (again);
      } finally {
        ticking = false;
      }
    },
    /** For /health: how many rows are failing right now. */
    failing: () => failures.size,
    /** For /alerts: how many rows have failed three or more times in a row. */
    alerting: () => [...failures.values()].filter((failure) => failure.count >= ALERT_AFTER).length,
  };
}
