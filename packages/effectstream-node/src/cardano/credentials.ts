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
