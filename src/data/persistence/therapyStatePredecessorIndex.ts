// The guard also covers malformed JSON retained by older apps and backups.
const PAYLOAD = "CASE WHEN json_valid(payload_json) THEN payload_json ELSE '{}' END";
const JS_TRIM_CHARACTERS = 'CHAR(32, 160, 5760, 8192, 8193, 8194, 8195, 8196, 8197, 8198, 8199, 8200, 8201, 8202, 8232, 8233, 8239, 8287, 12288, 65279)';

/** Normal discriminator strings need only the domain's Unicode trim and bound. */
function treatmentText(field: string) {
  return `CASE WHEN json_type(${PAYLOAD}, '$.${field}') = 'text'
    THEN SUBSTR(TRIM(json_extract(${PAYLOAD}, '$.${field}'), ${JS_TRIM_CHARACTERS}), 1, 40) ELSE '' END`;
}

// JSON quoting exposes every ASCII control without nested SQL replacements.
// Escaped discriminator strings go through the ordinary TypeScript parser,
// including NUL, which SQLite's text trim/replace functions cannot remove.
const EVENT_TYPE = `LOWER(${treatmentText('eventType')})`;
const MODE = `UPPER(${treatmentText('mode')})`;
const REASON = `UPPER(${treatmentText('reason')})`;
const ONGOING_MODES = "'CLOSED_LOOP', 'CLOSED_LOOP_LGS', 'OPEN_LOOP', 'DISABLED_LOOP'";
const KNOWN_OVERLAYS = "'SUPER_BOLUS', 'DISCONNECTED_PUMP', 'SUSPENDED_BY_PUMP', 'SUSPENDED_BY_USER', 'SUSPENDED_BY_DST'";

function escaped(field: string) {
  const value = `json_extract(${PAYLOAD}, '$.${field}')`;
  return `(INSTR(json_quote(${value}), CHAR(92)) > 0 OR INSTR(${value}, CHAR(127)) > 0)`;
}

const HAS_ESCAPED_DISCRIMINATOR = `CASE
  WHEN INSTR(payload_json, CHAR(92)) > 0 OR INSTR(payload_json, CHAR(127)) > 0 THEN
    CASE WHEN ${escaped('eventType')} THEN 1 ELSE CASE ${EVENT_TYPE}
      WHEN 'openaps offline' THEN ${escaped('mode')} OR ${escaped('reason')}
      WHEN 'temp basal' THEN ${escaped('type')}
      WHEN 'temporary basal' THEN ${escaped('type')}
      ELSE 0 END END
  ELSE 0 END`;

/** Keep this classification aligned with therapyStateEventFromTreatment. */
export const THERAPY_STATE_PREDECESSOR_GROUP_SQL = `CASE WHEN ${HAS_ESCAPED_DISCRIMINATOR}
  THEN 'exceptional'
  ELSE CASE ${EVENT_TYPE}
  WHEN 'temporary target' THEN 'temporary-target'
  WHEN 'temporary target cancel' THEN 'temporary-target'
  WHEN 'profile switch' THEN 'profile-switch'
  WHEN 'pump suspend' THEN 'pump-suspend'
  WHEN 'pump resume' THEN 'pump-suspend'
  WHEN 'temp basal' THEN CASE
    WHEN UPPER(${treatmentText('type')}) IN ('PUMP_SUSPEND', 'EMULATED_PUMP_SUSPEND') THEN 'pump-suspend' END
  WHEN 'temporary basal' THEN CASE
    WHEN UPPER(${treatmentText('type')}) IN ('PUMP_SUSPEND', 'EMULATED_PUMP_SUSPEND') THEN 'pump-suspend' END
  WHEN 'openaps offline' THEN CASE
    WHEN ${MODE} IN (${ONGOING_MODES}) THEN 'loop-ongoing'
    WHEN (${MODE} IS NULL OR ${MODE} NOT IN (${KNOWN_OVERLAYS}))
      AND ${REASON} = 'DISABLE_LOOP' THEN 'loop-ongoing'
    ELSE 'loop-overlay'
  END
  ELSE NULL
END END`;

export const THERAPY_STATE_PREDECESSOR_ELIGIBLE_SQL = `
  source_id IN ('nightscout', 'aaps-local')
  AND record_kind IN ('nightscout-treatment', 'aaps-local-treatment')
  AND ${THERAPY_STATE_PREDECESSOR_GROUP_SQL} IS NOT NULL`;

/**
 * Only eligible therapy records occupy this index. An absent state is an
 * empty index seek rather than another scan of ordinary bolus/carb history.
 * Every raw payload and the portable-backup table layout remain intact.
 */
export const THERAPY_STATE_PREDECESSOR_INDEX_SQL = `
  CREATE INDEX IF NOT EXISTS idx_import_raw_therapy_predecessor
    ON import_raw_records (
      source_id, ${THERAPY_STATE_PREDECESSOR_GROUP_SQL}, timestamp_ms DESC, id DESC
    )
    WHERE ${THERAPY_STATE_PREDECESSOR_ELIGIBLE_SQL};
`;
