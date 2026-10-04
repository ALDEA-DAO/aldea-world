import { createHash, randomBytes } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { decodeJwt } from "jose";
import { createPublicClient, http, type Address, type LocalAccount } from "viem";
import { createApp } from "../../src/app";
import { createAccessTokenVerifier } from "../../src/auth/accessToken";
import type { AnyDb } from "../../src/auth/adapter";
import { createChallengeStore } from "../../src/auth/interaction";
import { generateSigningKey, publicJwks } from "../../src/auth/keys";
import type { EmailCodeSender } from "../../src/auth/methods/email";
import { createAlmaAuth, type AlmaAuth } from "../../src/auth/provider";
import type { ProvisionedCustody } from "../../src/auth/souls";
import { upsertOidcClients } from "../../src/db/clients";
import * as schema from "../../src/db/schema";
import { soulActivityFromDb } from "../../src/routes/orgs";
import { createPresenceStore } from "../../src/routes/presence";
import { createRequestHandler } from "../../src/server";
import type { VirtualAuthenticator } from "./virtualAuthenticator";

/**
 * The Resolver as it runs (API, ALMA Auth, login pages) on a random port, with its migrations on an in-memory
 * Postgres, a fake custody provider and an email sender that records codes.
 */

export const WORLD = "http://localhost:3000";
export const REDIRECT = `${WORLD}/`;
export const CHAIN_ID = 31337;
export const ALDEA_WORLD_ID = `0x${"a1".repeat(32)}`;

export interface Stack {
  issuer: string;
  auth: AlmaAuth;
  db: AnyDb;
  pg: PGlite;
  sentCodes: { to: string; code: string }[];
  custodies: ProvisionedCustody[];
  close: () => Promise<void>;
}

/** `custody: false` runs like local development: no custody provider, the client names a development key. */
export async function startStack({ custody = true }: { custody?: boolean } = {}): Promise<Stack> {
  const pg = new PGlite();
  const db = drizzle(pg, { schema }) as unknown as AnyDb;
  await migrate(drizzle(pg), { migrationsFolder: join(dirname(fileURLToPath(import.meta.url)), "../../drizzle"), migrationsSchema: "alma" });
  await upsertOidcClients(db, [{ clientId: "aldea-world", name: "ALDEA World", redirectUris: [REDIRECT] }]);

  const server: Server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  const issuer = `http://localhost:${port}`;
  const signingKeys = { keys: [await generateSigningKey()] };
  const apiResource = `${issuer}/v1`;
  const auth = createAlmaAuth({ issuer, db, signingKeys, cookieKeys: ["k"], pairwiseSalt: "s", apiResource });
  const verifyAccessToken = createAccessTokenVerifier({ issuer, audience: apiResource, jwks: publicJwks(signingKeys) });

  const sentCodes: Stack["sentCodes"] = [];
  const custodies: ProvisionedCustody[] = [];
  const sender: EmailCodeSender = { send: async (to, code) => void sentCodes.push({ to, code }) };
  const provisionCustody = async () => {
    const n = custodies.length + 1;
    const c = {
      subOrganizationId: `sub-${n}`,
      walletId: `wallet-${n}`,
      ownerAddress: `0x${n.toString(16).padStart(40, "1")}` as Address,
      smartAccountAddress: `0x${n.toString(16).padStart(40, "5")}` as Address,
    };
    custodies.push(c);
    return c;
  };
  // Plain signatures verify offline; the RPC is only needed for smart-account (ERC-1271/6492) signatures
  const client = createPublicClient({ transport: http("http://127.0.0.1:1") });
  const challenges = createChallengeStore(db);
  const soul = { db, chainId: CHAIN_ID, provisionCustody: custody ? provisionCustody : undefined };
  const passkey = { rpID: "localhost", origin: issuer };
  const email = { hmacKey: "test-hmac-key", sender };
  const wallet = { domain: `localhost:${port}`, origin: issuer, chainId: CHAIN_ID, client };
  const app = createApp({
    pingDb: async () => {},
    baseHead: async () => 1n,
    corsOrigins: [WORLD],
    interaction: { auth, soul, passkey, wallet, email },
    souls: { soul, verifyAccessToken, activity: soulActivityFromDb(db), allowDevelopmentController: !custody },
    presence: { verifyAccessToken, store: createPresenceStore(), aldeaWorldId: () => ALDEA_WORLD_ID },
    links: {
      me: { db, challenges, verifyAccessToken, wallet, email, worldOrigins: [WORLD], issuer },
      passkey: { db, challenges, passkey },
    },
  });
  server.on("request", createRequestHandler(app, auth));

  return {
    issuer,
    auth,
    db,
    pg,
    sentCodes,
    custodies,
    close: async () => {
      await new Promise((resolve) => server.close(resolve));
      await pg.close();
    },
  };
}

/** A browser for one issuer: keeps cookies and follows nothing by itself. */
export function browser(stack: Stack) {
  const jar = new Map<string, string>();
  async function request(url: string, init: { method?: string; body?: unknown; headers?: Record<string, string> } = {}) {
    const res = await fetch(new URL(url, stack.issuer), {
      method: init.method ?? "GET",
      redirect: "manual",
      headers: {
        cookie: [...jar].map(([k, v]) => `${k}=${v}`).join("; "),
        ...(init.body !== undefined ? { "content-type": "application/json" } : {}),
        ...init.headers,
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
    for (const header of res.headers.getSetCookie()) {
      const pair = header.split(";")[0]!;
      const eq = pair.indexOf("=");
      const value = pair.slice(eq + 1);
      if (value) jar.set(pair.slice(0, eq), value);
      else jar.delete(pair.slice(0, eq));
    }
    return res;
  }
  return { request, post: (path: string, body?: unknown, headers?: Record<string, string>) => request(path, { method: "POST", body: body ?? {}, headers }) };
}
export type Browser = ReturnType<typeof browser>;

/** Starts a login at /authorize; returns the interaction uid and the PKCE verifier. */
export async function begin(stack: Stack, b = browser(stack), scope = "openid alma alma:links") {
  const verifier = randomBytes(32).toString("base64url");
  const params = new URLSearchParams({
    client_id: "aldea-world",
    redirect_uri: REDIRECT,
    response_type: "code",
    scope,
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    code_challenge_method: "S256",
    nonce: "n",
  });
  const res = await b.request(`/authorize?${params}`);
  const uid = /\/interaction\/([^/?]+)/.exec(res.headers.get("location") ?? "")![1]!;
  return { b, uid, verifier };
}

export interface Tokens {
  almaId: string;
  accessToken: string;
  idToken: string;
  amr: string[];
}

/** Follows the redirect after a login method succeeded, exchanges the code and returns the tokens. */
export async function finish(stack: Stack, b: Browser, redirectTo: string, verifier: string): Promise<Tokens> {
  let next = redirectTo;
  for (let i = 0; i < 5 && !next.startsWith(REDIRECT); i++) next = new URL((await b.request(next)).headers.get("location")!, stack.issuer).href;
  const code = new URL(next).searchParams.get("code")!;
  const res = await fetch(`${stack.issuer}/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: REDIRECT, client_id: "aldea-world", code_verifier: verifier }),
  });
  const body = (await res.json()) as { id_token: string; access_token: string };
  const id = decodeJwt(body.id_token);
  return { almaId: id.sub!, accessToken: body.access_token, idToken: body.id_token, amr: id.amr as string[] };
}

const redirectOf = async (res: Response) => ((await res.json()) as { redirectTo: string }).redirectTo;

export async function signInWithPasskey(stack: Stack, device: VirtualAuthenticator, mode: "register" | "login" = "register", scope?: string) {
  const { b, uid, verifier } = await begin(stack, undefined, scope);
  const options = await (await b.post(`/interaction/${uid}/passkey/options`, { mode })).json();
  const credential = mode === "register" ? device.create(options) : device.get(options);
  const res = await b.post(`/interaction/${uid}/passkey/verify`, { credential });
  if (res.status !== 200) throw new Error(`passkey sign-in failed: ${res.status} ${await res.text()}`);
  return finish(stack, b, await redirectOf(res), verifier);
}

export async function signInWithEmail(stack: Stack, email: string) {
  const { b, uid, verifier } = await begin(stack);
  await b.post(`/interaction/${uid}/email/start`, { email });
  const { code } = stack.sentCodes.filter((s) => s.to === email).at(-1)!;
  const res = await b.post(`/interaction/${uid}/email/verify`, { email, code });
  if (res.status !== 200) throw new Error(`email sign-in failed: ${res.status} ${await res.text()}`);
  return finish(stack, b, await redirectOf(res), verifier);
}

export async function signInWithWallet(stack: Stack, account: LocalAccount) {
  const { b, uid, verifier } = await begin(stack);
  const { message } = (await (await b.post(`/interaction/${uid}/wallet/challenge`, { address: account.address })).json()) as { message: string };
  const res = await b.post(`/interaction/${uid}/wallet/verify`, { message, signature: await account.signMessage({ message }) });
  if (res.status !== 200) throw new Error(`wallet sign-in failed: ${res.status} ${await res.text()}`);
  return finish(stack, b, await redirectOf(res), verifier);
}

/** Calls the Resolver API as a world page would: with the access token and the world's origin. */
export function api(stack: Stack, accessToken: string) {
  const call = async (method: string, path: string, body?: unknown) =>
    fetch(`${stack.issuer}${path}`, {
      method,
      headers: { authorization: `Bearer ${accessToken}`, origin: WORLD, ...(body !== undefined ? { "content-type": "application/json" } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  return { get: (path: string) => call("GET", path), post: (path: string, body?: unknown) => call("POST", path, body ?? {}), del: (path: string) => call("DELETE", path) };
}
