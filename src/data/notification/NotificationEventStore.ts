import { SQLiteDatabase } from 'expo-sqlite';
import type { CapturedNotificationEnvelope } from '../../../modules/t1arc-notification-source';
import type { GlucoseReading, TimeRange } from '@/domain/models';

import {
  openT1ArcDatabase,
  withT1ArcTransaction,
} from '@/data/persistence/t1arcDatabase';
import {
  glucoseHistoryBoundsInTransaction,
  saveSourceSyncStateInTransaction,
  upsertGlucoseReadingsInTransaction,
} from '@/data/persistence/SqliteGlucoseHistoryStore';

import {
  isTimestampedIobEvidenceParserVersion,
  NOTIFICATION_PARSER_VERSION,
  NOTIFICATION_SOURCE_ID,
  StoredNotificationEvent,
} from './types';
import { parseCapturedNotification } from './notificationParser';
import { timestampedIobEvidenceApp } from './supportedApps';
import {
  assertNotificationSourceEpochInTransaction,
  readNotificationSourceEpoch,
} from './notificationSourceEpoch';

export const MAX_TIMESTAMPED_IOB_RECORDS = 1_000;
const NOTIFICATION_IOB_ID_QUERY_CHUNK_SIZE = 400;
const LEGACY_NOTIFICATION_OBSERVATION_ID_PREFIX = 'notification-observation:v2';
const TOKEN_NOTIFICATION_OBSERVATION_ID_PREFIX = 'notification-observation:v3';
const CAPTURE_TOKEN_PATTERN =
  /^notification-capture:v1:[A-Za-z0-9_-]{43}$/;

export interface TimestampedNotificationIob {
  id: string;
  sourceId: string;
  packageName: string;
  sourceLabel: string;
  capturedAt: number;
  iobUnits: number;
  origin: 'local' | 'restored' | 'unknown';
}

export interface TimestampedIobQueryResult {
  records: TimestampedNotificationIob[];
  truncated: boolean;
}

interface NotificationIobRow {
  id: string;
  package_name: string;
  posted_at_ms: number;
  notification_when_ms: number | null;
  received_at_ms: number;
  is_ongoing: number;
  payload_json: string;
  parser_version: number;
  parsed_iob_units: number | null;
  reconciliation_scope: string;
}

const NOTIFICATION_IOB_SELECT = `
  SELECT id, package_name, posted_at_ms, notification_when_ms,
    received_at_ms, is_ongoing, payload_json, parser_version,
    parsed_iob_units, reconciliation_scope
  FROM notification_source_events`;

export const NOTIFICATION_EVENT_UPSERT_SQL = `INSERT INTO notification_source_events (
  id, package_name, posted_at_ms, notification_when_ms,
  received_at_ms, is_ongoing, payload_json, parser_version,
  parsed_glucose_id, parsed_iob_units, parsed_pump_mode,
  imported_at_ms
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(id) DO UPDATE SET
  package_name = excluded.package_name,
  posted_at_ms = excluded.posted_at_ms,
  notification_when_ms = excluded.notification_when_ms,
  received_at_ms = excluded.received_at_ms,
  is_ongoing = excluded.is_ongoing,
  payload_json = excluded.payload_json,
  parser_version = excluded.parser_version,
  parsed_glucose_id = excluded.parsed_glucose_id,
  parsed_iob_units = excluded.parsed_iob_units,
  parsed_pump_mode = excluded.parsed_pump_mode,
  reconciliation_scope = 'local',
  imported_at_ms = excluded.imported_at_ms
WHERE notification_source_events.package_name = excluded.package_name
  AND notification_source_events.posted_at_ms = excluded.posted_at_ms
  AND notification_source_events.notification_when_ms IS excluded.notification_when_ms
  AND notification_source_events.received_at_ms = excluded.received_at_ms
  AND notification_source_events.is_ongoing = excluded.is_ongoing
  AND notification_source_events.payload_json = excluded.payload_json`;

export function notificationObservationId(
  envelope: Pick<
    CapturedNotificationEnvelope,
    'id' | 'receivedAt' | 'captureToken'
  >,
) {
  if (envelope.captureToken !== undefined) {
    if (!CAPTURE_TOKEN_PATTERN.test(envelope.captureToken)) {
      throw new Error('The native notification capture token is invalid.');
    }
    return `${TOKEN_NOTIFICATION_OBSERVATION_ID_PREFIX}:${envelope.captureToken}`;
  }
  return `${LEGACY_NOTIFICATION_OBSERVATION_ID_PREFIX}:${envelope.id}:${envelope.receivedAt}`;
}

function isSafeTimestamp(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value >= 0
  );
}

function optionalString(value: unknown) {
  return value === undefined || value === null || typeof value === 'string';
}

function stringOrUndefined(value: unknown) {
  return typeof value === 'string' ? value : undefined;
}

function parseRetainedEnvelope(value: string) {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return undefined;
    }
    const candidate = parsed as Record<string, unknown>;
    if (
      typeof candidate.id !== 'string' ||
      candidate.id.length === 0 ||
      (candidate.captureToken !== undefined &&
        (typeof candidate.captureToken !== 'string' ||
          !CAPTURE_TOKEN_PATTERN.test(candidate.captureToken))) ||
      typeof candidate.packageName !== 'string' ||
      candidate.packageName.length === 0 ||
      !isSafeTimestamp(candidate.postedAt) ||
      !isSafeTimestamp(candidate.receivedAt) ||
      (candidate.notificationWhen !== undefined &&
        candidate.notificationWhen !== null &&
        !isSafeTimestamp(candidate.notificationWhen)) ||
      typeof candidate.isOngoing !== 'boolean' ||
      !Array.isArray(candidate.textLines) ||
      !candidate.textLines.every((line) => typeof line === 'string') ||
      !optionalString(candidate.title) ||
      !optionalString(candidate.text) ||
      !optionalString(candidate.bigText) ||
      !optionalString(candidate.subText) ||
      !optionalString(candidate.infoText) ||
      !optionalString(candidate.category) ||
      !optionalString(candidate.channelId)
    ) {
      return undefined;
    }
    return {
      id: candidate.id,
      captureToken: candidate.captureToken as string | undefined,
      packageName: candidate.packageName,
      postedAt: candidate.postedAt,
      notificationWhen:
        candidate.notificationWhen === null
          ? undefined
          : candidate.notificationWhen as number | undefined,
      receivedAt: candidate.receivedAt,
      isOngoing: candidate.isOngoing,
      title: stringOrUndefined(candidate.title),
      text: stringOrUndefined(candidate.text),
      bigText: stringOrUndefined(candidate.bigText),
      subText: stringOrUndefined(candidate.subText),
      infoText: stringOrUndefined(candidate.infoText),
      textLines: candidate.textLines as string[],
      category: stringOrUndefined(candidate.category),
      channelId: stringOrUndefined(candidate.channelId),
    } satisfies CapturedNotificationEnvelope;
  } catch {
    return undefined;
  }
}

function isValidRowShape(
  row: NotificationIobRow,
): row is NotificationIobRow & {
  reconciliation_scope: TimestampedNotificationIob['origin'];
} {
  return (
    typeof row.id === 'string' &&
    typeof row.package_name === 'string' &&
    isSafeTimestamp(row.posted_at_ms) &&
    (row.notification_when_ms === null ||
      isSafeTimestamp(row.notification_when_ms)) &&
    isSafeTimestamp(row.received_at_ms) &&
    (row.is_ongoing === 0 || row.is_ongoing === 1) &&
    typeof row.payload_json === 'string' &&
    Number.isSafeInteger(row.parser_version) &&
    typeof row.parsed_iob_units === 'number' &&
    Number.isFinite(row.parsed_iob_units) &&
    row.parsed_iob_units >= 0 &&
    row.parsed_iob_units <= 100 &&
    (row.reconciliation_scope === 'local' ||
      row.reconciliation_scope === 'restored' ||
      row.reconciliation_scope === 'unknown')
  );
}

function validatedTimestampedIob(
  row: NotificationIobRow,
): TimestampedNotificationIob | undefined {
  if (!isValidRowShape(row)) return undefined;
  const envelope = parseRetainedEnvelope(row.payload_json);
  if (!envelope) return undefined;
  const expectedId = notificationObservationId(envelope);
  const isCurrentId = row.id === expectedId;
  const isLegacyId = envelope.captureToken === undefined && row.id === envelope.id;
  if (!isCurrentId && !isLegacyId) return undefined;
  if (
    envelope.packageName !== row.package_name ||
    envelope.postedAt !== row.posted_at_ms ||
    (envelope.notificationWhen ?? null) !== row.notification_when_ms ||
    envelope.receivedAt !== row.received_at_ms ||
    (envelope.isOngoing ? 1 : 0) !== row.is_ongoing ||
    !isTimestampedIobEvidenceParserVersion(row.parser_version)
  ) {
    return undefined;
  }
  const rule = timestampedIobEvidenceApp(row.package_name);
  if (!rule) return undefined;
  const reparsedIob = parseCapturedNotification(envelope, rule).pump?.iobUnits;
  if (reparsedIob === undefined || reparsedIob !== row.parsed_iob_units) {
    return undefined;
  }
  return {
    id: row.id,
    sourceId: `${NOTIFICATION_SOURCE_ID}:${row.package_name}`,
    packageName: row.package_name,
    sourceLabel: rule.displayName,
    capturedAt: row.received_at_ms,
    iobUnits: reparsedIob,
    origin: row.reconciliation_scope,
  };
}

function stableIobOrder(
  left: TimestampedNotificationIob,
  right: TimestampedNotificationIob,
) {
  return left.capturedAt - right.capturedAt || left.id.localeCompare(right.id);
}

export interface NotificationEventBounds {
  earliest?: number;
  latest?: number;
  count: number;
}

export interface NotificationDrainBatch {
  epoch: number;
  assertConfigurationCurrent: () => Promise<void>;
  events: StoredNotificationEvent[];
  readings: GlucoseReading[];
  sourceId: string;
  attemptedAt: number;
  completedAt: number;
  hasParsedGlucose: boolean;
}

export interface EmptyNotificationDrain {
  epoch: number;
  assertConfigurationCurrent: () => Promise<void>;
  sourceId: string;
  attemptedAt: number;
}

export class NotificationEventStore {
  private database?: SQLiteDatabase;

  private async getDatabase() {
    this.database ??= await openT1ArcDatabase();
    return this.database;
  }

  acquireDrainEpoch() {
    return readNotificationSourceEpoch();
  }

  private async saveInTransaction(
    transaction: SQLiteDatabase,
    events: StoredNotificationEvent[],
  ) {
    for (const event of events) {
      const { observation, importedAt } = event;
      const { envelope } = observation;
      const result = await transaction.runAsync(
        NOTIFICATION_EVENT_UPSERT_SQL,
        notificationObservationId(envelope),
        envelope.packageName,
        envelope.postedAt,
        envelope.notificationWhen ?? null,
        envelope.receivedAt,
        envelope.isOngoing ? 1 : 0,
        JSON.stringify(envelope),
        NOTIFICATION_PARSER_VERSION,
        observation.glucose?.id ?? null,
        observation.pump?.iobUnits ?? null,
        observation.pump?.mode ?? null,
        importedAt,
      );
      if (result.changes !== 1) {
        throw new Error(
          'Immutable notification observation collision; captured evidence was not acknowledged.',
        );
      }
    }
  }

  async save(events: StoredNotificationEvent[]) {
    if (events.length === 0) return;
    await this.getDatabase();
    await withT1ArcTransaction(async (transaction) => {
      await this.saveInTransaction(transaction, events);
    });
  }

  async commitDrainBatch(batch: NotificationDrainBatch) {
    await this.getDatabase();
    return withT1ArcTransaction(async (transaction) => {
      // Native configuration ownership is checked after SQLite grants the
      // writer and before any database read/write. App reconfiguration uses
      // this same writer, so neither side can pass the other after this point.
      await batch.assertConfigurationCurrent();
      // An erase/reconfiguration that advanced the durable epoch makes the
      // complete evidence/glucose/sync batch roll back.
      await assertNotificationSourceEpochInTransaction(
        transaction,
        batch.epoch,
      );
      await this.saveInTransaction(transaction, batch.events);
      await upsertGlucoseReadingsInTransaction(transaction, batch.readings);
      const bounds = await glucoseHistoryBoundsInTransaction(
        transaction,
        batch.sourceId,
      );
      await saveSourceSyncStateInTransaction(transaction, {
        sourceId: batch.sourceId,
        lastAttemptAt: batch.attemptedAt,
        lastSuccessAt: batch.completedAt,
        lastErrorCode: batch.hasParsedGlucose
          ? undefined
          : 'no-glucose-value',
        lastErrorMessage: batch.hasParsedGlucose
          ? undefined
          : 'Selected notifications were retained but contained no recognised glucose value.',
        recordCount: bounds.count,
      });
      return bounds;
    });
  }

  async commitEmptyDrain(drain: EmptyNotificationDrain) {
    await this.getDatabase();
    await withT1ArcTransaction(async (transaction) => {
      await drain.assertConfigurationCurrent();
      await assertNotificationSourceEpochInTransaction(
        transaction,
        drain.epoch,
      );
      const bounds = await glucoseHistoryBoundsInTransaction(
        transaction,
        drain.sourceId,
      );
      await transaction.runAsync(
        `INSERT INTO source_sync_state (
           source_id, last_attempt_at_ms, record_count
         ) VALUES (?, ?, ?)
         ON CONFLICT(source_id) DO UPDATE SET
           last_attempt_at_ms = excluded.last_attempt_at_ms,
           record_count = excluded.record_count`,
        drain.sourceId,
        drain.attemptedAt,
        bounds.count,
      );
    });
  }

  async getTimestampedIob(
    range: TimeRange,
  ): Promise<TimestampedIobQueryResult> {
    if (
      !isSafeTimestamp(range.start) ||
      !isSafeTimestamp(range.end) ||
      range.end <= range.start
    ) {
      return { records: [], truncated: false };
    }
    const database = await this.getDatabase();
    const rows = await database.getAllAsync<NotificationIobRow>(
      `${NOTIFICATION_IOB_SELECT}
       WHERE received_at_ms >= ? AND received_at_ms < ?
         AND parsed_iob_units IS NOT NULL
       ORDER BY received_at_ms ASC, id ASC
       LIMIT ?`,
      range.start,
      range.end,
      MAX_TIMESTAMPED_IOB_RECORDS + 1,
    );
    if (rows.length > MAX_TIMESTAMPED_IOB_RECORDS) {
      return { records: [], truncated: true };
    }
    return {
      records: rows
        .map(validatedTimestampedIob)
        .filter((record): record is TimestampedNotificationIob => Boolean(record))
        .sort(stableIobOrder),
      truncated: false,
    };
  }

  async getTimestampedIobByIds(
    ids: readonly string[],
  ): Promise<TimestampedNotificationIob[]> {
    const uniqueIds = [...new Set(ids.filter((id) => id.length > 0))];
    if (!uniqueIds.length) return [];
    const database = await this.getDatabase();
    const records = new Map<string, TimestampedNotificationIob>();
    for (
      let offset = 0;
      offset < uniqueIds.length;
      offset += NOTIFICATION_IOB_ID_QUERY_CHUNK_SIZE
    ) {
      const chunk = uniqueIds.slice(
        offset,
        offset + NOTIFICATION_IOB_ID_QUERY_CHUNK_SIZE,
      );
      const rows = await database.getAllAsync<NotificationIobRow>(
        `${NOTIFICATION_IOB_SELECT}
         WHERE id IN (${chunk.map(() => '?').join(', ')})
           AND parsed_iob_units IS NOT NULL
         ORDER BY received_at_ms ASC, id ASC`,
        ...chunk,
      );
      for (const row of rows) {
        const record = validatedTimestampedIob(row);
        if (record && !records.has(record.id)) records.set(record.id, record);
      }
    }
    return [...records.values()].sort(stableIobOrder);
  }

  async getBounds(): Promise<NotificationEventBounds> {
    const database = await this.getDatabase();
    const row = await database.getFirstAsync<{
      earliest: number | null;
      latest: number | null;
      count: number;
    }>(
      `SELECT MIN(posted_at_ms) AS earliest, MAX(posted_at_ms) AS latest,
         COUNT(*) AS count
       FROM notification_source_events`,
    );
    return {
      earliest: row?.earliest ?? undefined,
      latest: row?.latest ?? undefined,
      count: row?.count ?? 0,
    };
  }
}
