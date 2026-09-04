import { beforeEach, describe, expect, it, vi } from 'vitest';

import { loadAutomationDataEvidence } from '@/data/background/automationEvidence';

const { database, openT1ArcDatabase } = vi.hoisted(() => {
  const database = {
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

describe('automation data evidence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('reports data coverage separately from the time a worker ran', async () => {
    database.getFirstAsync.mockResolvedValue({
      glucose_data_through_ms: 1_720_000_000_000,
      glucose_last_stored_at_ms: 1_720_000_030_000,
      glucose_record_count: 576,
      glooko_data_through_ms: 1_719_990_000_000,
      glooko_last_stored_at_ms: 1_720_000_040_000,
      glooko_record_count: 4_312,
      health_data_through_ms: 1_719_999_000_000,
      health_last_stored_at_ms: 1_720_000_050_000,
      health_record_count: 8_904,
      hevy_data_through_ms: 1_719_998_000_000,
      hevy_last_stored_at_ms: 1_720_000_055_000,
      hevy_record_count: 42,
      review_data_through_ms: 1_719_900_000_000,
      review_last_stored_at_ms: 1_720_000_060_000,
      review_record_count: 6,
    });

    await expect(loadAutomationDataEvidence()).resolves.toEqual({
      glucose: {
        dataThrough: 1_720_000_000_000,
        lastStoredAt: 1_720_000_030_000,
        recordCount: 576,
      },
      glooko: {
        dataThrough: 1_719_990_000_000,
        lastStoredAt: 1_720_000_040_000,
        recordCount: 4_312,
      },
      'health-connect': {
        dataThrough: 1_719_999_000_000,
        lastStoredAt: 1_720_000_050_000,
        recordCount: 8_904,
      },
      hevy: {
        dataThrough: 1_719_998_000_000,
        lastStoredAt: 1_720_000_055_000,
        recordCount: 42,
      },
      'insight-review': {
        dataThrough: 1_719_900_000_000,
        lastStoredAt: 1_720_000_060_000,
        recordCount: 6,
      },
    });

    const sql = database.getFirstAsync.mock.calls[0]?.[0] as string;
    expect(sql).toContain('WHERE source_file IS NULL');
    expect(sql).toContain("source_id = 'glooko-export'");
    expect(sql).toContain('FROM health_connect_records');
    expect(sql).toContain('FROM hevy_workouts');
    expect(sql).toContain('FROM insight_reports');
  });

  it('returns explicit empty evidence when nothing has been stored', async () => {
    database.getFirstAsync.mockResolvedValue(undefined);

    await expect(loadAutomationDataEvidence()).resolves.toEqual({
      glucose: { recordCount: 0 },
      glooko: { recordCount: 0 },
      'health-connect': { recordCount: 0 },
      hevy: { recordCount: 0 },
      'insight-review': { recordCount: 0 },
    });
  });
});
