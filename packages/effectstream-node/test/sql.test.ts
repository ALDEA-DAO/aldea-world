import { describe, expect, it } from "bun:test";
import { sql } from "../src/sql.ts";

describe("sql", () => {
  it("builds the same IR pgtyped generates (inclusive locations)", () => {
    // IR from a pgtyped-generated query in the Effectstream evm-cardano template
    const statement =
      "INSERT INTO events (chain, event_type, from_address, to_address, amount, tx_hash, block_height)\nVALUES (:chain!, :event_type!, :from_address, :to_address, :amount, :tx_hash!, :block_height!)\nRETURNING *";
    const ir = (sql(statement) as any).queryIR;
    expect(ir.params[0]).toEqual({ name: "chain", required: true, transform: { type: "scalar" }, locs: [{ a: 104, b: 110 }] });
    expect(ir.params.find((p: any) => p.name === "from_address").required).toBe(false);
    expect(ir.usedParamSet).toEqual({ chain: true, event_type: true, from_address: true, to_address: true, amount: true, tx_hash: true, block_height: true });
  });

  it("ignores ::casts and merges repeated parameters", () => {
    const ir = (sql("SELECT :x!::text, :x") as any).queryIR;
    expect(ir.params).toHaveLength(1);
    expect(ir.params[0].locs).toEqual([{ a: 7, b: 9 }, { a: 18, b: 19 }]);
  });
});
