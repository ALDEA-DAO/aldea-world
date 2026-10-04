import type { StartConfigApiRouter } from "@effectstream/node-sdk/runtime";
import { parseCredential } from "./cardano/credentials.ts";
import { env } from "./env.ts";

/**
 * Custom read API, next to the node's default endpoints (/health, /block-heights).
 *
 * The feeds the Resolver follows (`births?status=born`, `souls/anchored`) page by Base block: `since` is exclusive
 * and every page ends on a whole block, so `nextSince` (the last block returned) never splits a block between pages.
 */

const MAX_LIMIT = 500;

interface FeedQuery {
  since?: string;
  limit?: string;
}

function feedParams(query: FeedQuery) {
  const since = query.since === undefined ? -1 : Number(query.since);
  const limit = query.limit === undefined ? 100 : Number(query.limit);
  if (!Number.isInteger(since) || since < -1 || !Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) return undefined;
  return { since, limit };
}

type Db = Pick<Parameters<StartConfigApiRouter>[1], "query">;

/**
 * Rows after `since`, by (block, key), completed with the rest of the last block so a block never spans two pages.
 * `table`, `blockColumn` and `keyColumn` are fixed identifiers from this file, never user input.
 */
export async function feedPage(db: Db, table: string, blockColumn: string, keyColumn: string, where: string, since: number, limit: number) {
  const { rows } = await db.query(`SELECT * FROM ${table} WHERE ${where} AND ${blockColumn} > $1 ORDER BY ${blockColumn}, ${keyColumn} LIMIT $2`, [since, limit]);
  const last = rows.at(-1);
  if (last && rows.length === limit) {
    const rest = await db.query(`SELECT * FROM ${table} WHERE ${where} AND ${blockColumn} = $1 AND ${keyColumn} > $2 ORDER BY ${keyColumn}`, [
      last[blockColumn],
      last[keyColumn],
    ]);
    rows.push(...rest.rows);
  }
  return { rows, nextSince: rows.length ? Number(rows.at(-1)![blockColumn]) : since };
}

const birthView = (row: Record<string, unknown>) => ({
  characterId: row.character_id,
  status: row.status,
  owner: row.owner,
  almaIdHash: row.alma_id_hash,
  characterClass: row.character_class,
  tribe: row.tribe,
  targetBlock: String(row.target_block),
  requestedTx: row.requested_tx,
  bornBlock: row.born_block === null ? null : Number(row.born_block),
  bornTx: row.born_tx,
  bornTs: row.born_ts === null ? null : Number(row.born_ts),
});

/** Activity windows the API accepts, in seconds. */
export const WINDOWS = { "1h": 3_600, "24h": 86_400, "7d": 604_800 } as const;
export type ActivityWindow = keyof typeof WINDOWS;

/** Visits and distinct souls per building since `fromTs` (unix seconds), plus the totals across buildings and births. */
export async function buildingActivity(db: Db, fromTs: number) {
  const perBuilding = await db.query(
    `SELECT building_id, count(*)::int AS visits, count(DISTINCT alma_id_hash)::int AS unique_souls, max(base_ts) AS last_visit_ts,
       count(*) FILTER (WHERE left_ts IS NULL)::int AS inside
     FROM building_visits WHERE base_ts >= $1 GROUP BY building_id ORDER BY building_id`,
    [fromTs],
  );
  const totals = await db.query(`SELECT count(*)::int AS visits, count(DISTINCT alma_id_hash)::int AS unique_souls FROM building_visits WHERE base_ts >= $1`, [fromTs]);
  // Births are counted per hour: the hours that started inside the window
  const births = await db.query(`SELECT coalesce(sum(births), 0)::int AS births FROM world_activity_hourly WHERE hour_start >= $1`, [Math.ceil(fromTs / 3600) * 3600]);
  return {
    items: perBuilding.rows.map((row) => ({
      buildingId: row.building_id,
      visits: row.visits,
      uniqueSouls: row.unique_souls,
      // Visits not closed yet: souls that went in during the window and have not left (an approximation: a closed tab
      // without leaveBuilding stays "inside" until that soul's next entry)
      inside: row.inside,
      lastVisitTs: Number(row.last_visit_ts),
    })),
    totals: { visits: totals.rows[0]?.visits ?? 0, uniqueSouls: totals.rows[0]?.unique_souls ?? 0, births: births.rows[0]?.births ?? 0 },
  };
}

/** Souls that went into at least one building in the 7 days before `nowTs` (unix seconds). */
export async function weeklySouls(db: Db, nowTs: number) {
  const fromTs = nowTs - WINDOWS["7d"];
  const { rows } = await db.query(`SELECT count(DISTINCT alma_id_hash)::int AS unique_souls, count(*)::int AS visits FROM building_visits WHERE base_ts >= $1 AND base_ts <= $2`, [fromTs, nowTs]);
  return { fromTs, toTs: nowTs, uniqueSouls: rows[0]?.unique_souls ?? 0, visits: rows[0]?.visits ?? 0 };
}

const VISIBILITY = ["public", "unlisted", "private"] as const;
const VERSION_STATUS = ["none", "candidate", "official", "superseded", "withdrawn"] as const;
const CLIENT_KIND = ["web", "mobile", "desktop", "agent"] as const;
const HEX_32 = /^0x[0-9a-f]{64}$/;

/** The World whose on-chain activity this node measures: by its Atlas id once registered, by its address until then. */
export interface MeasuredWorld {
  worldId: string;
  chainId: number;
  worldAddress: string;
}

export interface AtlasFilter {
  /** Index in Visibility, or undefined for every visibility. */
  visibility?: number;
  verifiedOnly: boolean;
  /** Only the worlds forked from this one. */
  parentWorldId?: string;
  cursor?: { block: number; worldId: string };
  limit: number;
}

const ATLAS_WORLD_SELECT = `SELECT w.*, org.alma_id AS org_alma_id,
  o.version_id AS o_version_id, o.semver AS o_semver, o.client_cid AS o_client_cid, o.chain_id AS o_chain_id, o.world_address AS o_world_address,
  (SELECT count(*)::int FROM atlas_versions c WHERE c.world_id = w.world_id AND c.status = 1) AS candidates,
  (SELECT count(*)::int FROM atlas_worlds f WHERE f.parent_world_id = w.world_id) AS forks
FROM atlas_worlds w
LEFT JOIN souls_anchored org ON org.alma_id_hash = w.alma_org_id_hash
LEFT JOIN atlas_versions o ON o.version_id = w.official_version_id`;

/** Active clients of the given worlds' versions that were not withdrawn, oldest first. */
async function atlasClients(db: Db, worldIds: string[]) {
  const byWorld = new Map<string, unknown[]>();
  if (!worldIds.length) return byWorld;
  const { rows } = await db.query(
    `SELECT v.world_id, c.client_id, c.version_id, c.url, c.kind, c.operator_alma_id_hash, c.registered_tx, op.alma_id AS operator_alma_id
     FROM atlas_clients c JOIN atlas_versions v ON v.version_id = c.version_id
     LEFT JOIN souls_anchored op ON op.alma_id_hash = c.operator_alma_id_hash
     WHERE c.active AND v.status <> 4 AND v.world_id = ANY($1::text[])
     ORDER BY c.registered_block, c.client_id`,
    [worldIds],
  );
  for (const row of rows) {
    const clients = byWorld.get(row.world_id) ?? [];
    clients.push({
      clientId: row.client_id,
      versionId: row.version_id,
      url: row.url,
      kind: CLIENT_KIND[row.kind] ?? "web",
      operatorAlmaIdHash: row.operator_alma_id_hash,
      operatorAlmaId: row.operator_alma_id ?? null,
      registeredTx: row.registered_tx,
    });
    byWorld.set(row.world_id, clients);
  }
  return byWorld;
}

/**
 * Births, visits and souls of the last 24 h, only for the World this node follows; every other world is `null`
 * ("not measurable on-chain"), since there is no primitive on its contracts.
 */
async function measuredActivity(db: Db, nowTs: number) {
  const { totals } = await buildingActivity(db, nowTs - WINDOWS["24h"]);
  return { births: totals.births, visits: totals.visits, uniqueSouls: totals.uniqueSouls };
}

function worldView(row: Record<string, any>, clients: unknown[], measured: MeasuredWorld, activity: unknown) {
  const isMeasured =
    row.world_id === measured.worldId || (row.o_version_id !== null && Number(row.o_chain_id) === measured.chainId && row.o_world_address === measured.worldAddress);
  return {
    worldId: row.world_id,
    name: row.name,
    verified: row.verified,
    visibility: VISIBILITY[row.visibility] ?? "private",
    parentWorldId: row.parent_world_id,
    governor: row.governor,
    metadataUri: row.metadata_uri,
    createdBlock: Number(row.created_block),
    createdTx: row.created_tx,
    createdTs: row.created_ts === null ? null : Number(row.created_ts),
    org: { almaIdHash: row.alma_org_id_hash, almaId: row.org_alma_id ?? null },
    official:
      row.o_version_id === null
        ? null
        : { versionId: row.o_version_id, semver: row.o_semver, clientCid: row.o_client_cid, chainId: Number(row.o_chain_id), worldAddress: row.o_world_address },
    candidates: row.candidates,
    forks: row.forks,
    clients,
    activity24h: isMeasured ? activity : null,
  };
}

/** One page of worlds in registration order, each with its organization, official version, clients and activity. */
export async function atlasWorlds(db: Db, filter: AtlasFilter, measured: MeasuredWorld, nowTs: number) {
  const { rows } = await db.query(
    `${ATLAS_WORLD_SELECT}
     WHERE ($1::int IS NULL OR w.visibility = $1::int) AND (NOT $2::boolean OR w.verified) AND ($3::text IS NULL OR w.parent_world_id = $3::text)
       AND (w.created_block, w.world_id) > ($4::bigint, $5::text)
     ORDER BY w.created_block, w.world_id LIMIT $6`,
    [filter.visibility ?? null, filter.verifiedOnly, filter.parentWorldId ?? null, filter.cursor?.block ?? -1, filter.cursor?.worldId ?? "", filter.limit],
  );
  const clients = await atlasClients(db, rows.map((row) => row.world_id));
  const activity = await measuredActivity(db, nowTs);
  const last = rows.at(-1);
  return {
    items: rows.map((row) => worldView(row, clients.get(row.world_id) ?? [], measured, activity)),
    nextCursor: last && rows.length === filter.limit ? `${Number(last.created_block)}:${last.world_id}` : null,
  };
}

/** A world with all its versions (newest first) and its lineage, from the first ancestor down to the world itself. */
export async function atlasWorld(db: Db, worldId: string, measured: MeasuredWorld, nowTs: number) {
  const { rows } = await db.query(`${ATLAS_WORLD_SELECT} WHERE w.world_id = $1`, [worldId]);
  if (!rows[0]) return undefined;
  const versions = await db.query(`SELECT * FROM atlas_versions WHERE world_id = $1 ORDER BY registered_block DESC, version_id`, [worldId]);
  // The depth bound only guards against a cycle, which registerWorld cannot create (a parent must already exist)
  const lineage = await db.query(
    `WITH RECURSIVE line AS (
       SELECT world_id, name, parent_world_id, 0 AS depth FROM atlas_worlds WHERE world_id = $1
       UNION ALL
       SELECT p.world_id, p.name, p.parent_world_id, line.depth + 1 FROM atlas_worlds p JOIN line ON p.world_id = line.parent_world_id WHERE line.depth < 64
     )
     SELECT world_id, name FROM line ORDER BY depth DESC`,
    [worldId],
  );
  const clients = await atlasClients(db, [worldId]);
  return {
    ...worldView(rows[0], clients.get(worldId) ?? [], measured, await measuredActivity(db, nowTs)),
    versions: versions.rows.map((row) => ({
      versionId: row.version_id,
      parentVersionId: row.parent_version_id,
      status: VERSION_STATUS[row.status] ?? "none",
      semver: row.semver,
      clientCid: row.client_cid,
      gitCommit: row.git_commit,
      engine: row.engine,
      chainId: Number(row.chain_id),
      worldAddress: row.world_address,
      registeredBlock: Number(row.registered_block),
      registeredTx: row.registered_tx,
      registeredTs: row.registered_ts === null ? null : Number(row.registered_ts),
    })),
    lineage: lineage.rows.map((row) => ({ worldId: row.world_id, name: row.name })),
  };
}

interface AtlasQuery {
  visibility?: string;
  verified?: string;
  parent?: string;
  cursor?: string;
  limit?: string;
}

/** Query string → filter, or undefined when a value is not one the API accepts. */
export function atlasFilter(query: AtlasQuery): AtlasFilter | undefined {
  const visibility = query.visibility ?? "public";
  const verified = query.verified ?? "any";
  const limit = query.limit === undefined ? 50 : Number(query.limit);
  if (visibility !== "any" && !VISIBILITY.includes(visibility as never)) return undefined;
  if (verified !== "any" && verified !== "true") return undefined;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) return undefined;
  const parentWorldId = query.parent?.toLowerCase();
  if (parentWorldId !== undefined && !HEX_32.test(parentWorldId)) return undefined;
  let cursor: AtlasFilter["cursor"];
  if (query.cursor) {
    const [block, worldId] = query.cursor.split(":");
    if (!/^\d+$/.test(block ?? "") || !HEX_32.test(worldId ?? "")) return undefined;
    cursor = { block: Number(block), worldId: worldId! };
  }
  return { visibility: visibility === "any" ? undefined : VISIBILITY.indexOf(visibility as never), verifiedOnly: verified === "true", parentWorldId, cursor, limit };
}

/** The last Cardano slot the node has folded in, or null before the first one. */
async function cardanoTipSlot(db: Db): Promise<number | null> {
  return null;
}

/** What a credential holds of $ALDEA, in base units: "0" for a credential the asset never reached. */
export async function aldeaHolding(db: Db, credential: string) {
  const { rows } = await db.query(`SELECT balance::text AS balance, updated_height FROM aldea_holdings WHERE credential = $1`, [credential]);
  return { credential, balance: rows[0]?.balance ?? "0", updatedHeight: rows[0] ? Number(rows[0].updated_height) : null };
}

const nowSeconds = () => Math.floor(Date.now() / 1000);
const measuredWorld = (): MeasuredWorld => ({ worldId: env.activityWorldId, chainId: env.chainId, worldAddress: env.worldAddress });

export const apiRouter: StartConfigApiRouter = async (server, dbConn) => {
  server.get<{ Params: { characterId: string } }>("/api/v1/births/:characterId", async (request, reply) => {
    const id = Number(request.params.characterId);
    if (!Number.isInteger(id) || id < 1) return reply.code(400).send({ error: "invalid_character_id" });
    const { rows } = await dbConn.query(`SELECT * FROM births WHERE character_id = $1`, [id]);
    if (!rows[0]) return reply.code(404).send({ error: "birth_not_found" });
    return birthView(rows[0]);
  });

  /** Born characters after a Base block (the Resolver turns them into souls' tribe memberships). */
  server.get<{ Querystring: FeedQuery & { status?: string } }>("/api/v1/births", async (request, reply) => {
    const params = feedParams(request.query);
    if (!params || request.query.status !== "born") return reply.code(400).send({ error: "invalid_query", hint: "status=born&since=<block>&limit=1..500" });
    const { rows, nextSince } = await feedPage(dbConn, "births", "born_block", "character_id", "status = 'born'", params.since, params.limit);
    return { items: rows.map(birthView), nextSince };
  });

  /** Souls anchored after a Base block (the Resolver marks them anchored). */
  server.get<{ Querystring: FeedQuery }>("/api/v1/souls/anchored", async (request, reply) => {
    const params = feedParams(request.query);
    if (!params) return reply.code(400).send({ error: "invalid_query", hint: "since=<block>&limit=1..500" });
    const { rows, nextSince } = await feedPage(dbConn, "souls_anchored", "anchored_block", "alma_id_hash", "true", params.since, params.limit);
    return {
      items: rows.map((row) => ({
        almaIdHash: row.alma_id_hash,
        almaId: row.alma_id,
        subjectType: row.subject_type,
        controller: row.controller,
        anchoredBlock: Number(row.anchored_block),
        txHash: row.tx_hash,
      })),
      nextSince,
    };
  });

  /** Activity per building in a recent window (1h, 24h or 7d; 24h by default). */
  server.get<{ Querystring: { window?: string } }>("/api/v1/activity/buildings", async (request, reply) => {
    const window = (request.query.window ?? "24h") as ActivityWindow;
    if (!(window in WINDOWS)) return reply.code(400).send({ error: "invalid_window", hint: "window=1h|24h|7d" });
    const fromTs = nowSeconds() - WINDOWS[window];
    return { window, fromTs, ...(await buildingActivity(dbConn, fromTs)) };
  });

  /** $ALDEA held by a Cardano credential (`stake:<hex28>` or `pay:<hex28>`), with how far the node has read Cardano. */
  server.get<{ Params: { credential: string } }>("/api/v1/cardano/holdings/:credential", async (request, reply) => {
    const credential = parseCredential(request.params.credential);
    if (!credential) return reply.code(400).send({ error: "invalid_credential", hint: "stake:<56 hex> or pay:<56 hex>" });
    if (!env.cardano) return reply.code(503).send({ error: "cardano_not_configured" });
    return { ...(await aldeaHolding(dbConn, credential)), cardanoTipSlot: await cardanoTipSlot(dbConn) };
  });

  /** The Atlas: worlds by registration order (public ones unless asked otherwise), `parent` narrows to a world's forks. */
  server.get<{ Querystring: AtlasQuery }>("/api/v1/atlas/worlds", async (request, reply) => {
    const filter = atlasFilter(request.query);
    if (!filter) return reply.code(400).send({ error: "invalid_query", hint: "visibility=public|unlisted|private|any&verified=any|true&parent=<worldId>&cursor=&limit=1..100" });
    return atlasWorlds(dbConn, filter, measuredWorld(), nowSeconds());
  });

  server.get<{ Params: { worldId: string } }>("/api/v1/atlas/worlds/:worldId", async (request, reply) => {
    const worldId = request.params.worldId.toLowerCase();
    if (!HEX_32.test(worldId)) return reply.code(400).send({ error: "invalid_world_id" });
    const world = await atlasWorld(dbConn, worldId, measuredWorld(), nowSeconds());
    if (!world) return reply.code(404).send({ error: "world_not_found" });
    return world;
  });

  /** Weekly active souls: distinct souls with at least one building entry in the last 7 days. */
  server.get("/api/v1/activity/souls/weekly", async () => weeklySouls(dbConn, nowSeconds()));
};
