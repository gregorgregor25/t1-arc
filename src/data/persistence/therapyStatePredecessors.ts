import type { SQLiteDatabase } from 'expo-sqlite';

import {
  therapyStateEventsFromRawRecords,
  type TherapyStateEvent,
} from '@/domain/therapyStates';
import type { ImportRawRecord } from './HealthRecordStore';
import {
  THERAPY_STATE_PREDECESSOR_ELIGIBLE_SQL,
  THERAPY_STATE_PREDECESSOR_GROUP_SQL,
} from './therapyStatePredecessorIndex';

// Ongoing loop modes survive temporary overlays, so both predecessors matter.
const GROUPS = [
  { key: 'temporary-target', kind: 'temporary-target' },
  { key: 'profile-switch', kind: 'profile-switch' },
  { key: 'pump-suspend', kind: 'pump-suspend' },
  { key: 'loop-overlay', kind: 'loop-mode', ongoing: false },
  { key: 'loop-ongoing', kind: 'loop-mode', ongoing: true },
] as const;

function matches(event: TherapyStateEvent, group: (typeof GROUPS)[number]) {
  return event.kind === group.kind &&
    (!('ongoing' in group) || group.ongoing === !event.temporaryOverlay);
}

/** Keep the last valid start or end before the recent history for each route. */
export function selectTherapyStatePredecessors(records: readonly ImportRawRecord[]) {
  const byId = new Map(records.map((record) => [record.id, record]));
  const events = therapyStateEventsFromRawRecords(records)
    .sort((left, right) => right.start - left.start ||
      right.source.rawRecordId.localeCompare(left.source.rawRecordId));
  const selected = new Map<string, ImportRawRecord>();
  for (const sourceId of ['nightscout', 'aaps-local']) {
    for (const group of GROUPS) {
      const event = events.find((candidate) =>
        candidate.source.sourceId === sourceId && matches(candidate, group));
      const record = event && byId.get(event.source.rawRecordId);
      if (record) selected.set(record.id, record);
    }
  }
  return [...selected.values()];
}

interface RawRecordRow {
  id: string;
  source_id: string;
  record_kind: string;
  timestamp_ms: number;
  source_file: string;
  source_row: number;
  payload_json: string;
  last_seen_at_ms: number;
}

function fromRow(row: RawRecordRow): ImportRawRecord {
  return {
    id: row.id, sourceId: row.source_id, recordKind: row.record_kind,
    timestamp: row.timestamp_ms, sourceFile: row.source_file,
    sourceRow: row.source_row, payloadJson: row.payload_json,
    importedAt: row.last_seen_at_ms,
  };
}

/**
 * The partial state-family index narrows each search. Only the newest valid
 * predecessor is returned, even if years of treatment evidence are retained.
 * Invalid or withdrawn rows cannot hide a preceding valid state.
 */
export async function readTherapyStatePredecessors(database: SQLiteDatabase, before: number) {
  async function readPage(sourceId: string, group: string, cursorTime: number, cursorId: string) {
    return database.getAllAsync<RawRecordRow>(
      `SELECT id, source_id, record_kind, timestamp_ms, source_file,
              source_row, payload_json, last_seen_at_ms
         FROM import_raw_records
        WHERE ${THERAPY_STATE_PREDECESSOR_ELIGIBLE_SQL}
          AND source_id = ?
          AND ${THERAPY_STATE_PREDECESSOR_GROUP_SQL} = ?
          AND (timestamp_ms, id) < (?, ?)
        ORDER BY timestamp_ms DESC, id DESC LIMIT 32`,
      sourceId, group, cursorTime, cursorId,
    );
  }

  async function latestForGroups(
    sourceId: string,
    indexKey: string,
    groups: readonly (typeof GROUPS)[number][],
  ) {
    const selected = new Map<string, ImportRawRecord>();
    let cursorTime = before;
    let cursorId = '';
    for (;;) {
      const rows = await readPage(sourceId, indexKey, cursorTime, cursorId);
      const records = rows.map(fromRow);
      const events = therapyStateEventsFromRawRecords(records);
      for (const group of groups) {
        if (selected.has(group.key)) continue;
        const event = events.find((candidate) => matches(candidate, group));
        const record = event && records.find((candidate) => candidate.id === event.source.rawRecordId);
        if (record) selected.set(group.key, record);
      }
      if (rows.length < 32 || selected.size === groups.length) return [...selected.values()];
      const last = rows[rows.length - 1]!;
      cursorTime = last.timestamp_ms;
      cursorId = last.id;
    }
  }

  const result = await Promise.all(['nightscout', 'aaps-local'].flatMap((sourceId) => [
    ...GROUPS.map((group) => latestForGroups(sourceId, group.key, [group])),
    latestForGroups(sourceId, 'exceptional', GROUPS),
  ]));
  return selectTherapyStatePredecessors(result.flat());
}
