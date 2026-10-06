import { randomBytes } from "node:crypto";
import { MeshWallet } from "@meshsdk/core";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as schema from "../src/db/schema";
import { cardanoSigner } from "../src/lib/cip8";
import { api, signInWithEmail, startStack, type Stack } from "./helpers/stack";

/**
 * Linking a Cardano wallet with a CIP-8 signature, as Eternl or Lace produce it with `signData`. The signatures here
 * come from throwaway test wallets (MeshJS), not from fixtures: each run signs the challenge it was given.
 */

let stack: Stack;
beforeAll(async () => {
  stack = await startStack();
}, 30_000);
afterAll(() => stack.close());

const newEmail = () => `holder-${randomBytes(4).toString("hex")}@example.com`;
const MIN = "1000000000";

interface Challenge {
  challengeId: string;
  payload: string;
  payloadHex: string;
  expiresAt: string;
}

async function newWallet() {
  const wallet = new MeshWallet({ networkId: 0, key: { type: "mnemonic", words: MeshWallet.brew() as string[] } });
  await wallet.init();
  const [stakeAddress] = await wallet.getRewardAddresses();
  const baseAddress = await wallet.getChangeAddress();
  return { wallet, stakeAddress: stakeAddress!, baseAddress, credential: cardanoSigner(stakeAddress!, 0).credential };
}

async function soul() {
  const tokens = await signInWithEmail(stack, newEmail());
  return { ...tokens, me: api(stack, tokens.accessToken) };
}
const challenge = async (me: ReturnType<typeof api>) => (await (await me.post("/v1/cardano/link/challenge")).json()) as Challenge;

describe("POST /v1/cardano/link/challenge", () => {
  it("gives a message that says what is being signed, for whom and until when", async () => {
    const { me, almaId } = await soul();
    const res = await me.post("/v1/cardano/link/challenge");
    expect(res.status).toBe(200);
    const c = (await res.json()) as Challenge;
    expect(c.payload).toMatch(new RegExp(`^ALDEA World · vincular Cardano\\nalma: ${almaId}\\ndominio: localhost:3100\\nnonce: [0-9a-f]{16}\\nvence: ${c.expiresAt}$`));
    expect(Buffer.from(c.payloadHex, "hex").toString("utf8")).toBe(c.payload);
    expect(Date.parse(c.expiresAt) - Date.now()).toBeGreaterThan(4 * 60 * 1000);
  });

  it("requires a session", async () => {
    expect((await api(stack, "nope").post("/v1/cardano/link/challenge")).status).toBe(401);
  });
});

describe("POST /v1/cardano/link/verify", () => {
  it("links the wallet's stake credential and reports what it holds", async () => {
    const { me, almaId } = await soul();
    const holder = await newWallet();
    stack.holdings.set(holder.credential, "1500000000");

    const c = await challenge(me);
    const { signature, key } = await holder.wallet.signData(c.payload, holder.stakeAddress);
    const res = await me.post("/v1/cardano/link/verify", { challengeId: c.challengeId, address: holder.stakeAddress, signature, key });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({
      link: { kind: "cardano", value: `cardano:${holder.credential}`, roles: ["holdings"], hasStakePart: true },
      holdings: { balance: "1500000000", eligible: true, minimum: MIN },
    });

    const [link] = await stack.db.select().from(schema.links).where(eq(schema.links.almaId, almaId));
    // The email is the other link; the Cardano one proves ownership and is not a way to sign in
    const cardano = (await stack.db.select().from(schema.links).where(eq(schema.links.value, `cardano:${holder.credential}`)))[0]!;
    expect(link).toBeDefined();
    expect(cardano).toMatchObject({ almaId, kind: "cardano", roles: ["holdings"], visibility: "private" });
    expect(cardano.proof).toMatchObject({ type: "cip8", payload: c.payload, address: holder.stakeAddress });
  });

  it("accepts the base address when the stake key signed, in hex as wallets give it", async () => {
    const { me } = await soul();
    const holder = await newWallet();
    const c = await challenge(me);
    const { signature, key } = await holder.wallet.signData(c.payload, holder.stakeAddress);
    const { bech32 } = await import("bech32");
    const hex = Buffer.from(bech32.fromWords(bech32.decode(holder.baseAddress, 1000).words)).toString("hex");
    const res = await me.post("/v1/cardano/link/verify", { challengeId: c.challengeId, address: hex, signature, key });
    expect(res.status).toBe(201);
    expect(((await res.json()) as { link: { value: string } }).link.value).toBe(`cardano:${holder.credential}`);
  });

  it("refuses a base address signed by its payment key: that does not prove the stake credential", async () => {
    const { me } = await soul();
    const holder = await newWallet();
    const c = await challenge(me);
    const { signature, key } = await holder.wallet.signData(c.payload, holder.baseAddress);
    const res = await me.post("/v1/cardano/link/verify", { challengeId: c.challengeId, address: holder.baseAddress, signature, key });
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ code: "invalid_cip8_signature" });
    expect(await stack.db.select().from(schema.links).where(eq(schema.links.value, `cardano:${holder.credential}`))).toEqual([]);
  });

  it("refuses a signature over another message, or by another wallet", async () => {
    const { me } = await soul();
    const holder = await newWallet();
    const other = await newWallet();

    // The wallet signed something else
    const first = await challenge(me);
    const tampered = await holder.wallet.signData(first.payload.replace("vincular", "transferir"), holder.stakeAddress);
    const wrongPayload = await me.post("/v1/cardano/link/verify", { challengeId: first.challengeId, address: holder.stakeAddress, ...tampered });
    expect(wrongPayload.status).toBe(401);
    expect(await wrongPayload.json()).toMatchObject({ code: "invalid_cip8_signature" });

    // Another wallet signed, claiming this address
    const second = await challenge(me);
    const forged = await other.wallet.signData(second.payload, other.stakeAddress);
    expect((await me.post("/v1/cardano/link/verify", { challengeId: second.challengeId, address: holder.stakeAddress, ...forged })).status).toBe(401);

    // Not a signature at all
    const third = await challenge(me);
    expect((await me.post("/v1/cardano/link/verify", { challengeId: third.challengeId, address: holder.stakeAddress, signature: "00", key: "00" })).status).toBe(401);
  });

  it("uses a challenge once, and only for the soul it was given to", async () => {
    const { me } = await soul();
    const holder = await newWallet();
    const c = await challenge(me);
    const signed = await holder.wallet.signData(c.payload, holder.stakeAddress);
    const body = { challengeId: c.challengeId, address: holder.stakeAddress, ...signed };

    const thief = await soul();
    expect(await (await thief.me.post("/v1/cardano/link/verify", body)).json()).toMatchObject({ code: "challenge_expired" });
    // Taken by the failed attempt: the owner asks for a new one
    expect((await me.post("/v1/cardano/link/verify", body)).status).toBe(410);
  });

  it("binds a credential to one soul, and a soul to one credential", async () => {
    const first = await soul();
    const holder = await newWallet();
    const link = async (who: typeof first, wallet: typeof holder) => {
      const c = await challenge(who.me);
      return who.me.post("/v1/cardano/link/verify", { challengeId: c.challengeId, address: wallet.stakeAddress, ...(await wallet.wallet.signData(c.payload, wallet.stakeAddress)) });
    };
    expect((await link(first, holder)).status).toBe(201);
    // Linking it again is not an error
    expect((await link(first, holder)).status).toBe(200);

    const second = await soul();
    const elsewhere = await link(second, holder);
    expect(elsewhere.status).toBe(409);
    expect(await elsewhere.json()).toMatchObject({ code: "credential_linked_elsewhere" });

    const another = await link(first, await newWallet());
    expect(another.status).toBe(409);
    expect(await another.json()).toMatchObject({ code: "cardano_already_linked" });
  });

  it("says when the holder is below the minimum, and links even if Cardano cannot be read", async () => {
    const poor = await soul();
    const small = await newWallet();
    stack.holdings.set(small.credential, "999999999");
    const c1 = await challenge(poor.me);
    const below = await poor.me.post("/v1/cardano/link/verify", { challengeId: c1.challengeId, address: small.stakeAddress, ...(await small.wallet.signData(c1.payload, small.stakeAddress)) });
    expect(((await below.json()) as { holdings: unknown }).holdings).toEqual({ balance: "999999999", eligible: false, minimum: MIN });

    const unread = await soul();
    const unknown = await newWallet();
    const c2 = await challenge(unread.me);
    const res = await unread.me.post("/v1/cardano/link/verify", { challengeId: c2.challengeId, address: unknown.stakeAddress, ...(await unknown.wallet.signData(c2.payload, unknown.stakeAddress)) });
    expect(res.status).toBe(201);
    expect(((await res.json()) as { holdings: unknown }).holdings).toBeNull();
  });

  it("refuses addresses of another network or that are not addresses", async () => {
    const { me } = await soul();
    const c = await challenge(me);
    const mainnet = "stake1uyehkck0lajq8gr28t9uxnuvgcqrc6070x3k9r8048z8y5gh6ffgw";
    expect(await (await me.post("/v1/cardano/link/verify", { challengeId: c.challengeId, address: mainnet, signature: "00", key: "00" })).json()).toMatchObject({ code: "wrong_network" });
    expect(await (await me.post("/v1/cardano/link/verify", { challengeId: c.challengeId, address: "not-an-address", signature: "00", key: "00" })).json()).toMatchObject({ code: "invalid_address" });
  });
});
