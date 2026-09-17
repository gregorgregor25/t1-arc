/**
 * Match the expression used by resolveAndPromoteHealthConnectRecordId exactly.
 * Without this index every imported provider record parses all retained JSON
 * for its kind/source while holding the writer. Large restored histories make
 * even a 25-record write batch delay time-sensitive glucose commits.
 *
 * Non-unique deliberately: the resolver must still detect ambiguous provider
 * identities and distinguish samples belonging to one parent record. Invalid
 * legacy JSON remains retained and is indexed as NULL, not rejected or deleted.
 */
export const HEALTH_CONNECT_IDENTITY_INDEX_SQL = `
  CREATE INDEX IF NOT EXISTS idx_health_connect_provider_identity
    ON health_connect_records (
      kind,
      source_package,
      CASE WHEN json_valid(payload_json)
        THEN TRIM(json_extract(payload_json, '$.clientRecordId'))
        ELSE NULL
      END
    );
`;
