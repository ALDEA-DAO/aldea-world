import { randomBytes } from "node:crypto";
import { almaIdHash, docHash, type AlmaCoreDoc } from "@aldea/shared/alma";
import { eq } from "drizzle-orm";
import type { Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as schema from "../src/db/schema";
import { api, CHAIN_ID, signInWithEmail, signInWithPasskey, signInWithWallet, startStack, type Stack } from "./helpers/stack";
import { VirtualAuthenticator } from "./helpers/virtualAuthenticator";

let stack: Stack;
let local: Stack;
beforeAll(async () => {
  [stack, local] = await Promise.all([startStack(), startStack({ custody: false })]);
});
afterAll(() => Promise.all([stack.close(), local.close()]));

const newEmail = () => `soul-${randomBytes(4).toString("hex")}@example.com`;
type Prepared = { almaId: string; almaIdHash: Hex; doc: AlmaCoreDoc; docHash: Hex };

describe("POST /v1/souls/prepare", () => {
  it("returns the soul's anchoring material, with its smart wallet as controller", async () => {
    const tokens = await signInWithPasskey(stack, new VirtualAuthenticator(stack.issuer, "localhost"));
    const res = await api(stack, tokens.accessToken).post("/v1/souls/prepare");
    expect(res.status).toBe(200);
    const prepared = (await res.json()) as Prepared;

    expect(prepared.almaId).toMatch(/^alma:main:human:[0-9a-f]{32}$/);
    expect(prepared.almaId).toBe(tokens.almaId);
    expect(prepared.almaIdHash).toBe(almaIdHash(prepared.almaId));
    expect(prepared.docHash).toBe(docHash(prepared.doc));
    const [custody] = await stack.db.select().from(schema.custody).where(eq(schema.custody.almaId, tokens.almaId));
    expect(prepared.doc.controllers).toEqual([{ id: `did:pkh:eip155:${CHAIN_ID}:${custody!.smartAccountAddress}`, kind: "evm", primary: true }]);
  });

  it("is idempotent, and refuses once the soul is anchored", async () => {
    const tokens = await signInWithEmail(stack, newEmail());
    const me = api(stack, tokens.accessToken);
    const first = await (await me.post("/v1/souls/prepare")).json();
    expect(await (await me.post("/v1/souls/prepare")).json()).toEqual(first);

    await stack.db.update(schema.souls).set({ status: "anchored" }).where(eq(schema.souls.almaId, tokens.almaId));
    const again = await me.post("/v1/souls/prepare");
    expect(again.status).toBe(409);
    expect(await again.json()).toMatchObject({ code: "soul_already_anchored", detail: tokens.almaId });
  });

  it("requires a session", async () => {
    expect((await api(stack, "nope").post("/v1/souls/prepare")).status).toBe(401);
  });

  it("locally, takes the client's development key as controller, once", async () => {
    const tokens = await signInWithEmail(local, newEmail());
    const me = api(local, tokens.accessToken);
    expect(await (await me.post("/v1/souls/prepare")).json()).toMatchObject({ code: "controller_required" });

    const key = privateKeyToAccount(`0x${randomBytes(32).toString("hex")}` as Hex);
    const prepared = (await (await me.post("/v1/souls/prepare", { controller: key.address })).json()) as Prepared;
    expect(prepared.doc.controllers[0]?.id).toBe(`did:pkh:eip155:${CHAIN_ID}:${key.address}`);
    expect(prepared.docHash).toBe(docHash(prepared.doc));
    expect((await me.post("/v1/souls/prepare", { controller: key.address })).status).toBe(200);
    const other = privateKeyToAccount(`0x${randomBytes(32).toString("hex")}` as Hex);
    expect(await (await me.post("/v1/souls/prepare", { controller: other.address })).json()).toMatchObject({ code: "controller_mismatch" });
  });

  it("locally, lets the wallet that signed in control its own soul, and no other soul take it", async () => {
    const wallet = privateKeyToAccount(`0x${randomBytes(32).toString("hex")}` as Hex);
    const tokens = await signInWithWallet(local, wallet);
    const me = api(local, tokens.accessToken);
    const prepared = (await (await me.post("/v1/souls/prepare", { controller: wallet.address })).json()) as Prepared;
    expect(prepared.doc.controllers[0]?.id).toBe(`did:pkh:eip155:${CHAIN_ID}:${wallet.address}`);
    expect((await me.post("/v1/souls/prepare", { controller: wallet.address })).status).toBe(200);
    const links = await local.db.select().from(schema.links).where(eq(schema.links.almaId, tokens.almaId));
    expect(links.map((l) => l.roles)).toEqual([["login", "controller"]]);

    const other = await signInWithEmail(local, newEmail());
    const taken = await api(local, other.accessToken).post("/v1/souls/prepare", { controller: wallet.address });
    expect(taken.status).toBe(409);
    expect(await taken.json()).toMatchObject({ code: "link_belongs_to_other_soul" });
  });
});

describe("GET /v1/souls/me and /v1/souls/:almaId", () => {
  it("serves the soul's document to itself and only its public side to everyone", async () => {
    const tokens = await signInWithEmail(stack, newEmail());
    await stack.db.insert(schema.bindings).values([
      { almaId: tokens.almaId, type: "endpoint", value: "https://public.example", visibility: "public" },
      { almaId: tokens.almaId, type: "endpoint", value: "https://private.example", visibility: "private" },
    ]);

    const me = await (await api(stack, tokens.accessToken).get("/v1/souls/me")).json();
    expect(me).toMatchObject({ id: tokens.almaId, type: "human", status: "prepared", character: null, founder: null });
    expect(me.bindings).toHaveLength(2);

    const res = await fetch(`${stack.issuer}/v1/souls/${tokens.almaId}`);
    const view = await res.json();
    expect(view).toMatchObject({ id: tokens.almaId, type: "human", status: "prepared", tribe: null, character: null, founder: false, relationships: [] });
    expect(view.bindings.map((b: { value: string }) => b.value)).toEqual(["https://public.example"]);
    // keys are never public
    expect(JSON.stringify(view)).not.toMatch(/hmac:|controllers|links/);
  });

  it("answers soul_not_found for unknown and malformed ids", async () => {
    for (const id of ["alma:main:human:00000000000000000000000000000000", "not-an-id"]) {
      const res = await fetch(`${stack.issuer}/v1/souls/${encodeURIComponent(id)}`);
      expect(res.status).toBe(404);
      expect(await res.json()).toMatchObject({ code: "soul_not_found" });
    }
  });
});
