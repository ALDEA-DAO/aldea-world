import canonicalize from "canonicalize";
import { keccak256, toBytes, type Hex } from "viem";

/**
 * The Council's rules, shared by whoever applies them (the Effectstream node), whoever checks them (the relay, before
 * queueing a result on-chain) and whoever wants to recompute them (the client, or anyone with the tally).
 *
 * Amounts are $ALDEA in base units, as decimal strings: they do not fit a JSON number.
 */

/** A proposal's rules, published as JSON at its `paramsURI`. */
export interface CouncilParams {
  kind: "GenesisRatification" | "SeasonElection";
  rule: "approved_unless_objected";
  /** Share of the eligible supply the objections must reach to reject, in basis points (1000 = 10%). */
  objectionThresholdBps: number;
  weight: "aldea_balance_at_snapshot";
  voters: "founders_only";
  /** Credentials left out of the eligible supply (`stake:<hex28>`, `pay:<hex28>` or `addr:<hex>`): treasury, vesting, pools. */
  excludedCredentials: string[];
  durationDays: number;
}

export type CouncilChoice = "sign" | "object";
export type CouncilOutcome = "approved" | "rejected";

const CREDENTIAL = /^(stake|pay):[0-9a-f]{56}$|^addr:[0-9a-f]+$/;

/** The params if `value` is a well-formed set of rules; undefined otherwise. Credentials come out in lowercase. */
export function parseCouncilParams(value: unknown): CouncilParams | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const p = value as Record<string, unknown>;
  if (p.kind !== "GenesisRatification" && p.kind !== "SeasonElection") return undefined;
  if (p.rule !== "approved_unless_objected" || p.weight !== "aldea_balance_at_snapshot" || p.voters !== "founders_only") return undefined;
  if (!Number.isInteger(p.objectionThresholdBps) || (p.objectionThresholdBps as number) < 1 || (p.objectionThresholdBps as number) > 10_000) return undefined;
  if (!Number.isInteger(p.durationDays) || (p.durationDays as number) < 0) return undefined;
  if (!Array.isArray(p.excludedCredentials)) return undefined;
  const excluded = p.excludedCredentials.map((c) => (typeof c === "string" ? c.toLowerCase() : ""));
  if (excluded.some((c) => !CREDENTIAL.test(c))) return undefined;
  return {
    kind: p.kind,
    rule: p.rule,
    objectionThresholdBps: p.objectionThresholdBps as number,
    weight: p.weight,
    voters: p.voters,
    excludedCredentials: excluded,
    durationDays: p.durationDays as number,
  };
}

/** JCS (RFC 8785): one byte sequence per value, whatever the key order it was written in. */
export function canonicalJson(value: unknown): string {
  const json = canonicalize(value);
  if (json === undefined) throw new Error("Value cannot be canonicalized");
  return json;
}

/** keccak256(utf8(JCS(value))): how params and tallies are named on-chain. */
export const canonicalHash = (value: unknown): Hex => keccak256(toBytes(canonicalJson(value)));

/**
 * The rule: a proposal is rejected only if the objections outweigh the signatures and also reach the threshold share
 * of the eligible supply. Anything else (silence included) approves it.
 */
export function councilOutcome({ eligible, signatures, objections, objectionThresholdBps }: { eligible: bigint; signatures: bigint; objections: bigint; objectionThresholdBps: number }): CouncilOutcome {
  return objections > signatures && objections * 10_000n >= eligible * BigInt(objectionThresholdBps) ? "rejected" : "approved";
}

export interface TallyVote {
  /** The voter's Cardano credential, as the snapshot names it. */
  credential: string;
  /** The Founder soul that credential sealed. */
  almaIdHash: string;
  choice: CouncilChoice;
  /** The credential's snapshot balance. */
  weight: string;
  /** The Base transaction that carried the signed vote: public evidence. */
  inputTx: string;
}

/** Everything needed to recompute a proposal's result. Its canonical hash is what goes on-chain as `tallyHash`. */
export interface CouncilTally {
  proposalId: string;
  worldId: string;
  /** What is ratified (Genesis: the one version proposed). */
  versionId: string;
  params: CouncilParams;
  /** Unix seconds, as opened on-chain. */
  snapshotAt: number;
  startsAt: number;
  endsAt: number;
  /** Every credential with $ALDEA at the snapshot, without the excluded ones, by credential. */
  snapshot: { credential: string; weight: string }[];
  /** Each voter's last vote, by credential. */
  votes: TallyVote[];
  result: { eligible: string; signatures: string; objections: string; participants: number; outcome: CouncilOutcome };
}

const byCredential = (a: { credential: string }, b: { credential: string }) => (a.credential < b.credential ? -1 : a.credential > b.credential ? 1 : 0);

/** Builds the tally from a snapshot and the votes: sorts both, adds up and applies the rule. */
export function buildTally(proposal: Omit<CouncilTally, "snapshot" | "votes" | "result">, snapshot: { credential: string; weight: string }[], votes: TallyVote[]): CouncilTally {
  const sum = (weights: string[]) => weights.reduce((total, w) => total + BigInt(w), 0n);
  const eligible = sum(snapshot.map((s) => s.weight));
  const signatures = sum(votes.filter((v) => v.choice === "sign").map((v) => v.weight));
  const objections = sum(votes.filter((v) => v.choice === "object").map((v) => v.weight));
  return {
    ...proposal,
    snapshot: [...snapshot].sort(byCredential),
    votes: [...votes].sort(byCredential),
    result: {
      eligible: eligible.toString(),
      signatures: signatures.toString(),
      objections: objections.toString(),
      participants: votes.length,
      outcome: councilOutcome({ eligible, signatures, objections, objectionThresholdBps: proposal.params.objectionThresholdBps }),
    },
  };
}

/**
 * Recomputes a downloaded tally from its own snapshot and votes: true when its result is what the rule gives. With
 * `canonicalHash(tally)` equal to the on-chain `tallyHash`, that is the whole verification.
 */
export function tallyIsConsistent(tally: CouncilTally): boolean {
  const { snapshot, votes, result, ...proposal } = tally;
  const weights = new Map(snapshot.map((s) => [s.credential, s.weight]));
  if (weights.size !== snapshot.length || new Set(votes.map((v) => v.credential)).size !== votes.length) return false;
  if (snapshot.some((s) => proposal.params.excludedCredentials.includes(s.credential))) return false;
  if (votes.some((v) => weights.get(v.credential) !== v.weight || BigInt(v.weight) <= 0n)) return false;
  return canonicalJson(buildTally(proposal, snapshot, votes).result) === canonicalJson(result);
}

/** A vote as the voter signs it and the state machine reads it: `["cv","<proposalId>","s"]` to sign, `"o"` to object. */
export const voteInput = (proposalId: string, choice: CouncilChoice) => JSON.stringify(["cv", proposalId.toLowerCase(), choice === "sign" ? "s" : "o"]);

/** A proposal's rules as the guardian posts them for the state machine: `["cp","<proposalId>","<canonical JSON>"]`. */
export const paramsInput = (proposalId: string, params: CouncilParams) => JSON.stringify(["cp", proposalId.toLowerCase(), canonicalJson(params)]);

/** Effectstream's security namespace of this world: part of what a voter signs, so a vote cannot be replayed elsewhere. */
export const COUNCIL_NAMESPACE = "aldea-world";

/**
 * The exact text a wallet signs to publish `input` through a batcher (Effectstream's format): the namespace, the
 * time in milliseconds, the signing address and the input, with everything but letters and digits turned into `-`.
 */
export const signedInputMessage = (address: string, timestampMs: number, input: string, namespace = COUNCIL_NAMESPACE) =>
  `${namespace}${timestampMs}${address}${input}`.replace(/[^a-zA-Z0-9]/g, "-").toLowerCase();
