import { beforeEach, describe, expect, it } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import readModelSql from "../db/migrations/0001_read_model.sql" with { type: "text" };
import visitExitsSql from "../db/migrations/0002_visit_exits.sql" with { type: "text" };
import { buildingActivity, weeklySouls } from "../src/api.ts";
import type { Effect, StfContext } from "../src/stf/births.ts";
import { buildingEntered, buildingLeft } from "../src/stf/buildings.ts";

/**
 * Building visits against the real read-model schema (PGlite): entries, exits, the hourly activity and the activity
 * API's queries. Replaying any event changes nothing.
 */

async function freshDb() {
  const db = new PGlite();
  await db.exec(readModelSql);
  await db.exec(visitExitsSql);
  return db;
}

async function apply(db: PGlite, effects: Effect[]) {
  for (const [query, params] of effects) await query.run(params, db as never);
}

// Effectstream block n is at T0 + n seconds; T0 is on an hour boundary
const T0 = 1_790_002_800;
const ctx = (height: number): StfContext => ({ height, timestampMs: (T0 + height) * 1000, worldId: "0xworld" });
const PORTAL = "0x" + "aa".repeat(32);
const REGISTRY = "0x" + "bb".repeat(32);
const soul = (n: number) => "0x" + n.toString(16).padStart(64, "0");
const entry = (characterId: number, buildingId: string, tx: string) => ({ characterId, buildingId, almaIdHash: soul(characterId), txHash: tx, logIndex: 0, blockNumber: 100 });

type Row = Record<string, unknown>;
const state = async (db: PGlite) => ({
  visits: (await db.query<Row>("SELECT character_id, building_id, base_ts, left_ts, left_tx FROM building_visits ORDER BY id")).rows,
  activity: (await db.query<Row>("SELECT * FROM world_activity_hourly ORDER BY hour_start")).rows,
});

let db: PGlite;
beforeEach(async () => {
  db = await freshDb();
});

describe("buildingEntered", () => {
  it("counts three different souls entering as three unique souls in the 24 h window", async () => {
    await apply(db, buildingEntered(entry(1, PORTAL, "0xE1"), ctx(10)));
    await apply(db, buildingEntered(entry(2, PORTAL, "0xE2"), ctx(11)));
    await apply(db, buildingEntered(entry(3, REGISTRY, "0xE3"), ctx(12)));

    const activity = await buildingActivity(db as never, T0 + 12 - 86_400);
    expect(activity.totals).toEqual({ visits: 3, uniqueSouls: 3 });
    expect(activity.items).toEqual([
      { buildingId: PORTAL, visits: 2, uniqueSouls: 2, inside: 2, lastVisitTs: T0 + 11 },
      { buildingId: REGISTRY, visits: 1, uniqueSouls: 1, inside: 1, lastVisitTs: T0 + 12 },
    ]);
    expect((await state(db)).activity).toEqual([{ world_id: "0xworld", hour_start: T0, births: 0, visits: 3, unique_souls: 3 }]);
  });

  it("counts a soul once per hour however many buildings it visits, and again the next hour", async () => {
    await apply(db, buildingEntered(entry(1, PORTAL, "0xE1"), ctx(10)));
    await apply(db, buildingEntered(entry(1, REGISTRY, "0xE2"), ctx(20)));
    await apply(db, buildingEntered(entry(1, PORTAL, "0xE3"), ctx(3_610)));
    expect((await state(db)).activity).toEqual([
      { world_id: "0xworld", hour_start: T0, births: 0, visits: 2, unique_souls: 1 },
      { world_id: "0xworld", hour_start: T0 + 3_600, births: 0, visits: 1, unique_souls: 1 },
    ]);
    expect((await buildingActivity(db as never, T0)).totals).toEqual({ visits: 3, uniqueSouls: 1 });
  });

  it("closes the previous visit when the character goes into another building without leaving", async () => {
    await apply(db, buildingEntered(entry(1, PORTAL, "0xE1"), ctx(10)));
    await apply(db, buildingEntered(entry(1, REGISTRY, "0xE2"), ctx(15)));
    expect((await state(db)).visits).toEqual([
      { character_id: 1, building_id: PORTAL, base_ts: T0 + 10, left_ts: T0 + 15, left_tx: null },
      { character_id: 1, building_id: REGISTRY, base_ts: T0 + 15, left_ts: null, left_tx: null },
    ]);
  });
});

describe("buildingLeft", () => {
  it("closes the open visit once, even when the event is replayed", async () => {
    await apply(db, buildingEntered(entry(1, PORTAL, "0xE1"), ctx(10)));
    await apply(db, buildingLeft({ characterId: 1, buildingId: PORTAL, txHash: "0xL1", logIndex: 0, blockNumber: 101 }, ctx(14)));
    // a later visit, then the old exit replayed: the new visit must stay open
    await apply(db, buildingEntered(entry(1, PORTAL, "0xE2"), ctx(20)));
    await apply(db, buildingLeft({ characterId: 1, buildingId: PORTAL, txHash: "0xL1", logIndex: 0, blockNumber: 101 }, ctx(21)));
    expect((await state(db)).visits).toEqual([
      { character_id: 1, building_id: PORTAL, base_ts: T0 + 10, left_ts: T0 + 14, left_tx: "0xl1" },
      { character_id: 1, building_id: PORTAL, base_ts: T0 + 20, left_ts: null, left_tx: null },
    ]);
    expect((await buildingActivity(db as never, T0)).items[0]).toMatchObject({ visits: 2, inside: 1 });
  });
});

describe("determinism", () => {
  it("produces the same read model from the same events, whatever is replayed in between", async () => {
    const events: Effect[][] = [
      buildingEntered(entry(1, PORTAL, "0xE1"), ctx(10)),
      buildingEntered(entry(2, PORTAL, "0xE2"), ctx(11)),
      buildingLeft({ characterId: 1, buildingId: PORTAL, txHash: "0xL1", logIndex: 1, blockNumber: 102 }, ctx(12)),
      buildingEntered(entry(2, REGISTRY, "0xE3"), ctx(13)),
    ];
    const other = await freshDb();
    for (const effects of events) await apply(db, effects);
    for (const effects of [...events, ...events]) await apply(other, effects);
    expect(await state(other)).toEqual(await state(db));
  });
});

describe("weekly souls", () => {
  it("counts distinct souls with an entry in the last 7 days", async () => {
    await apply(db, buildingEntered(entry(1, PORTAL, "0xE1"), ctx(10)));
    await apply(db, buildingEntered(entry(2, PORTAL, "0xE2"), ctx(20)));
    await apply(db, buildingEntered(entry(2, REGISTRY, "0xE3"), ctx(30)));
    expect(await weeklySouls(db as never, T0 + 100)).toEqual({ fromTs: T0 + 100 - 604_800, toTs: T0 + 100, uniqueSouls: 2, visits: 3 });
    // eight days later nobody has been seen this week
    expect((await weeklySouls(db as never, T0 + 8 * 86_400)).uniqueSouls).toBe(0);
  });
});
