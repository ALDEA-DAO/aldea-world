import { createHash, randomBytes } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { eq } from "drizzle-orm";
import { decodeJwt } from "jose";
import { createPublicClient, http, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import type { AnyDb } from "../src/auth/adapter";
import { generateSigningKey } from "../src/auth/keys";
import type { EmailCodeSender } from "../src/auth/methods/email";
import { createAlmaAuth, type AlmaAuth } from "../src/auth/provider";
import { loginWithKey, type ProvisionedCustody } from "../src/auth/souls";
import { upsertOidcClients } from "../src/db/clients";
import * as schema from "../src/db/schema";
import { createRequestHandler } from "../src/server";
import { VirtualAuthenticator } from "./helpers/virtualAuthenticator";

const REDIRECT = "http://localhost:3000/auth/callback";
const CHAIN_ID = 31337;

let server: Server;
let issuer: string;
let auth: AlmaAuth;
let db: AnyDb;
let pg: PGlite;
const sentCodes: { to: string; code: string }[] = [];
const custodies: ProvisionedCustody[] = [];

beforeAll(async () => {
  pg = new PGlite();
  db = drizzle(pg, { schema }) as unknown as AnyDb;
  await migrate(drizzle(pg), { migrationsFolder: join(dirname(fileURLToPath(import.meta.url)), "../drizzle"), migrationsSchema: "alma" });
  await upsertOidcClients(db, [{ clientId: "aldea-world", name: "ALDEA World", redirectUris: [REDIRECT] }]);

  server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  issuer = `http://localhost:${port}`;
  auth = createAlmaAuth({ issuer, db, signingKeys: { keys: [await generateSigningKey()] }, cookieKeys: ["k"], pairwiseSalt: "s", apiResource: `${issuer}/v1` });

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
  const app = createApp({
    pingDb: async () => {},
    baseHead: async () => 1n,
    corsOrigins: [],
    interaction: {
      auth,
      soul: { db, chainId: CHAIN_ID, provisionCustody },
      passkey: { rpID: "localhost", origin: issuer },
      wallet: { domain: `localhost:${port}`, origin: issuer, chainId: CHAIN_ID, client },
      email: { hmacKey: "test-hmac-key", sender },
    },
  });
  server.on("request", createRequestHandler(app, auth));
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
  await pg.close();
});

/** A browser that keeps cookies per name (enough for one issuer) and follows nothing by itself. */
function browser() {
  const jar = new Map<string, string>();
  async function request(url: string, init: { method?: string; body?: unknown } = {}) {
    const res = await fetch(new URL(url, issuer), {
      method: init.method ?? "GET",
      redirect: "manual",
      headers: { cookie: [...jar].map(([k, v]) => `${k}=${v}`).join("; "), ...(init.body ? { "content-type": "application/json" } : {}) },
      body: init.body ? JSON.stringify(init.body) : undefined,
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
  return { request, post: (path: string, body?: unknown) => request(path, { method: "POST", body: body ?? {} }) };
}

/** Starts a login at /authorize and returns the interaction's uid and the PKCE verifier. */
async function begin(b = browser()) {
  const verifier = randomBytes(32).toString("base64url");
  const params = new URLSearchParams({
    client_id: "aldea-world",
    redirect_uri: REDIRECT,
    response_type: "code",
    scope: "openid alma",
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    code_challenge_method: "S256",
    nonce: "n",
  });
  const res = await b.request(`/authorize?${params}`);
  const uid = /\/interaction\/([^/?]+)/.exec(res.headers.get("location") ?? "")![1]!;
  return { b, uid, verifier };
}

/** Follows the redirect after a login method succeeded and returns the ID token's claims. */
async function finish(b: ReturnType<typeof browser>, redirectTo: string, verifier: string) {
  let next = redirectTo;
  for (let i = 0; i < 5 && !next.startsWith(REDIRECT); i++) next = new URL((await b.request(next)).headers.get("location")!, issuer).href;
  const code = new URL(next).searchParams.get("code")!;
  const res = await fetch(`${issuer}/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: REDIRECT, client_id: "aldea-world", code_verifier: verifier }),
  });
  return decodeJwt(((await res.json()) as { id_token: string }).id_token);
}

describe("hosted login page", () => {
  it("renders for the interaction's browser with a strict CSP, and not for others", async () => {
    const { b, uid } = await begin();
    const page = await b.request(`/interaction/${uid}`);
    expect(page.status).toBe(200);
    expect(page.headers.get("content-security-policy")).toContain("script-src 'nonce-");
    expect(await page.text()).toContain("ALDEA World");
    expect((await browser().request(`/interaction/${uid}`)).status).toBe(400);
  });

  it("lets the person cancel", async () => {
    const { b, uid } = await begin();
    const { redirectTo } = (await (await b.post(`/interaction/${uid}/abort`)).json()) as { redirectTo: string };
    let next = redirectTo;
    for (let i = 0; i < 5 && !next.startsWith(REDIRECT); i++) next = new URL((await b.request(next)).headers.get("location")!, issuer).href;
    expect(new URL(next).searchParams.get("error")).toBe("access_denied");
  });
});

describe("passkey", () => {
  const authenticator = () => new VirtualAuthenticator(issuer, "localhost");

  it("creates a soul with custody on registration and signs back in with the same passkey", async () => {
    const device = authenticator();
    const first = await begin();
    const creation = await (await first.b.post(`/interaction/${first.uid}/passkey/options`, { mode: "register" })).json();
    const registered = await first.b.post(`/interaction/${first.uid}/passkey/verify`, { credential: device.create(creation) });
    expect(registered.status).toBe(200);
    const claims = await finish(first.b, ((await registered.json()) as { redirectTo: string }).redirectTo, first.verifier);
    expect(claims.sub).toMatch(/^alma:main:human:[0-9a-f]{32}$/);
    expect(claims.amr).toEqual(["hwk"]);

    const almaId = claims.sub!;
    const soulLinks = await db.select().from(schema.links).where(eq(schema.links.almaId, almaId));
    expect(soulLinks.map((l) => [l.kind, l.roles])).toEqual(expect.arrayContaining([["passkey", ["login"]], ["evm", ["controller"]]]));
    const [custody] = await db.select().from(schema.custody).where(eq(schema.custody.almaId, almaId));
    expect(custody?.subOrganizationId).toMatch(/^sub-/);
    const [soul] = await db.select().from(schema.souls).where(eq(schema.souls.almaId, almaId));
    expect(soul?.status).toBe("prepared");
    expect((soul?.doc as { controllers: { id: string }[] }).controllers[0]?.id).toBe(`did:pkh:eip155:${CHAIN_ID}:${custody?.smartAccountAddress}`);

    const second = await begin();
    const request = await (await second.b.post(`/interaction/${second.uid}/passkey/options`, { mode: "login" })).json();
    const signedIn = await second.b.post(`/interaction/${second.uid}/passkey/verify`, { credential: device.get(request) });
    const again = await finish(second.b, ((await signedIn.json()) as { redirectTo: string }).redirectTo, second.verifier);
    expect(again.sub).toBe(almaId);
  });

  it("rejects a replayed response and a response from another browser", async () => {
    const device = authenticator();
    const { b, uid } = await begin();
    const creation = await (await b.post(`/interaction/${uid}/passkey/options`, { mode: "register" })).json();
    const credential = device.create(creation);
    expect((await browser().post(`/interaction/${uid}/passkey/verify`, { credential })).status).toBe(400);
    expect((await b.post(`/interaction/${uid}/passkey/verify`, { credential })).status).toBe(200);
    // the challenge was consumed
    const replay = await begin();
    expect((await replay.b.post(`/interaction/${replay.uid}/passkey/verify`, { credential })).status).toBe(410);
  });

  it("does not sign in with an unknown passkey", async () => {
    const stranger = authenticator();
    stranger.create({ challenge: "x", user: { id: "u", name: "u", displayName: "u" }, rp: { name: "x" }, pubKeyCredParams: [] } as never);
    const { b, uid } = await begin();
    const request = await (await b.post(`/interaction/${uid}/passkey/options`, { mode: "login" })).json();
    expect((await b.post(`/interaction/${uid}/passkey/verify`, { credential: stranger.get(request) })).status).toBe(401);
  });
});

describe("email code", () => {
  const lastCodeFor = (address: string) => sentCodes.filter((s) => s.to === address).at(-1)!;
  const email = () => `soul-${randomBytes(4).toString("hex")}@example.com`;

  it("signs in with the code and never stores the address", async () => {
    const address = email();
    const { b, uid, verifier } = await begin();
    expect((await b.post(`/interaction/${uid}/email/start`, { email: address })).status).toBe(202);
    const { code } = lastCodeFor(address);
    const res = await b.post(`/interaction/${uid}/email/verify`, { email: address.toUpperCase(), code });
    const claims = await finish(b, ((await res.json()) as { redirectTo: string }).redirectTo, verifier);
    expect(claims.amr).toEqual(["otp"]);
    const [link] = await db.select().from(schema.links).where(eq(schema.links.almaId, claims.sub!));
    expect(link?.value).toMatch(/^hmac:[0-9a-f]{64}$/);
    expect(JSON.stringify(await pg.query("select * from alma.links, alma.email_codes"))).not.toContain(address);
  });

  it("answers the same for any address and sends at most 3 codes an hour", async () => {
    const address = email();
    const { b, uid } = await begin();
    for (let i = 0; i < 4; i++) expect((await b.post(`/interaction/${uid}/email/start`, { email: address })).status).toBe(202);
    expect(sentCodes.filter((s) => s.to === address)).toHaveLength(3);
  });

  it("locks a code after 5 wrong attempts", async () => {
    const address = email();
    const { b, uid } = await begin();
    await b.post(`/interaction/${uid}/email/start`, { email: address });
    const { code } = lastCodeFor(address);
    const wrong = code === "000000" ? "111111" : "000000";
    for (let i = 0; i < 5; i++) expect((await b.post(`/interaction/${uid}/email/verify`, { email: address, code: wrong })).status).toBe(401);
    expect((await b.post(`/interaction/${uid}/email/verify`, { email: address, code })).status).toBe(401);
  });
});

describe("wallet (Sign-In with Ethereum)", () => {
  const wallet = privateKeyToAccount(`0x${randomBytes(32).toString("hex")}` as Hex);

  it("signs in with a SIWE signature on the world's chain", async () => {
    const { b, uid, verifier } = await begin();
    const { message } = (await (await b.post(`/interaction/${uid}/wallet/challenge`, { address: wallet.address })).json()) as { message: string };
    expect(message).toContain(`Chain ID: ${CHAIN_ID}`);
    const res = await b.post(`/interaction/${uid}/wallet/verify`, { message, signature: await wallet.signMessage({ message }) });
    const claims = await finish(b, ((await res.json()) as { redirectTo: string }).redirectTo, verifier);
    expect(claims.amr).toEqual(["pop"]);
    const links = await db.select().from(schema.links).where(eq(schema.links.almaId, claims.sub!));
    expect(links.find((l) => l.roles.includes("login"))?.value).toBe(`eip155:${CHAIN_ID}:${wallet.address}`);
  });

  it("rejects altered messages and signatures from another key", async () => {
    const { b, uid } = await begin();
    const { message } = (await (await b.post(`/interaction/${uid}/wallet/challenge`, { address: wallet.address })).json()) as { message: string };
    const other = privateKeyToAccount(`0x${randomBytes(32).toString("hex")}` as Hex);
    expect((await b.post(`/interaction/${uid}/wallet/verify`, { message, signature: await other.signMessage({ message }) })).status).toBe(401);

    const again = await begin();
    const issued = (await (await again.b.post(`/interaction/${again.uid}/wallet/challenge`, { address: wallet.address })).json()) as { message: string };
    const altered = issued.message.replace("Sign in to ALMA", "Sign in to EVIL");
    expect((await again.b.post(`/interaction/${again.uid}/wallet/verify`, { message: altered, signature: await wallet.signMessage({ message: altered }) })).status).toBe(410);
  });

  it("never signs in, or creates a soul, with a key another soul holds without the login role", async () => {
    // e.g. a soul's smart account, linked as its controller: proving it must not open a second soul
    const { smartAccountAddress } = custodies[0]!;
    const key = { kind: "evm" as const, value: `eip155:${CHAIN_ID}:${smartAccountAddress}`, proof: { type: "caip122" } };
    await expect(loginWithKey({ db, chainId: CHAIN_ID }, key)).rejects.toMatchObject({ status: 409, code: "link_belongs_to_other_soul" });
    const holders = await db.select().from(schema.links).where(eq(schema.links.value, key.value));
    expect(holders).toHaveLength(1);
  });
});
