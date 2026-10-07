-- The Council beyond its first sketch: where each proposal's rules were published and their hash once the guardian
-- posts them, when the snapshot was taken, and how the proposal went on-chain (queued, executed or vetoed).
ALTER TABLE council_proposals
  ADD COLUMN params_uri      TEXT NOT NULL DEFAULT '',
  ADD COLUMN params_hash     TEXT,                       -- keccak256 of the canonical JSON rules; null until they arrive
  ADD COLUMN opened_block    BIGINT NOT NULL DEFAULT 0,  -- Base block of ProposalOpened
  ADD COLUMN opened_tx       TEXT NOT NULL DEFAULT '',
  ADD COLUMN snapshot_height BIGINT,                     -- height of the Effectstream main clock at the snapshot
  ADD COLUMN tally_uri       TEXT,
  ADD COLUMN eta             BIGINT,                     -- unix seconds from which a queued result can be executed
  ADD COLUMN queued_tx       TEXT,
  ADD COLUMN executed_tx     TEXT,
  ADD COLUMN vetoed_tx       TEXT,
  ADD COLUMN vetoed_by       TEXT,
  ADD COLUMN veto_reason     TEXT;

CREATE INDEX votes_soul_idx ON council_votes (alma_id_hash); -- Charter Signatories
