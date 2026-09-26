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
function readDeployment(): { world?: { blockNumber: number; systems: Record<string, string> } } | undefined {
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

export const env = {
  chainId,
  baseRpcUrl: process.env.BASE_RPC_URL ?? "http://127.0.0.1:8545",
  /** First Base block to sync: the World's deployment block. */
  startBlock: Number(process.env.START_BLOCK ?? readDeployment()?.world?.blockNumber ?? 0),
  /** Base confirmations before an event is folded into the state machine (2 on public networks). */
  confirmations: Number(process.env.BASE_CONFIRMATIONS ?? (isLocal ? 0 : 2)),
  /** Main clock start (unix ms) for a fresh database; later restarts recover it from the database. */
  genesisMs: process.env.EFFECTSTREAM_GENESIS_MS ? Number(process.env.EFFECTSTREAM_GENESIS_MS) : undefined,
  systems: systemAddresses,
};
