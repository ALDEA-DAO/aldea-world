import { buildTally, canonicalHash, canonicalJson, type CouncilParams, type CouncilTally, type TallyVote } from "@aldea/shared/council";
import { describe, expect, it } from "vitest";
import type { CouncilChain, CouncilSimulation } from "../src/chain";
import type { Outbox, PendingExecution, PendingQueue } from "../src/db";
import { createCouncilExecuteJob } from "../src/jobs/councilExecute";
import { createCouncilQueueJob, tallyProblem } from "../src/jobs/councilQueue";
import { createTallyPublisher, createTallySource } from "../src/tally";

/** The Council jobs against an in-memory outbox and an executor that behaves like the contract (delay, veto). */

const PID = `0x${"c1".repeat(32)}` as const;
const V0 = `0x${"b0".repeat(32)}` as const;
const DELAY = 600;
const params: CouncilParams = { kind: "GenesisRatification", rule: "approved_unless_objected", objectionThresholdBps: 1000, weight: "aldea_balance_at_snapshot", voters: "founders_only", excludedCredentials: [], durationDays: 7 };
const holder = (n: number) => "stake:" + n.toString(16).padStart(2, "0").repeat(28);
const vote = (n: number, choice: TallyVote["choice"], weight: string): TallyVote => ({ credential: holder(n), almaIdHash: "0x" + String(n).repeat(64), choice, weight, inputTx: "0x" + "f".repeat(64) });
const tallyWith = (votes: TallyVote[]): CouncilTally =>
  buildTally({ proposalId: PID, worldId: "0x" + "a0".repeat(32), versionId: V0, params, snapshotAt: 100, startsAt: 200, endsAt: 1000 }, [{ credential: holder(1), weight: "300" }, { credential: holder(2), weight: "700" }], votes);

function setup({ tally = tallyWith([vote(1, "sign", "300")]), served }: { tally?: CouncilTally; served?: string } = {}) {
  let clock = 0; // ms, this process
  let chainTime = 0; // s, Base
  const proposal: { state: "open" | "queued" | "vetoed" | "executed"; eta: number; official?: string; tallyURI?: string; tallyHash?: string } = { state: "open", eta: 0 };
  const queues: PendingQueue[] = [{ id: 1, proposalId: PID, versionId: V0, tallyHash: canonicalHash(tally) }];
  const executions: PendingExecution[] = [];
  const attempts: { outboxId: number; txHash?: string; error?: string }[] = [];
  const alerts: { message: string; context: Record<string, unknown> }[] = [];
  const published: string[] = [];
  let rpc: Error | undefined;

  const outbox: Outbox = {
    pendingCompletions: async () => [],
    pendingQueues: async () => queues,
    pendingExecutions: async () => executions,
    recordAttempt: async (outboxId, attempt) => void attempts.push({ outboxId, ...attempt }),
  };
  const queueState = (): CouncilSimulation => (proposal.state !== "open" ? "done" : chainTime < tally.endsAt ? "too_early" : "ok");
  const executeState = (): CouncilSimulation => (proposal.state !== "queued" ? "done" : chainTime < proposal.eta ? "too_early" : "ok");
  const failing = async <T>(value: () => T) => {
    if (rpc) throw rpc;
    return value();
  };
  const chain: CouncilChain = {
    simulateQueue: () => failing(queueState),
    queue: (_, versionId, tallyHash, tallyURI) =>
      failing(() => {
        if (queueState() !== "ok") throw new Error("queue reverted");
        Object.assign(proposal, { state: "queued", eta: chainTime + DELAY, tallyURI, tallyHash, official: undefined, versionId });
        // What the STF does when it sees ProposalQueued: the first job is done, the execution waits for the delay
        queues.length = 0;
        executions.push({ id: 2, proposalId: PID, eta: proposal.eta });
        return "0xqueue" as const;
      }),
    simulateExecute: () => failing(executeState),
    execute: () =>
      failing(() => {
        if (executeState() !== "ok") throw new Error("execute reverted");
        Object.assign(proposal, { state: "executed", official: V0 });
        executions.length = 0;
        return "0xexecute" as const;
      }),
  };
  const deps = { outbox, chain, alert: (message: string, context: Record<string, unknown>) => void alerts.push({ message, context }), now: () => clock };
  const queue = createCouncilQueueJob({
    ...deps,
    fetchTally: async () => served ?? canonicalJson(tally),
    publishTally: async (proposalId, json) => {
      published.push(json);
      return `ipfs://tally-of-${proposalId.slice(0, 6)}`;
    },
  });
  const execute = createCouncilExecuteJob(deps);
  return {
    queue,
    execute,
    proposal,
    attempts,
    alerts,
    published,
    tally,
    /** Both clocks move together, as they do outside tests. */
    advance(seconds: number) {
      clock += seconds * 1000;
      chainTime += seconds;
    },
    /** This process' clock alone: it runs ahead of Base's. */
    advanceOwnClock(seconds: number) {
      clock += seconds * 1000;
    },
    tick: async () => {
      await queue.tick();
      await execute.tick();
    },
    veto: () => {
      proposal.state = "vetoed";
    },
    failRpc: (err?: Error) => void (rpc = err),
  };
}

describe("the Charter on-chain", () => {
  it("waits for the close, queues the recomputed tally, waits out the delay and executes: the version is official", async () => {
    const t = setup();
    t.advance(999);
    await t.tick();
    expect(t.proposal.state).toBe("open");
    // Nothing is published for a proposal that cannot be queued yet
    expect(t.published).toEqual([]);

    t.advance(1);
    await t.tick();
    expect(t.proposal).toMatchObject({ state: "queued", eta: 1000 + DELAY, tallyURI: "ipfs://tally-of-0xc1c1", tallyHash: canonicalHash(t.tally) });
    expect(t.published).toEqual([canonicalJson(t.tally)]);
    expect(t.attempts).toEqual([{ outboxId: 1, txHash: "0xqueue" }]);

    // The delay: 600 s in which the guardian can veto and nobody can execute
    t.advance(DELAY - 1);
    await t.tick();
    expect(t.proposal.state).toBe("queued");
    t.advance(1);
    await t.tick();
    expect(t.proposal).toMatchObject({ state: "executed", official: V0 });
    expect(t.attempts.at(-1)).toEqual({ outboxId: 2, txHash: "0xexecute" });

    // Nothing is sent twice
    await t.tick();
    await t.tick();
    expect(t.attempts).toHaveLength(2);
    expect(t.alerts).toEqual([]);
  });

  it("leaves a vetoed result alone, before or after it was queued", async () => {
    const queued = setup();
    queued.advance(1000);
    await queued.tick();
    queued.veto();
    queued.advance(DELAY);
    await queued.tick();
    expect(queued.proposal.state).toBe("vetoed");
    expect(queued.attempts.at(-1)).toEqual({ outboxId: 2, error: "already_executed" });

    const open = setup();
    open.veto();
    open.advance(1000);
    await open.tick();
    expect(open.proposal.state).toBe("vetoed");
    expect(open.published).toEqual([]);
    expect(open.attempts).toEqual([{ outboxId: 1, error: "already_queued" }]);
  });

  it("does not execute while Base's clock is behind this one, and counts no failure for it", async () => {
    const t = setup();
    t.advance(1000);
    await t.tick();
    t.advanceOwnClock(DELAY);
    await t.tick();
    expect(t.proposal.state).toBe("queued");
    expect(t.attempts).toHaveLength(1);
    expect(t.execute.failing()).toBe(0);
    t.advance(DELAY);
    await t.tick();
    expect(t.proposal.state).toBe("executed");
  });

  it("never queues a tally that does not add up, and says so once", async () => {
    const real = tallyWith([vote(1, "sign", "300"), vote(2, "object", "700")]);
    expect(real.result.outcome).toBe("rejected");
    // The read model claims it was approved: the hash recorded at the close is of the forged tally
    const forged = { ...real, result: { ...real.result, outcome: "approved" as const } };
    const t = setup({ tally: forged });
    t.advance(1000);
    await t.tick();
    t.advance(2);
    await t.tick();
    expect(t.proposal.state).toBe("open");
    expect(t.published).toEqual([]);
    expect(t.alerts.filter((a) => a.message.startsWith("the Council tally"))).toEqual([
      { message: "the Council tally does not add up: not queued", context: { proposalId: PID, tallyHash: canonicalHash(forged), problem: "its result is not what its snapshot and votes give" } },
    ]);
    expect(t.attempts[0]!.error).toContain("its result is not what its snapshot and votes give");

    // A tally other than the one whose hash was recorded, or something that is not a tally
    const swapped = setup({ served: canonicalJson(tallyWith([])) });
    swapped.advance(1000);
    await swapped.tick();
    expect(swapped.alerts[0]!.context.problem).toBe("its hash is not the one computed at the close");
    const garbage = setup({ served: "<html>" });
    garbage.advance(1000);
    await garbage.tick();
    expect(garbage.alerts[0]!.context.problem).toBe("it is not a tally");
    expect(garbage.proposal.state).toBe("open");
  });

  it("retries when Base cannot be reached and alerts on the third failure in a row", async () => {
    const t = setup();
    t.advance(1000);
    t.failRpc(new Error("rpc down"));
    await t.tick();
    t.advance(2);
    await t.tick();
    t.advance(4);
    await t.tick();
    expect(t.alerts.map((a) => a.message)).toEqual(["councilQueue failed 3 times in a row"]);
    expect(t.queue.failing()).toBe(1);
    t.failRpc(undefined);
    t.advance(8);
    await t.tick();
    expect(t.proposal.state).toBe("queued");
    expect(t.queue.failing()).toBe(0);
  });
});

describe("what can be queued", () => {
  const tally = tallyWith([vote(1, "sign", "300")]);
  const expected = { proposalId: PID, versionId: V0, tallyHash: canonicalHash(tally) };

  it("the tally of that proposal and version, approved, hashing to what the close recorded", () => {
    expect(tallyProblem(tally, expected)).toBeUndefined();
    expect(tallyProblem(tally, { ...expected, tallyHash: expected.tallyHash.toUpperCase().replace("0X", "0x") })).toBeUndefined();
    expect(tallyProblem(tally, { ...expected, versionId: "0x" + "b1".repeat(32) })).toBe("it is the tally of another proposal or version");
    const rejected = tallyWith([vote(2, "object", "700")]);
    expect(tallyProblem(rejected, { ...expected, tallyHash: canonicalHash(rejected) })).toBe("it was not approved");
  });
});

describe("publishing the tally", () => {
  it("without a pinning key, the URI is the read model's public address for that tally", async () => {
    const publish = createTallyPublisher({ publicUrl: createTallySource("https://read.aldea.world/").url });
    expect(await publish(PID, "{}")).toBe(`https://read.aldea.world/api/v1/council/proposals/${PID}/tally.json`);
  });
});
