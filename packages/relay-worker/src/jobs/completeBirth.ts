import type { BirthChain } from "../chain";
import type { Outbox } from "../db";

/**
 * The Midwife: completes the births Effectstream queued in the outbox as soon as their target block exists.
 *
 * - A completion is sent once: after a success (or finding it already completed) the row is left to the STF, which
 *   closes it when it sees `CharacterBorn`. If the relay restarts meanwhile, the simulation answers
 *   `already_completed` and nothing is sent.
 * - Failures retry with a backoff of 2, 4, 8 and 16 s; three in a row raise an alert.
 */

export interface CompleteBirthDeps {
  outbox: Outbox;
  chain: BirthChain;
  /** Called when a completion failed three times in a row. */
  alert: (message: string, context: Record<string, unknown>) => void;
  now?: () => number;
  log?: (message: string, context?: Record<string, unknown>) => void;
}

const BACKOFF_MS = [2_000, 4_000, 8_000, 16_000];
const ALERT_AFTER = 3;

export function createCompleteBirthJob({ outbox, chain, alert, now = Date.now, log = () => {} }: CompleteBirthDeps) {
  /** Outbox rows this process already resolved (sent or found completed). */
  const settled = new Set<number>();
  const inFlight = new Set<number>();
  const failures = new Map<number, { count: number; retryAt: number }>();
  let ticking = false;
  let again = false;

  async function complete(id: number, characterId: number) {
    inFlight.add(id);
    try {
      const simulation = await chain.simulateCompleteBirth(characterId);
      if (simulation === "not_ready") return;
      if (simulation === "already_completed") {
        await outbox.recordAttempt(id, { error: "already_completed" });
        log("birth already completed", { characterId });
      } else {
        const txHash = await chain.completeBirth(characterId);
        await outbox.recordAttempt(id, { txHash });
        log("birth completed", { characterId, txHash });
      }
      settled.add(id);
      failures.delete(id);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const count = (failures.get(id)?.count ?? 0) + 1;
      failures.set(id, { count, retryAt: now() + BACKOFF_MS[Math.min(count, BACKOFF_MS.length) - 1]! });
      await outbox.recordAttempt(id, { error: message.slice(0, 500) }).catch(() => undefined);
      if (count === ALERT_AFTER) alert("completeBirth failed 3 times in a row", { characterId, outboxId: id, error: message });
    } finally {
      inFlight.delete(id);
    }
  }

  /** One pass: completes every due birth whose target block exists. */
  async function pass() {
    const pending = await outbox.pendingCompletions();
    const live = new Set(pending.map((p) => p.id));
    for (const id of settled) if (!live.has(id)) settled.delete(id);
    for (const id of failures.keys()) if (!live.has(id)) failures.delete(id);
    const due = pending.filter((p) => !settled.has(p.id) && !inFlight.has(p.id) && (failures.get(p.id)?.retryAt ?? 0) <= now());
    if (due.length === 0) return;
    const head = await chain.head();
    await Promise.all(due.filter((p) => head >= p.notBeforeBlock).map((p) => complete(p.id, p.characterId)));
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
    /** For /health: how many completions are failing right now. */
    failing: () => failures.size,
  };
}
