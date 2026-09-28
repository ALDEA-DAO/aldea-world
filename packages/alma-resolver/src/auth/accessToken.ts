import type { Context } from "hono";
import { createLocalJWKSet, jwtVerify, type JSONWebKeySet } from "jose";
import { isAlmaId } from "@aldea/shared/alma";

/**
 * Verifies ALMA Auth access tokens (ES256 JWTs for the ALMA API) against the JWKS: signature, issuer, audience and
 * expiry. The API acts on the public almaId, so tokens with a pairwise subject are not accepted here.
 */
export interface AlmaAccess {
  almaId: string;
  clientId: string;
  scopes: Set<string>;
}

export function createAccessTokenVerifier({ issuer, audience, jwks }: { issuer: string; audience: string; jwks: JSONWebKeySet }) {
  const keys = createLocalJWKSet(jwks);
  return async function verify(token: string): Promise<AlmaAccess | undefined> {
    try {
      const { payload } = await jwtVerify(token, keys, { issuer, audience, algorithms: ["ES256"], typ: "at+jwt" });
      if (typeof payload.sub !== "string" || !isAlmaId(payload.sub, "human")) return undefined;
      return {
        almaId: payload.sub,
        clientId: String(payload.client_id ?? ""),
        scopes: new Set(typeof payload.scope === "string" ? payload.scope.split(" ") : []),
      };
    } catch {
      return undefined;
    }
  };
}

export function bearerToken(c: Context): string | undefined {
  const header = c.req.header("authorization");
  return header?.startsWith("Bearer ") ? header.slice("Bearer ".length).trim() : undefined;
}
