import { getDeployment } from "@aldea/shared/deployments";
import type { Address } from "viem";

/**
 * Contract addresses for the build's chain: VITE_* overrides, else packages/shared/src/deployments. The local anvil
 * deployment (31337.json) is not committed; `pnpm dev` writes it, and it is picked up here when present.
 */
const localDeployment = Object.values(import.meta.glob("../../../shared/src/deployments/31337.json", { eager: true, import: "default" }))[0];

export interface WorldDeployment {
  worldAddress: Address;
  /** Block to start syncing the World's tables from. */
  startBlock: bigint;
  almaRegistry: Address;
}

export function worldDeployment(chainId: number): WorldDeployment {
  const env = import.meta.env;
  const deployment = getDeployment(chainId, localDeployment);
  const worldAddress = (env.VITE_WORLD_ADDRESS || deployment.world?.address) as Address | undefined;
  if (!worldAddress) throw new Error(`The World is not deployed on chain ${chainId} yet`);
  return {
    worldAddress,
    startBlock: BigInt(deployment.world?.blockNumber ?? 0),
    almaRegistry: (env.VITE_ALMA_REGISTRY_ADDRESS || deployment.protocol.almaAnchorRegistry) as Address,
  };
}

/** ALDEA World's id in the Atlas, once it is registered there. */
export function aldeaWorldId(chainId: number): `0x${string}` | undefined {
  const fromEnv = import.meta.env.VITE_ALDEA_WORLD_ID as `0x${string}` | undefined;
  if (fromEnv) return fromEnv;
  try {
    return getDeployment(chainId, localDeployment).aldeaWorldId;
  } catch {
    return undefined;
  }
}
