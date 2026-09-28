import { calculateJwkThumbprint, exportJWK, generateKeyPair, type JWK } from "jose";
import { logger } from "../lib/logger";

/**
 * ALMA Auth's token-signing keys: ES256 private JWKs. The first key signs; the rest stay in the JWKS so tokens signed
 * before a rotation keep verifying until they expire.
 *
 * They come from ALMA_AUTH_JWKS (a JSON `{ "keys": [...] }` held in the secret manager; generate one with
 * `pnpm --filter @aldea/alma-resolver auth:keygen`). Without it, development gets an ephemeral key, so sessions do not
 * survive a restart; production refuses to start.
 */
export interface SigningKeys {
  keys: JWK[];
}

export async function generateSigningKey(): Promise<JWK> {
  const { privateKey } = await generateKeyPair("ES256", { extractable: true });
  const jwk = await exportJWK(privateKey);
  return { ...jwk, alg: "ES256", use: "sig", kid: await calculateJwkThumbprint(jwk) };
}

export async function loadSigningKeys(env: NodeJS.ProcessEnv = process.env): Promise<SigningKeys> {
  const raw = env.ALMA_AUTH_JWKS;
  if (!raw) {
    if (env.NODE_ENV === "production") throw new Error("ALMA_AUTH_JWKS is required in production");
    logger.warn("ALMA_AUTH_JWKS is not set: using an ephemeral signing key (development only)");
    return { keys: [await generateSigningKey()] };
  }
  const jwks = JSON.parse(raw) as SigningKeys;
  if (!Array.isArray(jwks.keys) || jwks.keys.length === 0) throw new Error("ALMA_AUTH_JWKS has no keys");
  for (const key of jwks.keys) {
    if (key.kty !== "EC" || key.crv !== "P-256" || !key.d || !key.kid) throw new Error("ALMA_AUTH_JWKS keys must be private ES256 (P-256) JWKs with a kid");
  }
  return jwks;
}

/** Public half of the keys, for verifying ALMA Auth tokens in this process. */
export function publicJwks({ keys }: SigningKeys): { keys: JWK[] } {
  return { keys: keys.map(({ d: _d, ...pub }) => pub) };
}
