-- The $ALDEA UTxOs behind aldea_holdings: one row per output that ever held the asset. A spent output is marked,
-- not deleted, so replaying the event that created it cannot count it again.
CREATE TABLE aldea_utxos (
  tx_id         TEXT NOT NULL,
  output_index  INTEGER NOT NULL,
  credential    TEXT NOT NULL,            -- 'stake:<hex28>', 'pay:<hex28>' or 'addr:<address hex>'
  amount        NUMERIC(38,0) NOT NULL,   -- base units
  created_height BIGINT NOT NULL,         -- height of the Effectstream main clock
  spent_height  BIGINT,
  PRIMARY KEY (tx_id, output_index)
);
CREATE INDEX aldea_utxos_credential_idx ON aldea_utxos (credential) WHERE spent_height IS NULL;
