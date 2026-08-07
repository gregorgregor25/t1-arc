import { beforeEach, describe, expect, it, vi } from 'vitest';

const { database, openDaymarkDatabase } = vi.hoisted(() => {
  const database = {
    getAllAsync: vi.fn(),
    getFirstAsync: vi.fn(),
  };
  return {
    database,
    openDaymarkDatabase: vi.fn(async () => database),
  };
});

vi.mock('@/data/persistence/daymarkDatabase', () => ({
  openDaymarkDatabase,
}));

import {
  HEALTH_CONNECT_SOURCE_RECORD_KINDS,
  presentHealthConnectSourceRecord,
} from '@/data/healthConnect/sourceRecordPresentation';
import {
  getHealthConnectSourceRecordPage,
  StoredHealthConnectRecord,
} from '@/data/healthConnect/sourceRecords';

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

  it('surfaces retained sleep, nutrition and cycle detail', () => {
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
        sourceRecord('menstruation_flow', { flow: 3 }),
      ).detail,
    ).toBe('Heavy flow');
  });
});
