import { sql } from "../sql.ts";
import type { Effect, StfContext } from "./births.ts";

/**
 * The Atlas in the read model (AtlasRegistry's events): worlds, their versions and the clients that serve them.
 *
 * Like every STF here: pure, and no statement can fail on chain data (a version or client whose parent row is missing
 * is skipped, not rejected by the foreign key). Each statement returns the `world_id` it changed and nothing when it
 * changed nothing, so a replayed event neither rewrites a row nor announces the world again.
 */

export const VersionStatus = { None: 0, Candidate: 1, Official: 2, Superseded: 3, Withdrawn: 4 } as const;

const ZERO_32 = "0x" + "0".repeat(64);
/** bytes32(0) means "none" on-chain (no parent world, no parent or previous version). */
const orNull = (value: string) => (value.toLowerCase() === ZERO_32 ? null : value.toLowerCase());

interface Log {
  txHash: string;
  logIndex: number;
  blockNumber: number;
}

export interface WorldRegistered extends Log {
  worldId: string;
  almaOrgIdHash: string;
  parentWorldId: string;
  governor: string;
  visibility: number;
  name: string;
  metadataURI: string;
}

export interface VersionRegistered extends Log {
  versionId: string;
  worldId: string;
  parentVersionId: string;
  version: { chainId: string; worldAddress: string; gitCommit: string; engine: string; semver: string; clientCid: string };
  registeredBy: string;
}

export interface ClientRegistered extends Log {
  clientId: string;
  versionId: string;
  operatorAlmaIdHash: string;
  kind: number;
  url: string;
}

export type ClientDeactivated = Log & { clientId: string };
export type OfficialVersionSet = Log & { worldId: string; versionId: string; previousVersionId: string };
export type VersionWithdrawn = Log & { versionId: string };
export type GovernorChanged = Log & { worldId: string; newGovernor: string };
export type VisibilityChanged = Log & { worldId: string; visibility: number };
export type MetadataChanged = Log & { worldId: string; metadataURI: string };
export type VerifiedChanged = Log & { worldId: string; verified: boolean };

const insertWorld = sql<{
  world_id: string;
  name: string;
  alma_org_id_hash: string;
  parent_world_id: string | null;
  governor: string;
  visibility: number;
  metadata_uri: string;
  created_block: number;
  created_tx: string;
  created_ts: number;
}>(
  `INSERT INTO atlas_worlds (world_id, name, alma_org_id_hash, parent_world_id, governor, visibility, metadata_uri, created_block, created_tx, created_ts)
VALUES (:world_id!, :name!, :alma_org_id_hash!, :parent_world_id, :governor!, :visibility!, :metadata_uri!, :created_block!, :created_tx!, :created_ts!)
ON CONFLICT (world_id) DO NOTHING
RETURNING world_id`,
);

const insertVersion = sql<{
  version_id: string;
  world_id: string;
  parent_version_id: string | null;
  chain_id: string;
  world_address: string;
  engine: string;
  semver: string;
  git_commit: string;
  client_cid: string;
  registered_block: number;
  registered_tx: string;
  registered_ts: number;
}>(
  `INSERT INTO atlas_versions (version_id, world_id, parent_version_id, chain_id, world_address, engine, semver, git_commit, client_cid, status, registered_block, registered_tx, registered_ts)
SELECT :version_id!::text, w.world_id, :parent_version_id::text, :chain_id!::bigint, :world_address!::text, :engine!::text, :semver!::text, :git_commit!::text, :client_cid!::text, ${VersionStatus.Candidate}, :registered_block!::bigint, :registered_tx!::text, :registered_ts!::bigint
FROM atlas_worlds w WHERE w.world_id = :world_id!
ON CONFLICT (version_id) DO NOTHING
RETURNING world_id`,
);

/**
 * Applies only while the world's official version is still the event's `previousVersionId`, so it happens once: the
 * previous official version becomes Superseded and this one Official.
 */
const setOfficial = sql<{ world_id: string; version_id: string; previous_version_id: string | null }>(
  `WITH world AS (
  UPDATE atlas_worlds SET official_version_id = :version_id!
  WHERE world_id = :world_id! AND official_version_id IS NOT DISTINCT FROM :previous_version_id::text
    AND EXISTS (SELECT 1 FROM atlas_versions WHERE version_id = :version_id! AND world_id = :world_id!)
  RETURNING world_id
), superseded AS (
  UPDATE atlas_versions SET status = ${VersionStatus.Superseded} FROM world WHERE atlas_versions.version_id = :previous_version_id::text
), official AS (
  UPDATE atlas_versions SET status = ${VersionStatus.Official} FROM world WHERE atlas_versions.version_id = :version_id!
)
SELECT world_id FROM world`,
);

const withdrawVersion = sql<{ version_id: string }>(
  `UPDATE atlas_versions SET status = ${VersionStatus.Withdrawn} WHERE version_id = :version_id! AND status = ${VersionStatus.Candidate} RETURNING world_id`,
);

const insertClient = sql<{ client_id: string; version_id: string; url: string; kind: number; operator_alma_id_hash: string; registered_block: number; registered_tx: string }>(
  `WITH client AS (
  INSERT INTO atlas_clients (client_id, version_id, url, kind, operator_alma_id_hash, registered_block, registered_tx)
  SELECT :client_id!::text, v.version_id, :url!::text, :kind!::smallint, :operator_alma_id_hash!::text, :registered_block!::bigint, :registered_tx!::text
  FROM atlas_versions v WHERE v.version_id = :version_id!
  ON CONFLICT (client_id) DO NOTHING
  RETURNING version_id
)
SELECT v.world_id FROM atlas_versions v JOIN client ON client.version_id = v.version_id`,
);

const deactivateClient = sql<{ client_id: string }>(
  `WITH client AS (
  UPDATE atlas_clients SET active = false WHERE client_id = :client_id! AND active RETURNING version_id
)
SELECT v.world_id FROM atlas_versions v JOIN client ON client.version_id = v.version_id`,
);

const setGovernor = sql<{ world_id: string; governor: string }>(
  `UPDATE atlas_worlds SET governor = :governor! WHERE world_id = :world_id! AND governor <> :governor! RETURNING world_id`,
);
const setVisibility = sql<{ world_id: string; visibility: number }>(
  `UPDATE atlas_worlds SET visibility = :visibility! WHERE world_id = :world_id! AND visibility <> :visibility! RETURNING world_id`,
);
const setMetadata = sql<{ world_id: string; metadata_uri: string }>(
  `UPDATE atlas_worlds SET metadata_uri = :metadata_uri! WHERE world_id = :world_id! AND metadata_uri IS DISTINCT FROM :metadata_uri! RETURNING world_id`,
);
const setVerified = sql<{ world_id: string; verified: boolean }>(
  `UPDATE atlas_worlds SET verified = :verified! WHERE world_id = :world_id! AND verified <> :verified! RETURNING world_id`,
);

export function worldRegistered(input: WorldRegistered, ctx: StfContext): Effect[] {
  return [
    [
      insertWorld,
      {
        world_id: input.worldId.toLowerCase(),
        name: input.name,
        alma_org_id_hash: input.almaOrgIdHash.toLowerCase(),
        parent_world_id: orNull(input.parentWorldId),
        governor: input.governor.toLowerCase(),
        visibility: input.visibility,
        metadata_uri: input.metadataURI,
        created_block: input.blockNumber,
        created_tx: input.txHash.toLowerCase(),
        created_ts: Math.floor(ctx.timestampMs / 1000),
      },
    ],
  ];
}

export function versionRegistered(input: VersionRegistered, ctx: StfContext): Effect[] {
  return [
    [
      insertVersion,
      {
        version_id: input.versionId.toLowerCase(),
        world_id: input.worldId.toLowerCase(),
        parent_version_id: orNull(input.parentVersionId),
        chain_id: String(input.version.chainId),
        world_address: input.version.worldAddress.toLowerCase(),
        engine: input.version.engine,
        semver: input.version.semver,
        git_commit: input.version.gitCommit.toLowerCase(),
        client_cid: input.version.clientCid,
        registered_block: input.blockNumber,
        registered_tx: input.txHash.toLowerCase(),
        registered_ts: Math.floor(ctx.timestampMs / 1000),
      },
    ],
  ];
}

export function officialVersionSet(input: OfficialVersionSet): Effect[] {
  return [[setOfficial, { world_id: input.worldId.toLowerCase(), version_id: input.versionId.toLowerCase(), previous_version_id: orNull(input.previousVersionId) }]];
}

export function versionWithdrawn(input: VersionWithdrawn): Effect[] {
  return [[withdrawVersion, { version_id: input.versionId.toLowerCase() }]];
}

export function clientRegistered(input: ClientRegistered): Effect[] {
  return [
    [
      insertClient,
      {
        client_id: input.clientId.toLowerCase(),
        version_id: input.versionId.toLowerCase(),
        url: input.url,
        kind: input.kind,
        operator_alma_id_hash: input.operatorAlmaIdHash.toLowerCase(),
        registered_block: input.blockNumber,
        registered_tx: input.txHash.toLowerCase(),
      },
    ],
  ];
}

export function clientDeactivated(input: ClientDeactivated): Effect[] {
  return [[deactivateClient, { client_id: input.clientId.toLowerCase() }]];
}

export function governorChanged(input: GovernorChanged): Effect[] {
  return [[setGovernor, { world_id: input.worldId.toLowerCase(), governor: input.newGovernor.toLowerCase() }]];
}

export function visibilityChanged(input: VisibilityChanged): Effect[] {
  return [[setVisibility, { world_id: input.worldId.toLowerCase(), visibility: input.visibility }]];
}

export function metadataChanged(input: MetadataChanged): Effect[] {
  return [[setMetadata, { world_id: input.worldId.toLowerCase(), metadata_uri: input.metadataURI }]];
}

export function verifiedChanged(input: VerifiedChanged): Effect[] {
  return [[setVerified, { world_id: input.worldId.toLowerCase(), verified: input.verified }]];
}
