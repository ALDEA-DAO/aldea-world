import { getAddress, isAddress, type Address, type Hex, type PublicClient } from "viem";
import { createSiweMessage, generateSiweNonce, parseSiweMessage, verifySiweMessage } from "viem/siwe";
import { ProblemError } from "../../lib/problem";
import type { ChallengeStore } from "../interaction";
import { loginWithKey, type SoulDeps } from "../souls";

/**
 * Wallet sign-in for people who already have one: a CAIP-122 / Sign-In with Ethereum (EIP-4361) challenge on the
 * world's Base chain. Verification goes through the chain, so smart accounts (ERC-1271) and not-yet-deployed ones
 * (ERC-6492) work as well as plain keys. Cardano (CIP-8) and Midnight wallets are linked later from the soul.
 */

export interface WalletConfig {
  /** Host and origin of the login pages: the SIWE `domain` and `uri`. */
  domain: string;
  origin: string;
  chainId: number;
  client: PublicClient;
}

/** A Sign-In with Ethereum message for `address`, valid for 5 minutes. */
export function siweMessage(config: Pick<WalletConfig, "domain" | "origin" | "chainId">, address: string, statement: string) {
  if (!isAddress(address)) throw new ProblemError(400, "invalid_address", "That is not an EVM address");
  const nonce = generateSiweNonce();
  const issuedAt = new Date();
  const message = createSiweMessage({
    domain: config.domain,
    uri: config.origin,
    address: getAddress(address),
    chainId: config.chainId,
    version: "1",
    nonce,
    issuedAt,
    expirationTime: new Date(issuedAt.getTime() + 5 * 60 * 1000),
    statement,
  });
  return { message, nonce, expiresAt: new Date(issuedAt.getTime() + 5 * 60 * 1000).toISOString() };
}

/**
 * Verifies the signature of a message we issued (compared with the stored copy, so nothing in it can be swapped:
 * address, chain, nonce, domain). Returns the CAIP-10 account it proves.
 */
export async function verifySiwe(config: Pick<WalletConfig, "client" | "chainId">, issued: string | undefined, message: string, signature: Hex) {
  if (!issued || issued !== message) throw new ProblemError(410, "challenge_expired", "The request expired", "Try again.");
  const { address, nonce, domain } = parseSiweMessage(message) as { address: Address; nonce: string; domain: string };
  const valid = await verifySiweMessage(config.client, { message, signature, domain, nonce, address }).catch(() => false);
  if (!valid) throw new ProblemError(401, "invalid_signature", "The signature did not match");
  return { address: getAddress(address), value: `eip155:${config.chainId}:${getAddress(address)}` };
}

export async function walletChallenge(config: WalletConfig, challenges: ChallengeStore, uid: string, address: string) {
  const challenge = siweMessage(config, address, "Sign in to ALMA. This does not send a transaction or cost gas.");
  await challenges.put(uid, "wallet", { message: challenge.message });
  return challenge;
}

export async function walletVerify(config: WalletConfig, challenges: ChallengeStore, soulDeps: SoulDeps, uid: string, message: string, signature: Hex) {
  const pending = await challenges.take<{ message: string }>(uid, "wallet");
  const { value } = await verifySiwe(config, pending?.message, message, signature);
  return loginWithKey(soulDeps, {
    kind: "evm",
    value,
    proof: { type: "caip122", message, signature, chainId: `eip155:${config.chainId}`, verifiedAt: new Date().toISOString() },
    label: "Wallet",
  });
}
