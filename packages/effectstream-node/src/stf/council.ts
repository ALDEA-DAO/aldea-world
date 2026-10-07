import { buildTally, canonicalHash, parseCouncilParams, type CouncilTally, type TallyVote } from "@aldea/shared/council";
import { sql } from "../sql.ts";
import type { Effect, StfContext } from "./births.ts";

/**
 * The Council in the read model: proposals as AldeaCouncilExecutor opens, queues, vetoes and executes them, the
 * snapshot of $ALDEA holdings each one is weighed with, the Founders' votes, and the tally at the close.
 *
 * A proposal goes `scheduled` → `snapshotted` (holdings copied, without the excluded credentials) → `open` (from
 * `startsAt`, once its rules are known) → `closed` (tallied) → `queued` → `executed`, or `vetoed` at any point.
 * The state machine cannot fetch the rules at `paramsURI`, so the guardian posts them as an input; the first valid
 * ones stay.
 *
 * Like every STF here: deterministic, idempotent on replay, and no statement can fail on chain data.
 */

interface Log {
  txHash: string;
  logIndex: number;
  blockNumber: number;
}

export interface CouncilOpened extends Log {
  proposalId: string;
  kind: number;
  worldId: string;
  versionId: string;
  snapshotAt: string;
  startsAt: string;
  endsAt: string;
  paramsURI: string;
}
export type CouncilQueued = Log & { proposalId: string; versionId: string; tallyHash: string; tallyURI: string; eta: string };
export type CouncilVetoed = Log & { proposalId: string; by: string; reason: string };
export type CouncilExecuted = Log & { proposalId: string };

const KINDS = ["GenesisRatification", "SeasonElection"] as const;
/** Unix seconds a proposal can be scheduled with: beyond this (the year 5138) a timestamp is not a date. */
const MAX_SECONDS = 100_000_000_000n;
/** Postgres text cannot hold NUL, and a contract string can. */
const text = (value: string, max = 2_000) => value.replaceAll("\u0000", "").slice(0, max);
const seconds = (value: string) => (/^\d+$/.test(value) && BigInt(value) <= MAX_SECONDS ? Number(value) : undefined);

export const queueKey = (proposalId: string) => `council_queue:${proposalId}`;
export const executeKey = (proposalId: string) => `council_execute:${proposalId}`;

const insertProposal = sql<{
  proposal_id: string;
  kind: number;
  world_id: string;
  version_id: string;
  snapshot_at: number;
  starts_at: number;
  ends_at: number;
  params_uri: string;
  opened_block: number;
  opened_tx: string;
}>(`INSERT INTO council_proposals (proposal_id, kind, world_id, version_ids, snapshot_at, starts_at, ends_at, params, status, params_uri, opened_block, opened_tx)
VALUES (:proposal_id!, :kind!, :world_id!, ARRAY[:version_id!]::text[], :snapshot_at!, :starts_at!, :ends_at!, '{}'::jsonb, 'scheduled', :params_uri!, :opened_block!, :opened_tx!)
ON CONFLICT (proposal_id) DO NOTHING
RETURNING proposal_id, snapshot_at, starts_at, ends_at`);

/**
 * ProposalOpened: the proposal, to be snapshotted, opened and closed at its times. The statement returns the row only
 * when it is new, which is when the state machine sets its timers.
 */
export function councilOpened(input: CouncilOpened): Effect[] {
  const [snapshotAt, startsAt, endsAt] = [seconds(input.snapshotAt), seconds(input.startsAt), seconds(input.endsAt)];
  if (snapshotAt === undefined || startsAt === undefined || endsAt === undefined || !(input.kind in KINDS)) return [];
  return [
    [
      insertProposal,
      {
        proposal_id: input.proposalId.toLowerCase(),
        kind: input.kind,
        world_id: input.worldId.toLowerCase(),
        version_id: input.versionId.toLowerCase(),
        snapshot_at: snapshotAt,
        starts_at: startsAt,
        ends_at: endsAt,
        params_uri: text(input.paramsURI),
        opened_block: input.blockNumber,
        opened_tx: input.txHash.toLowerCase(),
      },
    ],
  ];
}

/** Copies who holds $ALDEA right now, without the credentials the rules exclude (when the rules are already known). */
const takeSnapshot = sql<{ proposal_id: string }>(
  `INSERT INTO council_snapshots (proposal_id, credential, weight)
SELECT p.proposal_id, h.credential, h.balance
FROM council_proposals p CROSS JOIN aldea_holdings h
WHERE p.proposal_id = :proposal_id! AND p.status = 'scheduled' AND h.balance > 0
  AND NOT coalesce(p.params->'excludedCredentials', '[]'::jsonb) @> to_jsonb(h.credential)
ON CONFLICT (proposal_id, credential) DO NOTHING`,
);
const markSnapshotted = sql<{ proposal_id: string; height: number }>(
  `UPDATE council_proposals SET status = 'snapshotted', snapshot_height = :height! WHERE proposal_id = :proposal_id! AND status = 'scheduled'`,
);
/** Voting starts when the three things hold: the snapshot is taken, the rules are known and the time has come. */
const openIfReady = sql<{ proposal_id: string; now: number }>(
  `UPDATE council_proposals SET status = 'open'
WHERE proposal_id = :proposal_id! AND status = 'snapshotted' AND params_hash IS NOT NULL AND starts_at <= :now! AND ends_at > :now!
RETURNING proposal_id, status`,
);

const now = (ctx: StfContext) => Math.floor(ctx.timestampMs / 1000);

/**
 * The snapshot, at the first block at or after `snapshotAt`. Taken once: later calls find the proposal already
 * snapshotted and change nothing, so every timer can make sure of it first.
 */
export function councilSnapshot(proposalId: string, ctx: StfContext): Effect[] {
  const proposal_id = proposalId.toLowerCase();
  return [
    [takeSnapshot, { proposal_id }],
    [markSnapshotted, { proposal_id, height: ctx.height }],
    [openIfReady, { proposal_id, now: now(ctx) }],
  ];
}

const setParams = sql<{ proposal_id: string; kind: number; params: string; params_hash: string }>(
  `UPDATE council_proposals SET params = :params!::jsonb, params_hash = :params_hash!
WHERE proposal_id = :proposal_id! AND kind = :kind! AND params_hash IS NULL AND status IN ('scheduled', 'snapshotted')
RETURNING proposal_id`,
);
/** A snapshot taken before the rules arrived still holds the excluded credentials. */
const dropExcluded = sql<{ proposal_id: string }>(
  `DELETE FROM council_snapshots s USING council_proposals p
WHERE s.proposal_id = :proposal_id! AND p.proposal_id = s.proposal_id AND p.params->'excludedCredentials' @> to_jsonb(s.credential)`,
);

/**
 * A proposal's rules, posted by the guardian (the caller checks who posted them). Only well-formed rules of the
 * proposal's kind are taken, only before voting starts, and only once.
 */
export function councilParams(input: { proposalId: string; params: string }, ctx: StfContext): Effect[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(input.params);
  } catch {
    return [];
  }
  const params = parseCouncilParams(parsed);
  if (!params) return [];
  const proposal_id = input.proposalId.toLowerCase();
  return [
    [setParams, { proposal_id, kind: KINDS.indexOf(params.kind), params: JSON.stringify(params), params_hash: canonicalHash(params) }],
    [dropExcluded, { proposal_id }],
    [openIfReady, { proposal_id, now: now(ctx) }],
  ];
}

/** The proposal opens at `startsAt` if it is ready (and when its rules arrive, if they arrive later). */
export function councilOpen(proposalId: string, ctx: StfContext): Effect[] {
  return councilSnapshot(proposalId, ctx);
}

/**
 * A vote counts when the proposal is open at this block's time, the credential that signed sealed a Founder, and it
 * had $ALDEA in the snapshot. A voter's later vote replaces their earlier one. Returns the vote when it counted.
 */
const castVote = sql<{ proposal_id: string; credential: string; stake_credential: string; choice: string; input_tx: string; height: number; now: number }>(
  `INSERT INTO council_votes (proposal_id, credential, alma_id_hash, choice, weight, input_tx, height)
SELECT p.proposal_id, s.credential, f.alma_id_hash, :choice!, s.weight, :input_tx!, :height!
FROM council_proposals p
JOIN council_snapshots s ON s.proposal_id = p.proposal_id AND s.credential = :credential! AND s.weight > 0
JOIN founders f ON f.stake_credential = :stake_credential!
WHERE p.proposal_id = :proposal_id! AND p.status = 'open' AND p.starts_at <= :now! AND p.ends_at > :now!
ON CONFLICT (proposal_id, credential) DO UPDATE SET choice = EXCLUDED.choice, input_tx = EXCLUDED.input_tx, height = EXCLUDED.height
RETURNING proposal_id, choice`,
);

/** `credential` is who signed (`stake:<hex28>` or `pay:<hex28>`); `inputTx`, the Base transaction that carried the vote. */
export function vote(input: { proposalId: string; choice: "s" | "o" }, credential: string, inputTx: string, ctx: StfContext): Effect[] {
  return [
    [
      castVote,
      {
        proposal_id: input.proposalId.toLowerCase(),
        credential,
        stake_credential: credential.slice(credential.indexOf(":") + 1),
        choice: input.choice === "s" ? "sign" : "object",
        input_tx: inputTx.toLowerCase(),
        height: ctx.height,
        now: now(ctx),
      },
    ],
  ];
}

/** Closes the proposal at its end and returns it, once. */
export const closeProposal = sql<{ proposal_id: string; now: number }, ProposalRow>(
  `UPDATE council_proposals SET status = 'closed'
WHERE proposal_id = :proposal_id! AND status IN ('scheduled', 'snapshotted', 'open') AND ends_at <= :now!
RETURNING proposal_id, kind, world_id, version_ids, snapshot_at, starts_at, ends_at, params, params_hash`,
);
export const selectProposal = sql<{ proposal_id: string }, ProposalRow>(
  `SELECT proposal_id, kind, world_id, version_ids, snapshot_at, starts_at, ends_at, params, params_hash FROM council_proposals WHERE proposal_id = :proposal_id!`,
);
export const selectStatus = sql<{ proposal_id: string }, { status: string }>(`SELECT status FROM council_proposals WHERE proposal_id = :proposal_id!`);
export const selectSnapshot = sql<{ proposal_id: string }, { credential: string; weight: string }>(
  `SELECT credential, weight::text AS weight FROM council_snapshots WHERE proposal_id = :proposal_id! ORDER BY credential`,
);
export const selectVotes = sql<{ proposal_id: string }, { credential: string; alma_id_hash: string; choice: "sign" | "object"; weight: string; input_tx: string }>(
  `SELECT credential, alma_id_hash, choice, weight::text AS weight, input_tx FROM council_votes WHERE proposal_id = :proposal_id! ORDER BY credential`,
);

export interface ProposalRow {
  proposal_id: string;
  kind: number;
  world_id: string;
  version_ids: string[];
  snapshot_at: string | number;
  starts_at: string | number;
  ends_at: string | number;
  params: unknown;
  params_hash: string | null;
}

/**
 * The tally of a proposal from its rows, or undefined when it cannot be tallied: its rules never arrived, or it is not
 * a Genesis ratification (a season chooses among versions, which is a different count).
 */
export function tallyOf(proposal: ProposalRow, snapshot: { credential: string; weight: string }[], votes: { credential: string; alma_id_hash: string; choice: "sign" | "object"; weight: string; input_tx: string }[]): CouncilTally | undefined {
  const params = proposal.params_hash ? parseCouncilParams(typeof proposal.params === "string" ? JSON.parse(proposal.params) : proposal.params) : undefined;
  if (!params || proposal.kind !== 0) return undefined;
  const tallyVotes: TallyVote[] = votes.map((v) => ({ credential: v.credential, almaIdHash: v.alma_id_hash, choice: v.choice, weight: v.weight, inputTx: v.input_tx }));
  return buildTally(
    {
      proposalId: proposal.proposal_id,
      worldId: proposal.world_id,
      versionId: proposal.version_ids[0]!,
      params,
      snapshotAt: Number(proposal.snapshot_at),
      startsAt: Number(proposal.starts_at),
      endsAt: Number(proposal.ends_at),
    },
    snapshot,
    tallyVotes,
  );
}

const insertResult = sql<{ proposal_id: string; eligible: string; signatures: string; objections: string; participants: number; outcome: string; tally_hash: string; height: number }>(
  `INSERT INTO council_results (proposal_id, eligible_weight, signatures_weight, objections_weight, participants, outcome, tally_hash, finalized_height)
VALUES (:proposal_id!, :eligible!::numeric, :signatures!::numeric, :objections!::numeric, :participants!, :outcome!, :tally_hash!, :height!)
ON CONFLICT (proposal_id) DO NOTHING`,
);
const queueResult = sql<{ dedupe_key: string; proposal_id: string; version_id: string; tally_hash: string; not_before_ts: number; height: number }>(
  `INSERT INTO relay_outbox (kind, dedupe_key, payload, not_before_ts, created_height)
VALUES ('council_queue', :dedupe_key!, jsonb_build_object('proposalId', :proposal_id!::text, 'versionId', :version_id!::text, 'tallyHash', :tally_hash!::text), :not_before_ts!, :height!)
ON CONFLICT (dedupe_key) DO NOTHING`,
);

/** The result of a closed proposal and, when it was approved, the intent for the relay to queue it on-chain. */
export function councilResult(tally: CouncilTally, ctx: StfContext): Effect[] {
  const tally_hash = canonicalHash(tally);
  const effects: Effect[] = [
    [
      insertResult,
      {
        proposal_id: tally.proposalId,
        eligible: tally.result.eligible,
        signatures: tally.result.signatures,
        objections: tally.result.objections,
        participants: tally.result.participants,
        outcome: tally.result.outcome,
        tally_hash,
        height: ctx.height,
      },
    ],
  ];
  if (tally.result.outcome === "approved") {
    effects.push([queueResult, { dedupe_key: queueKey(tally.proposalId), proposal_id: tally.proposalId, version_id: tally.versionId, tally_hash, not_before_ts: tally.endsAt, height: ctx.height }]);
  }
  return effects;
}

const closeOutbox = sql<{ dedupe_key: string; height: number }>(`UPDATE relay_outbox SET status = 'done', done_height = :height! WHERE dedupe_key = :dedupe_key! AND status = 'pending'`);

const markQueued = sql<{ proposal_id: string; tally_uri: string; eta: number; tx: string }>(
  `UPDATE council_proposals SET status = 'queued', tally_uri = :tally_uri!, eta = :eta!, queued_tx = :tx!
WHERE proposal_id = :proposal_id! AND status NOT IN ('queued', 'executed', 'vetoed')
RETURNING proposal_id`,
);
const queueExecution = sql<{ dedupe_key: string; proposal_id: string; eta: number; height: number }>(
  `INSERT INTO relay_outbox (kind, dedupe_key, payload, not_before_ts, created_height)
SELECT 'council_execute', :dedupe_key!, jsonb_build_object('proposalId', :proposal_id!::text), :eta!, :height!
FROM council_proposals WHERE proposal_id = :proposal_id! AND status = 'queued'
ON CONFLICT (dedupe_key) DO NOTHING`,
);

/** ProposalQueued: the result is on-chain with its delay running; the relay executes it from `eta`. */
export function councilQueued(input: CouncilQueued, ctx: StfContext): Effect[] {
  const proposal_id = input.proposalId.toLowerCase();
  const eta = seconds(input.eta);
  if (eta === undefined) return [];
  return [
    [markQueued, { proposal_id, tally_uri: text(input.tallyURI), eta, tx: input.txHash.toLowerCase() }],
    [closeOutbox, { dedupe_key: queueKey(proposal_id), height: ctx.height }],
    [queueExecution, { dedupe_key: executeKey(proposal_id), proposal_id, eta, height: ctx.height }],
  ];
}

const markVetoed = sql<{ proposal_id: string; by: string; reason: string; tx: string }>(
  `UPDATE council_proposals SET status = 'vetoed', vetoed_by = :by!, veto_reason = :reason!, vetoed_tx = :tx!
WHERE proposal_id = :proposal_id! AND status NOT IN ('executed', 'vetoed')`,
);

/** ProposalVetoed: the guardian stopped it; nothing is left for the relay to do. */
export function councilVetoed(input: CouncilVetoed, ctx: StfContext): Effect[] {
  const proposal_id = input.proposalId.toLowerCase();
  return [
    [markVetoed, { proposal_id, by: input.by.toLowerCase(), reason: text(input.reason), tx: input.txHash.toLowerCase() }],
    [closeOutbox, { dedupe_key: queueKey(proposal_id), height: ctx.height }],
    [closeOutbox, { dedupe_key: executeKey(proposal_id), height: ctx.height }],
  ];
}

const markExecuted = sql<{ proposal_id: string; tx: string }>(
  `UPDATE council_proposals SET status = 'executed', executed_tx = :tx! WHERE proposal_id = :proposal_id! AND status <> 'executed'`,
);

/** ProposalExecuted: the ratified version is the world's official one. */
export function councilExecuted(input: CouncilExecuted, ctx: StfContext): Effect[] {
  const proposal_id = input.proposalId.toLowerCase();
  return [
    [markExecuted, { proposal_id, tx: input.txHash.toLowerCase() }],
    [closeOutbox, { dedupe_key: queueKey(proposal_id), height: ctx.height }],
    [closeOutbox, { dedupe_key: executeKey(proposal_id), height: ctx.height }],
  ];
}
