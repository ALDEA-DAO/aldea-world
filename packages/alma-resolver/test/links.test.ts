import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import type { Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hasRecentAuth, hasRecentPasskey, type AlmaAccess } from "../src/auth/accessToken";
import { canAddOwner } from "../src/auth/links";
import * as schema from "../src/db/schema";
import { api, browser, CHAIN_ID, signInWithEmail, signInWithPasskey, signInWithWallet, WORLD, type Stack } from "./helpers/stack";
import { startStack } from "./helpers/stack";
import { VirtualAuthenticator } from "./helpers/virtualAuthenticator";

let stack: Stack;
beforeAll(async () => {
  stack = await startStack();
});
afterAll(() => stack.close());

const newWallet = () => privateKeyToAccount(`0x${randomBytes(32).toString("hex")}` as Hex);
const newEmail = () => `soul-${randomBytes(4).toString("hex")}@example.com`;
const device = () => new VirtualAuthenticator(stack.issuer, "localhost");

type Links = { items: { id: string; kind: string; display: string; roles: string[] }[] };

async function linkWallet(accessToken: string, wallet = newWallet(), roles: string[] = ["login"]) {
  const me = api(stack, accessToken);
  const challenge = await me.post("/v1/me/links/wallet/challenge", { address: wallet.address, roles });
  if (challenge.status !== 200) return { status: challenge.status, body: await challenge.json(), wallet };
  const { message } = (await challenge.json()) as { message: string };
  const res = await me.post("/v1/me/links/wallet/verify", { message, signature: await wallet.signMessage({ message }) });
  return { status: res.status, body: await res.json(), wallet, message };
}

describe("GET /v1/me/links", () => {
  it("lists the soul's keys without revealing emails or passkey ids", async () => {
    const tokens = await signInWithPasskey(stack, device());
    const { items } = (await (await api(stack, tokens.accessToken).get("/v1/me/links")).json()) as Links;
    expect(items.map((l) => [l.kind, l.roles])).toEqual([
      ["passkey", ["login"]],
      ["evm", ["controller"]],
    ]);
    expect(items[0]!.display).toBe("passkey");
  });

  it("requires the alma:links scope and a valid token", async () => {
    const narrow = await signInWithPasskey(stack, device(), "register", "openid alma");
    expect((await api(stack, narrow.accessToken).get("/v1/me/links")).status).toBe(403);
    expect((await api(stack, "not-a-token").get("/v1/me/links")).status).toBe(401);
  });
});

describe("linking a wallet", () => {
  it("links it for sign-in; the same wallet then opens the same soul", async () => {
    const tokens = await signInWithEmail(stack, newEmail());
    const { status, wallet } = await linkWallet(tokens.accessToken);
    expect(status).toBe(201);
    expect((await signInWithWallet(stack, wallet)).almaId).toBe(tokens.almaId);
    // proving it again is not a new link
    expect((await linkWallet(tokens.accessToken, wallet)).status).toBe(200);
  });

  it("binds the message to a registered world and to this wallet", async () => {
    const tokens = await signInWithEmail(stack, newEmail());
    const wallet = newWallet();
    const res = await fetch(`${stack.issuer}/v1/me/links/wallet/challenge`, {
      method: "POST",
      headers: { authorization: `Bearer ${tokens.accessToken}`, origin: "https://evil.example", "content-type": "application/json" },
      body: JSON.stringify({ address: wallet.address }),
    });
    expect(res.status).toBe(403);
    const me = api(stack, tokens.accessToken);
    const { message } = (await (await me.post("/v1/me/links/wallet/challenge", { address: wallet.address })).json()) as { message: string };
    expect(message).toContain(`${new URL(WORLD).host} wants you to sign in`);
    expect((await me.post("/v1/me/links/wallet/verify", { message, signature: await newWallet().signMessage({ message }) })).status).toBe(401);
  });

  it("adds a smart-wallet owner only after a recent passkey sign-in, and only that owner's gas is sponsored", async () => {
    const byEmail = await signInWithEmail(stack, newEmail());
    expect((await linkWallet(byEmail.accessToken, newWallet(), ["controller"])).body).toMatchObject({ code: "step_up_required" });

    const byPasskey = await signInWithPasskey(stack, device());
    const { status, wallet } = await linkWallet(byPasskey.accessToken, newWallet(), ["login", "controller"]);
    expect(status).toBe(201);
    const [custody] = await stack.db.select().from(schema.custody).where(eq(schema.custody.almaId, byPasskey.almaId));
    const smartWallet = custody!.smartAccountAddress;
    expect(await canAddOwner(stack.db, CHAIN_ID, byPasskey.almaId, smartWallet, wallet.address)).toBe(true);
    expect(await canAddOwner(stack.db, CHAIN_ID, byPasskey.almaId, smartWallet, newWallet().address)).toBe(false);
    expect(await canAddOwner(stack.db, CHAIN_ID, byEmail.almaId, smartWallet, wallet.address)).toBe(false);
  });
});

describe("keys of another soul", () => {
  it("never moves a key, and merges a soul only with proof of both", async () => {
    const wallet = newWallet();
    const other = await signInWithWallet(stack, wallet);
    const mine = await signInWithPasskey(stack, device());
    const me = api(stack, mine.accessToken);

    expect((await me.post("/v1/me/merge")).status).toBe(401);
    const conflict = await linkWallet(mine.accessToken, wallet);
    expect(conflict.status).toBe(409);
    expect(conflict.body).toMatchObject({ code: "link_belongs_to_other_soul" });
    expect((await signInWithWallet(stack, wallet)).almaId).toBe(other.almaId);

    const merged = await me.post("/v1/me/merge");
    expect(await merged.json()).toEqual({ mergedFrom: other.almaId });
    expect((await signInWithWallet(stack, wallet)).almaId).toBe(mine.almaId);
    const [gone] = await stack.db.select().from(schema.souls).where(eq(schema.souls.almaId, other.almaId));
    expect(gone?.status).toBe("revoked");
    expect(await stack.db.select().from(schema.soulMerges).where(eq(schema.soulMerges.fromAlmaId, other.almaId))).toHaveLength(1);
  });

  it("does not merge away a soul that was born on-chain", async () => {
    const wallet = newWallet();
    const other = await signInWithWallet(stack, wallet);
    await stack.db.update(schema.souls).set({ status: "anchored" }).where(eq(schema.souls.almaId, other.almaId));
    const mine = await signInWithPasskey(stack, device());
    expect((await linkWallet(mine.accessToken, wallet)).status).toBe(409);
    expect(await (await api(stack, mine.accessToken).post("/v1/me/merge")).json()).toMatchObject({ code: "soul_anchored" });
  });
});

describe("removing keys", () => {
  it("never removes the last way to sign in nor the smart wallet's owner", async () => {
    const passkey = device();
    const tokens = await signInWithPasskey(stack, passkey);
    const me = api(stack, tokens.accessToken);
    const { items } = (await (await me.get("/v1/me/links")).json()) as Links;
    const passkeyLink = items.find((l) => l.kind === "passkey")!;
    const controller = items.find((l) => l.roles.includes("controller"))!;

    expect(await (await me.del(`/v1/me/links/${passkeyLink.id}`)).json()).toMatchObject({ code: "last_login_method" });
    expect(await (await me.del(`/v1/me/links/${controller.id}`)).json()).toMatchObject({ code: "controller_link" });

    await linkWallet(tokens.accessToken);
    expect((await me.del(`/v1/me/links/${passkeyLink.id}`)).status).toBe(204);
    // the removed passkey no longer opens the soul
    await expect(signInWithPasskey(stack, passkey, "login")).rejects.toThrow("401");
  });
});

describe("recovery email and more passkeys", () => {
  it("links a recovery email with a code", async () => {
    const tokens = await signInWithPasskey(stack, device());
    const me = api(stack, tokens.accessToken);
    const address = newEmail();
    expect((await me.post("/v1/me/links/email/start", { email: address })).status).toBe(202);
    const { code } = stack.sentCodes.filter((s) => s.to === address).at(-1)!;
    expect((await me.post("/v1/me/links/email/verify", { email: address, code })).status).toBe(201);
    expect((await signInWithEmail(stack, address)).almaId).toBe(tokens.almaId);
  });

  it("adds a passkey on ALMA Auth's page through a one-time link and returns to the world", async () => {
    const tokens = await signInWithPasskey(stack, device());
    const me = api(stack, tokens.accessToken);
    expect((await me.post("/v1/me/links/passkey", { returnTo: "https://evil.example/" })).status).toBe(400);
    const { url } = (await (await me.post("/v1/me/links/passkey", { returnTo: `${WORLD}/#/ajustes` })).json()) as { url: string };

    const b = browser(stack);
    expect((await b.request(url)).status).toBe(200);
    const second = device();
    const options = await (await b.post(`${new URL(url).pathname}/options`)).json();
    const res = await b.post(`${new URL(url).pathname}/verify`, { credential: second.create(options) });
    expect(await res.json()).toEqual({ redirectTo: `${WORLD}/#/ajustes` });
    expect((await signInWithPasskey(stack, second, "login")).almaId).toBe(tokens.almaId);
    // the link was single-use
    expect((await b.request(url)).status).toBe(410);
  });
});

describe("step-up rules", () => {
  const access = (amr: string[], ageSeconds: number): AlmaAccess => ({
    almaId: "alma:main:human:0123456789abcdef0123456789abcdef",
    clientId: "aldea-world",
    scopes: new Set(["alma:links"]),
    amr,
    authTime: Math.floor(Date.now() / 1000) - ageSeconds,
  });

  it("asks for a recent sign-in to add keys, and a recent passkey to add owners", () => {
    expect(hasRecentAuth(access(["otp"], 60))).toBe(true);
    expect(hasRecentAuth(access(["otp"], 3 * 60 * 60))).toBe(false);
    expect(hasRecentPasskey(access(["hwk"], 60))).toBe(true);
    expect(hasRecentPasskey(access(["otp"], 60))).toBe(false);
    expect(hasRecentPasskey(access(["hwk"], 20 * 60))).toBe(false);
  });
});
