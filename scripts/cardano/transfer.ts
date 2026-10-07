/**
 * Moves tALDEA between two of the preprod test wallets, to watch holdings change.
 *
 *   pnpm cardano:transfer --from holder-10 --to holder-01 --amount 250000
 */
import { parseArgs } from "node:util";
import { MeshTxBuilder } from "@meshsdk/core";
import { ALDEA_ASSETS } from "../../packages/shared/src/constants.ts";
import { toBaseUnits } from "./amounts.ts";
import { openWallet, provider, readWallets } from "./wallets.ts";

const { values } = parseArgs({ options: { from: { type: "string" }, to: { type: "string" }, amount: { type: "string" } } });
const wallets = readWallets();
const all = [wallets.minter, wallets.treasury, ...wallets.holders];
const find = (name: string | undefined) => {
  const wallet = all.find((w) => w.name === name);
  if (!wallet) throw new Error(`Unknown wallet "${name}": one of ${all.map((w) => w.name).join(", ")}`);
  return wallet;
};
const from = find(values.from);
const to = find(values.to);
if (!values.amount) throw new Error("--amount is required, in whole tALDEA");
const unit = ALDEA_ASSETS.preprod.policyId + ALDEA_ASSETS.preprod.assetNameHex;

const sender = await openWallet(from.mnemonic);
// The minimum ADA a token output needs travels with it; the change (ADA and the rest of the tALDEA) returns to the sender
const unsigned = await new MeshTxBuilder({ fetcher: provider(), verbose: false })
  .txOut(to.address, [
    { unit: "lovelace", quantity: "1500000" },
    { unit, quantity: toBaseUnits(values.amount).toString() },
  ])
  .changeAddress(from.address)
  .selectUtxosFrom(await sender.getUtxos())
  .complete();
const txHash = await sender.submitTx(await sender.signTx(unsigned));
console.log(`${values.amount} tALDEA from ${from.name} to ${to.name}: https://preprod.cardanoscan.io/transaction/${txHash}`);
