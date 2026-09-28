/*
 * The player's account on Base: a Coinbase Smart Wallet owned by the soul's Turnkey EVM key (ADR 0006).
 *
 * - `smart` (Base Sepolia, Base): every write is a UserOperation sponsored by the CDP paymaster. The bundler and
 *   paymaster are reached through the ALMA Resolver (`/v1/aa/rpc`), which holds the CDP key, requires the player's
 *   access token and only forwards calls to the World and AlmaAnchorRegistry functions the game uses.
 * - `eoa` (local anvil, which has no bundler): the owner key sends plain transactions and the anvil funds it.
 *
 * The account address is counterfactual: it is known before the first UserOperation deploys the wallet, so it can be
 * the soul's controller from the start.
 */
import {
  createPublicClient,
  createWalletClient,
  http,
  numberToHex,
  parseEther,
  type Address,
  type Chain,
  type Hash,
  type Hex,
  type LocalAccount,
} from "viem";
import { createBundlerClient, toCoinbaseSmartAccount } from "viem/account-abstraction";

export type AaMode = "smart" | "eoa";

export interface Call {
  to: Address;
  data?: Hex;
  value?: bigint;
}

export interface PlayerAccount {
  mode: AaMode;
  /** The smart wallet (smart mode) or the owner key (eoa mode): the soul's controller and the character's owner. */
  address: Address;
  /** Sends the calls atomically and resolves with the transaction hash once it is included. */
  sendCalls: (calls: readonly Call[]) => Promise<Hash>;
}

export interface PlayerAccountOptions {
  owner: LocalAccount;
  chain: Chain;
  rpcUrl?: string;
  mode: AaMode;
  /** Resolver endpoint that proxies the CDP bundler and paymaster (smart mode). */
  aaRpcUrl?: string;
  /** Current ALMA Auth access token, sent to the proxy with each request (smart mode). */
  getAccessToken?: () => string | undefined;
}

const LOCAL_CHAIN_ID = 31337;

export async function createPlayerAccount({ owner, chain, rpcUrl, mode, aaRpcUrl, getAccessToken }: PlayerAccountOptions): Promise<PlayerAccount> {
  const transport = http(rpcUrl);
  const client = createPublicClient({ chain, transport });

  if (mode === "eoa") {
    if (chain.id !== LOCAL_CHAIN_ID) throw new Error("VITE_AA_MODE=eoa is only for the local anvil");
    const wallet = createWalletClient({ account: owner, chain, transport });
    return {
      mode,
      address: owner.address,
      sendCalls: async (calls) => {
        await fundOnAnvil(client, owner.address);
        let hash: Hash | undefined;
        // anvil has no batching: one transaction per call, in order; the last hash identifies the action
        for (const call of calls) {
          hash = await wallet.sendTransaction({ to: call.to, data: call.data, value: call.value ?? 0n });
          const receipt = await client.waitForTransactionReceipt({ hash });
          if (receipt.status !== "success") throw new Error(`Transaction ${hash} reverted`);
        }
        if (!hash) throw new Error("No calls to send");
        return hash;
      },
    };
  }

  if (!aaRpcUrl) throw new Error("The bundler endpoint (VITE_ALMA_API_URL) is required in smart mode");
  const account = await toCoinbaseSmartAccount({ client, owners: [owner], version: "1.1" });
  const bundler = createBundlerClient({
    account,
    client,
    paymaster: true,
    transport: http(aaRpcUrl, {
      fetchFn: (input, init) => {
        const headers = new Headers(init?.headers);
        const token = getAccessToken?.();
        if (token) headers.set("authorization", `Bearer ${token}`);
        return fetch(input, { ...init, headers });
      },
    }),
  });
  return {
    mode,
    address: account.address,
    sendCalls: async (calls) => {
      const hash = await bundler.sendUserOperation({ calls: calls.map((c) => ({ to: c.to, data: c.data ?? "0x", value: c.value ?? 0n })) });
      const receipt = await bundler.waitForUserOperationReceipt({ hash });
      if (!receipt.success) throw new Error(`UserOperation ${hash} reverted`);
      return receipt.receipt.transactionHash;
    },
  };
}

/** Local only: tops the owner up to 1 ETH with anvil's cheat code, so a new player never needs a faucet. */
async function fundOnAnvil(client: ReturnType<typeof createPublicClient>, address: Address) {
  const balance = await client.getBalance({ address });
  if (balance >= parseEther("0.1")) return;
  await client.request({ method: "anvil_setBalance" as never, params: [address, numberToHex(parseEther("1"))] as never });
}
