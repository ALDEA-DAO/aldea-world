import type { StartConfigApiRouter } from "@effectstream/node-sdk/runtime";

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

const nowSeconds = () => Math.floor(Date.now() / 1000);

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

  /** Weekly active souls: distinct souls with at least one building entry in the last 7 days. */
  server.get("/api/v1/activity/souls/weekly", async () => weeklySouls(dbConn, nowSeconds()));
};
