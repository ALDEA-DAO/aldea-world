/**
 * Prints a new ALMA_AUTH_JWKS with a fresh ES256 signing key. To rotate, pass the current value: the new key goes
 * first (it signs from the next deploy) and only the previous signing key is kept, so tokens already issued keep
 * verifying.
 *
 *   pnpm --filter @aldea/alma-resolver auth:keygen                    # new JWKS
 *   ALMA_AUTH_JWKS='{"keys":[…]}' pnpm --filter @aldea/alma-resolver auth:keygen   # rotation
 */
import { generateSigningKey } from "../src/auth/keys";

const current = process.env.ALMA_AUTH_JWKS ? (JSON.parse(process.env.ALMA_AUTH_JWKS) as { keys: unknown[] }).keys : [];
console.log(JSON.stringify({ keys: [await generateSigningKey(), ...current.slice(0, 1)] }));
