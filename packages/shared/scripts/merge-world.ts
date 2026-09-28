/**
 * Merges the MUD World deployment into packages/shared/src/deployments/<chainId>.json:
 * the World address and start block (from packages/contracts/worlds.json, written by `mud deploy`) and the
 * address of every aldea system, read from the World's `world:Systems` table. Effectstream needs the system
 * addresses because non-root systems emit their events from their own address.
 *
 *   pnpm --filter @aldea/shared merge-world -- --chain-id 31337 --rpc-url http://127.0.0.1:8545
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { createPublicClient, getAddress, http, slice, stringToHex, concatHex, type Hex } from "viem";
import { worldAbi } from "../src/abis";

const { values } = parseArgs({
  options: { "chain-id": { type: "string", default: "31337" }, "rpc-url": { type: "string", default: "http://127.0.0.1:8545" } },
});
const chainId = Number(values["chain-id"]);
const here = dirname(fileURLToPath(import.meta.url));
const worldsPath = join(here, "../../contracts/worlds.json");
const deploymentPath = join(here, `../src/deployments/${chainId}.json`);

/** MUD ResourceId: 2-byte type, 14-byte namespace, 16-byte name. */
const resourceId = (type: "tb" | "sy", namespace: string, name: string): Hex =>
  concatHex([stringToHex(type, { size: 2 }), stringToHex(namespace, { size: 14 }), stringToHex(name, { size: 16 })]);

const SYSTEMS = ["CharacterSystem", "MovementSystem", "FounderSystem", "AdminSystem"] as const;

const worlds = JSON.parse(readFileSync(worldsPath, "utf8")) as Record<string, { address: Hex; blockNumber?: number }>;
const world = worlds[String(chainId)];
if (!world) throw new Error(`No World for chain ${chainId} in ${worldsPath}; run mud deploy first`);
// worlds.json omits the block on local chains; `mud deploy` always records it in deploys/<chainId>/latest.json
if (world.blockNumber === undefined) {
  const latest = JSON.parse(readFileSync(join(here, `../../contracts/deploys/${chainId}/latest.json`), "utf8"));
  if (getAddress(latest.worldAddress) === getAddress(world.address)) world.blockNumber = Number(latest.blockNumber);
}

const client = createPublicClient({ transport: http(values["rpc-url"]) });
const systemsTable = resourceId("tb", "world", "Systems");
const systems: Record<string, Hex> = {};
for (const name of SYSTEMS) {
  const [staticData] = await client.readContract({
    address: world.address,
    abi: worldAbi,
    functionName: "getRecord",
    args: [systemsTable, [resourceId("sy", "aldea", name)]],
  });
  const address = getAddress(slice(staticData, 0, 20));
  if (address === "0x0000000000000000000000000000000000000000") throw new Error(`${name} is not registered`);
  systems[name] = address;
}

const deployment = JSON.parse(readFileSync(deploymentPath, "utf8"));
deployment.world = { address: getAddress(world.address), blockNumber: world.blockNumber ?? 0, systems };
writeFileSync(deploymentPath, `${JSON.stringify(deployment, null, 2)}\n`);
console.log(JSON.stringify(deployment.world, null, 2));
