-- ALMA Resolver schema (docs/prd.md § Data Model 3.4 and § Indexes), verbatim.
CREATE SCHEMA IF NOT EXISTS alma;
--> statement-breakpoint
CREATE TABLE alma.souls (
  alma_id        TEXT PRIMARY KEY,                    -- 'alma:main:human:5f3c9a1e7b2d4c80a1f6e2b9d4c7a310'
  alma_id_hash   BYTEA NOT NULL UNIQUE,               -- keccak256(utf8(alma_id)), 32 bytes
  subject_type   TEXT NOT NULL CHECK (subject_type IN ('human','org','agent')),
  status         TEXT NOT NULL DEFAULT 'prepared'
                 CHECK (status IN ('prepared','anchored','active','revoked')),
  doc            JSONB NOT NULL,                      -- core ALMA document (see 3.6)
  doc_hash       BYTEA NOT NULL,                      -- keccak256(JCS(doc))
  public_profile JSONB NOT NULL DEFAULT '{}'::jsonb,  -- optional public data (displayName, avatar)
  anchored_tx    TEXT,
  anchored_block BIGINT,
  anchored_at    TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE alma.controllers (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  alma_id     TEXT NOT NULL REFERENCES alma.souls(alma_id) ON DELETE CASCADE,
  kind        TEXT NOT NULL CHECK (kind IN ('evm','cardano','lightning')),
  value       TEXT NOT NULL,        -- 'did:pkh:eip155:8453:0x…' | 'cardano:stake:<hex28>' | 'lnurl:<linkingKeyHex>'
  is_primary  BOOLEAN NOT NULL DEFAULT false,
  visibility  TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('public','private')),
  added_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at  TIMESTAMPTZ,
  UNIQUE (kind, value)              -- a controller belongs to a single soul
);
--> statement-breakpoint
CREATE TABLE alma.bindings (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  alma_id     TEXT NOT NULL REFERENCES alma.souls(alma_id) ON DELETE CASCADE,
  type        TEXT NOT NULL CHECK (type IN ('aldea-world:character','erc8004','endpoint','world')),
  value       TEXT NOT NULL,        -- 'base:8453:0x<world>:42' | 'erc8004:base:291' | URL
  visibility  TEXT NOT NULL DEFAULT 'public' CHECK (visibility IN ('public','private')),
  evidence    JSONB,                -- { "chainId": 8453, "txHash": "0x…", "logIndex": 3 }
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at  TIMESTAMPTZ,
  UNIQUE (type, value)
);
--> statement-breakpoint
CREATE TABLE alma.relationships (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  from_alma_id  TEXT NOT NULL REFERENCES alma.souls(alma_id),
  to_alma_id    TEXT NOT NULL REFERENCES alma.souls(alma_id),
  type          TEXT NOT NULL CHECK (type IN ('owns','represents','delegates','operates',
                                              'member_of','hired','paid','transacted_with')),
  evidence      JSONB NOT NULL,     -- every relationship points to concrete evidence
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at    TIMESTAMPTZ,
  revoked_by    TEXT,
  revoke_reason TEXT,
  UNIQUE (from_alma_id, to_alma_id, type)
);
--> statement-breakpoint
CREATE TABLE alma.auth_nonces (
  nonce       TEXT PRIMARY KEY,     -- 16 random bytes in base58
  address     TEXT NOT NULL,        -- EIP-55
  chain_id    INTEGER NOT NULL,
  issued_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at  TIMESTAMPTZ NOT NULL, -- issued_at + 5 min
  used_at     TIMESTAMPTZ
);
--> statement-breakpoint
CREATE TABLE alma.sessions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  controller    TEXT NOT NULL,      -- 'did:pkh:eip155:8453:0x…'
  alma_id       TEXT REFERENCES alma.souls(alma_id), -- NULL while it has no soul
  refresh_hash  BYTEA NOT NULL,     -- sha256 of the refresh token
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at    TIMESTAMPTZ NOT NULL, -- +7 days
  rotated_from  UUID,
  revoked_at    TIMESTAMPTZ,
  user_agent    TEXT,
  ip_hash       BYTEA
);
--> statement-breakpoint
CREATE TABLE alma.cardano_link_challenges (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  alma_id      TEXT NOT NULL REFERENCES alma.souls(alma_id),
  payload      TEXT NOT NULL,       -- exact text to sign (see § API)
  expires_at   TIMESTAMPTZ NOT NULL, -- +10 min
  used_at      TIMESTAMPTZ
);
--> statement-breakpoint
CREATE TABLE alma.founder_attestations (
  digest            BYTEA PRIMARY KEY,  -- EIP-712 digest
  alma_id           TEXT NOT NULL REFERENCES alma.souls(alma_id),
  owner_address     TEXT NOT NULL,
  stake_credential  BYTEA NOT NULL,     -- 28 bytes
  aldea_balance     NUMERIC(38,0) NOT NULL,
  snapshot_slot     BIGINT NOT NULL,
  nonce             BYTEA NOT NULL,     -- 32 bytes
  deadline          TIMESTAMPTZ NOT NULL,
  signature         BYTEA NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE alma.waitlist (
  alma_id    TEXT NOT NULL REFERENCES alma.souls(alma_id),
  building   TEXT NOT NULL CHECK (building IN ('npc_forge','velum_archive','soul_registry_agents')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (alma_id, building)
);
--> statement-breakpoint
CREATE INDEX souls_status_idx          ON alma.souls (status);                          -- sync of pending souls
--> statement-breakpoint
CREATE INDEX controllers_alma_idx      ON alma.controllers (alma_id) WHERE revoked_at IS NULL;
--> statement-breakpoint
CREATE INDEX bindings_alma_idx         ON alma.bindings (alma_id) WHERE revoked_at IS NULL;
--> statement-breakpoint
CREATE INDEX rel_to_type_idx           ON alma.relationships (to_alma_id, type) WHERE revoked_at IS NULL; -- members of a tribe
--> statement-breakpoint
CREATE INDEX rel_from_idx              ON alma.relationships (from_alma_id) WHERE revoked_at IS NULL;
--> statement-breakpoint
CREATE INDEX sessions_controller_idx   ON alma.sessions (controller) WHERE revoked_at IS NULL;
--> statement-breakpoint
CREATE INDEX auth_nonces_expires_idx   ON alma.auth_nonces (expires_at);                -- periodic cleanup
