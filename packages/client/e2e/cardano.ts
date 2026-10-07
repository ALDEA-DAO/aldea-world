import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { MeshWallet } from "@meshsdk/core";
import type { Page } from "@playwright/test";
import { bech32 } from "bech32";

/**
 * A Cardano holder for the tests: a throwaway wallet that really signs (CIP-8, as Eternl or Lace do through CIP-30),
 * with the $ALDEA the test says it holds written straight into Effectstream's read model. Reading real balances from
 * Cardano is covered by `pnpm cardano:balances`; here every run needs a wallet nobody has linked or claimed with.
 */

const COMPOSE = fileURLToPath(new URL("../../../scripts/compose.sh", import.meta.url));
const EFFECTSTREAM = "http://localhost:9999";

export interface Holder {
  wallet: MeshWallet;
  /** Reward address, bech32 and hex (what CIP-30 returns). */
  stakeAddress: string;
  stakeAddressHex: string;
  /** `stake:<hex28>`. */
  credential: string;
}

/** Whether the local Effectstream follows Cardano (it needs CARDANO_UTXORPC_URL); the claim tests need it. */
export async function cardanoConfigured(): Promise<boolean> {
  const res = await fetch(`${EFFECTSTREAM}/api/v1/cardano/holdings/stake:${"00".repeat(28)}`).catch(() => undefined);
  return res?.status === 200;
}

/** A new wallet holding `aldea` whole tokens, as far as the read model is concerned. */
export async function newHolder(aldea: number): Promise<Holder> {
  const wallet = new MeshWallet({ networkId: 0, key: { type: "mnemonic", words: MeshWallet.brew() as string[] } });
  await wallet.init();
  const [stakeAddress] = await wallet.getRewardAddresses();
  const bytes = Buffer.from(bech32.fromWords(bech32.decode(stakeAddress!, 1000).words));
  const credential = `stake:${bytes.subarray(1).toString("hex")}`;
  if (aldea > 0) {
    const sql = `INSERT INTO aldea_holdings (credential, balance, updated_height) VALUES ('${credential}', ${BigInt(aldea) * 1_000_000n}, 1) ON CONFLICT (credential) DO UPDATE SET balance = EXCLUDED.balance`;
    execFileSync(COMPOSE, ["exec", "-T", "postgres", "psql", "-q", "-U", "aldea", "-d", "effectstream", "-c", sql], { stdio: "pipe" });
  }
  return { wallet, stakeAddress: stakeAddress!, stakeAddressHex: bytes.toString("hex"), credential };
}

/**
 * Puts a CIP-30 wallet named "Test wallet" in the page, backed by the holder's keys. `declines` makes it refuse that
 * many signatures first, as a person closing the wallet's prompt would.
 */
export async function installWallet(page: Page, holder: Holder, { declines = 0 } = {}) {
  let left = declines;
  await page.exposeFunction("__cardanoSign", async (addressHex: string, payloadHex: string) => {
    if (left > 0) {
      left--;
      throw new Error("user declined");
    }
    if (addressHex !== holder.stakeAddressHex) throw new Error("the dialog must sign with the stake address");
    return holder.wallet.signData(Buffer.from(payloadHex, "hex").toString("utf8"), holder.stakeAddress);
  });
  await page.addInitScript((rewardAddress) => {
    const sign = (window as unknown as { __cardanoSign: (a: string, p: string) => Promise<unknown> }).__cardanoSign;
    (window as unknown as { cardano: unknown }).cardano = {
      testwallet: {
        name: "Test wallet",
        apiVersion: "1",
        enable: async () => ({ getRewardAddresses: async () => [rewardAddress], getChangeAddress: async () => rewardAddress, signData: (address: string, payload: string) => sign(address, payload) }),
      },
    };
  }, holder.stakeAddressHex);
}
