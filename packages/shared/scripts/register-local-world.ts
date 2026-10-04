/**
 * Local chains only: registers ALDEA World in the Atlas, as its organization's controller (the deployer, which stands
 * in for the ALDEA Safe locally), and writes its id to packages/shared/src/deployments/<chainId>.json as
 * `aldeaWorldId`. On public networks the Safe registers the world.
 *
 *   PRIVATE_KEY=0x… pnpm --filter @aldea/shared register-local-world -- --chain-id 31337 --rpc-url http://127.0.0.1:8545
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { createPublicClient, createWalletClient, defineChain, http, parseEventLogs, zeroAddress, zeroHash, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { atlasRegistryAbi } from "../src/abis";

const WORLD_NAME = "ALDEA World";
const ORG = "alma:main:org:aldea-world";

const { values } = parseArgs({
  options: { "chain-id": { type: "string", default: "31337" }, "rpc-url": { type: "string", default: "http://127.0.0.1:8545" } },
});
const chainId = Number(values["chain-id"]);
if (chainId !== 31337) throw new Error("register-local-world is for local chains: on public networks the Safe registers the world");
if (!process.env.PRIVATE_KEY) throw new Error("PRIVATE_KEY is required");

const deploymentPath = join(dirname(fileURLToPath(import.meta.url)), `../src/deployments/${chainId}.json`);
const deployment = JSON.parse(readFileSync(deploymentPath, "utf8"));
const org = deployment.orgs?.[ORG]?.almaIdHash as Hex | undefined;
if (!org) throw new Error(`${ORG} is not in ${deploymentPath}; deploy the rails first`);

const chain = defineChain({ id: chainId, name: "local", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [values["rpc-url"]] } } });
const account = privateKeyToAccount(process.env.PRIVATE_KEY as Hex);
const publicClient = createPublicClient({ chain, transport: http() });
const { request } = await publicClient.simulateContract({
  account,
  address: deployment.protocol.atlasRegistry,
  abi: atlasRegistryAbi,
  functionName: "registerWorld",
  // Public, no parent, no metadata; governor 0x0 means the sender
  args: [WORLD_NAME, org, zeroHash, 0, "", zeroAddress],
});
const hash = await createWalletClient({ account, chain, transport: http() }).writeContract(request);
const receipt = await publicClient.waitForTransactionReceipt({ hash });
const [registered] = parseEventLogs({ abi: atlasRegistryAbi, logs: receipt.logs, eventName: "WorldRegistered" });
if (!registered) throw new Error("registerWorld did not emit WorldRegistered");

deployment.aldeaWorldId = registered.args.worldId;
writeFileSync(deploymentPath, `${JSON.stringify(deployment, null, 2)}\n`);
console.log(`${WORLD_NAME}: ${deployment.aldeaWorldId}`);
