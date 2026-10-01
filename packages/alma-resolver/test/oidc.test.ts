import { createHash, randomBytes } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { SignJWT, createRemoteJWKSet, decodeJwt, importJWK, jwtVerify } from "jose";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { createAccessTokenVerifier } from "../src/auth/accessToken";
import type { AnyDb } from "../src/auth/adapter";
import { generateSigningKey, publicJwks, type SigningKeys } from "../src/auth/keys";
import { createAlmaAuth, type AlmaAuth } from "../src/auth/provider";
import { upsertOidcClients } from "../src/db/clients";
import * as schema from "../src/db/schema";
import { createRequestHandler } from "../src/server";

const ALDEA_REDIRECT = "http://localhost:3000/auth/callback";
const VELUM_REDIRECT = "https://velum.example/auth/callback";
const SOUL = "alma:main:human:0123456789abcdef0123456789abcdef";

let server: Server;
let issuer: string;
let apiResource: string;
let auth: AlmaAuth;
let keys: SigningKeys;
let pg: PGlite;

beforeAll(async () => {
  pg = new PGlite();
  const db = drizzle(pg, { schema }) as unknown as AnyDb;
  await migrate(drizzle(pg), { migrationsFolder: join(dirname(fileURLToPath(import.meta.url)), "../drizzle"), migrationsSchema: "alma" });
  await upsertOidcClients(db, [
    { clientId: "aldea-world", name: "ALDEA World", redirectUris: [ALDEA_REDIRECT] },
    { clientId: "velum", name: "Velum", redirectUris: [VELUM_REDIRECT], subjectType: "pairwise" },
  ]);

  server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  issuer = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  apiResource = `${issuer}/v1`;
  keys = { keys: [await generateSigningKey()] };
  auth = createAlmaAuth({ issuer, db, signingKeys: keys, cookieKeys: ["test-cookie-key"], pairwiseSalt: "test-salt", apiResource });
  const app = createApp({ pingDb: async () => {}, baseHead: async () => 1n, corsOrigins: [] });
  server.on("request", createRequestHandler(app, auth));
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
  await pg.close();
});

/** A browser: follows the provider's redirects and keeps its cookies. */
function browser() {
  const cookies = new Map<string, string>();
  return async function go(url: string) {
    const res = await fetch(url, { redirect: "manual", headers: { cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join("; ") } });
    for (const header of res.headers.getSetCookie()) {
      const [pair] = header.split(";");
      const [name, value] = pair!.split("=");
      if (value) cookies.set(name!, value);
      else cookies.delete(name!);
    }
    return res;
  };
}

const b64url = (buf: Buffer) => buf.toString("base64url");

interface LoginOptions {
  clientId?: string;
  redirectUri?: string;
  scope?: string;
  almaId?: string;
  pkce?: boolean;
}

/** Runs /authorize → login interaction → callback, and returns the code with its PKCE verifier. */
async function authorize({ clientId = "aldea-world", redirectUri = ALDEA_REDIRECT, scope = "openid offline_access alma alma:links", almaId = SOUL, pkce = true }: LoginOptions = {}) {
  const go = browser();
  const verifier = b64url(randomBytes(32));
  const nonce = b64url(createHash("sha256").update("turnkey-session-public-key").digest());
  const params = new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri, response_type: "code", scope, state: "s1", nonce });
  if (pkce) {
    params.set("code_challenge", b64url(createHash("sha256").update(verifier).digest()));
    params.set("code_challenge_method", "S256");
  }

  let res = await go(`${issuer}/authorize?${params}`);
  let location = res.headers.get("location") ?? "";
  const uid = /\/interaction\/([^/?]+)/.exec(location)?.[1];
  if (!uid) return { error: new URL(location, issuer).searchParams.get("error") ?? `status ${res.status}`, verifier, nonce };

  let next = new URL(await auth.completeLogin(uid, { almaId, amr: ["hwk"] }), issuer).href;
  for (let hops = 0; hops < 5 && !next.startsWith(redirectUri); hops++) {
    res = await go(next);
    location = res.headers.get("location") ?? "";
    if (!location) {
      const stuck = /\/interaction\/([^/?]+)/.exec(next)?.[1];
      const details = stuck ? await auth.provider.Interaction.find(stuck) : undefined;
      throw new Error(`stuck at ${next}: ${res.status} prompt=${JSON.stringify(details?.prompt)} session=${JSON.stringify(details?.session)}`);
    }
    next = new URL(location, issuer).href;
  }
  const callback = new URL(next);
  return { code: callback.searchParams.get("code") ?? undefined, state: callback.searchParams.get("state"), error: callback.searchParams.get("error") ?? undefined, verifier, nonce };
}

async function token(body: Record<string, string>) {
  const res = await fetch(`${issuer}/token`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(body) });
  return { status: res.status, body: (await res.json()) as Record<string, string> };
}

const exchange = (code: string, verifier: string, clientId = "aldea-world", redirectUri = ALDEA_REDIRECT) =>
  token({ grant_type: "authorization_code", code, redirect_uri: redirectUri, client_id: clientId, code_verifier: verifier });

describe("ALMA Auth (OIDC)", () => {
  it("publishes discovery with S256 PKCE, ES256 tokens and the PRD's endpoints", async () => {
    const config = (await (await fetch(`${issuer}/.well-known/openid-configuration`)).json()) as Record<string, unknown>;
    expect(config).toMatchObject({
      issuer,
      authorization_endpoint: `${issuer}/authorize`,
      token_endpoint: `${issuer}/token`,
      jwks_uri: `${issuer}/jwks`,
      revocation_endpoint: `${issuer}/token/revocation`,
      end_session_endpoint: `${issuer}/session/end`,
      code_challenge_methods_supported: ["S256"],
      id_token_signing_alg_values_supported: ["ES256"],
      subject_types_supported: expect.arrayContaining(["public", "pairwise"]),
    });
    const jwks = (await (await fetch(`${issuer}/jwks`)).json()) as { keys: Record<string, unknown>[] };
    expect(jwks.keys).toHaveLength(1);
    expect(jwks.keys[0]).not.toHaveProperty("d");
  });

  it("runs code + PKCE and issues 5-minute ES256 tokens whose subject is the soul", async () => {
    const { code, state, verifier, nonce } = await authorize();
    expect(state).toBe("s1");
    const { status, body } = await exchange(code!, verifier);
    expect(status).toBe(200);
    expect(body).toMatchObject({ token_type: "Bearer", expires_in: 300 });
    expect(body.refresh_token).toBeTruthy();

    const { payload: id } = await jwtVerify(body.id_token!, createRemoteJWKSet(new URL(`${issuer}/jwks`)), { issuer, audience: "aldea-world", algorithms: ["ES256"] });
    expect(id).toMatchObject({ sub: SOUL, alma: SOUL, nonce, amr: ["hwk"] });
    expect(id.exp! - id.iat!).toBe(300);
    expect(typeof id.auth_time).toBe("number");

    const access = await createAccessTokenVerifier({ issuer, audience: apiResource, jwks: publicJwks(keys) })(body.access_token!);
    expect(access?.almaId).toBe(SOUL);
    expect(access?.clientId).toBe("aldea-world");
    expect(access?.scopes.has("alma:links")).toBe(true);
  });

  it("requires PKCE and rejects a wrong code_verifier", async () => {
    expect((await authorize({ pkce: false })).error).toBe("invalid_request");
    const { code } = await authorize();
    const res = await exchange(code!, b64url(randomBytes(32)));
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_grant");
  });

  it("rejects access tokens from another key, issuer or audience", async () => {
    const verify = createAccessTokenVerifier({ issuer, audience: apiResource, jwks: publicJwks(keys) });
    const forge = async (key: SigningKeys["keys"][number], claims: { iss?: string; aud?: string } = {}) =>
      new SignJWT({ client_id: "aldea-world", scope: "alma:links" })
        .setProtectedHeader({ alg: "ES256", typ: "at+jwt", kid: key.kid })
        .setSubject(SOUL)
        .setIssuer(claims.iss ?? issuer)
        .setAudience(claims.aud ?? apiResource)
        .setIssuedAt()
        .setExpirationTime("5m")
        .sign(await importJWK(key, "ES256"));

    expect(await verify(await forge(keys.keys[0]!))).toMatchObject({ almaId: SOUL });
    expect(await verify(await forge(await generateSigningKey()))).toBeUndefined();
    expect(await verify(await forge(keys.keys[0]!, { aud: "https://other.example" }))).toBeUndefined();
    expect(await verify(await forge(keys.keys[0]!, { iss: "https://evil.example" }))).toBeUndefined();
  });

  it("rotates refresh tokens and revokes the whole family when one is reused", async () => {
    const { code, verifier } = await authorize();
    const first = (await exchange(code!, verifier)).body.refresh_token!;

    const rotated = await token({ grant_type: "refresh_token", refresh_token: first, client_id: "aldea-world" });
    expect(rotated.status).toBe(200);
    const second = rotated.body.refresh_token!;
    expect(second).toBeTruthy();
    expect(second).not.toBe(first);

    const reused = await token({ grant_type: "refresh_token", refresh_token: first, client_id: "aldea-world" });
    expect(reused.status).toBe(400);
    expect(reused.body.error).toBe("invalid_grant");
    // the reuse revoked the grant: the latest refresh token is dead too
    const after = await token({ grant_type: "refresh_token", refresh_token: second, client_id: "aldea-world" });
    expect(after.status).toBe(400);
  });

  it("gives pairwise clients a stable per-app subject and never the almaId", async () => {
    const login = async () => {
      const { code, verifier } = await authorize({ clientId: "velum", redirectUri: VELUM_REDIRECT });
      return decodeJwt((await exchange(code!, verifier, "velum", VELUM_REDIRECT)).body.id_token!);
    };
    const [a, b] = [await login(), await login()];
    expect(a.sub).not.toBe(SOUL);
    expect(a.sub).toBe(b.sub);
    expect(a).not.toHaveProperty("alma");
  });

  it("only redirects to registered redirect URIs", async () => {
    const params = new URLSearchParams({ client_id: "aldea-world", redirect_uri: "https://evil.example/cb", response_type: "code", scope: "openid", code_challenge: "x".repeat(43), code_challenge_method: "S256" });
    const res = await fetch(`${issuer}/authorize?${params}`, { redirect: "manual" });
    expect(res.status).toBe(400);
    expect(res.headers.get("location")).toBeNull();
  });
});
