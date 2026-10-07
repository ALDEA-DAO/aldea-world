import type { StartConfigApiRouter } from "@effectstream/node-sdk/runtime";
import { canonicalHash, canonicalJson } from "@aldea/shared/council";
import { parseCredential } from "./cardano/credentials.ts";
import { env } from "./env.ts";
import { tallyOf, type ProposalRow } from "./stf/council.ts";

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

/** Unix time of slot 0 if every slot had been one second long, per network: slot = unix seconds − this. */
const SLOT_ZERO_UNIX = { mainnet: 1_591_566_291, preprod: 1_655_683_200 } as const;

/**
 * How far the node has read Cardano. A main-clock block is only applied once Cardano has been read up to that block's
 * time, so holdings are complete as of `asOfMs`. `cardanoTipSlot` is the slot of the latest Cardano block in which the
 * asset moved (the sync only records blocks that carry one of its transactions), null before the first.
 */
async function cardanoReadState(db: Db): Promise<{ cardanoTipSlot: number | null; asOfMs: number | null; asOfSlot: number | null }> {
  const { rows } = await db.query(
    `SELECT
       (SELECT (page->'own'->>'slot')::bigint FROM effectstream.sync_protocol_pagination WHERE protocol_name = 'cardanoUtxoRpc') AS slot,
       (SELECT max(block_height) FROM effectstream.effectstream_blocks) AS height,
       (SELECT (immutable_config->>'startTime')::bigint FROM effectstream.sync_protocol_config_snapshot WHERE protocol_name = 'mainNtp') AS start_time`,
  );
  const { slot, height, start_time: startTime } = rows[0] ?? {};
  // The main clock ticks every second from its start time
  const asOfMs = height === null || height === undefined || startTime === null || startTime === undefined ? null : Number(startTime) + Number(height) * 1000;
  return {
    cardanoTipSlot: slot === null || slot === undefined ? null : Number(slot),
    asOfMs,
    // The Cardano slot at that time (Shelley-era slots are one second long): what a Founder attestation records
    asOfSlot: asOfMs === null || !env.cardano ? null : Math.floor(asOfMs / 1000) - SLOT_ZERO_UNIX[env.cardano.network],
  };
}

export async function founderSeal(db: Db, almaIdHash: string) {
  const { rows } = await db.query(`SELECT * FROM founders WHERE alma_id_hash = $1`, [almaIdHash]);
  const row = rows[0];
  if (!row) return undefined;
  return {
    almaIdHash: row.alma_id_hash,
    stakeCredential: row.stake_credential,
    aldeaBalance: String(row.aldea_balance),
    snapshotSlot: Number(row.snapshot_slot),
    claimedBlock: Number(row.claimed_block),
    txHash: row.tx_hash,
  };
}

/** What a credential holds of $ALDEA, in base units: "0" for a credential the asset never reached. */
export async function aldeaHolding(db: Db, credential: string) {
  const { rows } = await db.query(`SELECT balance::text AS balance, updated_height FROM aldea_holdings WHERE credential = $1`, [credential]);
  return { credential, balance: rows[0]?.balance ?? "0", updatedHeight: rows[0] ? Number(rows[0].updated_height) : null };
}

const proposalView = (row: Record<string, any>) => ({
  proposalId: row.proposal_id as string,
  kind: row.kind === 0 ? "GenesisRatification" : "SeasonElection",
  worldId: row.world_id as string,
  versionIds: row.version_ids as string[],
  snapshotAt: Number(row.snapshot_at),
  startsAt: Number(row.starts_at),
  endsAt: Number(row.ends_at),
  status: row.status as string,
  paramsURI: row.params_uri as string,
  /** Null until the guardian has published the rules for the read model. */
  paramsHash: row.params_hash as string | null,
  params: row.params_hash ? row.params : null,
  openedTx: row.opened_tx as string,
  tallyURI: row.tally_uri as string | null,
  /** Unix seconds from which a queued result can be executed. */
  eta: row.eta === null ? null : Number(row.eta),
  queuedTx: row.queued_tx as string | null,
  executedTx: row.executed_tx as string | null,
  vetoedTx: row.vetoed_tx as string | null,
  vetoReason: row.veto_reason as string | null,
});

/** Every proposal the Council has opened, the newest first. */
export async function councilProposals(db: Db) {
  const { rows } = await db.query(`SELECT * FROM council_proposals ORDER BY opened_block DESC, proposal_id`);
  return rows.map(proposalView);
}

/**
 * A proposal with how it is going: the eligible supply, what has signed and objected so far and, once closed, the
 * result with the hash that goes on-chain. With a `voter` credential, also that voter's weight and current vote.
 */
export async function councilProposal(db: Db, proposalId: string, voter?: string) {
  const { rows } = await db.query(`SELECT * FROM council_proposals WHERE proposal_id = $1`, [proposalId]);
  if (!rows[0]) return undefined;
  const counts = await db.query(
    `SELECT
       (SELECT coalesce(sum(weight), 0)::text FROM council_snapshots WHERE proposal_id = $1) AS eligible,
       (SELECT coalesce(sum(weight), 0)::text FROM council_votes WHERE proposal_id = $1 AND choice = 'sign') AS signatures,
       (SELECT coalesce(sum(weight), 0)::text FROM council_votes WHERE proposal_id = $1 AND choice = 'object') AS objections,
       (SELECT count(*)::int FROM council_votes WHERE proposal_id = $1) AS participants`,
    [proposalId],
  );
  const result = await db.query(`SELECT outcome, tally_hash FROM council_results WHERE proposal_id = $1`, [proposalId]);
  const out: Record<string, unknown> = {
    proposal: proposalView(rows[0]),
    tally: counts.rows[0],
    result: result.rows[0] ? { outcome: result.rows[0].outcome, tallyHash: result.rows[0].tally_hash } : null,
  };
  if (voter) {
    const mine = await db.query(
      `SELECT s.weight::text AS weight, v.choice, v.input_tx,
         EXISTS (SELECT 1 FROM founders f WHERE f.stake_credential = $3) AS founder
       FROM (SELECT $1::text AS proposal_id, $2::text AS credential) me
       LEFT JOIN council_snapshots s ON s.proposal_id = me.proposal_id AND s.credential = me.credential
       LEFT JOIN council_votes v ON v.proposal_id = me.proposal_id AND v.credential = me.credential`,
      [proposalId, voter, voter.slice(voter.indexOf(":") + 1)],
    );
    const row = mine.rows[0];
    out.voter = { credential: voter, founder: Boolean(row?.founder), weight: row?.weight ?? "0", vote: row?.choice ? { choice: row.choice, inputTx: row.input_tx } : null };
  }
  return out;
}

/** The full tally of a closed proposal, or undefined while there is none (open, or closed without rules). */
export async function councilTally(db: Db, proposalId: string) {
  const { rows } = await db.query(`SELECT p.* FROM council_proposals p JOIN council_results r ON r.proposal_id = p.proposal_id WHERE p.proposal_id = $1`, [proposalId]);
  if (!rows[0]) return undefined;
  const snapshot = await db.query(`SELECT credential, weight::text AS weight FROM council_snapshots WHERE proposal_id = $1 ORDER BY credential`, [proposalId]);
  const votes = await db.query(`SELECT credential, alma_id_hash, choice, weight::text AS weight, input_tx FROM council_votes WHERE proposal_id = $1 ORDER BY credential`, [proposalId]);
  return tallyOf(rows[0] as ProposalRow, snapshot.rows as never, votes.rows as never);
}

/** The proposals a soul took part in, signing or objecting alike, each with the transaction that carried its vote. */
export async function councilParticipations(db: Db, almaIdHash: string) {
  const { rows } = await db.query(
    `SELECT v.proposal_id, v.input_tx, p.kind FROM council_votes v JOIN council_proposals p ON p.proposal_id = v.proposal_id WHERE v.alma_id_hash = $1 ORDER BY v.height, v.proposal_id`,
    [almaIdHash],
  );
  return rows.map((row) => ({ proposalId: row.proposal_id as string, kind: row.kind === 0 ? "GenesisRatification" : "SeasonElection", inputTx: row.input_tx as string }));
}

/** Seconds a birth may wait for its completion before it is an alert. */
export const GESTATION_ALERT_SECONDS = 60;
/** Base blocks the read model may be behind before it is an alert. */
export const BASE_LAG_ALERT_BLOCKS = 30;

/**
 * What is wrong right now, for a monitor to page someone: births waiting too long for their completion, and the read
 * model too far behind Base. `height` is the main clock's (one block a second), `synced` the last Base block read and
 * `head` Base's own; a value that cannot be read is null and raises nothing by itself.
 */
export async function alerts(db: Db, { height, synced, head }: { height: number | null; synced: number | null; head: number | null }) {
  const firing: { alert: string; detail: string }[] = [];
  if (height !== null) {
    const { rows } = await db.query(`SELECT count(*)::int AS births, min(created_height) AS oldest FROM relay_outbox WHERE kind = 'complete_birth' AND status = 'pending' AND created_height < $1`, [height - GESTATION_ALERT_SECONDS]);
    if (rows[0]?.births > 0) firing.push({ alert: "gestation_stuck", detail: `${rows[0].births} birth(s) waiting for their completion, the oldest for ${height - Number(rows[0].oldest)} s` });
  }
  if (synced !== null && head !== null && head - synced > BASE_LAG_ALERT_BLOCKS) firing.push({ alert: "base_lag", detail: `${head - synced} Base blocks behind (read ${synced}, head ${head})` });
  return firing;
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
    return { ...(await aldeaHolding(dbConn, credential)), ...(await cardanoReadState(dbConn)) };
  });

  /** A soul's Founder seal, by the hash of its ALMA id; 404 while it has none. */
  server.get<{ Params: { almaIdHash: string } }>("/api/v1/founders/:almaIdHash", async (request, reply) => {
    const almaIdHash = request.params.almaIdHash.toLowerCase();
    if (!HEX_32.test(almaIdHash)) return reply.code(400).send({ error: "invalid_alma_id_hash" });
    const founder = await founderSeal(dbConn, almaIdHash);
    if (!founder) return reply.code(404).send({ error: "not_a_founder" });
    return founder;
  });

  /**
   * 200 while nothing is wrong, 503 with what is: an uptime monitor on this address is the alert. The node's own
   * `/health` says whether it is running; this says whether it is doing its job in time.
   */
  server.get("/api/v1/alerts", async (_request, reply) => {
    const { rows } = await dbConn.query(
      `SELECT (SELECT max(block_height) FROM effectstream.effectstream_blocks) AS height,
              (SELECT (page->>'ownBlockNumber')::bigint FROM effectstream.sync_protocol_pagination WHERE protocol_name = 'baseRpc') AS synced`,
    );
    const head = await fetch(env.baseRpcUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_blockNumber", params: [] }) })
      .then(async (res) => Number(BigInt(((await res.json()) as { result: string }).result)))
      .catch(() => null);
    const number = (value: unknown) => (value === null || value === undefined ? null : Number(value));
    const firing = await alerts(dbConn, { height: number(rows[0]?.height), synced: number(rows[0]?.synced), head });
    return reply.code(firing.length ? 503 : 200).send({ ok: firing.length === 0, alerts: firing });
  });

  /** The Council's proposals. */
  server.get("/api/v1/council/proposals", async () => ({ items: await councilProposals(dbConn), inputs: env.council?.inputs ?? null }));

  /** A proposal and its running tally; `voter=stake:<hex28>` adds that credential's weight and vote. */
  server.get<{ Params: { proposalId: string }; Querystring: { voter?: string } }>("/api/v1/council/proposals/:proposalId", async (request, reply) => {
    const proposalId = request.params.proposalId.toLowerCase();
    if (!HEX_32.test(proposalId)) return reply.code(400).send({ error: "invalid_proposal_id" });
    const voter = request.query.voter === undefined ? undefined : parseCredential(request.query.voter);
    if (request.query.voter !== undefined && !voter) return reply.code(400).send({ error: "invalid_credential", hint: "voter=stake:<56 hex> or pay:<56 hex>" });
    const proposal = await councilProposal(dbConn, proposalId, voter);
    if (!proposal) return reply.code(404).send({ error: "proposal_not_found" });
    return proposal;
  });

  /**
   * The canonical tally of a closed proposal (JCS): the snapshot, every vote with the transaction that carried it, and
   * the result. keccak256 of these exact bytes is the `tallyHash` queued on-chain, so anyone can recompute it.
   */
  server.get<{ Params: { proposalId: string } }>("/api/v1/council/proposals/:proposalId/tally.json", async (request, reply) => {
    const proposalId = request.params.proposalId.toLowerCase();
    if (!HEX_32.test(proposalId)) return reply.code(400).send({ error: "invalid_proposal_id" });
    const tally = await councilTally(dbConn, proposalId);
    if (!tally) return reply.code(404).send({ error: "tally_not_found", hint: "the proposal does not exist or has not been tallied yet" });
    return reply.header("Content-Type", "application/json; charset=utf-8").header("X-Tally-Hash", canonicalHash(tally)).send(canonicalJson(tally));
  });

  /** The Council proposals a soul took part in (Charter Signatories); an empty list for a soul that never voted. */
  server.get<{ Params: { almaIdHash: string } }>("/api/v1/council/participants/:almaIdHash", async (request, reply) => {
    const almaIdHash = request.params.almaIdHash.toLowerCase();
    if (!HEX_32.test(almaIdHash)) return reply.code(400).send({ error: "invalid_alma_id_hash" });
    return { almaIdHash, items: await councilParticipations(dbConn, almaIdHash) };
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
