import { bech32 } from "bech32";

/**
 * Who holds an $ALDEA UTxO, from its Cardano address. Holdings are added up per credential, not per address: a
 * wallet has many addresses but one stake key, and that stake key is what a holder links to their soul.
 *
 * A Shelley address is a header byte (type in the high nibble, network in the low one) followed by the 28-byte
 * payment credential and, for base addresses, the 28-byte stake credential (CIP-19).
 *
 * - base address (types 0 to 3): `stake:<hex28>`, the stake credential;
 * - enterprise or pointer address (types 4 to 7): `pay:<hex28>`, the payment credential (there is no stake one);
 * - anything else that can hold a UTxO (Byron): `addr:<address hex>`, so the total supply still adds up.
 */
export function credentialOf(addressHex: string): string {
  const hex = addressHex.toLowerCase().replace(/^0x/, "");
  const type = Number.parseInt(hex.slice(0, 1), 16);
  if (type <= 3 && hex.length === 2 + 56 + 56) return `stake:${hex.slice(2 + 56)}`;
  if (type >= 4 && type <= 7 && hex.length >= 2 + 56) return `pay:${hex.slice(2, 2 + 56)}`;
  return `addr:${hex}`;
}

const CREDENTIAL_RE = /^(stake|pay):[0-9a-f]{56}$/;

/** A credential as the API takes it: `stake:<hex28>` or `pay:<hex28>`, in lowercase. */
export function parseCredential(value: string): string | undefined {
  const credential = value.toLowerCase();
  return CREDENTIAL_RE.test(credential) ? credential : undefined;
}

/**
 * The credential a signature with `address` (bech32) speaks for, or undefined when it speaks for none:
 *
 * - a reward address (`stake…`): `stake:<hex28>`, its stake key signed;
 * - an enterprise address: `pay:<hex28>`, its payment key signed;
 * - a base address: none. Either of its two keys can sign for it, and its payment key proves nothing about the stake
 *   credential, which is where the holdings are counted.
 */
export function signerCredential(address: string): string | undefined {
  let bytes: number[];
  try {
    bytes = bech32.fromWords(bech32.decode(address, 200).words);
  } catch {
    return undefined;
  }
  if (bytes.length !== 29) return undefined;
  const type = bytes[0]! >> 4;
  const hex = Buffer.from(bytes.slice(1)).toString("hex");
  if (type === 14) return `stake:${hex}`;
  if (type === 6) return `pay:${hex}`;
  return undefined;
}
