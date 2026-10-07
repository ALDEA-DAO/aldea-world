import { founderAttestationDomain, founderAttestationTypes, type FounderAttestation } from "@aldea/shared/eip712";
import { hashTypedData, type Address, type Hex, type LocalAccount } from "viem";

/**
 * The Founder attestor: the key that vouches, to the World on Base, for what a soul holds on Cardano. The contract
 * cannot read Cardano, so it accepts a seal only with this key's signature over the claim (EIP-712), and only once.
 *
 * It is declared temporary trust: the key is rotatable through `Config.founderAttestor`, and every attestation is kept
 * so that it can be checked against the public holdings.
 */
export interface Attestor {
  address: Address;
  sign: (chainId: number, world: Address, attestation: FounderAttestation) => Promise<{ signature: Hex; digest: Hex }>;
}

export function createAttestor(account: LocalAccount): Attestor {
  return {
    address: account.address,
    async sign(chainId, world, attestation) {
      const typed = { domain: founderAttestationDomain(chainId, world), types: founderAttestationTypes, primaryType: "FounderAttestation", message: attestation } as const;
      return { signature: await account.signTypedData(typed), digest: hashTypedData(typed) };
    },
  };
}
