import { randomBytes } from "node:crypto";
import { almaIdHash, buildCoreDoc, docHash } from "@aldea/shared/alma";
import { ANCHORED_ORG_IDS, tribes } from "@aldea/shared/catalog";
import type { Deployment } from "@aldea/shared/deployments";
import { eq } from "drizzle-orm";
import type { Address, Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as schema from "../src/db/schema";
import { createSyncJob, type AnchoredSoul, type BornBirth, type EffectstreamFeeds } from "../src/jobs/syncFromEffectstream";
import { seedOrgs } from "../src/seed/orgs";
import { api, CHAIN_ID, signInWithEmail, startStack, type Stack } from "./helpers/stack";

const SAFE: Address = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
const WORLD: Address = "0x6026446be1De61fbba0e7F6C91af8F94c1813FdB";
const CREATED_AT = "2026-09-27T00:00:00Z";

/** A deployment like the one the deploy script writes: each org's docHash is the hash of its real document. */
const deployment: Deployment = {
  chainId: CHAIN_ID,
  safe: SAFE,
  relayer: SAFE,
  councilDelay: 600,
  orgDocsCreatedAt: CREATED_AT,
  orgs: Object.fromEntries(
    ANCHORED_ORG_IDS.map((id) => [id, { almaIdHash: almaIdHash(id), docHash: docHash(buildCoreDoc({ id, type: "org", createdAt: CREATED_AT, chainId: CHAIN_ID, controller: SAFE })) }]),
  ),
  protocol: { almaAnchorRegistry: SAFE, atlasRegistry: SAFE, aldeaCouncilExecutor: SAFE, deployBlock: 1 },
  world: { address: WORLD, blockNumber: 5, systems: {} },
};

let stack: Stack;
beforeAll(async () => {
  stack = await startStack({ custody: false });
});
afterAll(() => stack.close());

/** Effectstream's feeds, fed by the test. */
function fakeFeeds() {
  const anchored: AnchoredSoul[] = [];
  const born: BornBirth[] = [];
  const feeds: EffectstreamFeeds = {
    anchoredSouls: async (since) => {
      const items = anchored.filter((a) => a.anchoredBlock > since);
      return { items, nextSince: items.at(-1)?.anchoredBlock ?? since };
    },
    bornBirths: async (since) => {
      const items = born.filter((b) => b.bornBlock > since);
      return { items, nextSince: items.at(-1)?.bornBlock ?? since };
    },
  };
  return { feeds, anchored, born };
}

/** A signed-in soul prepared with a development controller, as in local development. */
async function preparedSoul() {
  const tokens = await signInWithEmail(stack, `soul-${randomBytes(4).toString("hex")}@example.com`);
  const controller = privateKeyToAccount(`0x${randomBytes(32).toString("hex")}` as Hex).address;
  const res = await api(stack, tokens.accessToken).post("/v1/souls/prepare", { controller });
  expect(res.status).toBe(200);
  return { ...tokens, controller };
}

const soulRow = async (almaId: string) => (await stack.db.select().from(schema.souls).where(eq(schema.souls.almaId, almaId)))[0]!;
let block = 100;

describe("organizations", () => {
  it("are seeded as anchored souls with the document that was anchored on-chain", async () => {
    expect(await seedOrgs(stack.db, deployment)).toHaveLength(6);
    const res = await fetch(`${stack.issuer}/v1/souls/alma:main:org:tribu-poseidones`);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ id: "alma:main:org:tribu-poseidones", type: "org", status: "anchored" });
  });

  it("are refused when the anchored hash is not the document's", async () => {
    const wrong = { ...deployment, orgs: { ...deployment.orgs, "alma:main:org:tribu-raes": { almaIdHash: almaIdHash("alma:main:org:tribu-raes"), docHash: `0x${"11".repeat(32)}` as Hex } } };
    await expect(seedOrgs(stack.db, wrong)).rejects.toThrow("does not match the document");
  });
});

describe("syncFromEffectstream", () => {
  it("marks a soul anchored only when its own controller anchored it", async () => {
    const { feeds, anchored } = fakeFeeds();
    const job = createSyncJob({ db: stack.db, feeds, deployment: () => deployment });
    const mine = await preparedSoul();
    const hijacked = await preparedSoul();

    anchored.push({ almaIdHash: almaIdHash(mine.almaId), almaId: mine.almaId, subjectType: 1, controller: mine.controller.toLowerCase(), anchoredBlock: ++block, txHash: "0xanchor1" });
    // someone else anchored this identifier on-chain: it is not this soul's anchor
    anchored.push({ almaIdHash: almaIdHash(hijacked.almaId), almaId: hijacked.almaId, subjectType: 1, controller: "0x000000000000000000000000000000000000dead", anchoredBlock: ++block, txHash: "0xanchor2" });

    expect(await job.tick()).toMatchObject({ anchored: 1 });
    expect(await soulRow(mine.almaId)).toMatchObject({ status: "anchored", anchoredTx: "0xanchor1" });
    expect((await soulRow(hijacked.almaId)).status).toBe("prepared");
    // nothing new: the cursor moved past both
    expect(await job.tick()).toEqual({ anchored: 0, born: 0 });
  });

  it("activates the born soul with its character binding and its tribe membership, once", async () => {
    const { feeds, born } = fakeFeeds();
    const job = createSyncJob({ db: stack.db, feeds, deployment: () => deployment });
    const soul = await preparedSoul();
    const birth: BornBirth = { characterId: 42, almaIdHash: almaIdHash(soul.almaId), characterClass: 0, tribe: 2, bornBlock: ++block, bornTx: "0xborn42", bornTs: 1_790_000_000 };
    born.push(birth, { ...birth, characterId: 43, almaIdHash: `0x${"ab".repeat(32)}`, bornBlock: ++block }); // the second soul is not ours

    expect(await job.tick()).toMatchObject({ born: 1 });
    expect((await soulRow(soul.almaId)).status).toBe("active");

    const me = await (await api(stack, soul.accessToken).get("/v1/souls/me")).json();
    expect(me.character).toMatchObject({ characterId: 42, status: "born", characterClass: 0, tribe: 2, bornTx: "0xborn42" });
    expect(me.bindings).toEqual([
      { type: "aldea-world:character", value: `base:${CHAIN_ID}:${deployment.world!.address}:42`, visibility: "public", evidence: expect.objectContaining({ chainId: CHAIN_ID, txHash: "0xborn42", event: "CharacterBorn" }) },
    ]);
    expect(me.relationships).toEqual([{ type: "member_of", to: tribes[2]!.almaOrgId, evidence: { chainId: CHAIN_ID, txHash: "0xborn42", event: "CharacterBorn" } }]);

    const view = await (await fetch(`${stack.issuer}/v1/souls/${soul.almaId}`)).json();
    expect(view).toMatchObject({ status: "active", tribe: { index: 2, almaId: tribes[2]!.almaOrgId }, character: { characterId: 42, characterClass: 0 } });

    // a restarted job replays the feed from its saved cursor; replaying the page by hand changes nothing either
    await stack.db.delete(schema.syncState).where(eq(schema.syncState.key, "births_born"));
    expect(await createSyncJob({ db: stack.db, feeds, deployment: () => deployment }).tick()).toMatchObject({ born: 0 });
    expect(await stack.db.select().from(schema.relationships).where(eq(schema.relationships.fromAlmaId, soul.almaId))).toHaveLength(1);
  });

  it("waits for the World to be deployed", async () => {
    const { feeds } = fakeFeeds();
    expect(await createSyncJob({ db: stack.db, feeds, deployment: () => undefined }).tick()).toBeUndefined();
  });
});

describe("GET /v1/orgs/:almaId/members", () => {
  it("lists a tribe's members, oldest first, in pages", async () => {
    const { feeds, born } = fakeFeeds();
    const job = createSyncJob({ db: stack.db, feeds, deployment: () => deployment });
    const tribe = tribes[4]!;
    const members: string[] = [];
    for (let i = 0; i < 3; i++) {
      const soul = await preparedSoul();
      members.push(soul.almaId);
      born.push({ characterId: 100 + i, almaIdHash: almaIdHash(soul.almaId), characterClass: i, tribe: 4, bornBlock: ++block, bornTx: `0xborn${100 + i}`, bornTs: null });
      await job.tick(); // one birth per pass, so the memberships have distinct times
    }

    const first = await (await fetch(`${stack.issuer}/v1/orgs/${tribe.almaOrgId}/members?limit=2`)).json();
    expect(first.items.map((m: { almaId: string }) => m.almaId)).toEqual(members.slice(0, 2));
    expect(first.items[0]).toMatchObject({ characterClass: 0, evidence: { event: "CharacterBorn", txHash: "0xborn100" } });
    expect(first.nextCursor).toBeTruthy();
    const second = await (await fetch(`${stack.issuer}/v1/orgs/${tribe.almaOrgId}/members?limit=2&cursor=${encodeURIComponent(first.nextCursor)}`)).json();
    expect(second.items.map((m: { almaId: string }) => m.almaId)).toEqual(members.slice(2));
    expect(second.nextCursor).toBeNull();
  });

  it("answers 404 for an unknown organization and 400 for a bad limit", async () => {
    expect((await fetch(`${stack.issuer}/v1/orgs/alma:main:org:nope/members`)).status).toBe(404);
    expect((await fetch(`${stack.issuer}/v1/orgs/${tribes[0]!.almaOrgId}/members?limit=1000`)).status).toBe(400);
  });
});
