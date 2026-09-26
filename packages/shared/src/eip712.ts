import type { Address, Hex } from "viem";

/**
 * EIP-712 types for FounderAttestation, identical to FounderSystem.sol and src/types/FounderAttestation.sol.
 * The verifying contract is the MUD World (FounderSystem hashes `_world()`).
 */
export const FOUNDER_ATTESTATION_DOMAIN_NAME = "ALDEA World";
export const FOUNDER_ATTESTATION_DOMAIN_VERSION = "1";

export const founderAttestationDomain = (chainId: number, worldAddress: Address) =>
  ({
    name: FOUNDER_ATTESTATION_DOMAIN_NAME,
    version: FOUNDER_ATTESTATION_DOMAIN_VERSION,
    chainId,
    verifyingContract: worldAddress,
  }) as const;

export const founderAttestationTypes = {
  FounderAttestation: [
    { name: "owner", type: "address" },
    { name: "almaIdHash", type: "bytes32" },
    { name: "cardanoStakeCredential", type: "bytes28" },
    { name: "aldeaBalance", type: "uint128" },
    { name: "snapshotSlot", type: "uint64" },
    { name: "deadline", type: "uint64" },
    { name: "nonce", type: "bytes32" },
  ],
} as const;

export interface FounderAttestation {
  owner: Address;
  almaIdHash: Hex;
  cardanoStakeCredential: Hex; // 28 bytes
  aldeaBalance: bigint; // base units
  snapshotSlot: bigint;
  deadline: bigint; // unix seconds, issuance + 15 min
  nonce: Hex; // 32 random bytes
}
