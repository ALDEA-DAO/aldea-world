import type { TurnkeyApiClient } from "@turnkey/sdk-server";
import { Hono } from "hono";
import { createLocalJWKSet, jwtVerify, type JSONWebKeySet } from "jose";
import { bearerToken, type AlmaAccess } from "../auth/accessToken";
import { ensureCustody, type SoulDeps } from "../auth/souls";
import { ProblemError } from "../lib/problem";

/**
 * `POST /v1/custody/session`: opens a Turnkey session on the soul's sub-organization for the browser's session key.
 * The browser sends the ID token it got with `nonce = sha256(sessionPublicKey)` and that public key; Turnkey verifies
 * the token against ALMA Auth's JWKS and the nonce binding, and registers the key as a short-lived login key, so the
 * browser can sign with the soul's EVM key without the Resolver ever touching it.
 */

export interface CustodyRoutesDeps {
  soul: SoulDeps;
  turnkey: TurnkeyApiClient;
  verifyAccessToken: (token: string) => Promise<AlmaAccess | undefined>;
  issuer: string;
  jwks: JSONWebKeySet;
  /** Session lifetime at Turnkey, in seconds. */
  sessionSeconds?: number;
}

export function createCustodyRoutes(deps: CustodyRoutesDeps) {
  const app = new Hono();
  const keys = createLocalJWKSet(deps.jwks);

  app.post("/session", async (c) => {
    const token = bearerToken(c);
    const access = token ? await deps.verifyAccessToken(token) : undefined;
    if (!access) throw new ProblemError(401, "unauthorized", "Sign in first");

    const { oidcToken, publicKey } = (await c.req.json().catch(() => ({}))) as { oidcToken?: string; publicKey?: string };
    if (!oidcToken || !publicKey || !/^0[23][0-9a-f]{64}$/i.test(publicKey)) throw new ProblemError(400, "invalid_request", "Missing ID token or session key");
    // The ID token must be ALMA Auth's and belong to the same soul as the access token
    const id = await jwtVerify(oidcToken, keys, { issuer: deps.issuer, algorithms: ["ES256"] }).catch(() => undefined);
    if (id?.payload.sub !== access.almaId) throw new ProblemError(401, "invalid_id_token", "The ID token does not match this session");

    const custody = await ensureCustody(deps.soul, access.almaId);
    if (!custody) throw new ProblemError(503, "custody_unavailable", "Your keys are not ready yet", "Try again in a moment.");

    const seconds = deps.sessionSeconds ?? 60 * 60;
    await deps.turnkey.oauthLogin({ organizationId: custody.subOrganizationId, oidcToken, publicKey, expirationSeconds: String(seconds) });
    return c.json({
      subOrganizationId: custody.subOrganizationId,
      ownerAddress: custody.ownerAddress,
      smartAccountAddress: custody.smartAccountAddress,
      expiresAt: new Date(Date.now() + seconds * 1000).toISOString(),
    });
  });

  return app;
}
