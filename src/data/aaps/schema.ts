/** AAPS publishes point-in-time estimates, not insulin or carbohydrate deliveries. */
export const AAPS_STATUS_OBSERVATIONS_CREATE_SQL = `
  CREATE TABLE IF NOT EXISTS aaps_status_observations (
    id TEXT NOT NULL PRIMARY KEY,
    received_at_ms INTEGER NOT NULL CHECK (received_at_ms > 0),
    write_epoch INTEGER NOT NULL CHECK (write_epoch >= 0),
    selection_generation INTEGER NOT NULL CHECK (selection_generation >= 0),
    glucose_timestamp_ms INTEGER,
    glucose_mgdl REAL,
    trend TEXT,
    raw_trend TEXT,
    delta_mgdl REAL,
    avg_delta_mgdl REAL,
    iob_units REAL,
    bolus_iob_units REAL,
    basal_iob_units REAL,
    cob_grams REAL CHECK (cob_grams IS NULL OR cob_grams >= 0),
    future_carbs_grams REAL,
    display_units TEXT,
    reconciliation_scope TEXT NOT NULL DEFAULT 'local'
      CHECK (reconciliation_scope IN ('local', 'restored'))
  );
  CREATE INDEX IF NOT EXISTS idx_aaps_status_selection_time
    ON aaps_status_observations(selection_generation, received_at_ms DESC);
  CREATE INDEX IF NOT EXISTS idx_aaps_status_received_time
    ON aaps_status_observations(received_at_ms);
`;
