import { almaAnchorRegistryAbi, worldAbi } from "@aldea/shared/abis";
import { encodeFunctionData, type Address, type Hex } from "viem";
import type { Call, PlayerAccount } from "../features/auth/smartAccount";
import type { Network } from "./setupNetwork";

/**
 * World calls sent from the player's account. Calls are built with `encodeFunctionData` and sent together, so a
 * birth that also anchors the soul is a single sponsored UserOperation; each call resolves once the store has
 * synced the transaction.
 */
export interface Anchor {
  almaId: string;
  docHash: Hex;
}

/** A Founder attestation as the Resolver returns it (numbers as decimal strings) and its signature. */
export interface FounderClaim {
  attestation: { owner: Address; almaIdHash: Hex; cardanoStakeCredential: Hex; aldeaBalance: string; snapshotSlot: string; deadline: string; nonce: Hex };
  signature: Hex;
}

export function createSystemCalls(network: Network, account: PlayerAccount) {
  const world = network.deployment.worldAddress;
  const send = async (calls: Call[]) => {
    const hash = await account.sendCalls(calls);
    await network.waitForTransaction(hash);
    return hash;
  };

  const anchorCall = (anchor?: Anchor): Call[] =>
    anchor ? [{ to: network.deployment.almaRegistry, data: encodeFunctionData({ abi: almaAnchorRegistryAbi, functionName: "anchorHuman", args: [anchor.almaId, anchor.docHash] }) }] : [];
  const claimCall = ({ attestation, signature }: FounderClaim): Call => ({
    to: world,
    data: encodeFunctionData({
      abi: worldAbi,
      functionName: "aldea__claimFounder",
      args: [{ ...attestation, aldeaBalance: BigInt(attestation.aldeaBalance), snapshotSlot: BigInt(attestation.snapshotSlot), deadline: BigInt(attestation.deadline) }, signature],
    }),
  });

  return {
    /**
     * Anchors the soul (unless it already is) and asks for the birth, in one operation. During Genesis the Founder
     * seal is claimed in between, since only Founders are born then.
     */
    requestBirth: ({ characterClass, almaIdHash, anchor, founder }: { characterClass: number; almaIdHash: Hex; anchor?: Anchor; founder?: FounderClaim }) =>
      send([
        ...anchorCall(anchor),
        ...(founder ? [claimCall(founder)] : []),
        { to: world, data: encodeFunctionData({ abi: worldAbi, functionName: "aldea__requestBirth", args: [characterClass, almaIdHash] }) },
      ]),

    /** Claims the Founder seal with the Resolver's attestation, anchoring the soul first when it is not yet. */
    claimFounder: ({ anchor, ...claim }: FounderClaim & { anchor?: Anchor }) => send([...anchorCall(anchor), claimCall(claim)]),

    /** Draws the tribe once the target block exists. Permissionless: the Midwife usually does it first. */
    completeBirth: (characterId: number) => send([{ to: world, data: encodeFunctionData({ abi: worldAbi, functionName: "aldea__completeBirth", args: [characterId] }) }]),

    /** Records that the player's character went into a building (overwrites its Location). */
    enterBuilding: (buildingId: Hex) => send([{ to: world, data: encodeFunctionData({ abi: worldAbi, functionName: "aldea__enterBuilding", args: [buildingId] }) }]),

    /** Records that the character is back outside (no effect when it already is). */
    leaveBuilding: () => send([{ to: world, data: encodeFunctionData({ abi: worldAbi, functionName: "aldea__leaveBuilding" }) }]),

    /** Admin only (the namespace owner): pauses or resumes births, entries and Founder claims. */
    setPaused: (paused: boolean) => send([{ to: world, data: encodeFunctionData({ abi: worldAbi, functionName: "aldea__setPaused", args: [paused] }) }]),
  };
}

export type SystemCalls = ReturnType<typeof createSystemCalls>;
