-- A visit ends when the character leaves (BuildingLeft) or enters another building (enterBuilding overwrites the
-- on-chain Location without a BuildingLeft). left_tx/left_log_index make each exit apply once on replay.
ALTER TABLE building_visits ADD COLUMN left_ts BIGINT;
ALTER TABLE building_visits ADD COLUMN left_tx TEXT;
ALTER TABLE building_visits ADD COLUMN left_log_index INTEGER;
CREATE INDEX visits_open_idx ON building_visits (character_id) WHERE left_ts IS NULL;
