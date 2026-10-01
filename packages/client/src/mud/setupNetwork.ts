import { syncToZustand } from "@latticexyz/store-sync/zustand";
import mudConfig from "contracts/mud.config";
import { createPublicClient, http, type Chain } from "viem";
import { worldDeployment } from "./deployment";

/**
 * Keeps the World's `aldea` tables in a zustand store: from the MUD indexer when VITE_MUD_INDEXER_URL is set
 * (falling back to the RPC), then block by block. Polling every second keeps on-chain changes on screen in under 3 s.
 */
export async function setupNetwork(chain: Chain) {
  const deployment = worldDeployment(chain.id);
  const publicClient = createPublicClient({ chain, transport: http(), pollingInterval: 1_000 });
  const sync = await syncToZustand({
    config: mudConfig,
    address: deployment.worldAddress,
    publicClient,
    startBlock: deployment.startBlock,
    indexerUrl: import.meta.env.VITE_MUD_INDEXER_URL || false,
  });
  return { ...sync, publicClient, deployment };
}

export type Network = Awaited<ReturnType<typeof setupNetwork>>;
