import { beforeEach, describe, expect, it } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import readModelSql from "../db/migrations/0001_read_model.sql" with { type: "text" };
import { founderSeal } from "../src/api.ts";
import type { Effect } from "../src/stf/births.ts";
import { founderClaimed } from "../src/stf/founders.ts";

/** Founder seals against the real read-model schema (PGlite). */

async function apply(db: PGlite, effects: Effect[]) {
  for (const [query, params] of effects) await query.run(params, db as never);
}
const SOUL = "0x" + "a1".repeat(32);
const OTHER = "0x" + "a2".repeat(32);
const STAKE = "0x" + "5C".repeat(28);
const claim = (almaIdHash: string, stake: string, tx: string) => ({ almaIdHash, cardanoStakeCredential: stake, aldeaBalance: "1500000000", snapshotSlot: "135460000", txHash: tx, blockNumber: 77 });

let db: PGlite;
beforeEach(async () => {
  db = new PGlite();
  await db.exec(readModelSql);
});

describe("founderClaimed", () => {
  it("records the seal with the credential as the holdings name it", async () => {
    await apply(db, founderClaimed(claim(SOUL, STAKE, "0xAA")));
    expect(await founderSeal(db as never, SOUL)).toEqual({
      almaIdHash: SOUL,
      stakeCredential: "5c".repeat(28),
      aldeaBalance: "1500000000",
      snapshotSlot: 135460000,
      claimedBlock: 77,
      txHash: "0xaa",
    });
    expect(await founderSeal(db as never, OTHER)).toBeUndefined();
  });

  it("keeps one seal per soul and per credential, whatever is replayed", async () => {
    await apply(db, founderClaimed(claim(SOUL, STAKE, "0xAA")));
    await apply(db, founderClaimed(claim(SOUL, STAKE, "0xAA")));
    // The contract allows neither; if such an event ever arrived it must not break the node
    await apply(db, founderClaimed(claim(OTHER, STAKE, "0xBB")));
    await apply(db, founderClaimed(claim(SOUL, "0x" + "6d".repeat(28), "0xCC")));
    expect((await db.query("SELECT alma_id_hash, tx_hash FROM founders")).rows).toEqual([{ alma_id_hash: SOUL, tx_hash: "0xaa" }]);
  });
});
