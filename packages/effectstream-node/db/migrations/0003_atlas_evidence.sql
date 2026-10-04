-- The transaction behind each Atlas row and when it happened, for the world detail's "view on-chain" and dates.
ALTER TABLE atlas_worlds   ADD COLUMN created_tx TEXT, ADD COLUMN created_ts BIGINT;
ALTER TABLE atlas_versions ADD COLUMN registered_tx TEXT, ADD COLUMN registered_ts BIGINT;
ALTER TABLE atlas_clients  ADD COLUMN registered_tx TEXT;
