-- ALMA Auth: the soul is the user; every way to sign in or act is a link with roles and a proof.
-- links replaces controllers (unsigned strings) and oidc_payloads replaces sessions (the OIDC provider stores
-- sessions, grants, codes and refresh tokens). custody records each soul's Turnkey sub-organization.
DROP TABLE alma.sessions;
--> statement-breakpoint
DROP TABLE alma.controllers;
--> statement-breakpoint
CREATE TABLE alma.links (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  alma_id       TEXT NOT NULL REFERENCES alma.souls(alma_id) ON DELETE CASCADE,
  kind          TEXT NOT NULL CHECK (kind IN ('passkey','email','google','apple','evm','cardano','midnight','bitcoin','lightning')),
  value         TEXT NOT NULL,  -- passkey credential id | 'hmac:<hex>' (email) | 'google:<sub>' | CAIP-10 'eip155:8453:0x…'
                                -- | 'cardano:stake:<hex28>' | 'midnight:<unshielded key hex>'
  roles         TEXT[] NOT NULL CHECK (cardinality(roles) > 0 AND roles <@ ARRAY['login','controller','holdings']),
  proof         JSONB NOT NULL, -- { "type": "webauthn" | "email_otp" | "oidc" | "caip122" | "custody", … "verifiedAt" }
  visibility    TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('public','private')),
  label         TEXT,           -- "Passkey · iPhone", "Lace"
  last_used_at  TIMESTAMPTZ,
  added_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at    TIMESTAMPTZ,
  UNIQUE (kind, value)          -- a key belongs to a single soul; it never moves on its own
);
--> statement-breakpoint
CREATE TABLE alma.passkey_credentials (
  credential_id TEXT PRIMARY KEY,                  -- base64url
  link_id       UUID NOT NULL REFERENCES alma.links(id) ON DELETE CASCADE,
  public_key    BYTEA NOT NULL,                    -- COSE
  sign_count    BIGINT NOT NULL DEFAULT 0,
  transports    TEXT[],
  backed_up     BOOLEAN NOT NULL DEFAULT false,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE alma.email_codes (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email_hmac  BYTEA NOT NULL,
  code_hash   BYTEA NOT NULL,    -- sha256 of the 6-digit code
  attempts    SMALLINT NOT NULL DEFAULT 0,
  expires_at  TIMESTAMPTZ NOT NULL, -- +10 min
  used_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE alma.oidc_clients (
  client_id          TEXT PRIMARY KEY,           -- 'aldea-world', 'velum', 'nocturna', …
  name               TEXT NOT NULL,
  redirect_uris      TEXT[] NOT NULL,
  post_logout_redirect_uris TEXT[] NOT NULL DEFAULT '{}',
  subject_type       TEXT NOT NULL DEFAULT 'public' CHECK (subject_type IN ('public','pairwise')),
  sector_identifier  TEXT,                       -- pairwise: apps in the same sector share the per-app sub
  owner_alma_id      TEXT REFERENCES alma.souls(alma_id), -- the world's org soul
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE alma.oidc_payloads (                -- storage adapter of the OIDC provider
  id          TEXT NOT NULL,
  kind        TEXT NOT NULL,                     -- Session, Grant, AuthorizationCode, RefreshToken, Interaction, …
  payload     JSONB NOT NULL,
  grant_id    TEXT,
  uid         TEXT,
  expires_at  TIMESTAMPTZ,
  consumed_at TIMESTAMPTZ,
  PRIMARY KEY (id, kind)
);
--> statement-breakpoint
CREATE TABLE alma.soul_merges (                  -- audit: two souls merged with proof of control of both
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  from_alma_id  TEXT NOT NULL REFERENCES alma.souls(alma_id),
  into_alma_id  TEXT NOT NULL REFERENCES alma.souls(alma_id),
  proofs        JSONB NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE alma.custody (                      -- the soul's keys at the custody provider (never the keys themselves)
  alma_id                TEXT PRIMARY KEY REFERENCES alma.souls(alma_id) ON DELETE CASCADE,
  provider               TEXT NOT NULL DEFAULT 'turnkey' CHECK (provider IN ('turnkey')),
  sub_organization_id    TEXT NOT NULL UNIQUE,
  wallet_id              TEXT NOT NULL,
  owner_address          TEXT NOT NULL,          -- EVM key that owns the smart account
  smart_account_address  TEXT NOT NULL UNIQUE,   -- Coinbase Smart Wallet (counterfactual until the first UserOperation)
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX links_alma_idx        ON alma.links (alma_id) WHERE revoked_at IS NULL;
--> statement-breakpoint
CREATE INDEX email_codes_hmac_idx  ON alma.email_codes (email_hmac, created_at DESC);
--> statement-breakpoint
CREATE INDEX oidc_payloads_grant   ON alma.oidc_payloads (grant_id);
--> statement-breakpoint
CREATE INDEX oidc_payloads_uid     ON alma.oidc_payloads (uid);
--> statement-breakpoint
CREATE INDEX oidc_payloads_expires ON alma.oidc_payloads (expires_at);
