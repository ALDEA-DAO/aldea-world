-- Effectstream read model (docs/prd.md § Data Model 3.5 and § Indexes).
-- Written only by the STFs, deterministically; relay_attempts is the only exception (relay worker).

CREATE TABLE births (
  character_id     INTEGER PRIMARY KEY,
  owner            TEXT NOT NULL,         -- 0x… in lowercase
  alma_id_hash     TEXT NOT NULL,         -- 0x…
  character_class  SMALLINT NOT NULL CHECK (character_class BETWEEN 0 AND 10),
  tribe            SMALLINT CHECK (tribe BETWEEN 0 AND 4),
  status           TEXT NOT NULL CHECK (status IN ('gestating','born')),
  target_block     BIGINT NOT NULL,
  requested_block  BIGINT NOT NULL,
  requested_tx     TEXT NOT NULL,
  born_block       BIGINT,
  born_tx          TEXT,
  born_ts          BIGINT                 -- Base block timestamp
);

CREATE TABLE building_visits (
  id            BIGSERIAL PRIMARY KEY,
  character_id  INTEGER NOT NULL,
  alma_id_hash  TEXT NOT NULL,
  building_id   TEXT NOT NULL,
  base_block    BIGINT NOT NULL,
  base_ts       BIGINT NOT NULL,
  tx_hash       TEXT NOT NULL,
  log_index     INTEGER NOT NULL,
  UNIQUE (tx_hash, log_index)
);

CREATE TABLE souls_anchored (
  alma_id_hash   TEXT PRIMARY KEY,
  alma_id        TEXT NOT NULL,
  subject_type   SMALLINT NOT NULL,       -- 1 human, 2 org, 3 agent
  controller     TEXT NOT NULL,
  anchored_block BIGINT NOT NULL,
  tx_hash        TEXT NOT NULL
);

CREATE TABLE founders (
  alma_id_hash      TEXT PRIMARY KEY,
  stake_credential  TEXT NOT NULL UNIQUE, -- 28-byte hex
  aldea_balance     NUMERIC(38,0) NOT NULL,
  snapshot_slot     BIGINT NOT NULL,
  claimed_block     BIGINT NOT NULL,
  tx_hash           TEXT NOT NULL
);

CREATE TABLE atlas_worlds (
  world_id            TEXT PRIMARY KEY,
  name                TEXT NOT NULL,
  alma_org_id_hash    TEXT NOT NULL,
  parent_world_id     TEXT,
  official_version_id TEXT,
  governor            TEXT NOT NULL,
  visibility          SMALLINT NOT NULL,   -- 0 public, 1 unlisted, 2 private
  verified            BOOLEAN NOT NULL DEFAULT false,
  metadata_uri        TEXT,
  created_block       BIGINT NOT NULL
);

CREATE TABLE atlas_versions (
  version_id         TEXT PRIMARY KEY,
  world_id           TEXT NOT NULL REFERENCES atlas_worlds(world_id),
  parent_version_id  TEXT,
  chain_id           BIGINT NOT NULL,
  world_address      TEXT NOT NULL,
  engine             TEXT NOT NULL,
  semver             TEXT NOT NULL,
  git_commit         TEXT NOT NULL,
  client_cid         TEXT NOT NULL,
  status             SMALLINT NOT NULL,    -- VersionStatus
  registered_block   BIGINT NOT NULL
);

CREATE TABLE atlas_clients (
  client_id              TEXT PRIMARY KEY,
  version_id             TEXT NOT NULL REFERENCES atlas_versions(version_id),
  url                    TEXT NOT NULL,
  kind                   SMALLINT NOT NULL,  -- 0 web, 1 mobile, 2 desktop, 3 agent
  operator_alma_id_hash  TEXT NOT NULL,
  active                 BOOLEAN NOT NULL DEFAULT true,
  registered_block       BIGINT NOT NULL
);

-- On-chain activity per world (official ALDEA and worlds with a primitives config)
CREATE TABLE world_activity_hourly (
  world_id      TEXT NOT NULL,
  hour_start    BIGINT NOT NULL,          -- base_ts truncated to the hour
  births        INTEGER NOT NULL DEFAULT 0,
  visits        INTEGER NOT NULL DEFAULT 0,
  unique_souls  INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (world_id, hour_start)
);

-- $ALDEA holdings derived from the Cardano primitive (live UTxOs of the asset)
CREATE TABLE aldea_holdings (
  credential     TEXT PRIMARY KEY,        -- 'stake:<hex28>' or 'pay:<hex28>'
  balance        NUMERIC(38,0) NOT NULL,  -- base units
  updated_height BIGINT NOT NULL          -- height of the Effectstream main clock
);

CREATE TABLE council_proposals (
  proposal_id    TEXT PRIMARY KEY,
  kind           SMALLINT NOT NULL,       -- 0 GenesisRatification, 1 SeasonElection
  world_id       TEXT NOT NULL,
  version_ids    TEXT[] NOT NULL,         -- Genesis: [v0]; Season: candidates + current official
  snapshot_at    BIGINT NOT NULL,
  starts_at      BIGINT NOT NULL,
  ends_at        BIGINT NOT NULL,
  params         JSONB NOT NULL,          -- { objectionThresholdBps: 1000, excluded: [...] }
  status         TEXT NOT NULL CHECK (status IN ('scheduled','snapshotted','open','closed','queued','executed','vetoed'))
);

CREATE TABLE council_snapshots (
  proposal_id    TEXT NOT NULL REFERENCES council_proposals(proposal_id),
  credential     TEXT NOT NULL,
  weight         NUMERIC(38,0) NOT NULL,
  PRIMARY KEY (proposal_id, credential)
);

CREATE TABLE council_votes (
  proposal_id    TEXT NOT NULL REFERENCES council_proposals(proposal_id),
  credential     TEXT NOT NULL,           -- stake credential of the voter
  alma_id_hash   TEXT NOT NULL,           -- the voting Founder
  choice         TEXT NOT NULL CHECK (choice IN ('sign','object')),
  weight         NUMERIC(38,0) NOT NULL,  -- taken from the snapshot
  input_tx       TEXT NOT NULL,           -- batcher tx on EffectstreamL2 (public evidence)
  height         BIGINT NOT NULL,
  PRIMARY KEY (proposal_id, credential)   -- the last vote before closing replaces the previous one
);

CREATE TABLE council_results (
  proposal_id        TEXT PRIMARY KEY REFERENCES council_proposals(proposal_id),
  eligible_weight    NUMERIC(38,0) NOT NULL,
  signatures_weight  NUMERIC(38,0) NOT NULL,
  objections_weight  NUMERIC(38,0) NOT NULL,
  participants       INTEGER NOT NULL,
  outcome            TEXT NOT NULL CHECK (outcome IN ('approved','rejected')),
  tally_hash         TEXT NOT NULL,        -- keccak256 of the canonical JSON tally
  finalized_height   BIGINT NOT NULL
);

-- Write intents (deterministic) executed by the relay worker
CREATE TABLE relay_outbox (
  id              BIGSERIAL PRIMARY KEY,
  kind            TEXT NOT NULL CHECK (kind IN ('complete_birth','council_queue','council_execute')),
  dedupe_key      TEXT NOT NULL UNIQUE,    -- 'complete_birth:42', 'council_queue:<proposalId>'
  payload         JSONB NOT NULL,
  not_before_base_block BIGINT,            -- e.g. target_block + 1
  not_before_ts   BIGINT,                  -- e.g. eta of the Charter
  status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','done')),
  created_height  BIGINT NOT NULL,
  done_height     BIGINT                   -- filled in when the STF observes the resulting event
);

-- Written only by the relay worker (non-deterministic; no STF reads it)
CREATE TABLE relay_attempts (
  id          BIGSERIAL PRIMARY KEY,
  outbox_id   BIGINT NOT NULL REFERENCES relay_outbox(id),
  tx_hash     TEXT,
  error       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX births_owner_idx          ON births (owner);
CREATE INDEX births_status_idx         ON births (status) WHERE status = 'gestating'; -- the Midwife and alerts
CREATE INDEX visits_building_ts_idx    ON building_visits (building_id, base_ts DESC); -- activity per building
CREATE INDEX visits_soul_ts_idx        ON building_visits (alma_id_hash, base_ts DESC); -- weekly active souls
CREATE INDEX versions_world_idx        ON atlas_versions (world_id);
CREATE INDEX clients_version_idx       ON atlas_clients (version_id) WHERE active;
CREATE INDEX worlds_public_idx         ON atlas_worlds (visibility, verified);
CREATE INDEX outbox_pending_idx        ON relay_outbox (status, kind) WHERE status = 'pending';
CREATE INDEX votes_proposal_idx        ON council_votes (proposal_id, choice);
