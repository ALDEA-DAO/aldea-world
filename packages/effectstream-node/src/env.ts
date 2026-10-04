import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ALDEA_ASSETS, type CardanoNetwork } from "@aldea/shared/constants";
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
  | { world?: { address: string; blockNumber: number; systems: Record<string, string> }; protocol?: { almaAnchorRegistry: string; atlasRegistry?: string; deployBlock: number }; aldeaWorldId?: string }
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

function atlasRegistryAddress(): Address {
  const value = process.env.ATLAS_ADDRESS || readDeployment()?.protocol?.atlasRegistry;
  if (!value) throw new Error(`No AtlasRegistry address: set ATLAS_ADDRESS or deploy to chain ${chainId} first`);
  return getAddress(value);
}

/**
 * Where $ALDEA is read from: a UTxO RPC endpoint (a local Dolos, or a hosted one with an API key). Without
 * CARDANO_UTXORPC_URL the node runs without Cardano and aldea_holdings stays empty.
 *
 * The sync starts at a block just before the asset's first UTxO. On preprod that is the block before the tALDEA mint;
 * on mainnet it has to be given (CARDANO_START_SLOT and CARDANO_START_HASH).
 */
// Keys in alphabetical order (hash, slot): Effectstream stores the start point as immutable config and compares it as
// serialized JSON on the next start, after Postgres has sorted the keys; any other order hangs every restart silently.
const PREPROD_START = { hash: "25f5f3fc114a6d03d6ed856926a9fa538a126260d71fbc7f602017b25464f8c9", slot: 135417364 };

function cardanoConfig() {
  const rpcUrl = process.env.CARDANO_UTXORPC_URL;
  if (!rpcUrl) return undefined;
  const network = (process.env.CARDANO_NETWORK ?? "preprod") as CardanoNetwork;
  const asset = ALDEA_ASSETS[network];
  if (!asset) throw new Error(`CARDANO_NETWORK must be one of ${Object.keys(ALDEA_ASSETS).join(", ")}`);
  const start = process.env.CARDANO_START_SLOT && process.env.CARDANO_START_HASH ? { hash: process.env.CARDANO_START_HASH, slot: Number(process.env.CARDANO_START_SLOT) } : network === "preprod" ? PREPROD_START : undefined;
  if (!start) throw new Error("Set CARDANO_START_SLOT and CARDANO_START_HASH: a block just before the asset's first UTxO");
  const apiKey = process.env.CARDANO_UTXORPC_API_KEY;
  return {
    rpcUrl,
    headers: apiKey ? { "dmtr-api-key": apiKey } : undefined,
    network,
    policyId: (process.env.ALDEA_POLICY_ID || asset.policyId).toLowerCase(),
    assetNameHex: (process.env.ALDEA_ASSET_NAME_HEX || asset.assetNameHex).toLowerCase(),
    start,
  };
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
  atlasRegistry: atlasRegistryAddress,
  /** The World this node measures, as the Atlas versions name it. */
  worldAddress: (process.env.WORLD_ADDRESS || deployment?.world?.address || "").toLowerCase(),
  cardano: cardanoConfig(),
  /** Key of this world in world_activity_hourly: its Atlas worldId, or the World address until it is registered. */
  activityWorldId: (process.env.ALDEA_WORLD_ID || deployment?.aldeaWorldId || process.env.WORLD_ADDRESS || deployment?.world?.address || "aldea").toLowerCase(),
};
