import { ALDEA_DECIMALS } from "../../packages/shared/src/constants.ts";

/** A whole-token amount as text to base units: "1000.000001" → 1000000001n. */
export function toBaseUnits(amount: string): bigint {
  const [whole = "0", fraction = ""] = amount.split(".");
  if (!/^\d+$/.test(whole) || !/^\d*$/.test(fraction) || fraction.length > ALDEA_DECIMALS) throw new Error(`Not an $ALDEA amount: ${amount}`);
  return BigInt(whole) * 10n ** BigInt(ALDEA_DECIMALS) + BigInt(fraction.padEnd(ALDEA_DECIMALS, "0"));
}
