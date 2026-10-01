import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getAddress, type Address } from "viem";

/**
 * Node configuration from the environment (see .env.example). The database connection uses Effectstream's own
 * variables (DB_HOST, DB_PORT, DB_USER, DB_PW, DB_NAME, PGLITE), read by the runtime directly.
 */
export interface SystemAddresses {
  CharacterSystem: Address;
  MovementSystem: Address;
  FounderSystem: Address;
}

const chainId = Number(process.env.CHAIN_ID ?? 31337);
const isLocal = chainId === 31337;

/** packages/shared/src/deployments/<chainId>.json, written by Deploy.s.sol and merge-world.ts. */
function readDeployment():
  | { world?: { address: string; blockNumber: number; systems: Record<string, string> }; protocol?: { almaAnchorRegistry: string; deployBlock: number }; aldeaWorldId?: string }
  | undefined {
  const path = join(import.meta.dir, `../../shared/src/deployments/${chainId}.json`);
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : undefined;
}

function systemAddresses(): SystemAddresses {
  const raw = process.env.SYSTEM_ADDRESSES_JSON
    ? (JSON.parse(process.env.SYSTEM_ADDRESSES_JSON) as Record<string, string>)
    : readDeployment()?.world?.systems;
  if (!raw) throw new Error(`No system addresses: set SYSTEM_ADDRESSES_JSON or deploy to chain ${chainId} first`);
  const pick = (name: keyof SystemAddresses) => {
    const value = raw[name];
    if (!value) throw new Error(`Missing address for ${name}`);
    return getAddress(value);
  };
  return { CharacterSystem: pick("CharacterSystem"), MovementSystem: pick("MovementSystem"), FounderSystem: pick("FounderSystem") };
}

function almaRegistryAddress(): Address {
  const value = process.env.ALMA_REGISTRY_ADDRESS || readDeployment()?.protocol?.almaAnchorRegistry;
  if (!value) throw new Error(`No AlmaAnchorRegistry address: set ALMA_REGISTRY_ADDRESS or deploy to chain ${chainId} first`);
  return getAddress(value);
}

const deployment = readDeployment();

export const env = {
  chainId,
  baseRpcUrl: process.env.BASE_RPC_URL ?? "http://127.0.0.1:8545",
  /**
   * First Base block to sync: the protocol's deployment, which precedes the World's (the tribe organizations are
   * anchored there).
   */
  startBlock: Number(process.env.START_BLOCK ?? deployment?.protocol?.deployBlock ?? deployment?.world?.blockNumber ?? 0),
  /** The World's deployment block: its systems' events start there. */
  worldStartBlock: Number(process.env.WORLD_START_BLOCK ?? deployment?.world?.blockNumber ?? process.env.START_BLOCK ?? 0),
  /** Base confirmations before an event is folded into the state machine (2 on public networks). */
  confirmations: Number(process.env.BASE_CONFIRMATIONS ?? (isLocal ? 0 : 2)),
  /** Main clock start (unix ms) for a fresh database; later restarts recover it from the database. */
  genesisMs: process.env.EFFECTSTREAM_GENESIS_MS ? Number(process.env.EFFECTSTREAM_GENESIS_MS) : undefined,
  systems: systemAddresses,
  almaRegistry: almaRegistryAddress,
  /** Key of this world in world_activity_hourly: its Atlas worldId, or the World address until it is registered. */
  activityWorldId: (process.env.ALDEA_WORLD_ID || deployment?.aldeaWorldId || process.env.WORLD_ADDRESS || deployment?.world?.address || "aldea").toLowerCase(),
};
