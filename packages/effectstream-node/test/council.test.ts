import { beforeEach, describe, expect, it } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { bech32 } from "bech32";
import { canonicalHash, canonicalJson, tallyIsConsistent, type CouncilParams } from "@aldea/shared/council";
import readModelSql from "../db/migrations/0001_read_model.sql" with { type: "text" };
import councilSql from "../db/migrations/0005_council.sql" with { type: "text" };
import { councilParticipations, councilProposal, councilProposals, councilTally } from "../src/api.ts";
import { signerCredential } from "../src/cardano/credentials.ts";
import type { Effect, StfContext } from "../src/stf/births.ts";
import * as council from "../src/stf/council.ts";
import { founderClaimed } from "../src/stf/founders.ts";

/**
 * The Council against the real read-model schema (PGlite): a proposal from its opening to its tally, as the state
 * machine drives it (src/state-machine.ts only adds where each input comes from, the timers and the events).
 */

const PID = "0x" + "c1".repeat(32);
const WORLD = "0x" + "a0".repeat(32);
const V0 = "0x" + "b0".repeat(32);
const T0 = 1_800_000_000;
const stake = (n: number) => "stake:" + n.toString(16).padStart(2, "0").repeat(28);
const soul = (n: number) => "0x" + n.toString(16).padStart(2, "0").repeat(32);
const TREASURY = stake(0xee);

const params: CouncilParams = {
  kind: "GenesisRatification",
  rule: "approved_unless_objected",
  objectionThresholdBps: 1000,
  weight: "aldea_balance_at_snapshot",
  voters: "founders_only",
  excludedCredentials: [TREASURY],
  durationDays: 7,
};

let db: PGlite;
let height = 0;
const at = (seconds: number): StfContext => ({ height: ++height, timestampMs: seconds * 1000, worldId: WORLD });
async function apply(effects: Effect[]) {
  const rows: unknown[] = [];
  for (const [query, p] of effects) rows.push(...(await query.run(p, db as never)));
  return rows;
}
const holds = (credential: string, balance: number) => db.query(`INSERT INTO aldea_holdings (credential, balance, updated_height) VALUES ($1, $2, 1) ON CONFLICT (credential) DO UPDATE SET balance = EXCLUDED.balance`, [credential, balance]);
const founder = (n: number) => apply(founderClaimed({ almaIdHash: soul(n), cardanoStakeCredential: "0x" + n.toString(16).padStart(2, "0").repeat(28), aldeaBalance: "1000", snapshotSlot: "1", txHash: "0xf" + n, blockNumber: 5 }));
const opened = (over: Partial<council.CouncilOpened> = {}): council.CouncilOpened => ({
  proposalId: PID,
  kind: 0,
  worldId: WORLD,
  versionId: V0,
  snapshotAt: String(T0),
  startsAt: String(T0 + 100),
  endsAt: String(T0 + 1000),
  paramsURI: "ipfs://params",
  txHash: "0xOPEN",
  logIndex: 0,
  blockNumber: 10,
  ...over,
});
const status = async () => (await db.query<{ status: string }>(`SELECT status FROM council_proposals WHERE proposal_id = $1`, [PID])).rows[0]?.status;
const cast = (n: number, choice: "s" | "o", seconds: number, tx = `0xvote${n}${choice}`) => apply(council.vote({ proposalId: PID, choice }, stake(n), tx, at(seconds)));
/** What the close timer does: close, tally, record the result. */
async function close(seconds: number) {
  const ctx = at(seconds);
  const [proposal] = (await council.closeProposal.run({ proposal_id: PID, now: seconds }, db as never)) as council.ProposalRow[];
  if (!proposal) return undefined;
  const snapshot = await council.selectSnapshot.run({ proposal_id: PID }, db as never);
  const votes = await council.selectVotes.run({ proposal_id: PID }, db as never);
  const tally = council.tallyOf(proposal, snapshot, votes);
  if (tally) await apply(council.councilResult(tally, ctx));
  return tally;
}
const outbox = async () => (await db.query<{ kind: string; dedupe_key: string; status: string; payload: unknown; not_before_ts: string | null }>(`SELECT kind, dedupe_key, status, payload, not_before_ts FROM relay_outbox ORDER BY id`)).rows;

/** Holders 1 to 4 (4 is not a Founder), the treasury, and an open proposal with its rules. */
async function openCharter() {
  await holds(stake(1), 300);
  await holds(stake(2), 100);
  await holds(stake(3), 600);
  await holds(stake(4), 50);
  await holds(TREASURY, 10_000);
  for (const n of [1, 2, 3]) await founder(n);
  await apply(council.councilOpened(opened()));
  await apply(council.councilParams({ proposalId: PID, params: canonicalJson(params) }, at(T0 - 10)));
  await apply(council.councilSnapshot(PID, at(T0)));
  await apply(council.councilOpen(PID, at(T0 + 100)));
}

beforeEach(async () => {
  db = new PGlite();
  await db.exec(readModelSql);
  await db.exec(councilSql);
  height = 0;
});

describe("a proposal's life", () => {
  it("is scheduled when opened, once, whatever is replayed", async () => {
    expect(await apply(council.councilOpened(opened()))).toEqual([{ proposal_id: PID, snapshot_at: T0, starts_at: T0 + 100, ends_at: T0 + 1000 }] as never);
    // A replay returns nothing: no second set of timers
    expect(await apply(council.councilOpened(opened()))).toEqual([]);
    const [proposal] = await councilProposals(db as never);
    expect(proposal).toMatchObject({ proposalId: PID, kind: "GenesisRatification", worldId: WORLD, versionIds: [V0], status: "scheduled", paramsURI: "ipfs://params", paramsHash: null, params: null, openedTx: "0xopen" });
  });

  it("ignores an opening it could not keep (times that are not dates, an unknown kind) and survives a NUL in the URI", async () => {
    expect(council.councilOpened(opened({ endsAt: "18446744073709551615" }))).toEqual([]);
    expect(council.councilOpened(opened({ kind: 7 }))).toEqual([]);
    await apply(council.councilOpened(opened({ paramsURI: "ipfs://a\u0000b" })));
    expect((await councilProposals(db as never))[0]!.paramsURI).toBe("ipfs://ab");
  });

  it("snapshots the holdings without the excluded credentials, then opens at its time", async () => {
    await openCharter();
    expect(await status()).toBe("open");
    const { rows } = await db.query(`SELECT credential, weight::text AS weight FROM council_snapshots ORDER BY credential`);
    expect(rows).toEqual([
      { credential: stake(1), weight: "300" },
      { credential: stake(2), weight: "100" },
      { credential: stake(3), weight: "600" },
      { credential: stake(4), weight: "50" },
    ]);
    // What moves after the snapshot does not change the weights
    await holds(stake(1), 999_999);
    await apply(council.councilSnapshot(PID, at(T0 + 200)));
    expect((await councilProposal(db as never, PID))!.tally).toEqual({ eligible: "1050", signatures: "0", objections: "0", participants: 0 });
  });

  it("waits for the rules: a snapshot taken without them drops the excluded when they arrive, and opens then", async () => {
    await holds(stake(1), 300);
    await holds(TREASURY, 10_000);
    await apply(council.councilOpened(opened()));
    await apply(council.councilSnapshot(PID, at(T0)));
    await apply(council.councilOpen(PID, at(T0 + 100)));
    expect(await status()).toBe("snapshotted");
    expect((await councilProposal(db as never, PID))!.tally).toMatchObject({ eligible: "10300" });

    await apply(council.councilParams({ proposalId: PID, params: canonicalJson(params) }, at(T0 + 150)));
    expect(await status()).toBe("open");
    const view = await councilProposal(db as never, PID);
    expect(view!.tally).toMatchObject({ eligible: "300" });
    expect(view!.proposal).toMatchObject({ paramsHash: canonicalHash(params), params });
  });

  it("takes the rules once, well-formed and of its own kind", async () => {
    await apply(council.councilOpened(opened()));
    await apply(council.councilParams({ proposalId: PID, params: "not json" }, at(T0 - 30)));
    await apply(council.councilParams({ proposalId: PID, params: JSON.stringify({ ...params, rule: "majority" }) }, at(T0 - 29)));
    await apply(council.councilParams({ proposalId: PID, params: JSON.stringify({ ...params, kind: "SeasonElection" }) }, at(T0 - 28)));
    expect((await councilProposals(db as never))[0]!.paramsHash).toBeNull();
    await apply(council.councilParams({ proposalId: PID, params: canonicalJson(params) }, at(T0 - 20)));
    await apply(council.councilParams({ proposalId: PID, params: canonicalJson({ ...params, excludedCredentials: [] }) }, at(T0 - 10)));
    expect((await councilProposals(db as never))[0]!.paramsHash).toBe(canonicalHash(params));
  });
});

describe("votes", () => {
  beforeEach(openCharter);

  it("count for a Founder with weight in the snapshot, and the last one replaces the earlier", async () => {
    expect(await cast(1, "s", T0 + 200, "0xAAA")).toEqual([{ proposal_id: PID, choice: "sign" }] as never);
    expect(await cast(1, "o", T0 + 300, "0xBBB")).toEqual([{ proposal_id: PID, choice: "object" }] as never);
    const view = await councilProposal(db as never, PID, stake(1));
    expect(view!.tally).toEqual({ eligible: "1050", signatures: "0", objections: "300", participants: 1 });
    expect(view!.voter).toEqual({ credential: stake(1), founder: true, weight: "300", vote: { choice: "object", inputTx: "0xbbb" } });
  });

  it("do not count without the seal, without weight, for another proposal, or outside its time", async () => {
    // A holder that never claimed the seal
    expect(await cast(4, "s", T0 + 200)).toEqual([]);
    // A Founder that held nothing at the snapshot
    await founder(5);
    expect(await cast(5, "s", T0 + 200)).toEqual([]);
    // The treasury, even if it were a Founder
    await founder(0xee);
    expect(await cast(0xee, "s", T0 + 200)).toEqual([]);
    expect(await apply(council.vote({ proposalId: "0x" + "99".repeat(32), choice: "s" }, stake(1), "0x1", at(T0 + 200)))).toEqual([]);
    // In the very block the proposal ends, before the close has run
    expect(await cast(1, "s", T0 + 1000)).toEqual([]);
    expect((await councilProposal(db as never, PID, stake(4)))!.voter).toEqual({ credential: stake(4), founder: false, weight: "50", vote: null });
    expect((await councilProposal(db as never, PID))!.tally).toMatchObject({ participants: 0 });
  });

  it("name every soul that took part the same way, signing or objecting", async () => {
    await cast(1, "s", T0 + 200, "0xAAA");
    await cast(2, "o", T0 + 210, "0xBBB");
    expect(await councilParticipations(db as never, soul(1))).toEqual([{ proposalId: PID, kind: "GenesisRatification", inputTx: "0xaaa" }]);
    expect(await councilParticipations(db as never, soul(2))).toEqual([{ proposalId: PID, kind: "GenesisRatification", inputTx: "0xbbb" }]);
    expect(await councilParticipations(db as never, soul(3))).toEqual([]);
  });
});

describe("the close", () => {
  beforeEach(openCharter);

  it("approves by silence and leaves the result for the relay to queue", async () => {
    expect(await close(T0 + 999)).toBeUndefined();
    const tally = await close(T0 + 1000);
    expect(tally!.result).toEqual({ eligible: "1050", signatures: "0", objections: "0", participants: 0, outcome: "approved" });
    expect(await status()).toBe("closed");
    const hash = canonicalHash(tally);
    expect((await councilProposal(db as never, PID))!.result).toEqual({ outcome: "approved", tallyHash: hash });
    expect(await outbox()).toEqual([{ kind: "council_queue", dedupe_key: `council_queue:${PID}`, status: "pending", payload: { proposalId: PID, versionId: V0, tallyHash: hash }, not_before_ts: T0 + 1000 }] as never);
    // Closing again finds nothing to close
    expect(await close(T0 + 1001)).toBeUndefined();
  });

  it("serves a tally anyone can recompute to the hash that goes on-chain", async () => {
    await cast(1, "s", T0 + 200, "0xAAA");
    await cast(2, "o", T0 + 210, "0xBBB");
    expect(await councilTally(db as never, PID)).toBeUndefined();
    const closed = await close(T0 + 1000);
    const served = await councilTally(db as never, PID);
    expect(canonicalJson(served)).toBe(canonicalJson(closed));
    expect(served!.votes).toEqual([
      { credential: stake(1), almaIdHash: soul(1), choice: "sign", weight: "300", inputTx: "0xaaa" },
      { credential: stake(2), almaIdHash: soul(2), choice: "object", weight: "100", inputTx: "0xbbb" },
    ]);
    expect(tallyIsConsistent(served!)).toBe(true);
    expect<string>(canonicalHash(JSON.parse(canonicalJson(served)))).toBe(((await councilProposal(db as never, PID))!.result as { tallyHash: string }).tallyHash);
    // Votes after the close change nothing
    expect(await cast(3, "o", T0 + 1001)).toEqual([]);
  });

  it("rejects on a qualified objection, and then queues nothing", async () => {
    await cast(1, "s", T0 + 200);
    await cast(3, "o", T0 + 210);
    const tally = await close(T0 + 1000);
    expect(tally!.result).toMatchObject({ signatures: "300", objections: "600", outcome: "rejected" });
    expect(await outbox()).toEqual([]);
  });
});

describe("after the close, on-chain", () => {
  beforeEach(async () => {
    await openCharter();
    await close(T0 + 1000);
  });
  const log = { txHash: "0xQUEUE", logIndex: 0, blockNumber: 90 };

  it("queued: the relay's first job is done and the execution waits for the delay", async () => {
    await apply(council.councilQueued({ ...log, proposalId: PID, versionId: V0, tallyHash: "0xhash", tallyURI: "ipfs://tally", eta: String(T0 + 1600) }, at(T0 + 1010)));
    await apply(council.councilQueued({ ...log, proposalId: PID, versionId: V0, tallyHash: "0xhash", tallyURI: "ipfs://tally", eta: String(T0 + 1600) }, at(T0 + 1011)));
    expect((await councilProposals(db as never))[0]).toMatchObject({ status: "queued", tallyURI: "ipfs://tally", eta: T0 + 1600, queuedTx: "0xqueue" });
    expect((await outbox()).map((o) => [o.kind, o.status, o.not_before_ts])).toEqual([
      ["council_queue", "done", T0 + 1000],
      ["council_execute", "pending", T0 + 1600],
    ] as never);

    await apply(council.councilExecuted({ ...log, txHash: "0xEXEC", proposalId: PID }, at(T0 + 1700)));
    expect((await councilProposals(db as never))[0]).toMatchObject({ status: "executed", executedTx: "0xexec" });
    expect((await outbox()).map((o) => o.status)).toEqual(["done", "done"]);
  });

  it("vetoed: the reason is kept and nothing is left to relay", async () => {
    await apply(council.councilQueued({ ...log, proposalId: PID, versionId: V0, tallyHash: "0xhash", tallyURI: "ipfs://tally", eta: String(T0 + 1600) }, at(T0 + 1010)));
    await apply(council.councilVetoed({ ...log, txHash: "0xVETO", proposalId: PID, by: "0xSAFE", reason: "the tally does not match\u0000" }, at(T0 + 1100)));
    expect((await councilProposals(db as never))[0]).toMatchObject({ status: "vetoed", vetoReason: "the tally does not match", vetoedTx: "0xveto" });
    expect((await outbox()).map((o) => o.status)).toEqual(["done", "done"]);
    // A veto is final in the read model too
    await apply(council.councilQueued({ ...log, proposalId: PID, versionId: V0, tallyHash: "0xhash", tallyURI: "ipfs://tally", eta: String(T0 + 1600) }, at(T0 + 1200)));
    expect(await status()).toBe("vetoed");
  });
});

describe("who signed", () => {
  const STAKE_CREDENTIAL = "32c728d3861e164cab28cb8f006448139c8f1740ffb8e7aa9e5232dc";
  const PAYMENT_CREDENTIAL = "9493315cd92eb5d8c4304e67b7e16ae36d61d34502694657811a2c8e";
  const address = (prefix: string, header: number, ...credentials: string[]) => bech32.encode(prefix, bech32.toWords(Buffer.from(header.toString(16).padStart(2, "0") + credentials.join(""), "hex")), 200);

  it("a reward address speaks for its stake credential and an enterprise address for its payment one", () => {
    // CIP-19's test vector for this stake key on a test network
    expect(signerCredential("stake_test1uqevw2xnsc0pvn9t9r9c7qryfqfeerchgrlm3ea2nefr9hqp8n5xl")).toBe(`stake:${STAKE_CREDENTIAL}`);
    expect(signerCredential(address("stake", 0xe1, STAKE_CREDENTIAL))).toBe(`stake:${STAKE_CREDENTIAL}`);
    expect(signerCredential(address("addr_test", 0x60, PAYMENT_CREDENTIAL))).toBe(`pay:${PAYMENT_CREDENTIAL}`);
  });

  it("a base address speaks for none, nor does a script's, nor anything that is not an address", () => {
    expect(signerCredential(address("addr_test", 0x00, PAYMENT_CREDENTIAL, STAKE_CREDENTIAL))).toBeUndefined();
    expect(signerCredential(address("stake_test", 0xf0, STAKE_CREDENTIAL))).toBeUndefined();
    expect(signerCredential("0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266")).toBeUndefined();
    expect(signerCredential("")).toBeUndefined();
  });
});
