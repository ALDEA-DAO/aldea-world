import { beforeEach, describe, expect, it } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import readModelSql from "../db/migrations/0001_read_model.sql" with { type: "text" };
import aldeaUtxosSql from "../db/migrations/0004_aldea_utxos.sql" with { type: "text" };
import { credentialOf, parseCredential } from "../src/cardano/credentials.ts";
import { aldeaUtxo } from "../src/stf/aldea.ts";
import type { Effect, StfContext } from "../src/stf/births.ts";

/**
 * $ALDEA holdings against the real read-model schema (PGlite), from UTxO fixtures shaped as the delayed-asset
 * primitive reports them. Replaying any event changes nothing.
 */

async function freshDb() {
  const db = new PGlite();
  await db.exec(readModelSql);
  await db.exec(aldeaUtxosSql);
  return db;
}
async function apply(db: PGlite, effects: Effect[]) {
  for (const [query, params] of effects) await query.run(params, db as never);
}
const ctx = (height: number): StfContext => ({ height, timestampMs: height * 1000, worldId: "0xworld" });

// Base addresses on a test network (header 0x00: payment key + stake key), with made-up credentials
const PAY_A = "551ea8992dc2cc213ccdb7e8e4b2606aa90e69af3e7a8be0d9dd314e";
const STAKE_A = "4956a7e0f7c1ce836994ac6c98e37b1e2ddfb082bcf550a7b5559899";
const BASE_A = `00${PAY_A}${STAKE_A}`;
// A second address of the same wallet: another payment key, the same stake key
const BASE_A2 = `00${"11".repeat(28)}${STAKE_A}`;
const STAKE_B = "22".repeat(28);
const BASE_B = `00${"33".repeat(28)}${STAKE_B}`;
// An enterprise address: no stake part
const PAY_C = "44".repeat(28);
const ENTERPRISE_C = `60${PAY_C}`;

const created = (txId: string, outputIndex: number, address: string, amount: string) => ({ address, txId, outputIndex: String(outputIndex), amount });
const spent = (txId: string, outputIndex: number, address: string) => ({ address, txId, outputIndex: String(outputIndex), amount: "" });

const holdings = async (db: PGlite) =>
  Object.fromEntries((await db.query<{ credential: string; balance: string }>("SELECT credential, balance::text FROM aldea_holdings ORDER BY credential")).rows.map((r) => [r.credential, r.balance]));

let db: PGlite;
beforeEach(async () => {
  db = await freshDb();
});

describe("credentialOf", () => {
  it("is the stake credential of a base address, whatever its payment part", () => {
    expect(credentialOf(BASE_A)).toBe(`stake:${STAKE_A}`);
    expect(credentialOf(BASE_A2)).toBe(`stake:${STAKE_A}`);
    expect(credentialOf(`0x${BASE_A.toUpperCase()}`)).toBe(`stake:${STAKE_A}`);
    // script payment credential, key stake credential
    expect(credentialOf(`10${"aa".repeat(28)}${STAKE_B}`)).toBe(`stake:${STAKE_B}`);
  });

  it("is the payment credential when the address has no stake part", () => {
    expect(credentialOf(ENTERPRISE_C)).toBe(`pay:${PAY_C}`);
    expect(credentialOf(`70${PAY_C}`)).toBe(`pay:${PAY_C}`);
  });

  it("keeps any other address whole, so nothing held is lost from the total", () => {
    const byron = "82d818582183581c" + "ab".repeat(30);
    expect(credentialOf(byron)).toBe(`addr:${byron}`);
  });

  it("only takes stake and payment credentials from the API", () => {
    expect(parseCredential(`STAKE:${STAKE_A.toUpperCase()}`)).toBe(`stake:${STAKE_A}`);
    expect(parseCredential(`pay:${PAY_C}`)).toBe(`pay:${PAY_C}`);
    for (const bad of ["stake:abc", `addr:${BASE_A}`, STAKE_A, `stake:${STAKE_A}00`]) expect(parseCredential(bad)).toBeUndefined();
  });
});

describe("aldeaUtxo", () => {
  it("adds up a wallet's outputs under its stake credential", async () => {
    await apply(db, aldeaUtxo(created("0xMINT", 0, BASE_A, "1000000000"), ctx(10)));
    await apply(db, aldeaUtxo(created("0xMINT", 1, BASE_A2, "1"), ctx(10)));
    await apply(db, aldeaUtxo(created("0xMINT", 2, BASE_B, "500000000"), ctx(10)));
    await apply(db, aldeaUtxo(created("0xMINT", 3, ENTERPRISE_C, "7"), ctx(10)));
    expect(await holdings(db)).toEqual({ [`pay:${PAY_C}`]: "7", [`stake:${STAKE_B}`]: "500000000", [`stake:${STAKE_A}`]: "1000000001" });
  });

  it("moves the balance when an output is spent into another wallet", async () => {
    await apply(db, aldeaUtxo(created("0xMINT", 0, BASE_A, "1000"), ctx(10)));
    // A sends 400 to B and keeps 600 as change
    await apply(db, aldeaUtxo(created("0xSEND", 0, BASE_B, "400"), ctx(20)));
    await apply(db, aldeaUtxo(created("0xSEND", 1, BASE_A2, "600"), ctx(20)));
    await apply(db, aldeaUtxo(spent("0xMINT", 0, BASE_A), ctx(20)));
    expect(await holdings(db)).toEqual({ [`stake:${STAKE_B}`]: "400", [`stake:${STAKE_A}`]: "600" });
    const { rows } = await db.query<{ updated_height: number }>("SELECT updated_height::int FROM aldea_holdings WHERE credential = $1", [`stake:${STAKE_A}`]);
    expect(rows[0]?.updated_height).toBe(20);
  });

  it("leaves a credential at zero when it sends everything", async () => {
    await apply(db, aldeaUtxo(created("0xMINT", 0, BASE_A, "1000"), ctx(10)));
    await apply(db, aldeaUtxo(spent("0xMINT", 0, BASE_A), ctx(20)));
    expect(await holdings(db)).toEqual({ [`stake:${STAKE_A}`]: "0" });
  });

  it("changes nothing when events are replayed, alone or together", async () => {
    const events = [
      aldeaUtxo(created("0xMINT", 0, BASE_A, "1000"), ctx(10)),
      aldeaUtxo(created("0xSEND", 0, BASE_B, "400"), ctx(20)),
      aldeaUtxo(created("0xSEND", 1, BASE_A, "600"), ctx(20)),
      aldeaUtxo(spent("0xMINT", 0, BASE_A), ctx(20)),
    ];
    for (const effects of events) await apply(db, effects);
    const once = await holdings(db);
    // The creation of an output that was already spent must not count it again
    await apply(db, events[0]!);
    for (const effects of events) await apply(db, effects);
    await apply(db, events[3]!);
    expect(await holdings(db)).toEqual(once);
    expect(once).toEqual({ [`stake:${STAKE_B}`]: "400", [`stake:${STAKE_A}`]: "600" });
  });

  it("ignores the spending of an output it never saw, and amounts that are not quantities", async () => {
    await apply(db, aldeaUtxo(spent("0xBEFORE", 0, BASE_A), ctx(5)));
    await apply(db, aldeaUtxo(created("0xODD", 0, BASE_A, "-5"), ctx(6)));
    await apply(db, aldeaUtxo(created("0xODD", 1, BASE_A, "1.5"), ctx(6)));
    expect(await holdings(db)).toEqual({});
  });

  it("handles the whole supply without losing precision", async () => {
    await apply(db, aldeaUtxo(created("0xBIG", 0, BASE_A, "650000000000000"), ctx(10)));
    await apply(db, aldeaUtxo(created("0xBIG", 1, BASE_A, "1"), ctx(10)));
    expect(await holdings(db)).toEqual({ [`stake:${STAKE_A}`]: "650000000000001" });
  });
});
