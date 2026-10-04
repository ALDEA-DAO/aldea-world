import { beforeEach, describe, expect, it } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import readModelSql from "../db/migrations/0001_read_model.sql" with { type: "text" };
import visitExitsSql from "../db/migrations/0002_visit_exits.sql" with { type: "text" };
import atlasEvidenceSql from "../db/migrations/0003_atlas_evidence.sql" with { type: "text" };
import { atlasFilter, atlasWorld, atlasWorlds, type MeasuredWorld } from "../src/api.ts";
import * as atlas from "../src/stf/atlas.ts";
import type { Effect, StfContext } from "../src/stf/births.ts";
import { buildingEntered } from "../src/stf/buildings.ts";
import { soulAnchored } from "../src/stf/souls.ts";

/**
 * The Atlas against the real read-model schema (PGlite): AtlasRegistry's events folded into worlds, versions and
 * clients, and the Atlas API's queries over them. A replayed event changes nothing and announces nothing.
 */

async function freshDb() {
  const db = new PGlite();
  await db.exec(readModelSql);
  await db.exec(visitExitsSql);
  await db.exec(atlasEvidenceSql);
  return db;
}

/** Runs the effects and returns the worlds they changed (what the state machine announces over MQTT). */
async function apply(db: PGlite, effects: Effect[]) {
  const changed: string[] = [];
  for (const [query, params] of effects) for (const row of (await query.run(params, db as never)) as { world_id?: string }[]) if (row.world_id) changed.push(row.world_id);
  return changed;
}

const id = (n: number) => "0x" + n.toString(16).padStart(64, "0");
const ZERO = id(0);
const ALDEA = id(0xa1);
const NOCTURNA = id(0xa2);
const ORG = id(0x0c);
const FORK_ORG = id(0x0d);
const OPERATOR = id(0x0e);
const V1 = id(0xb1);
const V2 = id(0xb2);
const CLIENT = id(0xc1);
const WORLD_ADDRESS = "0x" + "ad".repeat(20);
const SAFE = "0x" + "5a".repeat(20);
const log = (blockNumber: number, n = 0) => ({ txHash: "0x" + (blockNumber * 100 + n).toString(16).padStart(64, "0"), logIndex: n, blockNumber });

const world = (worldId: string, name: string, org: string, parentWorldId: string, block: number, visibility = 0): atlas.WorldRegistered => ({
  worldId,
  almaOrgIdHash: org,
  parentWorldId,
  governor: SAFE,
  visibility,
  name,
  metadataURI: "ipfs://meta",
  ...log(block),
});
const version = (versionId: string, worldId: string, semver: string, block: number, parentVersionId = ZERO, worldAddress = WORLD_ADDRESS): atlas.VersionRegistered => ({
  versionId,
  worldId,
  parentVersionId,
  version: { chainId: "31337", worldAddress, gitCommit: "0x" + "c0".repeat(20), engine: "mud@2.2.23", semver, clientCid: `bafy-${semver}` },
  registeredBy: SAFE,
  ...log(block),
});
/** Atlas events carry their own Base block; the main clock says when: block n at REGISTERED + n seconds. */
const at = (block: number): StfContext => ({ height: block, timestampMs: (REGISTERED + block) * 1000, worldId: WORLD_ADDRESS });
const anchor = (almaIdHash: string, almaId: string) => soulAnchored({ almaIdHash, almaId, subjectType: 2, controller: SAFE, txHash: almaIdHash, blockNumber: 1 });

const MEASURED: MeasuredWorld = { worldId: WORLD_ADDRESS, chainId: 31337, worldAddress: WORLD_ADDRESS };
// On an hour boundary
const NOW = 1_790_002_800;
const REGISTERED = NOW - 1_000;
const everything = { verifiedOnly: false, limit: 50 };

let db: PGlite;
beforeEach(async () => {
  db = await freshDb();
  await apply(db, anchor(ORG, "alma:main:org:aldea-world"));
});

describe("worlds", () => {
  it("lists a registered world with its organization, and nothing official yet", async () => {
    expect(await apply(db, atlas.worldRegistered(world(ALDEA, "ALDEA World", ORG, ZERO, 10), at(10)))).toEqual([ALDEA]);
    const { items, nextCursor } = await atlasWorlds(db as never, everything, MEASURED, NOW);
    expect(nextCursor).toBeNull();
    expect(items).toEqual([
      {
        worldId: ALDEA,
        name: "ALDEA World",
        verified: false,
        visibility: "public",
        parentWorldId: null,
        governor: SAFE,
        metadataUri: "ipfs://meta",
        createdBlock: 10,
        createdTx: log(10).txHash,
        createdTs: REGISTERED + 10,
        org: { almaIdHash: ORG, almaId: "alma:main:org:aldea-world" },
        official: null,
        candidates: 0,
        forks: 0,
        clients: [],
        activity24h: null,
      },
    ]);
  });

  it("follows governor, visibility, metadata and verification changes, once each", async () => {
    await apply(db, atlas.worldRegistered(world(ALDEA, "ALDEA World", ORG, ZERO, 10), at(10)));
    const governor = atlas.governorChanged({ worldId: ALDEA, newGovernor: "0x" + "9B".repeat(20), ...log(11) });
    expect(await apply(db, governor)).toEqual([ALDEA]);
    expect(await apply(db, governor)).toEqual([]);
    expect(await apply(db, atlas.verifiedChanged({ worldId: ALDEA, verified: true, ...log(12) }))).toEqual([ALDEA]);
    expect(await apply(db, atlas.metadataChanged({ worldId: ALDEA, metadataURI: "ipfs://new", ...log(13) }))).toEqual([ALDEA]);
    expect(await apply(db, atlas.visibilityChanged({ worldId: ALDEA, visibility: 1, ...log(14) }))).toEqual([ALDEA]);

    expect((await atlasWorlds(db as never, { ...everything, visibility: 0 }, MEASURED, NOW)).items).toEqual([]);
    const [item] = (await atlasWorlds(db as never, { ...everything, visibility: 1, verifiedOnly: true }, MEASURED, NOW)).items;
    expect(item).toMatchObject({ governor: "0x" + "9b".repeat(20), verified: true, visibility: "unlisted", metadataUri: "ipfs://new" });
  });

  it("ignores changes to a world it never saw", async () => {
    expect(await apply(db, atlas.verifiedChanged({ worldId: ALDEA, verified: true, ...log(12) }))).toEqual([]);
    expect(await apply(db, atlas.versionRegistered(version(V1, ALDEA, "0.1.0", 12), at(12)))).toEqual([]);
    expect(await apply(db, atlas.clientRegistered({ clientId: CLIENT, versionId: V1, operatorAlmaIdHash: OPERATOR, kind: 0, url: "https://aldea.world", ...log(13) }))).toEqual([]);
  });
});

describe("versions", () => {
  beforeEach(async () => {
    await apply(db, atlas.worldRegistered(world(ALDEA, "ALDEA World", ORG, ZERO, 10), at(10)));
    await apply(db, atlas.versionRegistered(version(V1, ALDEA, "0.1.0", 11), at(11)));
  });

  it("counts candidates until one is set as official", async () => {
    expect((await atlasWorlds(db as never, everything, MEASURED, NOW)).items[0]).toMatchObject({ candidates: 1, official: null });
    expect(await apply(db, atlas.officialVersionSet({ worldId: ALDEA, versionId: V1, previousVersionId: ZERO, ...log(12) }))).toEqual([ALDEA]);
    expect((await atlasWorlds(db as never, everything, MEASURED, NOW)).items[0]).toMatchObject({
      candidates: 0,
      official: { versionId: V1, semver: "0.1.0", clientCid: "bafy-0.1.0", chainId: 31337, worldAddress: WORLD_ADDRESS },
    });
  });

  it("supersedes the previous official version, and a replay of the older event does not bring it back", async () => {
    const first = atlas.officialVersionSet({ worldId: ALDEA, versionId: V1, previousVersionId: ZERO, ...log(12) });
    await apply(db, first);
    await apply(db, atlas.versionRegistered(version(V2, ALDEA, "0.2.0", 13, V1), at(13)));
    await apply(db, atlas.officialVersionSet({ worldId: ALDEA, versionId: V2, previousVersionId: V1, ...log(14) }));
    expect(await apply(db, first)).toEqual([]);

    const detail = await atlasWorld(db as never, ALDEA, MEASURED, NOW);
    expect(detail?.official?.versionId).toBe(V2);
    expect(detail?.versions.map((v) => [v.semver, v.status, v.parentVersionId, v.registeredTx, v.registeredTs])).toEqual([
      ["0.2.0", "official", V1, log(13).txHash, REGISTERED + 13],
      ["0.1.0", "superseded", null, log(11).txHash, REGISTERED + 11],
    ]);
  });

  it("does not make official a version of another world", async () => {
    await apply(db, atlas.worldRegistered(world(NOCTURNA, "ALDEA Nocturna", FORK_ORG, ALDEA, 12), at(12)));
    expect(await apply(db, atlas.officialVersionSet({ worldId: NOCTURNA, versionId: V1, previousVersionId: ZERO, ...log(13) }))).toEqual([]);
  });

  it("withdraws a candidate, but never an official version", async () => {
    await apply(db, atlas.versionRegistered(version(V2, ALDEA, "0.2.0", 12), at(12)));
    await apply(db, atlas.officialVersionSet({ worldId: ALDEA, versionId: V1, previousVersionId: ZERO, ...log(13) }));
    expect(await apply(db, atlas.versionWithdrawn({ versionId: V2, ...log(14) }))).toEqual([ALDEA]);
    expect(await apply(db, atlas.versionWithdrawn({ versionId: V1, ...log(15) }))).toEqual([]);
    const detail = await atlasWorld(db as never, ALDEA, MEASURED, NOW);
    expect(detail?.versions.map((v) => [v.semver, v.status])).toEqual([
      ["0.2.0", "withdrawn"],
      ["0.1.0", "official"],
    ]);
    expect(detail?.candidates).toBe(0);
  });
});

describe("clients", () => {
  it("lists a version's active clients with their operator, until they are deactivated", async () => {
    await apply(db, anchor(OPERATOR, "alma:main:org:operator"));
    await apply(db, atlas.worldRegistered(world(ALDEA, "ALDEA World", ORG, ZERO, 10), at(10)));
    await apply(db, atlas.versionRegistered(version(V1, ALDEA, "0.1.0", 11), at(11)));
    const client = atlas.clientRegistered({ clientId: CLIENT, versionId: V1, operatorAlmaIdHash: OPERATOR, kind: 0, url: "https://aldea.world", ...log(12) });
    expect(await apply(db, client)).toEqual([ALDEA]);
    expect(await apply(db, client)).toEqual([]);
    expect((await atlasWorlds(db as never, everything, MEASURED, NOW)).items[0]?.clients).toEqual([
      { clientId: CLIENT, versionId: V1, url: "https://aldea.world", kind: "web", operatorAlmaIdHash: OPERATOR, operatorAlmaId: "alma:main:org:operator", registeredTx: log(12).txHash },
    ]);

    expect(await apply(db, atlas.clientDeactivated({ clientId: CLIENT, ...log(13) }))).toEqual([ALDEA]);
    expect(await apply(db, atlas.clientDeactivated({ clientId: CLIENT, ...log(13) }))).toEqual([]);
    expect((await atlasWorlds(db as never, everything, MEASURED, NOW)).items[0]?.clients).toEqual([]);
  });
});

describe("forks and lineage", () => {
  beforeEach(async () => {
    await apply(db, atlas.worldRegistered(world(ALDEA, "ALDEA World", ORG, ZERO, 10), at(10)));
    await apply(db, atlas.worldRegistered(world(NOCTURNA, "ALDEA Nocturna", FORK_ORG, ALDEA, 20), at(20)));
  });

  it("shows the lineage from the first ancestor down to the fork", async () => {
    const fork = await atlasWorld(db as never, NOCTURNA, MEASURED, NOW);
    expect(fork?.lineage).toEqual([
      { worldId: ALDEA, name: "ALDEA World" },
      { worldId: NOCTURNA, name: "ALDEA Nocturna" },
    ]);
    // Its organization is not anchored in this read model: the hash is all that is known
    expect(fork?.org).toEqual({ almaIdHash: FORK_ORG, almaId: null });
    expect((await atlasWorld(db as never, ALDEA, MEASURED, NOW))?.forks).toBe(1);
    expect(await atlasWorld(db as never, id(0xff), MEASURED, NOW)).toBeUndefined();
  });

  it("narrows the list to a world's forks", async () => {
    const { items } = await atlasWorlds(db as never, { ...everything, parentWorldId: ALDEA }, MEASURED, NOW);
    expect(items.map((item) => item.name)).toEqual(["ALDEA Nocturna"]);
  });

  it("pages in registration order with a cursor", async () => {
    const first = await atlasWorlds(db as never, { ...everything, limit: 1 }, MEASURED, NOW);
    expect(first.items.map((item) => item.name)).toEqual(["ALDEA World"]);
    expect(first.nextCursor).toBe(`10:${ALDEA}`);
    const second = await atlasWorlds(db as never, { ...everything, limit: 1, cursor: atlasFilter({ cursor: first.nextCursor! })!.cursor }, MEASURED, NOW);
    expect(second.items.map((item) => item.name)).toEqual(["ALDEA Nocturna"]);
  });
});

describe("activity in the last 24 h", () => {
  const ctx = (ts: number): StfContext => ({ height: 1, timestampMs: ts * 1000, worldId: WORLD_ADDRESS });

  it("is measured for the World this node follows and not measurable for any other", async () => {
    await apply(db, atlas.worldRegistered(world(ALDEA, "ALDEA World", ORG, ZERO, 10), at(10)));
    await apply(db, atlas.versionRegistered(version(V1, ALDEA, "0.1.0", 11), at(11)));
    await apply(db, atlas.worldRegistered(world(NOCTURNA, "ALDEA Nocturna", FORK_ORG, ALDEA, 20), at(20)));
    await apply(db, atlas.versionRegistered(version(V2, NOCTURNA, "0.1.0", 21, ZERO, "0x" + "ee".repeat(20)), at(21)));
    await apply(db, atlas.officialVersionSet({ worldId: NOCTURNA, versionId: V2, previousVersionId: ZERO, ...log(22) }));
    await apply(db, buildingEntered({ characterId: 1, buildingId: id(0xb0), almaIdHash: id(1), ...log(30) }, ctx(NOW - 60)));

    // Until ALDEA's version is official, nothing ties the Atlas entry to the World this node follows
    const before = (await atlasWorlds(db as never, everything, MEASURED, NOW)).items;
    expect(before.map((item) => item.activity24h)).toEqual([null, null]);

    await apply(db, atlas.officialVersionSet({ worldId: ALDEA, versionId: V1, previousVersionId: ZERO, ...log(31) }));
    const after = (await atlasWorlds(db as never, everything, MEASURED, NOW)).items;
    expect(after.map((item) => item.activity24h)).toEqual([{ births: 0, visits: 1, uniqueSouls: 1 }, null]);

    // Configured with its Atlas id, the node needs no official version to know which world is its own
    const byId = (await atlasWorlds(db as never, everything, { ...MEASURED, worldId: NOCTURNA, worldAddress: "" }, NOW)).items;
    expect(byId.map((item) => item.activity24h === null)).toEqual([true, false]);
  });
});

describe("query", () => {
  it("defaults to public worlds, verified or not, 50 per page", () => {
    expect(atlasFilter({})).toEqual({ visibility: 0, verifiedOnly: false, parentWorldId: undefined, cursor: undefined, limit: 50 });
    expect(atlasFilter({ visibility: "any", verified: "true", parent: ALDEA.toUpperCase().replace("0X", "0x"), limit: "10" })).toEqual({
      visibility: undefined,
      verifiedOnly: true,
      parentWorldId: ALDEA,
      cursor: undefined,
      limit: 10,
    });
  });

  it("rejects values it does not know", () => {
    for (const query of [{ visibility: "hidden" }, { verified: "false" }, { limit: "0" }, { limit: "101" }, { parent: "0x12" }, { cursor: "abc" }, { cursor: `x:${ALDEA}` }]) {
      expect(atlasFilter(query)).toBeUndefined();
    }
  });
});
