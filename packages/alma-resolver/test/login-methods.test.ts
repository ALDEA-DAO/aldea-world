import { randomBytes } from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { decodeJwt } from "jose";
import type { Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AnyDb } from "../src/auth/adapter";
import { loginWithKey, type ProvisionedCustody } from "../src/auth/souls";
import * as schema from "../src/db/schema";
import { begin as beginLogin, browser as stackBrowser, CHAIN_ID, finish as finishLogin, REDIRECT, startStack, type Browser, type Stack } from "./helpers/stack";
import { VirtualAuthenticator } from "./helpers/virtualAuthenticator";

let stack: Stack;
let issuer: string;
let db: AnyDb;
let pg: PGlite;
let sentCodes: Stack["sentCodes"];
let custodies: ProvisionedCustody[];

beforeAll(async () => {
  stack = await startStack();
  ({ issuer, db, pg, sentCodes, custodies } = stack);
});
afterAll(() => stack.close());

const browser = () => stackBrowser(stack);
const begin = (b?: Browser) => beginLogin(stack, b, "openid alma");
/** Finishes the login and returns the ID token's claims. */
const finish = async (b: Browser, redirectTo: string, verifier: string) => decodeJwt((await finishLogin(stack, b, redirectTo, verifier)).idToken);

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
