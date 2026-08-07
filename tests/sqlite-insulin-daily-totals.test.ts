import { beforeEach, describe, expect, it, vi } from 'vitest';

import { zonedDateTimeToTimestamp } from '@/domain/time';

const { database, openDaymarkDatabase } = vi.hoisted(() => {
  const database = {
    getAllAsync: vi.fn(),
  };
  return {
    database,
    openDaymarkDatabase: vi.fn(async () => database),
  };
});

vi.mock('@/data/persistence/daymarkDatabase', () => ({
  openDaymarkDatabase,
  withDaymarkTransaction: vi.fn(),
}));

import { SqliteHealthRecordStore } from '@/data/persistence/SqliteHealthRecordStore';

describe('SQLite insulin daily-total queries', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    database.getAllAsync.mockResolvedValue([]);
  });

  it('loads a whole-day source total by date key for a partial-day range', async () => {
    const sourceTimestamp = zonedDateTimeToTimestamp('2026-08-06', 23, 59);
    database.getAllAsync.mockResolvedValue([
      {
        id: 'daily-total:2026-08-06',
        source_id: 'glooko-export',
        timestamp_ms: sourceTimestamp,
        date_key: '2026-08-06',
        basal_units: 16.8,
        bolus_units: 23.2,
        total_units: 40,
        imported_at_ms: zonedDateTimeToTimestamp('2026-08-07', 8),
        source_file: 'insulin_data.csv',
        source_row: 2,
        source_device_id: 'pdm-a',
      },
    ]);
    const store = new SqliteHealthRecordStore();
    const totals = await store.getDailyInsulinTotals({
      start: zonedDateTimeToTimestamp('2026-08-06'),
      end: zonedDateTimeToTimestamp('2026-08-06', 12),
    });

    expect(database.getAllAsync).toHaveBeenCalledWith(
      expect.stringContaining('WHERE date_key >= ? AND date_key <= ?'),
      '2026-08-06',
      '2026-08-06',
    );
    expect(totals).toEqual([
      {
        id: 'daily-total:2026-08-06',
        sourceId: 'glooko-export',
        timestamp: sourceTimestamp,
        dateKey: '2026-08-06',
        basalUnits: 16.8,
        bolusUnits: 23.2,
        totalUnits: 40,
        importedAt: zonedDateTimeToTimestamp('2026-08-07', 8),
        sourceFile: 'insulin_data.csv',
        sourceRow: 2,
        sourceDeviceId: 'pdm-a',
      },
    ]);
  });
});
