import { describe, expect, it } from "vitest";
import { buildTally, canonicalHash, canonicalJson, councilOutcome, paramsInput, parseCouncilParams, tallyIsConsistent, voteInput, type CouncilParams, type TallyVote } from "../src/council";

const params: CouncilParams = {
  kind: "GenesisRatification",
  rule: "approved_unless_objected",
  objectionThresholdBps: 1000,
  weight: "aldea_balance_at_snapshot",
  voters: "founders_only",
  excludedCredentials: ["stake:" + "ee".repeat(28)],
  durationDays: 7,
};
const proposal = { proposalId: "0x" + "01".repeat(32), worldId: "0x" + "02".repeat(32), versionId: "0x" + "03".repeat(32), params, snapshotAt: 100, startsAt: 200, endsAt: 300 };
const holder = (n: number) => "stake:" + n.toString(16).padStart(2, "0").repeat(28);
const vote = (n: number, choice: TallyVote["choice"], weight: string): TallyVote => ({ credential: holder(n), almaIdHash: "0x" + "a".repeat(63) + n, choice, weight, inputTx: "0x" + "f".repeat(63) + n });

describe("the Charter's rule", () => {
  // eligible supply 1,000: the threshold (10%) is 100
  const cases: [string, { signatures: bigint; objections: bigint }, "approved" | "rejected"][] = [
    ["nobody votes: approved by silence", { signatures: 0n, objections: 0n }, "approved"],
    ["only signatures", { signatures: 400n, objections: 0n }, "approved"],
    ["objections below the threshold, with no signatures", { signatures: 0n, objections: 99n }, "approved"],
    ["objections at the threshold but not more than the signatures", { signatures: 100n, objections: 100n }, "approved"],
    ["objections above the threshold but fewer than the signatures", { signatures: 500n, objections: 300n }, "approved"],
    ["objections more than the signatures but below the threshold", { signatures: 10n, objections: 50n }, "approved"],
    ["objections exactly at the threshold and more than the signatures", { signatures: 99n, objections: 100n }, "rejected"],
    ["a qualified objection", { signatures: 200n, objections: 450n }, "rejected"],
  ];
  it.each(cases)("%s", (_, weights, outcome) => {
    expect(councilOutcome({ eligible: 1000n, objectionThresholdBps: 1000, ...weights })).toBe(outcome);
  });

  it("an empty snapshot approves by silence too", () => {
    expect(councilOutcome({ eligible: 0n, signatures: 0n, objections: 0n, objectionThresholdBps: 1000 })).toBe("approved");
  });

  it("holds beyond what a JSON number can", () => {
    const supply = 650_000_000_000_000n; // 650,000,000 $ALDEA in base units
    expect(councilOutcome({ eligible: supply, signatures: 1n, objections: supply / 10n, objectionThresholdBps: 1000 })).toBe("rejected");
    expect(councilOutcome({ eligible: supply, signatures: 1n, objections: supply / 10n - 1n, objectionThresholdBps: 1000 })).toBe("approved");
  });
});

describe("the tally", () => {
  const snapshot = [
    { credential: holder(3), weight: "600" },
    { credential: holder(1), weight: "300" },
    { credential: holder(2), weight: "100" },
  ];

  it("adds up, sorts by credential and applies the rule", () => {
    const tally = buildTally(proposal, snapshot, [vote(2, "object", "100"), vote(1, "sign", "300")]);
    expect(tally.snapshot.map((s) => s.credential)).toEqual([holder(1), holder(2), holder(3)]);
    expect(tally.votes.map((v) => v.credential)).toEqual([holder(1), holder(2)]);
    expect(tally.result).toEqual({ eligible: "1000", signatures: "300", objections: "100", participants: 2, outcome: "approved" });
  });

  it("hashes the same whatever order its rows and keys arrive in", () => {
    const a = buildTally(proposal, snapshot, [vote(1, "sign", "300"), vote(2, "object", "100")]);
    const b = buildTally({ ...proposal, params: JSON.parse(JSON.stringify(params, Object.keys(params).reverse())) as CouncilParams }, [...snapshot].reverse(), [vote(2, "object", "100"), vote(1, "sign", "300")]);
    expect(canonicalJson(a)).toBe(canonicalJson(b));
    expect(canonicalHash(a)).toBe(canonicalHash(b));
    expect(canonicalHash(a)).toMatch(/^0x[0-9a-f]{64}$/);
    // What is downloaded and parsed again hashes the same
    expect(canonicalHash(JSON.parse(canonicalJson(a)))).toBe(canonicalHash(a));
  });

  it("recomputes: a tally whose result, weights or voters were touched is not consistent", () => {
    const tally = buildTally(proposal, snapshot, [vote(3, "object", "600"), vote(1, "sign", "300")]);
    expect(tally.result.outcome).toBe("rejected");
    expect(tallyIsConsistent(tally)).toBe(true);
    expect(tallyIsConsistent({ ...tally, result: { ...tally.result, outcome: "approved" } })).toBe(false);
    expect(tallyIsConsistent({ ...tally, votes: tally.votes.map((v) => ({ ...v, weight: "1" })) })).toBe(false);
    expect(tallyIsConsistent({ ...tally, votes: [...tally.votes, vote(9, "sign", "5000")] })).toBe(false);
    expect(tallyIsConsistent({ ...tally, votes: [...tally.votes, tally.votes[0]!] })).toBe(false);
    expect(tallyIsConsistent({ ...tally, snapshot: [...tally.snapshot, { credential: params.excludedCredentials[0]!, weight: "1" }] })).toBe(false);
  });
});

describe("inputs and rules", () => {
  it("writes a vote as the state machine reads it", () => {
    expect(voteInput("0xAB", "sign")).toBe('["cv","0xab","s"]');
    expect(voteInput("0xAB", "object")).toBe('["cv","0xab","o"]');
  });

  it("posts the rules in canonical form", () => {
    const [prefix, id, json] = JSON.parse(paramsInput("0xAB", params)) as string[];
    expect([prefix, id]).toEqual(["cp", "0xab"]);
    expect(json).toBe(canonicalJson(params));
    expect(parseCouncilParams(JSON.parse(json!))).toEqual(params);
  });

  it("takes only well-formed rules", () => {
    expect(parseCouncilParams({ ...params, excludedCredentials: ["STAKE:" + "EE".repeat(28)] })?.excludedCredentials).toEqual(params.excludedCredentials);
    expect(parseCouncilParams({ ...params, extra: 1 })).toEqual(params);
    for (const bad of [null, "x", {}, { ...params, rule: "majority" }, { ...params, objectionThresholdBps: 0 }, { ...params, objectionThresholdBps: 10_001 }, { ...params, objectionThresholdBps: 12.5 }, { ...params, excludedCredentials: ["nobody"] }, { ...params, excludedCredentials: "none" }, { ...params, kind: "Other" }]) {
      expect(parseCouncilParams(bad)).toBeUndefined();
    }
  });
});
