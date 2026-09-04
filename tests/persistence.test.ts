import { describe, expect, it } from 'vitest';

import {
  MemoryGlucoseHistoryStore,
  SOURCE_SYNC_CLOCK_ROLLBACK_TOLERANCE_MS,
  sourceSyncAttemptDue,
} from '@/data/persistence/GlucoseHistoryStore';
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
    sourceId: 't1arc-librelinkup',
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
    expect(await store.getBounds('t1arc-librelinkup')).toMatchObject({
      earliest: timestamp,
      latest: timestamp + 300_000,
      count: 2,
    });
  });

  it('persists sync metadata independently from readings', async () => {
    const store = new MemoryGlucoseHistoryStore();
    await store.saveSyncState({
      sourceId: 't1arc-librelinkup',
      lastAttemptAt: 100,
      lastSuccessAt: 90,
      lastErrorCode: 'network',
      lastErrorMessage: 'Offline',
      recordCount: 12,
    });

    expect(await store.getSyncState('t1arc-librelinkup')).toEqual({
      sourceId: 't1arc-librelinkup',
      lastAttemptAt: 100,
      lastSuccessAt: 90,
      lastErrorCode: 'network',
      lastErrorMessage: 'Offline',
      recordCount: 12,
    });
  });

  it('atomically prunes only one source outside a closed timestamp range', async () => {
    const store = new MemoryGlucoseHistoryStore();
    const sourceId = 'nightscout';
    const minimum = 1_000;
    const maximum = 3_000;
    await store.upsertReadings([
      { ...reading(999, 5), sourceId },
      { ...reading(minimum, 5.5), sourceId },
      { ...reading(2_000, 6), sourceId },
      { ...reading(maximum, 6.5), sourceId },
      { ...reading(3_001, 7), sourceId },
      reading(4_000, 8),
    ]);
    const syncState = {
      sourceId,
      lastAttemptAt: 50,
      lastSuccessAt: 40,
      lastErrorCode: 'network',
      lastErrorMessage: 'Offline',
      recordCount: 5,
    };
    await store.saveSyncState(syncState);

    await expect(
      store.pruneReadingsOutsideRange(sourceId, minimum, maximum),
    ).resolves.toBe(2);

    await expect(store.getBounds(sourceId)).resolves.toEqual({
      earliest: minimum,
      latest: maximum,
      count: 3,
    });
    await expect(store.getBounds('t1arc-librelinkup')).resolves.toEqual({
      earliest: 4_000,
      latest: 4_000,
      count: 1,
    });
    await expect(store.getSyncState(sourceId)).resolves.toEqual(syncState);
  });

  it('claims one shared source attempt for the persisted retry interval', async () => {
    const store = new MemoryGlucoseHistoryStore();

    await expect(
      store.claimSyncAttempt('t1arc-librelinkup', 1_000, 60_000, null),
    ).resolves.toBe(true);
    const firstClaim = await store.getSyncState('t1arc-librelinkup');
    await expect(
      store.claimSyncAttempt(
        't1arc-librelinkup',
        30_000,
        60_000,
        firstClaim ?? null,
      ),
    ).resolves.toBe(false);
    await expect(
      store.claimSyncAttempt(
        't1arc-librelinkup',
        61_000,
        60_000,
        firstClaim ?? null,
      ),
    ).resolves.toBe(true);
  });

  it('does not let an older completion overwrite a newer source attempt', async () => {
    const store = new MemoryGlucoseHistoryStore();
    await store.claimSyncAttempt('t1arc-librelinkup', 100, 0, null);
    await store.completeSyncAttempt(
      {
        sourceId: 't1arc-librelinkup',
        lastAttemptAt: 100,
        lastSuccessAt: 150,
        recordCount: 1,
      },
      100,
    );
    const successfulState = await store.getSyncState('t1arc-librelinkup');
    await store.claimSyncAttempt(
      't1arc-librelinkup',
      200,
      0,
      successfulState ?? null,
    );

    await expect(
      store.completeSyncAttempt(
        {
          sourceId: 't1arc-librelinkup',
          lastAttemptAt: 100,
          lastSuccessAt: 150,
          lastErrorCode: 'network',
          lastErrorMessage: 'Old failure',
          recordCount: 1,
        },
        100,
      ),
    ).resolves.toBe(false);

    expect(await store.getSyncState('t1arc-librelinkup')).toMatchObject({
      lastAttemptAt: 200,
      lastSuccessAt: 150,
    });
    expect(
      (await store.getSyncState('t1arc-librelinkup'))?.lastErrorCode,
    ).toBeUndefined();
  });

  it('recovers from a persisted attempt invalidated by wall-clock rollback', async () => {
    const store = new MemoryGlucoseHistoryStore();
    const now = 1_000_000;
    await store.saveSyncState({
      sourceId: 't1arc-librelinkup',
      lastAttemptAt:
        now + SOURCE_SYNC_CLOCK_ROLLBACK_TOLERANCE_MS + 1,
      recordCount: 3,
    });
    const observed = await store.getSyncState('t1arc-librelinkup');

    await expect(
      store.claimSyncAttempt(
        't1arc-librelinkup',
        now,
        60_000,
        observed ?? null,
      ),
    ).resolves.toBe(true);
    expect(await store.getSyncState('t1arc-librelinkup')).toMatchObject({
      lastAttemptAt: now,
      recordCount: 3,
    });
  });

  it('distinguishes a newer claimant from an invalid future timestamp', () => {
    const now = 1_000_000;
    expect(
      sourceSyncAttemptDue(
        now + SOURCE_SYNC_CLOCK_ROLLBACK_TOLERANCE_MS,
        now,
        60_000,
      ),
    ).toBe(false);
    expect(
      sourceSyncAttemptDue(
        now + SOURCE_SYNC_CLOCK_ROLLBACK_TOLERANCE_MS + 1,
        now,
        60_000,
      ),
    ).toBe(true);
  });
});
