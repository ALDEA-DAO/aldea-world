import { almaAnchorRegistryAbi, worldAbi } from "@aldea/shared/abis";
import { encodeFunctionData, type Hex } from "viem";
import type { Call, PlayerAccount } from "../features/auth/smartAccount";
import type { Network } from "./setupNetwork";

/**
 * World calls sent from the player's account. Calls are built with `encodeFunctionData` and sent together, so a
 * birth that also anchors the soul is a single sponsored UserOperation; each call resolves once the store has
 * synced the transaction.
 */
export function createSystemCalls(network: Network, account: PlayerAccount) {
  const world = network.deployment.worldAddress;
  const send = async (calls: Call[]) => {
    const hash = await account.sendCalls(calls);
    await network.waitForTransaction(hash);
    return hash;
  };

  return {
    /** Anchors the soul (unless it already is) and asks for the birth, in one operation. */
    requestBirth: ({ characterClass, almaIdHash, anchor }: { characterClass: number; almaIdHash: Hex; anchor?: { almaId: string; docHash: Hex } }) =>
      send([
        ...(anchor
          ? [{ to: network.deployment.almaRegistry, data: encodeFunctionData({ abi: almaAnchorRegistryAbi, functionName: "anchorHuman", args: [anchor.almaId, anchor.docHash] }) }]
          : []),
        { to: world, data: encodeFunctionData({ abi: worldAbi, functionName: "aldea__requestBirth", args: [characterClass, almaIdHash] }) },
      ]),

    /** Draws the tribe once the target block exists. Permissionless: the Midwife usually does it first. */
    completeBirth: (characterId: number) => send([{ to: world, data: encodeFunctionData({ abi: worldAbi, functionName: "aldea__completeBirth", args: [characterId] }) }]),

    /** Admin only (the namespace owner): pauses or resumes births, entries and Founder claims. */
    setPaused: (paused: boolean) => send([{ to: world, data: encodeFunctionData({ abi: worldAbi, functionName: "aldea__setPaused", args: [paused] }) }]),
  };
}

export type SystemCalls = ReturnType<typeof createSystemCalls>;
