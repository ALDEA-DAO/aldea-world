/**
 * Mints tALDEA, the stand-in for $ALDEA on Cardano preprod, and hands it out to the test wallets in one transaction.
 *
 * Mainnet $ALDEA is a fixed-supply token; tALDEA imitates that with a native-script policy that needs the minter's
 * signature and stops being valid a few hours after the mint, so its supply cannot change afterwards either. Same
 * asset name ("ALDEA") and decimals (6).
 *
 *   pnpm cardano:wallets     once, then fund the minter from the faucet
 *   pnpm cardano:mint        mints and distributes; prints the policy id to put in packages/shared/src/constants.ts
 *   pnpm cardano:mint --dry  only shows what it would do
 *   pnpm cardano:balances    compares each wallet's on-chain balance with what it should hold
 */
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { deserializeAddress, ForgeScript, MeshTxBuilder, resolveScriptHash, resolveSlotNo, type Asset, type NativeScript } from "@meshsdk/core";
import { ALDEA_ASSET_NAME_HEX as ASSET_NAME_HEX, ALDEA_DECIMALS as DECIMALS } from "../../packages/shared/src/constants.ts";
import { toBaseUnits } from "./amounts.ts";
import { openWallet, provider, readWallets, WALLETS_FILE, type TestWallet } from "./wallets.ts";

/** ADA sent with each wallet's tALDEA: above the minimum a token output needs, and enough to pay a few fees. */
const ADA_PER_WALLET = 5_000_000n;
const POLICY_OPEN_HOURS = 6;

const dry = process.argv.includes("--dry");
const record = join(WALLETS_FILE, "../taldea.json");
// Each run makes a different token (the policy's expiry is part of its id): one is enough
if (existsSync(record) && !dry && !process.argv.includes("--again")) {
  console.error(`tALDEA was already minted (${record}). Pass --again to mint another token under a new policy.`);
  process.exit(1);
}
const wallets = readWallets();
const recipients: TestWallet[] = [wallets.treasury, ...wallets.holders];
const supply = recipients.reduce((sum, wallet) => sum + toBaseUnits(wallet.taldea), 0n);

const minter = await openWallet(wallets.minter.mnemonic);
const minterAddress = await minter.getChangeAddress();
const { pubKeyHash } = deserializeAddress(minterAddress);
const expiry = Number(resolveSlotNo("preprod", Date.now() + POLICY_OPEN_HOURS * 3_600_000));
const policy: NativeScript = {
  type: "all",
  scripts: [
    { type: "sig", keyHash: pubKeyHash },
    { type: "before", slot: String(expiry) },
  ],
};
const script = ForgeScript.fromNativeScript(policy);
const policyId = resolveScriptHash(script);
const unit = policyId + ASSET_NAME_HEX;

const utxos = await minter.getUtxos();
const lovelace = utxos.reduce((sum, utxo) => sum + BigInt(utxo.output.amount.find((a) => a.unit === "lovelace")?.quantity ?? 0), 0n);
const needed = ADA_PER_WALLET * BigInt(recipients.length) + 5_000_000n;

console.log(`minter     ${minterAddress}`);
console.log(`balance    ${Number(lovelace) / 1e6} ADA (needs about ${Number(needed) / 1e6})`);
console.log(`policy     ${policyId} (closes at slot ${expiry}, about ${POLICY_OPEN_HOURS} h from now)`);
console.log(`supply     ${supply} base units of tALDEA to ${recipients.length} wallets`);
if (lovelace < needed) {
  console.error(`\nThe minter needs test ADA: fund ${minterAddress} from the preprod faucet and run this again.`);
  process.exit(1);
}
if (dry) process.exit(0);

const tx = new MeshTxBuilder({ fetcher: provider(), verbose: false });
tx.mint(supply.toString(), policyId, ASSET_NAME_HEX).mintingScript(script);
for (const wallet of recipients) {
  const amount: Asset[] = [{ unit: "lovelace", quantity: ADA_PER_WALLET.toString() }];
  const taldea = toBaseUnits(wallet.taldea);
  // A wallet that holds none still gets ADA, so it exists on-chain and can be linked
  if (taldea > 0n) amount.push({ unit, quantity: taldea.toString() });
  tx.txOut(wallet.address, amount);
}
const unsigned = await tx.requiredSignerHash(pubKeyHash).invalidHereafter(expiry).changeAddress(minterAddress).selectUtxosFrom(utxos).complete();
const txHash = await minter.submitTx(await minter.signTx(unsigned));

writeFileSync(record, `${JSON.stringify({ network: "preprod", policyId, assetNameHex: ASSET_NAME_HEX, decimals: DECIMALS, policy, supply: supply.toString(), txHash }, null, 2)}\n`);
console.log(`\nminted     https://preprod.cardanoscan.io/transaction/${txHash}`);
console.log(`token      https://preprod.cardanoscan.io/token/${unit}`);
console.log(`recorded in ${record}: set ALDEA_ASSETS.preprod.policyId to ${policyId}`);
