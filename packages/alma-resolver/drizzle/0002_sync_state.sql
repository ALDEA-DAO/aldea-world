-- Cursors of the syncFromEffectstream job: the last Base block already folded from each Effectstream feed.
CREATE TABLE alma.sync_state (
  key         TEXT PRIMARY KEY,           -- 'souls_anchored' | 'births_born'
  since       BIGINT NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
