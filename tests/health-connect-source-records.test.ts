import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  HEALTH_CONNECT_SOURCE_RECORD_KINDS,
  presentHealthConnectSourceRecord,
} from '@/data/healthConnect/sourceRecordPresentation';
import {
  getHealthConnectSourceRecordPage,
  StoredHealthConnectRecord,
} from '@/data/healthConnect/sourceRecords';
import {
  getRuntimeRegionalProfile,
  setRuntimeRegionalProfile,
} from '@/domain/regionalProfileRuntime';

const { database, openT1ArcDatabase } = vi.hoisted(() => {
  const database = {
    getAllAsync: vi.fn(),
    getFirstAsync: vi.fn(),
  };
  return {
    database,
    openT1ArcDatabase: vi.fn(async () => database),
  };
});

vi.mock('@/data/persistence/t1arcDatabase', () => ({
  openT1ArcDatabase,
}));

const NOW = Date.UTC(2026, 6, 28, 10);

function sourceRecord(
  kind: StoredHealthConnectRecord['kind'],
  overrides: Partial<StoredHealthConnectRecord> = {},
): StoredHealthConnectRecord {
  return {
    id: `health-connect:${kind}:source:record`,
    externalId: 'record',
    kind,
    sourcePackage: 'com.example.health',
    sourceLabel: 'Example Health',
    startTimeMs: NOW,
    endTimeMs: NOW,
    lastModifiedTimeMs: NOW,
    recordingMethod: 2,
    clientRecordVersion: 1,
    importedAt: NOW,
    rawPayloadJson: '{}',
    ...overrides,
  };
}

describe('complete Health Connect source records', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    database.getAllAsync.mockResolvedValue([]);
    database.getFirstAsync.mockResolvedValue({ total: 0 });
  });

  it('loads every stored kind without a metric-only filter', async () => {
    database.getAllAsync.mockResolvedValue([
      {
        id: 'health-connect:sleep:source:sleep-1',
        external_id: 'sleep-1',
        parent_external_id: null,
        kind: 'sleep',
        source_package: 'com.samsung.android.wear.shealth',
        display_name: 'Samsung Health',
        start_ms: NOW - 8 * 60 * 60 * 1000,
        end_ms: NOW,
        last_modified_ms: NOW,
        recording_method: 2,
        value: null,
        unit: null,
        payload_json: JSON.stringify({
          externalId: 'sleep-1',
          kind: 'sleep',
          sourcePackage: 'com.samsung.android.wear.shealth',
          startTimeMs: NOW - 8 * 60 * 60 * 1000,
          endTimeMs: NOW,
          lastModifiedTimeMs: NOW,
          recordingMethod: 2,
          clientRecordVersion: 3,
          title: 'Night sleep',
          stages: [
            {
              startTimeMs: NOW - 8 * 60 * 60 * 1000,
              endTimeMs: NOW,
              stageType: 4,
            },
          ],
        }),
        imported_at_ms: NOW + 1_000,
      },
    ]);
    database.getFirstAsync.mockResolvedValue({ total: 1 });

    const page = await getHealthConnectSourceRecordPage(
      {
        start: NOW - 24 * 60 * 60 * 1000,
        end: NOW + 1,
      },
      80,
      0,
    );

    expect(database.getAllAsync.mock.calls[0]?.[0]).not.toContain(
      'kind IN',
    );
    expect(page.totalRecords).toBe(1);
    expect(page.records).toEqual([
      expect.objectContaining({
        kind: 'sleep',
        sourceLabel: 'Samsung Health',
        title: 'Night sleep',
        clientRecordVersion: 3,
        stages: [expect.objectContaining({ stageType: 4 })],
        importedAt: NOW + 1_000,
      }),
    ]);
  });

  it('normalises nullable Android nutrition fields before presentation', async () => {
    database.getAllAsync.mockResolvedValue([
      {
        id: 'health-connect:nutrition:source:meal-1',
        external_id: 'meal-1',
        parent_external_id: null,
        kind: 'nutrition',
        source_package: 'com.example.health',
        display_name: 'Example Health',
        start_ms: NOW,
        end_ms: NOW + 1_000,
        last_modified_ms: NOW,
        recording_method: 2,
        value: null,
        unit: 'g',
        payload_json: JSON.stringify({
          externalId: 'meal-1',
          kind: 'nutrition',
          sourcePackage: 'com.example.health',
          startTimeMs: NOW,
          endTimeMs: NOW + 1_000,
          lastModifiedTimeMs: NOW,
          recordingMethod: 2,
          clientRecordVersion: 1,
          title: 'Meal summary',
          energyKcal: null,
          proteinGrams: 12,
          fatGrams: null,
          fibreGrams: null,
          sugarGrams: null,
          saturatedFatGrams: null,
        }),
        imported_at_ms: NOW + 2_000,
      },
    ]);
    database.getFirstAsync.mockResolvedValue({ total: 1 });

    const page = await getHealthConnectSourceRecordPage(
      { start: NOW - 1, end: NOW + 2_000 },
      80,
      0,
    );

    expect(page.records[0]).toMatchObject({
      value: undefined,
      energyKcal: undefined,
      proteinGrams: 12,
      fatGrams: undefined,
    });
    expect(presentHealthConnectSourceRecord(page.records[0]!).detail).toBe(
      '12 g protein',
    );
  });

  it('fails safely when a runtime nutrition payload still contains null', () => {
    const record = sourceRecord('nutrition', {
      value: null as never,
      energyKcal: null as never,
      proteinGrams: 12,
      fatGrams: null as never,
    });

    expect(() => presentHealthConnectSourceRecord(record)).not.toThrow();
    expect(presentHealthConnectSourceRecord(record).detail).toBe(
      '12 g protein',
    );
  });

  it('has a readable presentation for every supported record kind', () => {
    expect(HEALTH_CONNECT_SOURCE_RECORD_KINDS).toHaveLength(37);
    for (const kind of HEALTH_CONNECT_SOURCE_RECORD_KINDS) {
      const presentation = presentHealthConnectSourceRecord(
        sourceRecord(kind, { value: 6.4, unit: 'mmol/L' }),
      );
      expect(presentation.title.length, kind).toBeGreaterThan(0);
      expect(presentation.group.length, kind).toBeGreaterThan(0);
    }
  });

  it('surfaces retained workout, sleep, nutrition and cycle detail', () => {
    expect(
      presentHealthConnectSourceRecord(
        sourceRecord('workout', {
          startTimeMs: NOW - 45 * 60 * 1000,
          title: 'Strength session',
          segmentsCount: 2,
          lapsCount: 1,
          segments: [
            {
              startTimeMs: NOW - 45 * 60 * 1000,
              endTimeMs: NOW - 30 * 60 * 1000,
              segmentType: 1,
              repetitions: 12,
            },
            {
              startTimeMs: NOW - 25 * 60 * 1000,
              endTimeMs: NOW - 10 * 60 * 1000,
              segmentType: 1,
              repetitions: 10,
            },
          ],
        }),
      ).detail,
    ).toBe('45 min · 2 segments · 22 reps retained · 1 lap');
    expect(
      presentHealthConnectSourceRecord(
        sourceRecord('sleep', {
          startTimeMs: NOW - 7.5 * 60 * 60 * 1000,
          stages: [
            {
              startTimeMs: NOW - 1_000,
              endTimeMs: NOW,
              stageType: 4,
            },
          ],
        }),
      ).detail,
    ).toContain('7 hr 30 min');
    expect(
      presentHealthConnectSourceRecord(
        sourceRecord('nutrition', {
          value: 42.5,
          energyKcal: 510,
          proteinGrams: 18,
        }),
      ).detail,
    ).toBe('42.5 g carbohydrate · 510 kcal · 18 g protein');
    expect(
      presentHealthConnectSourceRecord(
        sourceRecord('nutrition', {
          value: undefined,
          energyKcal: 430,
          proteinGrams: 31,
          fatGrams: 16,
          fibreGrams: 7,
          sugarGrams: 5,
          saturatedFatGrams: 3,
        }),
      ).detail,
    ).toBe(
      '430 kcal · 31 g protein · 16 g fat · 7 g fibre · 5 g sugars · 3 g saturated fat',
    );
    expect(
      presentHealthConnectSourceRecord(
        sourceRecord('menstruation_flow', { flow: 3 }),
      ).detail,
    ).toBe('Heavy flow');
  });

  it('uses the selected locale for duration and retained-record counts', () => {
    const previousProfile = getRuntimeRegionalProfile();
    setRuntimeRegionalProfile({
      ...previousProfile,
      languageTag: 'ar-EG',
    });
    try {
      expect(
        presentHealthConnectSourceRecord(
          sourceRecord('workout', {
            startTimeMs: NOW - 61 * 60 * 1000,
            segmentsCount: 1_200,
            lapsCount: 1_201,
            rateOfPerceivedExertion: 7.5,
            segments: [
              {
                startTimeMs: NOW - 61 * 60 * 1000,
                endTimeMs: NOW,
                segmentType: 1,
                repetitions: 1_234,
              },
            ],
          }),
        ).detail,
      ).toBe(
        '١ hr ١ min · RPE ٧٫٥ · ١٬٢٠٠ segments · ١٬٢٣٤ reps retained · ١٬٢٠١ laps',
      );
    } finally {
      setRuntimeRegionalProfile(previousProfile);
    }
  });
});
