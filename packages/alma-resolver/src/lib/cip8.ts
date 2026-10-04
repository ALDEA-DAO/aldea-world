import verifyDataSignature from "@cardano-foundation/cardano-verify-datasignature";
import { bech32 } from "bech32";
import { ProblemError } from "./problem";

/**
 * Linking a Cardano wallet: the holder signs a message with CIP-30 `signData` (CIP-8), which proves control of a key
 * without building a transaction. What gets linked is the credential that key belongs to, never one that merely
 * appears in an address:
 *
 * - a wallet with a stake key is linked by its **stake credential** (`cardano:stake:<hex28>`), which is what $ALDEA
 *   holdings are added up by. The signature has to come from the stake key. A base address also carries a stake
 *   credential, but anyone can build one that pairs their own payment key with somebody else's stake key, so a
 *   signature from the payment key of a base address proves nothing about the stake credential and is refused;
 * - an enterprise address has no stake part: it is linked by its payment credential (`cardano:pay:<hex28>`).
 */

// The library is CommonJS with a default export
const verify = ((verifyDataSignature as unknown as { default?: typeof verifyDataSignature }).default ?? verifyDataSignature) as typeof verifyDataSignature;

export type CardanoNetworkId = 0 | 1; // 0: test networks, 1: mainnet

export interface CardanoSigner {
  /** `stake:<hex28>` or `pay:<hex28>`, the same key Effectstream adds holdings up by. */
  credential: string;
  /** The address whose only credential is the one being linked: the signature is checked against it. */
  address: string;
  hasStakePart: boolean;
}

const fromHex = (hex: string) => Uint8Array.from(Buffer.from(hex, "hex"));
const toHex = (bytes: Uint8Array) => Buffer.from(bytes).toString("hex");
const encode = (prefix: string, bytes: Uint8Array) => bech32.encode(prefix, bech32.toWords(bytes), 1000);

/** An address as bech32 (`addr…`, `stake…`) or as the hex CIP-30 wallets return, in bytes. */
function addressBytes(address: string): Uint8Array {
  if (/^([0-9a-f]{2})+$/i.test(address)) return fromHex(address);
  try {
    return Uint8Array.from(bech32.fromWords(bech32.decode(address, 1000).words));
  } catch {
    throw new ProblemError(400, "invalid_address", "That is not a Cardano address");
  }
}

/** Whose signature links this address, and under which credential (CIP-19 address layout). */
export function cardanoSigner(address: string, network: CardanoNetworkId): CardanoSigner {
  const bytes = addressBytes(address);
  const type = (bytes[0] ?? 0xff) >> 4;
  if (((bytes[0] ?? 0) & 0x0f) !== network) throw new ProblemError(400, "wrong_network", network === 1 ? "That address is not on Cardano mainnet" : "That address is not on a Cardano test network");
  const suffix = network === 1 ? "" : "_test";

  // Reward (stake) address with a key credential
  if (type === 0xe && bytes.length === 29) return { credential: `stake:${toHex(bytes.subarray(1))}`, address: encode(`stake${suffix}`, bytes), hasStakePart: true };
  // Base address with a stake key: the proof has to be by that stake key, so it is checked against its reward address
  if ((type === 0 || type === 1) && bytes.length === 57) {
    const stake = bytes.subarray(29);
    return { credential: `stake:${toHex(stake)}`, address: encode(`stake${suffix}`, Uint8Array.from([0xe0 | network, ...stake])), hasStakePart: true };
  }
  // Enterprise address with a payment key
  if (type === 6 && bytes.length === 29) return { credential: `pay:${toHex(bytes.subarray(1))}`, address: encode(`addr${suffix}`, bytes), hasStakePart: false };
  throw new ProblemError(400, "unsupported_address", "This kind of address cannot be linked", "Use a wallet's stake address, or an address controlled by a single key.");
}

/** The message the holder signs. Wallets show it as it is, so it says what it is for, in the player's language. */
export function linkPayload(params: { almaId: string; domain: string; nonce: string; expiresAt: string }): string {
  return `ALDEA World · vincular Cardano\nalma: ${params.almaId}\ndominio: ${params.domain}\nnonce: ${params.nonce}\nvence: ${params.expiresAt}`;
}

/** True when `signature`/`key` (COSE_Sign1 and COSE_Key, hex) sign exactly `payload` with the signer's key. */
export function verifyCip8(signer: CardanoSigner, payload: string, signature: string, key: string): boolean {
  try {
    return verify(signature, key, payload, signer.address) === true;
  } catch {
    // Malformed CBOR is a bad signature, not a server error
    return false;
  }
}
