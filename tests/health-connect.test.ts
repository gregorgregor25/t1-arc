import { describe, expect, it } from 'vitest';

import type { HealthConnectRecord } from '../modules/daymark-health-connect';
import {
  healthConnectRecordId,
  healthConnectRecordToContext,
} from '@/data/healthConnect/healthConnectRecords';

function record(
  overrides: Partial<HealthConnectRecord> = {},
): HealthConnectRecord {
  return {
    externalId: 'external-1',
    kind: 'workout',
    sourcePackage: 'com.sec.android.app.shealth',
    startTimeMs: Date.parse('2026-07-26T07:00:00+01:00'),
    endTimeMs: Date.parse('2026-07-26T07:45:00+01:00'),
    lastModifiedTimeMs: Date.parse('2026-07-26T08:00:00+01:00'),
    recordingMethod: 2,
    clientRecordVersion: 0,
    exerciseType: 56,
    ...overrides,
  };
}

describe('Health Connect record normalisation', () => {
  it('builds a source-aware stable identifier', () => {
    expect(healthConnectRecordId(record())).toBe(
      'health-connect:workout:com.sec.android.app.shealth:external-1',
    );
  });

  it('materialises workouts as evidence-linked activity context', () => {
    const importedAt = Date.parse('2026-07-26T09:00:00+01:00');
    expect(
      healthConnectRecordToContext(
        record({ rateOfPerceivedExertion: 8 }),
        importedAt,
      ),
    ).toEqual({
      id: 'health-connect:workout:com.sec.android.app.shealth:external-1',
      sourceId: 'health-connect:com.sec.android.app.shealth',
      origin: 'imported',
      kind: 'activity',
      start: Date.parse('2026-07-26T07:00:00+01:00'),
      end: Date.parse('2026-07-26T07:45:00+01:00'),
      title: 'Running',
      activityType: 'run',
      durationMinutes: 45,
      intensity: 'vigorous',
      recordedAt: importedAt,
      sourceFile: 'Health Connect',
    });
  });

  it('keeps sleep intervals and metric weight units intact', () => {
    const importedAt = 123;
    const sleep = healthConnectRecordToContext(
      record({
        kind: 'sleep',
        title: null,
        startTimeMs: 1_000,
        endTimeMs: 28_801_000,
      }),
      importedAt,
    );
    const weight = healthConnectRecordToContext(
      record({
        kind: 'weight',
        startTimeMs: 2_000,
        endTimeMs: 2_000,
        value: 82.4,
        unit: 'kg',
      }),
      importedAt,
    );

    expect(sleep).toMatchObject({
      kind: 'sleep',
      title: 'Sleep',
      durationMinutes: 480,
    });
    expect(weight).toMatchObject({
      kind: 'weight',
      kilograms: 82.4,
      sourceId: 'health-connect:com.sec.android.app.shealth',
    });
  });

  it('does not invent timeline context for raw step samples', () => {
    expect(
      healthConnectRecordToContext(
        record({ kind: 'steps', value: 412, unit: 'count' }),
        123,
      ),
    ).toBeUndefined();
  });
});
