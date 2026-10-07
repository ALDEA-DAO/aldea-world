import { describe, expect, it, vi } from "vitest";
import type { BirthChain, Simulation } from "../src/chain";
import type { Outbox, PendingCompletion } from "../src/db";
import { createCompleteBirthJob } from "../src/jobs/completeBirth";

/** The Midwife against an in-memory outbox and chain. */
function setup(pending: PendingCompletion[]) {
  let head = 100n;
  let clock = 0;
  const simulations = new Map<number, Simulation | Error>();
  const attempts: { outboxId: number; txHash?: string; error?: string }[] = [];
  const sent: number[] = [];
  const alerts: string[] = [];

  const outbox: Pick<Outbox, "pendingCompletions" | "recordAttempt"> = {
    pendingCompletions: async () => pending,
    recordAttempt: async (outboxId, attempt) => void attempts.push({ outboxId, ...attempt }),
  };
  const chain: BirthChain = {
    head: async () => head,
    simulateCompleteBirth: async (characterId) => {
      const result = simulations.get(characterId) ?? "ok";
      if (result instanceof Error) throw result;
      return result;
    },
    completeBirth: async (characterId) => {
      sent.push(characterId);
      return `0xtx${characterId}`;
    },
  };
  const job = createCompleteBirthJob({ outbox, chain, alert: (message) => void alerts.push(message), now: () => clock });
  return {
    job,
    attempts,
    sent,
    alerts,
    simulations,
    setHead: (n: bigint) => void (head = n),
    advance: (ms: number) => void (clock += ms),
  };
}

const birth = (id: number, characterId: number, notBeforeBlock: bigint): PendingCompletion => ({ id, characterId, notBeforeBlock });

describe("the Midwife", () => {
  it("waits for the target block, then completes the birth once", async () => {
    const t = setup([birth(1, 7, 104n)]);
    await t.job.tick();
    expect(t.sent).toEqual([]);

    t.setHead(104n);
    await t.job.tick();
    expect(t.sent).toEqual([7]);
    expect(t.attempts).toEqual([{ outboxId: 1, txHash: "0xtx7" }]);

    // the row stays pending until the STF sees CharacterBorn: no second transaction meanwhile
    await t.job.tick();
    await t.job.tick();
    expect(t.sent).toEqual([7]);
  });

  it("records a birth someone else completed without sending anything", async () => {
    const t = setup([birth(1, 7, 100n)]);
    t.simulations.set(7, "already_completed");
    await t.job.tick();
    await t.job.tick();
    expect(t.sent).toEqual([]);
    expect(t.attempts).toEqual([{ outboxId: 1, error: "already_completed" }]);
  });

  it("does nothing while the chain still says the birth is not ready", async () => {
    const t = setup([birth(1, 7, 100n)]);
    t.simulations.set(7, "not_ready");
    await t.job.tick();
    expect(t.sent).toEqual([]);
    expect(t.attempts).toEqual([]);
    t.simulations.set(7, "ok");
    await t.job.tick();
    expect(t.sent).toEqual([7]);
  });

  it("retries failures with a 2, 4, 8, 16 s backoff and alerts on the third in a row", async () => {
    const t = setup([birth(1, 7, 100n)]);
    t.simulations.set(7, new Error("rpc down"));

    await t.job.tick(); // failure 1 → retry in 2 s
    await t.job.tick();
    expect(t.attempts).toHaveLength(1);
    t.advance(2_000);
    await t.job.tick(); // failure 2 → retry in 4 s
    t.advance(3_999);
    await t.job.tick();
    expect(t.attempts).toHaveLength(2);
    expect(t.alerts).toEqual([]);
    t.advance(1);
    await t.job.tick(); // failure 3 → alert, retry in 8 s
    expect(t.alerts).toEqual(["completeBirth failed 3 times in a row"]);
    expect(t.job.failing()).toBe(1);

    t.simulations.set(7, "ok");
    t.advance(7_999);
    await t.job.tick();
    expect(t.sent).toEqual([]);
    t.advance(1);
    await t.job.tick();
    expect(t.sent).toEqual([7]);
    expect(t.job.failing()).toBe(0);
    expect(t.attempts.at(-1)).toEqual({ outboxId: 1, txHash: "0xtx7" });
  });

  it("goes around again when a trigger arrives during a pass, so a new block is never missed", async () => {
    const pending: PendingCompletion[] = [];
    let release = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    let reads = 0;
    const sent: number[] = [];
    const job = createCompleteBirthJob({
      outbox: {
        // the first read is slow (and sees nothing yet); the birth appears while it is in flight
        pendingCompletions: async () => {
          if (reads++ === 0) await gate;
          return reads === 1 ? [] : pending;
        },
        recordAttempt: async () => {},
      },
      chain: { head: async () => 100n, simulateCompleteBirth: async () => "ok", completeBirth: async (id) => (sent.push(id), `0xtx${id}`) },
      alert: () => {},
    });

    const first = job.tick();
    pending.push(birth(1, 7, 100n));
    await job.tick(); // arrives during the pass: returns at once, the running pass picks it up
    expect(sent).toEqual([]);
    release();
    await first;
    expect(sent).toEqual([7]);
    expect(reads).toBe(2);
  });

  it("completes independent births in the same pass and ignores overlapping passes", async () => {
    const t = setup([birth(1, 7, 100n), birth(2, 8, 100n), birth(3, 9, 200n)]);
    const complete = vi.fn();
    await Promise.all([t.job.tick().then(complete), t.job.tick().then(complete)]);
    expect(t.sent.sort()).toEqual([7, 8]);
    expect(complete).toHaveBeenCalledTimes(2);
  });
});
