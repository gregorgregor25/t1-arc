import { TABLE_SCHEMAS } from "../src/schema.js";

export function emptySnapshot() {
  return {
    schemaVersion: 1,
    timezone: "Europe/London",
    generatedAtMs: 1_787_680_800_000,
    range: {
      startMs: 1_787_594_400_000,
      endMs: 1_787_680_800_000,
    },
    tables: Object.fromEntries(Object.keys(TABLE_SCHEMAS).map((name) => [name, []])),
  };
}

export function glucoseRow(overrides = {}) {
  return {
    id: "glucose-1",
    timestamp_ms: 1_787_678_100_000,
    received_at_ms: 1_787_678_105_000,
    mmol_l: 5.9,
    trend: "flat",
    quality: "good",
    source_id: "libre",
    imported_at_ms: 1_787_678_110_000,
    local_date: "2026-08-26",
    local_time: "14:15",
    local_weekday: "Wednesday",
    ...overrides,
  };
}
