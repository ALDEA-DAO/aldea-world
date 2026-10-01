import { beforeEach, describe, expect, it } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import readModelSql from "../db/migrations/0001_read_model.sql" with { type: "text" };
import { feedPage } from "../src/api.ts";
import { birthCompleted, birthRequested, birthRescheduled, completeBirthKey, type Effect, type StfContext } from "../src/stf/births.ts";
import { soulAnchored } from "../src/stf/souls.ts";

/**
 * The STFs' effects against the real read-model schema (PGlite): the same inputs always produce the same state, and
 * replaying an event (same txHash/logIndex) changes nothing.
 */

async function freshDb() {
  const db = new PGlite();
  await db.exec(readModelSql);
  return db;
}

async function apply(db: PGlite, effects: Effect[]) {
  for (const [query, params] of effects) await query.run(params, db as never);
}

const ctx = (height: number): StfContext => ({ height, timestampMs: 1_790_000_000_000 + height * 1000, worldId: "0xworld" });
const SOUL = "0xABCDEF0000000000000000000000000000000000000000000000000000000001";
const requested = { characterId: 7, owner: "0xAAAA000000000000000000000000000000000001", almaIdHash: SOUL, characterClass: 0, targetBlock: "120", txHash: "0xREQ", blockNumber: 117 };
const completed = { characterId: 7, almaIdHash: SOUL, characterClass: 0, tribe: 3, txHash: "0xBORN", blockNumber: 122 };

type Row = Record<string, unknown>;
const state = async (db: PGlite) => ({
  births: (await db.query<Row>("SELECT * FROM births ORDER BY character_id")).rows,
  outbox: (await db.query<Row>("SELECT kind, dedupe_key, payload, not_before_base_block, status, created_height, done_height FROM relay_outbox ORDER BY dedupe_key")).rows,
  activity: (await db.query<Row>("SELECT * FROM world_activity_hourly ORDER BY world_id, hour_start")).rows,
  souls: (await db.query<Row>("SELECT * FROM souls_anchored ORDER BY alma_id_hash")).rows,
});

let db: PGlite;
beforeEach(async () => {
  db = await freshDb();
});

describe("birthRequested", () => {
  it("records the gestating birth and queues its completion after the target block, once", async () => {
    await apply(db, birthRequested(requested, ctx(10)));
    await apply(db, birthRequested(requested, ctx(11)));
    const { births, outbox } = await state(db);
    expect(births).toHaveLength(1);
    expect(births[0]).toMatchObject({ character_id: 7, status: "gestating", owner: requested.owner.toLowerCase(), alma_id_hash: SOUL.toLowerCase(), requested_tx: "0xreq" });
    expect(outbox).toEqual([
      { kind: "complete_birth", dedupe_key: completeBirthKey(7, "120"), payload: { characterId: 7 }, not_before_base_block: 121, status: "pending", created_height: 10, done_height: null },
    ]);
  });
});

describe("birthCompleted", () => {
  it("marks the birth born, closes its completion and counts it once in the hourly activity", async () => {
    await apply(db, birthRequested(requested, ctx(10)));
    await apply(db, birthCompleted(completed, ctx(14)));
    const once = await state(db);
    expect(once.births[0]).toMatchObject({ status: "born", tribe: 3, born_block: 122, born_tx: "0xborn", born_ts: Number(Math.floor(ctx(14).timestampMs / 1000)) });
    expect(once.outbox[0]).toMatchObject({ status: "done", done_height: 14 });
    expect(once.activity).toEqual([{ world_id: "0xworld", hour_start: Number(Math.floor(ctx(14).timestampMs / 1000 / 3600) * 3600), births: 1, visits: 0, unique_souls: 0 }]);

    // the same event again (a replay) leaves everything as it was
    await apply(db, birthCompleted(completed, ctx(15)));
    expect(await state(db)).toEqual(once);
  });
});

describe("birthRescheduled", () => {
  it("moves the target, retires the old completion and queues the new one", async () => {
    await apply(db, birthRequested(requested, ctx(10)));
    await apply(db, birthRescheduled({ characterId: 7, newTargetBlock: "400" }, ctx(20)));
    const { births, outbox } = await state(db);
    expect(births[0]).toMatchObject({ target_block: 400, status: "gestating" });
    expect(outbox.map((o) => [o.dedupe_key, o.status, o.not_before_base_block])).toEqual([
      [completeBirthKey(7, "120"), "done", 121],
      [completeBirthKey(7, "400"), "pending", 401],
    ]);

    await apply(db, birthCompleted(completed, ctx(30)));
    expect((await state(db)).outbox.every((o) => o.status === "done")).toBe(true);
  });
});

describe("determinism", () => {
  it("produces the same read model from the same events, whatever is replayed in between", async () => {
    const events: Effect[][] = [
      birthRequested(requested, ctx(10)),
      birthRequested({ ...requested, characterId: 8, txHash: "0xREQ8", targetBlock: "130" }, ctx(12)),
      birthRescheduled({ characterId: 8, newTargetBlock: "500" }, ctx(13)),
      birthCompleted(completed, ctx(14)),
      soulAnchored({ almaIdHash: SOUL, almaId: "alma:main:human:00000000000000000000000000000001", subjectType: 1, controller: requested.owner, txHash: "0xANCHOR", blockNumber: 116 }),
    ];
    const other = await freshDb();
    for (const effects of events) await apply(db, effects);
    for (const effects of [...events, ...events]) await apply(other, effects);
    expect(await state(other)).toEqual(await state(db));
  });
});

describe("soulAnchored", () => {
  it("records each anchor once", async () => {
    const anchor = { almaIdHash: SOUL, almaId: "alma:main:human:00000000000000000000000000000001", subjectType: 1, controller: requested.owner, txHash: "0xANCHOR", blockNumber: 116 };
    await apply(db, soulAnchored(anchor));
    await apply(db, soulAnchored({ ...anchor, controller: "0x0000000000000000000000000000000000000bad" }));
    expect((await state(db)).souls).toEqual([
      { alma_id_hash: SOUL.toLowerCase(), alma_id: anchor.almaId, subject_type: 1, controller: requested.owner.toLowerCase(), anchored_block: 116, tx_hash: "0xanchor" },
    ]);
  });
});

describe("feed pages", () => {
  it("never splits a block between pages", async () => {
    // four births: three born in block 5, one in block 6
    for (const [id, block] of [[1, 5], [2, 5], [3, 5], [4, 6]] as const) {
      await apply(db, birthRequested({ ...requested, characterId: id, txHash: `0x${id}`, targetBlock: "1" }, ctx(id)));
      await apply(db, birthCompleted({ ...completed, characterId: id, txHash: `0xb${id}`, blockNumber: block }, ctx(10 + id)));
    }
    const first = await feedPage(db as never, "births", "born_block", "character_id", "status = 'born'", -1, 2);
    expect(first.rows.map((r) => r.character_id)).toEqual([1, 2, 3]);
    expect(first.nextSince).toBe(5);
    const second = await feedPage(db as never, "births", "born_block", "character_id", "status = 'born'", first.nextSince, 2);
    expect(second.rows.map((r) => r.character_id)).toEqual([4]);
    expect((await feedPage(db as never, "births", "born_block", "character_id", "status = 'born'", second.nextSince, 2)).rows).toEqual([]);
  });
});
