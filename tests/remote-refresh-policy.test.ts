import { describe, expect, it } from 'vitest';
import {
  REMOTE_DUE_LEAD_MS,
  REMOTE_EXPECTED_READING_MS,
  dexcomMinutesToRequest,
  dexcomShareReadWindow,
  observedReadingIntervalMs,
  remoteRefreshDue,
  remoteSourceRefreshDue,
} from '@/data/live/remoteRefreshPolicy';
import { MemoryGlucoseHistoryStore } from '@/data/persistence/GlucoseHistoryStore';
import type { GlucoseReading } from '@/domain/models';

const s = 1_000;
const m = 60_000;

describe('remote refresh policy', () => {
  it('always fetches when nothing is stored or forced', () => {
    expect(remoteRefreshDue({ now: 0 })).toBe(true);
    expect(remoteRefreshDue({ now: 10 * m, latestReadingAt: 9 * m, lastAttemptAt: 9.9 * m, force: true })).toBe(true);
  });
  it('skips while the next reading cannot exist yet', () => {
    expect(remoteRefreshDue({ now: 3 * m, latestReadingAt: 0, lastAttemptAt: 2.5 * m })).toBe(false);
  });
  it('fetches once a reading is due', () => {
    expect(remoteRefreshDue({ now: 4.6 * m, latestReadingAt: 0, lastAttemptAt: 4 * m })).toBe(true);
  });
  it('rate-limits attempts to one per 15 seconds', () => {
    expect(remoteRefreshDue({ now: 6 * m, latestReadingAt: 0, lastAttemptAt: 6 * m - 10_000 })).toBe(false);
  });

  it('never blocks the native tick 20 s after a five-minute reading is due, nor its 20 s overdue polls', () => {
    // The native first five-minute tick lands 20 s after the reading is due.
    // The due threshold opens 30 s before the reading, so it is never skipped.
    expect(REMOTE_EXPECTED_READING_MS - REMOTE_DUE_LEAD_MS).toBeLessThan(5 * m + 20 * s);
    const observedIntervalMs = 5 * m;
    expect(remoteRefreshDue({ now: 5 * m + 20 * s, latestReadingAt: 0, observedIntervalMs, lastAttemptAt: 2 * m })).toBe(true);
    for (let tick = 5 * m + 40 * s; tick < 12 * m; tick += 20 * s) {
      expect(remoteRefreshDue({ now: tick, latestReadingAt: 0, observedIntervalMs, lastAttemptAt: tick - 20 * s })).toBe(true);
    }
    // Stale sources keep the native one-minute schedule.
    expect(remoteRefreshDue({ now: 30 * m, latestReadingAt: 0, observedIntervalMs, lastAttemptAt: 29 * m })).toBe(true);
  });

  it('treats a gap longer than two and a half minutes as a five-minute source', () => {
    expect(remoteRefreshDue({ now: 2 * m, latestReadingAt: 0, observedIntervalMs: 5 * m, lastAttemptAt: 1 * m })).toBe(false);
    expect(remoteRefreshDue({ now: 2 * m, latestReadingAt: 0, observedIntervalMs: 3 * m, lastAttemptAt: 1 * m })).toBe(false);
  });

  it('keeps minute freshness for sources whose own readings are one or two minutes apart', () => {
    for (const observedIntervalMs of [60 * s, 2 * m]) {
      // A native one-minute tick is never skipped, even right after a reading.
      expect(remoteRefreshDue({ now: 20 * s, latestReadingAt: 0, observedIntervalMs, lastAttemptAt: -40 * s })).toBe(true);
      expect(remoteRefreshDue({ now: 70 * s, latestReadingAt: 0, observedIntervalMs, lastAttemptAt: 10 * s })).toBe(true);
    }
    // Duplicate triggers seconds apart still coalesce.
    expect(remoteRefreshDue({ now: 20 * s, latestReadingAt: 0, observedIntervalMs: 60 * s, lastAttemptAt: 0 })).toBe(false);
    // Once the next minute reading is due, the 15 s catch-up ticks fetch.
    expect(remoteRefreshDue({ now: 50 * s, latestReadingAt: 0, observedIntervalMs: 60 * s, lastAttemptAt: 30 * s })).toBe(true);
  });

  it('fetches when the stored reading is ahead of the phone clock', () => {
    expect(remoteRefreshDue({ now: 0, latestReadingAt: 3 * m, lastAttemptAt: -1 * m })).toBe(true);
  });

  it('derives the observed interval from the two newest readings', () => {
    expect(observedReadingIntervalMs(5 * m, 4 * m)).toBe(m);
    expect(observedReadingIntervalMs(5 * m, undefined)).toBeUndefined();
    expect(observedReadingIntervalMs(undefined, 4 * m)).toBeUndefined();
    expect(observedReadingIntervalMs(5 * m, 5 * m)).toBeUndefined();
  });

  it('asks Dexcom only for the missing window', () => {
    expect(dexcomMinutesToRequest(undefined, 0)).toBe(1440);
    expect(dexcomMinutesToRequest(0, 12 * m)).toBe(22);
    expect(dexcomMinutesToRequest(0, 3000 * m)).toBe(1440);
    // At least ten minutes are always requested so a late reading is refilled.
    expect(dexcomMinutesToRequest(5 * m, 5 * m)).toBe(10);
    expect(dexcomMinutesToRequest(6 * m, 5 * m)).toBe(10);
  });

  it('reads the full Dexcom day when forced, first connected or due for gap-filling', () => {
    const now = 100 * m;
    expect(dexcomShareReadWindow({ now, latestReadingAt: undefined })).toEqual({ minutes: 1440, maxCount: 288, full: true });
    expect(dexcomShareReadWindow({ now, latestReadingAt: now - 6 * m, lastFullWindowAt: now - 10 * m }))
      .toEqual({ minutes: 16, maxCount: 4, full: false });
    expect(dexcomShareReadWindow({ now, latestReadingAt: now - 6 * m, lastFullWindowAt: now - 10 * m, force: true }))
      .toEqual({ minutes: 1440, maxCount: 288, full: true });
    expect(dexcomShareReadWindow({ now, latestReadingAt: now - 6 * m, lastFullWindowAt: undefined }).full).toBe(true);
    expect(dexcomShareReadWindow({ now, latestReadingAt: now - 6 * m, lastFullWindowAt: now - 61 * m }).full).toBe(true);
  });
});

function reading(sourceId: string, timestamp: number): GlucoseReading {
  return {
    id: `${sourceId}:${timestamp}`,
    sourceId,
    timestamp,
    receivedAt: timestamp,
    mmolL: 6.4,
    trend: 'flat',
    quality: 'measured',
  };
}

describe('remote source refresh due check', () => {
  it('fetches when the source has no stored reading', async () => {
    const store = new MemoryGlucoseHistoryStore();
    await expect(remoteSourceRefreshDue(store, 'nightscout', 10 * m)).resolves.toBe(true);
  });

  it("uses the persisted attempt and the source's own two newest readings", async () => {
    const store = new MemoryGlucoseHistoryStore();
    await store.upsertReadings([reading('nightscout', 0), reading('nightscout', 5 * m), reading('other', 4.5 * m)]);
    await store.saveSyncState({ sourceId: 'nightscout', lastAttemptAt: 6 * m, recordCount: 2 });
    await expect(remoteSourceRefreshDue(store, 'nightscout', 7 * m)).resolves.toBe(false);
    await expect(remoteSourceRefreshDue(store, 'nightscout', 9.5 * m)).resolves.toBe(true);
    await expect(remoteSourceRefreshDue(store, 'nightscout', 7 * m, { force: true })).resolves.toBe(true);
  });

  it('keeps minute sources fetching every native one-minute tick', async () => {
    const store = new MemoryGlucoseHistoryStore();
    await store.upsertReadings([reading('xdrip-local', 4 * m), reading('xdrip-local', 5 * m)]);
    await store.saveSyncState({ sourceId: 'xdrip-local', lastAttemptAt: 4 * m + 20 * s, recordCount: 2 });
    await expect(remoteSourceRefreshDue(store, 'xdrip-local', 5 * m + 20 * s)).resolves.toBe(true);
  });

  it('lets a validated network recovery bypass the due check only after a network error', async () => {
    const store = new MemoryGlucoseHistoryStore();
    await store.upsertReadings([reading('dexcom-share', 0), reading('dexcom-share', 5 * m)]);
    await store.saveSyncState({ sourceId: 'dexcom-share', lastAttemptAt: 6 * m, recordCount: 2, lastErrorCode: 'network' });
    await expect(remoteSourceRefreshDue(store, 'dexcom-share', 6.5 * m, { reason: 'validated-network' })).resolves.toBe(true);
    await expect(remoteSourceRefreshDue(store, 'dexcom-share', 6.5 * m)).resolves.toBe(false);
    await store.saveSyncState({ sourceId: 'dexcom-share', lastAttemptAt: 6 * m, recordCount: 2, lastErrorCode: 'authentication' });
    await expect(remoteSourceRefreshDue(store, 'dexcom-share', 6.5 * m, { reason: 'validated-network' })).resolves.toBe(false);
  });
});
