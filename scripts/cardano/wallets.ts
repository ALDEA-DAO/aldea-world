/**
 * Test wallets for Cardano preprod: the minter of the tALDEA test token, a "treasury" (excluded from the eligible
 * supply) and ten holders with different balances, some below the Founder minimum.
 *
 * They live in .cardano-preprod/wallets.json, which is never committed: the recovery phrases are in it, so the holders
 * can be imported into Eternl or Lace. These are test wallets on a test network; never reuse a phrase on mainnet.
 *
 *   pnpm cardano:wallets          creates the file once and prints the address to fund from the faucet
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { KoiosProvider, MeshWallet } from "@meshsdk/core";

export const PREPROD_KOIOS = "https://preprod.koios.rest/api/v1";
export const WALLETS_FILE = join(import.meta.dirname, "../../.cardano-preprod/wallets.json");
const TESTNET = 0;

/** tALDEA each holder receives, in whole tokens. The Founder minimum is 1,000. */
export const HOLDER_BALANCES = ["0", "10", "500", "999.999999", "1000", "1000.000001", "5000", "25000", "100000", "1000000"] as const;
export const TREASURY_BALANCE = "10000000";

export interface TestWallet {
  name: string;
  mnemonic: string[];
  address: string;
  /** Bech32 reward (stake) address: what a holder links to their soul. */
  stakeAddress: string;
  /** tALDEA it is meant to hold, in whole tokens. */
  taldea: string;
}

export interface WalletsFile {
  network: "preprod";
  minter: TestWallet;
  treasury: TestWallet;
  holders: TestWallet[];
}

export const provider = () => new KoiosProvider(PREPROD_KOIOS);

export async function openWallet(mnemonic: string[]): Promise<MeshWallet> {
  const koios = provider();
  const wallet = new MeshWallet({ networkId: TESTNET, fetcher: koios, submitter: koios, key: { type: "mnemonic", words: mnemonic } });
  await wallet.init();
  return wallet;
}

async function create(name: string, taldea: string): Promise<TestWallet> {
  const mnemonic = MeshWallet.brew() as string[];
  const wallet = await openWallet(mnemonic);
  const [stakeAddress] = await wallet.getRewardAddresses();
  return { name, mnemonic, address: await wallet.getChangeAddress(), stakeAddress: stakeAddress ?? "", taldea };
}

export function readWallets(): WalletsFile {
  if (!existsSync(WALLETS_FILE)) throw new Error(`${WALLETS_FILE} does not exist: run pnpm cardano:wallets first`);
  return JSON.parse(readFileSync(WALLETS_FILE, "utf8")) as WalletsFile;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  if (!existsSync(WALLETS_FILE)) {
    const file: WalletsFile = {
      network: "preprod",
      minter: await create("minter", "0"),
      treasury: await create("treasury", TREASURY_BALANCE),
      holders: await Promise.all(HOLDER_BALANCES.map((taldea, i) => create(`holder-${String(i + 1).padStart(2, "0")}`, taldea))),
    };
    mkdirSync(dirname(WALLETS_FILE), { recursive: true });
    writeFileSync(WALLETS_FILE, `${JSON.stringify(file, null, 2)}\n`, { mode: 0o600 });
    console.log(`Created ${WALLETS_FILE}`);
  }
  const { minter, treasury, holders } = readWallets();
  console.log(`\nFund the minter with test ADA (the preprod faucet gives 10,000):\n  ${minter.address}\n`);
  console.log(`treasury   ${treasury.taldea.padStart(14)} tALDEA  ${treasury.address}`);
  for (const holder of holders) console.log(`${holder.name}  ${holder.taldea.padStart(14)} tALDEA  ${holder.address}`);
}
