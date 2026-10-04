import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { almaAnchorRegistryAbi, atlasRegistryAbi } from "@aldea/shared/abis";
import { almaIdHash } from "@aldea/shared/alma";
import { createPublicClient, createWalletClient, defineChain, http, keccak256, parseEventLogs, toHex, zeroAddress, zeroHash, type Abi, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

/**
 * Writes to the local Atlas the way a forker would (their own key, soul and organization), so the Portal tests can
 * watch worlds appear. The deployer key is the local stand-in for the ALDEA Safe: organization controller and curator.
 */

const deployment = JSON.parse(readFileSync(fileURLToPath(new URL("../../shared/src/deployments/31337.json", import.meta.url)), "utf8")) as {
  aldeaWorldId: Hex;
  protocol: { almaAnchorRegistry: Hex; atlasRegistry: Hex };
};
export const ALDEA_WORLD_ID = deployment.aldeaWorldId;

// anvil's default account 0: a public development key
const DEPLOYER_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const RPC = "http://127.0.0.1:8545";
const chain = defineChain({ id: 31337, name: "local", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [RPC] } } });
const publicClient = createPublicClient({ chain, transport: http() });

async function send(key: Hex, address: Hex, abi: Abi, functionName: string, args: unknown[]) {
  const account = privateKeyToAccount(key);
  const { request } = await publicClient.simulateContract({ account, address, abi, functionName, args });
  return publicClient.waitForTransactionReceipt({ hash: await createWalletClient({ account, chain, transport: http() }).writeContract(request) });
}

export interface ForkPlan {
  key: Hex;
  name: string;
  org: string;
  clientUrl: string;
}

export interface Fork extends ForkPlan {
  worldId: Hex;
  versionId: Hex;
}

/** The identity of a fork that is about to be registered: its names are unique per run, since the chain is shared. */
export function planFork(): ForkPlan {
  const suffix = randomBytes(4).toString("hex");
  return { key: toHex(randomBytes(32)), name: `ALDEA Nocturna ${suffix}`, org: `alma:main:org:nocturna-${suffix}`, clientUrl: `https://nocturna-${suffix}.example` };
}

/** A fork of ALDEA World with one candidate version and one web client, registered by a brand-new key. */
export async function registerFork(plan: ForkPlan = planFork()): Promise<Fork> {
  const { key, name, org, clientUrl } = plan;
  const { almaAnchorRegistry, atlasRegistry } = deployment.protocol;
  const docHash = keccak256(toHex(name));
  // A new key has nothing to pay gas with: anvil hands it 1 ETH
  await publicClient.request({ method: "anvil_setBalance" as never, params: [privateKeyToAccount(key).address, toHex(10n ** 18n)] as never });

  await send(key, almaAnchorRegistry, almaAnchorRegistryAbi, "anchorHuman", [`alma:main:human:${randomBytes(16).toString("hex")}`, docHash]);
  await send(key, almaAnchorRegistry, almaAnchorRegistryAbi, "anchorOrg", [org, docHash]);
  const world = await send(key, atlasRegistry, atlasRegistryAbi, "registerWorld", [name, almaIdHash(org), ALDEA_WORLD_ID, 0, "", zeroAddress]);
  const [{ args: registered }] = parseEventLogs({ abi: atlasRegistryAbi, logs: world.logs, eventName: "WorldRegistered" }) as [{ args: { worldId: Hex } }];
  const version = await send(key, atlasRegistry, atlasRegistryAbi, "registerVersion", [
    registered.worldId,
    { parentVersionId: zeroHash, chainId: 31337n, worldAddress: `0x${"0e".repeat(20)}`, gitCommit: `0x${"c0".repeat(20)}`, engine: "mud@2.2.23", semver: "0.1.0", clientCid: `bafynocturna${name.slice(-8)}` },
  ]);
  const [{ args: versioned }] = parseEventLogs({ abi: atlasRegistryAbi, logs: version.logs, eventName: "VersionRegistered" }) as [{ args: { versionId: Hex } }];
  await send(key, atlasRegistry, atlasRegistryAbi, "registerClient", [versioned.versionId, clientUrl, 0, almaIdHash(org)]);
  return { ...plan, worldId: registered.worldId, versionId: versioned.versionId };
}

/** The curator vouches for a world. */
export const verifyWorld = (worldId: Hex) => send(DEPLOYER_KEY, deployment.protocol.atlasRegistry, atlasRegistryAbi, "setVerified", [worldId, true]);
