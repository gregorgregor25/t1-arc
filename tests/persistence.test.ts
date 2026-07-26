import { describe, expect, it } from 'vitest';

import { MemoryGlucoseHistoryStore } from '@/data/persistence/GlucoseHistoryStore';
import { GlucoseReading } from '@/domain/models';

function reading(
  timestamp: number,
  mmolL: number,
  id = `reading:${timestamp}:${mmolL}`,
  receivedAt = timestamp + 10_000,
): GlucoseReading {
  return {
    id,
    timestamp,
    receivedAt,
    mmolL,
    trend: 'flat',
    quality: 'measured',
    sourceId: 'daymark-librelinkup',
  };
}

describe('glucose history store contract', () => {
  it('deduplicates by source and timestamp while retaining the newest value', async () => {
    const store = new MemoryGlucoseHistoryStore();
    const timestamp = Date.parse('2026-07-26T08:00:00+01:00');
    await store.upsertReadings([
      reading(timestamp, 6.1),
      reading(timestamp + 300_000, 6.4),
    ]);
    await store.upsertReadings([
      reading(timestamp, 6.2, 'corrected', timestamp + 70_000),
    ]);

    const values = await store.getReadings({
      start: timestamp - 1,
      end: timestamp + 600_000,
    });

    expect(values).toHaveLength(2);
    expect(values[0]).toMatchObject({
      id: 'corrected',
      mmolL: 6.2,
      receivedAt: timestamp + 10_000,
    });
    expect(await store.getBounds('daymark-librelinkup')).toMatchObject({
      earliest: timestamp,
      latest: timestamp + 300_000,
      count: 2,
    });
  });

  it('persists sync metadata independently from readings', async () => {
    const store = new MemoryGlucoseHistoryStore();
    await store.saveSyncState({
      sourceId: 'daymark-librelinkup',
      lastAttemptAt: 100,
      lastSuccessAt: 90,
      lastErrorCode: 'network',
      lastErrorMessage: 'Offline',
      recordCount: 12,
    });

    expect(await store.getSyncState('daymark-librelinkup')).toEqual({
      sourceId: 'daymark-librelinkup',
      lastAttemptAt: 100,
      lastSuccessAt: 90,
      lastErrorCode: 'network',
      lastErrorMessage: 'Offline',
      recordCount: 12,
    });
  });
});
