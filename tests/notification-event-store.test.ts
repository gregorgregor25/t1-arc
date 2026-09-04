import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CapturedNotificationEnvelope } from '../modules/t1arc-notification-source';
import {
  MAX_TIMESTAMPED_IOB_RECORDS,
  NOTIFICATION_EVENT_UPSERT_SQL,
  NotificationEventStore,
  notificationObservationId,
} from '@/data/notification/NotificationEventStore';
import { parseCapturedNotification } from '@/data/notification/notificationParser';
import { SUPPORTED_NOTIFICATION_APPS } from '@/data/notification/supportedApps';
import {
  isTimestampedIobEvidenceParserVersion,
  NOTIFICATION_PARSER_VERSION,
  TIMESTAMPED_IOB_EVIDENCE_PARSER_VERSIONS,
  type StoredNotificationEvent,
} from '@/data/notification/types';

const { database, openT1ArcDatabase, transaction, withT1ArcTransaction } =
  vi.hoisted(() => {
    const database = {
      getAllAsync: vi.fn(async (..._args: unknown[]): Promise<unknown[]> => []),
      getFirstAsync: vi.fn(async (..._args: unknown[]): Promise<unknown> => null),
    };
    const transaction = {
      getFirstAsync: vi.fn(async (..._args: unknown[]): Promise<unknown> => null),
      runAsync: vi.fn(async (..._args: unknown[]) => ({ changes: 1 })),
    };
    return {
      database,
      transaction,
      openT1ArcDatabase: vi.fn(async () => database),
      withT1ArcTransaction: vi.fn(
        async (callback: (value: typeof transaction) => Promise<void>) =>
          callback(transaction),
      ),
    };
  });

vi.mock('@/data/persistence/t1arcDatabase', () => ({
  openT1ArcDatabase,
  withT1ArcTransaction,
}));

const OMNIPOD_PACKAGE = 'com.insulet.myblue.pdm';
const GLUROO_PACKAGE = 'com.gluroo.gluroo';
const CAPTURED_AT = Date.parse('2026-08-14T18:55:00+01:00');
const CAPTURE_TOKEN_A = `notification-capture:v1:${'a'.repeat(43)}`;
const CAPTURE_TOKEN_B = `notification-capture:v1:${'b'.repeat(43)}`;

function ruleFor(packageName = OMNIPOD_PACKAGE) {
  const rule = SUPPORTED_NOTIFICATION_APPS.find(
    (candidate) => candidate.packageName === packageName,
  );
  if (!rule) throw new Error(`Missing test rule for ${packageName}`);
  return rule;
}

function envelope(
  overrides: Partial<CapturedNotificationEnvelope> = {},
): CapturedNotificationEnvelope {
  return {
    id: 'native-notification-id',
    packageName: OMNIPOD_PACKAGE,
    postedAt: CAPTURED_AT - 45_000,
    notificationWhen: CAPTURED_AT - 10 * 60_000,
    receivedAt: CAPTURED_AT,
    isOngoing: true,
    title: '7.2 mmol/L · Automated Mode',
    text: 'IOB 1.25 U',
    textLines: [],
    ...overrides,
  };
}

function stored(
  captured: CapturedNotificationEnvelope,
  importedAt = captured.receivedAt + 1_000,
): StoredNotificationEvent {
  return {
    observation: parseCapturedNotification(
      captured,
      ruleFor(captured.packageName),
    ),
    importedAt,
  };
}

function row(
  captured: CapturedNotificationEnvelope,
  overrides: Record<string, unknown> = {},
) {
  const parsed = parseCapturedNotification(
    captured,
    ruleFor(captured.packageName),
  );
  return {
    id: notificationObservationId(captured),
    package_name: captured.packageName,
    posted_at_ms: captured.postedAt,
    notification_when_ms: captured.notificationWhen ?? null,
    received_at_ms: captured.receivedAt,
    is_ongoing: captured.isOngoing ? 1 : 0,
    payload_json: JSON.stringify(captured),
    parser_version: NOTIFICATION_PARSER_VERSION,
    parsed_iob_units: parsed.pump?.iobUnits ?? null,
    reconciliation_scope: 'local',
    ...overrides,
  };
}

describe('timestamped notification IOB store', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    database.getAllAsync.mockResolvedValue([]);
    database.getFirstAsync.mockResolvedValue(null);
    transaction.getFirstAsync.mockResolvedValue(null);
    transaction.runAsync.mockResolvedValue({ changes: 1 });
  });

  it('uses an explicit historical parser-version allowlist for IOB evidence', () => {
    expect(TIMESTAMPED_IOB_EVIDENCE_PARSER_VERSIONS).toEqual([1]);
    expect(
      isTimestampedIobEvidenceParserVersion(NOTIFICATION_PARSER_VERSION),
    ).toBe(true);
    expect(
      isTimestampedIobEvidenceParserVersion(NOTIFICATION_PARSER_VERSION + 1),
    ).toBe(false);
  });

  it('acquires the durable notification epoch before a drain peeks native data', async () => {
    database.getFirstAsync.mockResolvedValue({ value: '6' });

    await expect(new NotificationEventStore().acquireDrainEpoch()).resolves.toBe(6);
    expect(database.getFirstAsync).toHaveBeenCalledWith(
      expect.stringContaining('SELECT value FROM app_metadata'),
      'notification-source-epoch-v1',
    );
  });

  it('commits evidence, glucose and sync state atomically behind the acquired epoch', async () => {
    const captured = envelope({ captureToken: CAPTURE_TOKEN_A });
    const parsed = stored(captured);
    const reading = parsed.observation.glucose!;
    transaction.getFirstAsync
      .mockResolvedValueOnce({ value: '4' })
      .mockResolvedValueOnce({ earliest: reading.timestamp, latest: reading.timestamp, count: 1 });

    await expect(
      new NotificationEventStore().commitDrainBatch({
        epoch: 4,
        assertConfigurationCurrent: async () => undefined,
        events: [parsed],
        readings: [reading],
        sourceId: 'android-notification',
        attemptedAt: CAPTURED_AT + 500,
        completedAt: CAPTURED_AT + 1_000,
        hasParsedGlucose: true,
      }),
    ).resolves.toEqual({
      earliest: reading.timestamp,
      latest: reading.timestamp,
      count: 1,
    });

    expect(withT1ArcTransaction).toHaveBeenCalledOnce();
    expect(transaction.getFirstAsync.mock.calls[0]).toEqual([
      expect.stringContaining('SELECT value FROM app_metadata'),
      'notification-source-epoch-v1',
    ]);
    const sql = transaction.runAsync.mock.calls.map(([statement]) =>
      String(statement),
    );
    expect(sql.some((statement) => statement.includes('notification_source_events'))).toBe(true);
    expect(sql.some((statement) => statement.includes('glucose_readings'))).toBe(true);
    expect(sql.some((statement) => statement.includes('source_sync_state'))).toBe(true);
  });

  it('rechecks native configuration under the writer before reading the durable epoch', async () => {
    const assertConfigurationCurrent = vi.fn(async () => undefined);
    transaction.getFirstAsync.mockResolvedValue({ value: '4' });

    await new NotificationEventStore().commitDrainBatch({
      epoch: 4,
      events: [],
      readings: [],
      sourceId: 'android-notification',
      attemptedAt: CAPTURED_AT,
      completedAt: CAPTURED_AT,
      hasParsedGlucose: false,
      assertConfigurationCurrent,
    });

    expect(assertConfigurationCurrent).toHaveBeenCalledOnce();
    expect(assertConfigurationCurrent.mock.invocationCallOrder[0]).toBeLessThan(
      transaction.getFirstAsync.mock.invocationCallOrder[0]!,
    );
  });

  it('rolls back before any database read or write when native configuration changed', async () => {
    const failure = new Error('notification configuration superseded');

    await expect(
      new NotificationEventStore().commitDrainBatch({
        epoch: 4,
        events: [],
        readings: [],
        sourceId: 'android-notification',
        attemptedAt: CAPTURED_AT,
        completedAt: CAPTURED_AT,
        hasParsedGlucose: false,
        assertConfigurationCurrent: async () => {
          throw failure;
        },
      }),
    ).rejects.toBe(failure);
    expect(transaction.getFirstAsync).not.toHaveBeenCalled();
    expect(transaction.runAsync).not.toHaveBeenCalled();
  });

  it('rolls back a superseded drain before any evidence, glucose or sync write', async () => {
    transaction.getFirstAsync.mockResolvedValue({ value: '5' });

    await expect(
      new NotificationEventStore().commitDrainBatch({
        epoch: 4,
        assertConfigurationCurrent: async () => undefined,
        events: [stored(envelope({ captureToken: CAPTURE_TOKEN_A }))],
        readings: [],
        sourceId: 'android-notification',
        attemptedAt: CAPTURED_AT,
        completedAt: CAPTURED_AT,
        hasParsedGlucose: false,
      }),
    ).rejects.toThrow(/superseded/i);
    expect(transaction.runAsync).not.toHaveBeenCalled();
  });

  it('records an empty drain only while its epoch still owns the source', async () => {
    transaction.getFirstAsync.mockResolvedValue({ value: '2' });

    await new NotificationEventStore().commitEmptyDrain({
      epoch: 2,
      assertConfigurationCurrent: async () => undefined,
      sourceId: 'android-notification',
      attemptedAt: CAPTURED_AT,
    });

    expect(transaction.runAsync).toHaveBeenCalledOnce();
    expect(String(transaction.runAsync.mock.calls[0]?.[0])).toContain(
      'source_sync_state',
    );
  });

  it('stores each capture under an immutable observation ID while retries are idempotent', async () => {
    const first = envelope({ receivedAt: CAPTURED_AT });
    const second = envelope({ receivedAt: CAPTURED_AT + 60_000 });
    const store = new NotificationEventStore();

    await store.save([stored(first), stored(second), stored(first)]);

    const calls = transaction.runAsync.mock.calls;
    expect(calls.map((call) => call[1])).toEqual([
      notificationObservationId(first),
      notificationObservationId(second),
      notificationObservationId(first),
    ]);
    expect(calls[0]?.[9]).toBe(calls[1]?.[9]);
    expect(calls[0]?.[9]).toContain(
      'android-notification:native-notification-id:v1',
    );
  });

  it('uses the content-complete native capture token for collision-safe v3 observation IDs', async () => {
    const first = envelope({
      captureToken: CAPTURE_TOKEN_A,
      text: 'IOB 1.25 U',
    });
    const changedSameNativeIdentity = envelope({
      captureToken: CAPTURE_TOKEN_B,
      text: 'IOB 2 U',
    });

    expect(notificationObservationId(first)).toBe(
      `notification-observation:v3:${CAPTURE_TOKEN_A}`,
    );
    expect(notificationObservationId(changedSameNativeIdentity)).toBe(
      `notification-observation:v3:${CAPTURE_TOKEN_B}`,
    );

    await new NotificationEventStore().save([
      stored(first),
      stored(changedSameNativeIdentity),
    ]);
    expect(transaction.runAsync.mock.calls.map((call) => call[1])).toEqual([
      notificationObservationId(first),
      notificationObservationId(changedSameNativeIdentity),
    ]);
  });

  it('validates a token-backed row against its v3 ID and rejects token substitution', async () => {
    const captured = envelope({ captureToken: CAPTURE_TOKEN_A });
    database.getAllAsync.mockResolvedValue([
      row(captured),
      row(captured, {
        id: `notification-observation:v3:${CAPTURE_TOKEN_B}`,
      }),
    ]);

    const result = await new NotificationEventStore().getTimestampedIob({
      start: CAPTURED_AT - 1,
      end: CAPTURED_AT + 1,
    });
    expect(result.records.map((record) => record.id)).toEqual([
      notificationObservationId(captured),
    ]);
  });

  it('rejects a malformed native capture token before evidence is stored', async () => {
    const captured = envelope({ captureToken: 'not-a-capture-token' });

    await expect(new NotificationEventStore().save([stored(captured)])).rejects.toThrow(
      /capture token/i,
    );
    expect(transaction.runAsync).not.toHaveBeenCalled();
  });

  it('lets an exact retry advance importedAt but rejects changed payload under the same ID in SQLite', () => {
    const sqlite = new DatabaseSync(':memory:');
    sqlite.exec(`CREATE TABLE notification_source_events (
      id TEXT PRIMARY KEY, package_name TEXT NOT NULL, posted_at_ms INTEGER NOT NULL,
      notification_when_ms INTEGER, received_at_ms INTEGER NOT NULL,
      is_ongoing INTEGER NOT NULL, payload_json TEXT NOT NULL,
      parser_version INTEGER NOT NULL, parsed_glucose_id TEXT,
      parsed_iob_units REAL, parsed_pump_mode TEXT,
      reconciliation_scope TEXT NOT NULL DEFAULT 'local' CHECK (
        reconciliation_scope IN ('local', 'restored', 'unknown')
      ), imported_at_ms INTEGER NOT NULL
    )`);
    const captured = envelope();
    const payload = JSON.stringify(captured);
    const params = (importedAt: number, payloadJson = payload) =>
      [
        notificationObservationId(captured),
        captured.packageName,
        captured.postedAt,
        captured.notificationWhen ?? null,
        captured.receivedAt,
        1,
        payloadJson,
        NOTIFICATION_PARSER_VERSION,
        'stable-glucose-id',
        1.25,
        'automated',
        importedAt,
      ] satisfies SQLInputValue[];
    const statement = sqlite.prepare(NOTIFICATION_EVENT_UPSERT_SQL);

    expect(statement.run(...params(1)).changes).toBe(1);
    expect(statement.run(...params(2)).changes).toBe(1);
    expect(
      statement.run(...params(3, JSON.stringify({ ...captured, text: 'IOB 9 U' })))
        .changes,
    ).toBe(0);
    expect(
      sqlite
        .prepare(
          'SELECT imported_at_ms, payload_json FROM notification_source_events',
        )
        .get(),
    ).toEqual({ imported_at_ms: 2, payload_json: payload });
    sqlite.close();
  });

  it.each(['restored', 'unknown'] as const)(
    'promotes an exact %s row to local only after immutable identity matches',
    (initialScope) => {
      const sqlite = new DatabaseSync(':memory:');
      sqlite.exec(`CREATE TABLE notification_source_events (
        id TEXT PRIMARY KEY, package_name TEXT NOT NULL, posted_at_ms INTEGER NOT NULL,
        notification_when_ms INTEGER, received_at_ms INTEGER NOT NULL,
        is_ongoing INTEGER NOT NULL, payload_json TEXT NOT NULL,
        parser_version INTEGER NOT NULL, parsed_glucose_id TEXT,
        parsed_iob_units REAL, parsed_pump_mode TEXT,
        reconciliation_scope TEXT NOT NULL DEFAULT 'local' CHECK (
          reconciliation_scope IN ('local', 'restored', 'unknown')
        ), imported_at_ms INTEGER NOT NULL
      )`);
      const captured = envelope();
      const payload = JSON.stringify(captured);
      const params = (payloadJson = payload) =>
        [
          notificationObservationId(captured),
          captured.packageName,
          captured.postedAt,
          captured.notificationWhen ?? null,
          captured.receivedAt,
          1,
          payloadJson,
          NOTIFICATION_PARSER_VERSION,
          'stable-glucose-id',
          1.25,
          'automated',
          CAPTURED_AT + 1_000,
        ] satisfies SQLInputValue[];
      const statement = sqlite.prepare(NOTIFICATION_EVENT_UPSERT_SQL);
      expect(statement.run(...params()).changes).toBe(1);
      sqlite
        .prepare(
          'UPDATE notification_source_events SET reconciliation_scope = ? WHERE id = ?',
        )
        .run(initialScope, notificationObservationId(captured));

      expect(statement.run(...params()).changes).toBe(1);
      expect(
        sqlite
          .prepare(
            'SELECT reconciliation_scope FROM notification_source_events WHERE id = ?',
          )
          .get(notificationObservationId(captured)),
      ).toEqual({ reconciliation_scope: 'local' });

      sqlite
        .prepare(
          'UPDATE notification_source_events SET reconciliation_scope = ? WHERE id = ?',
        )
        .run(initialScope, notificationObservationId(captured));
      expect(
        statement.run(
          ...params(JSON.stringify({ ...captured, text: 'IOB 9 U' })),
        ).changes,
      ).toBe(0);
      expect(
        sqlite
          .prepare(
            'SELECT reconciliation_scope FROM notification_source_events WHERE id = ?',
          )
          .get(notificationObservationId(captured)),
      ).toEqual({ reconciliation_scope: initialScope });
      sqlite.close();
    },
  );

  it('atomically refreshes every stored envelope and parsed column on an exact retry', async () => {
    await new NotificationEventStore().save([stored(envelope())]);
    const sql = String(transaction.runAsync.mock.calls[0]?.[0]);

    for (const column of [
      'package_name',
      'posted_at_ms',
      'notification_when_ms',
      'received_at_ms',
      'is_ongoing',
      'payload_json',
      'parser_version',
      'parsed_glucose_id',
      'parsed_iob_units',
      'parsed_pump_mode',
      'imported_at_ms',
    ]) {
      expect(sql).toContain(`${column} = excluded.${column}`);
    }
    expect(sql).toContain(
      'notification_source_events.payload_json = excluded.payload_json',
    );
  });

  it('rejects when the same derived ID is presented with different immutable content', async () => {
    const first = envelope({ text: 'IOB 1.25 U' });
    const collision = envelope({ text: 'IOB 9.5 U' });
    expect(notificationObservationId(first)).toBe(
      notificationObservationId(collision),
    );

    transaction.runAsync
      .mockResolvedValueOnce({ changes: 1 })
      .mockResolvedValueOnce({ changes: 0 });
    await expect(
      new NotificationEventStore().save([stored(first), stored(collision)]),
    ).rejects.toThrow(/immutable notification observation collision/i);

    const sql = String(transaction.runAsync.mock.calls[1]?.[0]);
    expect(sql).toContain('ON CONFLICT(id) DO UPDATE SET');
    expect(sql).toContain('WHERE');
    expect(sql).toContain(
      'notification_source_events.received_at_ms = excluded.received_at_ms',
    );
    expect(sql).toContain(
      'notification_source_events.payload_json = excluded.payload_json',
    );
  });

  it('uses a bounded half-open received-time query and never returns raw notification text', async () => {
    const before = envelope({ receivedAt: CAPTURED_AT - 1, text: 'IOB 0 U' });
    const atStart = envelope({ receivedAt: CAPTURED_AT, text: 'IOB 0 U' });
    const atEnd = envelope({ receivedAt: CAPTURED_AT + 60_000, text: 'IOB 2 U' });
    database.getAllAsync.mockResolvedValue([row(atStart)]);

    const result = await new NotificationEventStore().getTimestampedIob({
      start: CAPTURED_AT,
      end: CAPTURED_AT + 60_000,
    });

    const [sql, ...args] = database.getAllAsync.mock.calls[0]!;
    expect(String(sql)).toContain('received_at_ms >= ?');
    expect(String(sql)).toContain('received_at_ms < ?');
    expect(String(sql)).toContain('ORDER BY received_at_ms ASC, id ASC');
    expect(args).toEqual([
      CAPTURED_AT,
      CAPTURED_AT + 60_000,
      MAX_TIMESTAMPED_IOB_RECORDS + 1,
    ]);
    expect(result).toEqual({
      records: [
        {
          id: notificationObservationId(atStart),
          sourceId: `android-notification:${OMNIPOD_PACKAGE}`,
          packageName: OMNIPOD_PACKAGE,
          sourceLabel: 'Omnipod 5',
          capturedAt: CAPTURED_AT,
          iobUnits: 0,
          origin: 'local',
        },
      ],
      truncated: false,
    });
    expect(JSON.stringify(result)).not.toContain(atStart.text);
    expect(JSON.stringify(result)).not.toContain('payload');
    expect(notificationObservationId(before)).not.toBe(notificationObservationId(atStart));
    expect(notificationObservationId(atEnd)).not.toBe(notificationObservationId(atStart));
  });

  it('accepts the native bridge shape when every nullable envelope field is explicitly null', async () => {
    const nativeShaped = {
      ...envelope(),
      notificationWhen: null,
      title: null,
      text: 'IOB 1.25 U',
      bigText: null,
      subText: null,
      infoText: null,
      category: null,
      channelId: null,
    };
    const parsedEnvelope = nativeShaped as unknown as CapturedNotificationEnvelope;
    database.getAllAsync.mockResolvedValue([
      row(parsedEnvelope, {
        notification_when_ms: null,
        payload_json: JSON.stringify(nativeShaped),
      }),
    ]);

    const result = await new NotificationEventStore().getTimestampedIob({
      start: CAPTURED_AT - 1,
      end: CAPTURED_AT + 1,
    });
    expect(result.records).toHaveLength(1);
    expect(result.records[0]).toMatchObject({ iobUnits: 1.25 });
  });

  it('preserves local, restored and unknown provenance and rejects an invalid scope', async () => {
    const local = envelope({
      id: 'local',
      captureToken: CAPTURE_TOKEN_A,
      receivedAt: CAPTURED_AT,
    });
    const restored = envelope({
      id: 'restored',
      captureToken: CAPTURE_TOKEN_B,
      receivedAt: CAPTURED_AT + 1,
    });
    const unknown = envelope({
      id: 'unknown',
      receivedAt: CAPTURED_AT + 2,
    });
    database.getAllAsync.mockResolvedValue([
      row(local),
      row(restored, { reconciliation_scope: 'restored' }),
      row(unknown, { reconciliation_scope: 'unknown' }),
      row(envelope({ id: 'invalid', receivedAt: CAPTURED_AT + 3 }), {
        reconciliation_scope: 'invalid',
      }),
    ]);

    const result = await new NotificationEventStore().getTimestampedIob({
      start: CAPTURED_AT,
      end: CAPTURED_AT + 4,
    });
    expect(result.records.map(({ id, origin }) => ({ id, origin }))).toEqual([
      { id: notificationObservationId(local), origin: 'local' },
      { id: notificationObservationId(restored), origin: 'restored' },
      { id: notificationObservationId(unknown), origin: 'unknown' },
    ]);
  });

  it('accepts valid current and unmodified legacy rows but rejects ambiguous or stale-parser rows', async () => {
    const captured = envelope();
    const validCurrent = row(captured);
    const validLegacy = row(captured, { id: captured.id });
    const ambiguousLegacy = row(captured, {
      id: captured.id,
      parsed_iob_units: 3.5,
    });
    const staleParser = row(captured, {
      parser_version: NOTIFICATION_PARSER_VERSION - 1,
    });
    database.getAllAsync.mockResolvedValue([
      validCurrent,
      validLegacy,
      ambiguousLegacy,
      staleParser,
    ]);

    const result = await new NotificationEventStore().getTimestampedIob({
      start: CAPTURED_AT - 1,
      end: CAPTURED_AT + 1,
    });

    expect(result.records.map((record) => record.id)).toEqual([
      captured.id,
      notificationObservationId(captured),
    ]);
  });

  it('fails closed on unsupported, glucose-only, malformed and identity-mismatched rows', async () => {
    const valid = envelope();
    database.getAllAsync.mockResolvedValue([
      row(valid, { package_name: GLUROO_PACKAGE }),
      row(valid, { received_at_ms: valid.receivedAt + 1 }),
      row(valid, { payload_json: '{broken json' }),
      row(envelope({ packageName: 'com.dexcom.g7' })),
      row(valid, {
        package_name: 'example.unsupported',
        payload_json: JSON.stringify({
          ...valid,
          packageName: 'example.unsupported',
        }),
      }),
      row(valid, { parsed_iob_units: Number.NaN }),
      row(valid, { parsed_iob_units: -0.01 }),
      row(valid, { parsed_iob_units: 100.01 }),
    ]);

    const result = await new NotificationEventStore().getTimestampedIob({
      start: CAPTURED_AT - 1,
      end: CAPTURED_AT + 1,
    });
    expect(result.records).toEqual([]);
  });

  it.each([
    ['posted time', { posted_at_ms: CAPTURED_AT - 123 }],
    ['notification time', { notification_when_ms: null }],
    ['capture time', { received_at_ms: CAPTURED_AT + 1 }],
    ['ongoing state', { is_ongoing: 0 }],
    [
      'native ID',
      {
        payload_json: JSON.stringify(
          envelope({ id: 'different-native-notification-id' }),
        ),
      },
    ],
  ])('rejects a row whose %s disagrees with its retained payload', async (_label, mismatch) => {
    database.getAllAsync.mockResolvedValue([row(envelope(), mismatch)]);
    const result = await new NotificationEventStore().getTimestampedIob({
      start: CAPTURED_AT - 1,
      end: CAPTURED_AT + 1,
    });
    expect(result.records).toEqual([]);
  });

  it.each([
    null,
    [],
    {},
    { ...envelope(), receivedAt: Number.MAX_SAFE_INTEGER + 1 },
    { ...envelope(), postedAt: 1.5 },
    { ...envelope(), textLines: ['valid', 42] },
  ])('rejects malformed retained envelope payload %#', async (payload) => {
    database.getAllAsync.mockResolvedValue([
      row(envelope(), { payload_json: JSON.stringify(payload) }),
    ]);
    const result = await new NotificationEventStore().getTimestampedIob({
      start: CAPTURED_AT - 1,
      end: CAPTURED_AT + 1,
    });
    expect(result.records).toEqual([]);
  });

  it('fails closed rather than selecting an incomplete nearest record when a bounded read truncates', async () => {
    database.getAllAsync.mockResolvedValue(
      Array.from({ length: MAX_TIMESTAMPED_IOB_RECORDS + 1 }, (_, index) => {
        const captured = envelope({
          id: `native-${index}`,
          receivedAt: CAPTURED_AT + index,
        });
        return row(captured);
      }),
    );

    const result = await new NotificationEventStore().getTimestampedIob({
      start: CAPTURED_AT,
      end: CAPTURED_AT + 10_000,
    });
    expect(result.records).toEqual([]);
    expect(result.truncated).toBe(true);
  });

  it('chunks by-ID inspection reads and rejects an insulin-capable app that is not evidence-mature', async () => {
    const omnipod = envelope({ id: 'omnipod', receivedAt: CAPTURED_AT });
    const gluroo = envelope({
      id: 'gluroo',
      packageName: GLUROO_PACKAGE,
      receivedAt: CAPTURED_AT,
      text: 'IOB 2.5 U',
    });
    database.getAllAsync
      .mockResolvedValueOnce([row(gluroo), row(omnipod)])
      .mockResolvedValueOnce([]);
    const ids = Array.from({ length: 401 }, (_, index) => `id-${index}`);

    const records = await new NotificationEventStore().getTimestampedIobByIds(ids);

    expect(database.getAllAsync).toHaveBeenCalledTimes(2);
    expect(database.getAllAsync.mock.calls[0]).toHaveLength(401);
    expect(database.getAllAsync.mock.calls[1]).toHaveLength(2);
    expect(records.map((record) => record.sourceId)).toEqual([
      `android-notification:${OMNIPOD_PACKAGE}`,
    ]);
    expect(records.map((record) => record.iobUnits)).toEqual([1.25]);
  });

  it('deduplicates requested evidence IDs before deterministic chunked resolution', async () => {
    const captured = envelope();
    database.getAllAsync.mockResolvedValue([row(captured)]);
    const id = notificationObservationId(captured);

    const records = await new NotificationEventStore().getTimestampedIobByIds([
      id,
      id,
      '',
    ]);

    expect(database.getAllAsync).toHaveBeenCalledOnce();
    expect(database.getAllAsync.mock.calls[0]?.slice(1)).toEqual([id]);
    expect(records.map((record) => record.id)).toEqual([id]);
  });

  it('has an additive received-time index for indefinitely retained evidence', () => {
    const schema = readFileSync(
      resolve(process.cwd(), 'src/data/persistence/t1arcDatabase.ts'),
      'utf8',
    );
    expect(schema).toMatch(
      /CREATE INDEX IF NOT EXISTS idx_notification_source_received\s+ON notification_source_events\(received_at_ms, id\)/,
    );
  });

  it('migrates unclassified historical notification rows to unknown provenance', () => {
    const schema = readFileSync(
      resolve(process.cwd(), 'src/data/persistence/t1arcDatabase.ts'),
      'utf8',
    );
    expect(schema).toMatch(
      /notification_source_events[\s\S]*reconciliation_scope[\s\S]*local[\s\S]*restored[\s\S]*unknown/,
    );
    expect(schema).toMatch(
      /ensureNotificationEvidenceProvenance/,
    );
  });
});
