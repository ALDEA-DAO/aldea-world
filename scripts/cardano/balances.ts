/**
 * Checks the test wallets on Cardano preprod: what each one holds of tALDEA on-chain against what it is meant to hold.
 *
 *   pnpm cardano:balances
 */
import { ALDEA_ASSETS } from "../../packages/shared/src/constants.ts";
import { toBaseUnits } from "./amounts.ts";
import { provider, readWallets } from "./wallets.ts";

const { policyId, assetNameHex } = ALDEA_ASSETS.preprod;
if (!policyId) throw new Error("ALDEA_ASSETS.preprod.policyId is empty: mint tALDEA first (pnpm cardano:mint)");
const unit = policyId + assetNameHex;
const { treasury, holders } = readWallets();
const koios = provider();

let mismatches = 0;
for (const wallet of [treasury, ...holders]) {
  const utxos = await koios.fetchAddressUTxOs(wallet.address);
  const held = utxos.reduce((sum, utxo) => sum + BigInt(utxo.output.amount.find((a) => a.unit === unit)?.quantity ?? 0), 0n);
  const expected = toBaseUnits(wallet.taldea);
  if (held !== expected) mismatches++;
  console.log(`${wallet.name.padEnd(10)} ${wallet.taldea.padStart(14)} tALDEA  on-chain ${held.toString().padStart(15)}  ${held === expected ? "ok" : `expected ${expected}`}`);
}
console.log(`\nhttps://preprod.cardanoscan.io/token/${unit}`);
if (mismatches) process.exit(1);
