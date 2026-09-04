import { describe, expect, it, vi } from 'vitest';

import { GlucoseSource } from '@/data/contracts';
import { DEXCOM_CGM_SOURCE_ID } from '@/data/import/dexcomClarityCsv';
import { GLOOKO_CGM_SOURCE_ID } from '@/data/import/glookoCsv';
import { CompositeGlucoseSource } from '@/data/live/CompositeGlucoseSource';
import { NOTIFICATION_SOURCE_ID } from '@/data/notification/types';
import { MemoryGlucoseHistoryStore } from '@/data/persistence/GlucoseHistoryStore';
import { DataSourceStatus, GlucoseReading } from '@/domain/models';

const NOW = Date.UTC(2026, 6, 26, 12);

function reading(
  sourceId: string,
  mmolL: number,
  timestamp = NOW,
): GlucoseReading {
  return {
    id: `${sourceId}:${timestamp}`,
    sourceId,
    timestamp,
    receivedAt: timestamp + 1_000,
    mmolL,
    trend: 'flat',
    quality: 'measured',
  };
}

class FakeSource implements GlucoseSource {
  refreshCalls = 0;
  statusCalls = 0;

  constructor(
    readonly sourceId: string,
    private readonly store: MemoryGlucoseHistoryStore,
    private readonly values: GlucoseReading[],
    private readonly failure?: Error,
    private readonly statusDetail?: string,
    private readonly configured?: boolean,
  ) {}

  async refresh() {
    this.refreshCalls += 1;
    if (this.failure) throw this.failure;
    await this.store.upsertReadings(this.values);
  }

  async getReadings(range: { start: number; end: number }) {
    return this.store.getReadings(range, this.sourceId);
  }

  async getLatestReading() {
    return this.store.getLatestReading(this.sourceId);
  }

  async getStatus(): Promise<DataSourceStatus> {
    this.statusCalls += 1;
    const latest = await this.getLatestReading();
    return {
      id: this.sourceId,
      label: this.sourceId,
      detail: this.statusDetail ?? this.sourceId,
      freshness: latest ? 'current' : 'missing',
      origin: 'live',
      dataThrough: latest?.timestamp,
      isLive: this.configured ?? !this.failure,
    };
  }
}

describe('composite glucose source', () => {
  it('retains provenance while preferring the first source at an exact duplicate timestamp', async () => {
    const store = new MemoryGlucoseHistoryStore();
    const preferred = new FakeSource(
      'notification',
      store,
      [reading('notification', 7.1)],
    );
    const fallback = new FakeSource(
      'cloud',
      store,
      [reading('cloud', 7.2)],
    );
    const source = new CompositeGlucoseSource(
      [preferred, fallback],
      store,
    );

    await source.refresh();
    const values = await source.getReadings({
      start: NOW - 60_000,
      end: NOW + 60_000,
    });
    expect(values).toEqual([reading('notification', 7.1)]);
    expect((await store.getBounds()).count).toBe(2);
  });

  it('continues from encrypted history when one live source fails', async () => {
    const store = new MemoryGlucoseHistoryStore();
    await store.upsertReadings([reading('cloud', 6.8)]);
    const live = new FakeSource(
      'cloud',
      store,
      [],
      new Error('temporary outage'),
    );
    const source = new CompositeGlucoseSource([live], store);

    await expect(source.getLatestReading()).resolves.toMatchObject({
      mmolL: 6.8,
    });
    expect(live.refreshCalls).toBe(0);
  });

  it('fills older gaps with Glooko history but removes a near-identical overlap', async () => {
    const store = new MemoryGlucoseHistoryStore();
    await store.upsertReadings([
      reading(GLOOKO_CGM_SOURCE_ID, 6.2, NOW - 10 * 60_000),
      reading(GLOOKO_CGM_SOURCE_ID, 7.05, NOW - 30_000),
    ]);
    const source = new CompositeGlucoseSource(
      [
        new FakeSource(
          'notification',
          store,
          [reading('notification', 7.1, NOW)],
        ),
      ],
      store,
    );

    await source.refresh();
    const values = await source.getReadings({
      start: NOW - 20 * 60_000,
      end: NOW + 60_000,
    });

    expect(values.map((value) => value.sourceId)).toEqual([
      GLOOKO_CGM_SOURCE_ID,
      'notification',
    ]);
  });

  it('keeps a nearby imported reading when the value is materially different', async () => {
    const store = new MemoryGlucoseHistoryStore();
    await store.upsertReadings([
      reading(GLOOKO_CGM_SOURCE_ID, 8.4, NOW - 30_000),
    ]);
    const source = new CompositeGlucoseSource(
      [
        new FakeSource(
          'notification',
          store,
          [reading('notification', 7.1, NOW)],
        ),
      ],
      store,
    );

    await source.refresh();
    await expect(
      source.getReadings({
        start: NOW - 60_000,
        end: NOW + 60_000,
      }),
    ).resolves.toHaveLength(2);
  });

  it('never replaces current live glucose with a newer delayed Glooko row', async () => {
    const store = new MemoryGlucoseHistoryStore();
    await store.upsertReadings([
      reading(GLOOKO_CGM_SOURCE_ID, 7.3, NOW + 60_000),
    ]);
    const source = new CompositeGlucoseSource(
      [
        new FakeSource(
          'notification',
          store,
          [reading('notification', 7.1, NOW)],
        ),
      ],
      store,
    );

    await source.refresh();
    await expect(source.getLatestReading()).resolves.toMatchObject({
      sourceId: 'notification',
      mmolL: 7.1,
    });
  });

  it('surfaces source failure through explicit refresh without network-gating an empty cache read', async () => {
    const store = new MemoryGlucoseHistoryStore();
    const source = new CompositeGlucoseSource(
      [
        new FakeSource(
          'cloud',
          store,
          [],
          new Error('temporary outage'),
        ),
      ],
      store,
    );
    await expect(source.getLatestReading()).resolves.toBeUndefined();
    await expect(source.refresh()).rejects.toThrow('temporary outage');
  });

  it('uses a source-neutral status when notification capture was never selected', async () => {
    const store = new MemoryGlucoseHistoryStore();
    const source = new CompositeGlucoseSource(
      [
        new FakeSource(
          NOTIFICATION_SOURCE_ID,
          store,
          [],
          undefined,
          'No notification source selected',
          false,
        ),
      ],
      store,
    );

    await expect(source.getStatus(NOW)).resolves.toMatchObject({
      detail: 'No glucose source connected',
      freshness: 'missing',
      isLive: false,
    });
  });

  it('labels imported Dexcom-only history without presenting it as live', async () => {
    const store = new MemoryGlucoseHistoryStore();
    await store.upsertReadings([
      reading(DEXCOM_CGM_SOURCE_ID, 6.4, NOW - 24 * 60 * 60_000),
    ]);
    const source = new CompositeGlucoseSource(
      [
        new FakeSource(
          NOTIFICATION_SOURCE_ID,
          store,
          [],
          undefined,
          'No notification source selected',
          false,
        ),
      ],
      store,
    );

    await expect(source.getStatus(NOW)).resolves.toMatchObject({
      detail: 'Historical glucose · encrypted local history',
      origin: 'imported',
      isLive: false,
    });
  });

  it('does not start a source refresh for a status-only read', async () => {
    const store = new MemoryGlucoseHistoryStore();
    const live = new FakeSource('cloud', store, []);
    const source = new CompositeGlucoseSource([live], store);

    await source.getStatus(NOW);

    expect(live.refreshCalls).toBe(0);
    expect(live.statusCalls).toBe(1);
  });

  it('reads cached glucose immediately without starting a hung source refresh', async () => {
    const store = new MemoryGlucoseHistoryStore();
    await store.upsertReadings([reading('cloud', 6.7)]);
    const never = new Promise<void>(() => {
      // Intentionally unresolved to verify cached reads remain non-blocking.
    });
    const refresh = vi.fn(() => never);
    const live: GlucoseSource = {
      sourceId: 'cloud',
      refresh,
      getReadings: (range) => store.getReadings(range, 'cloud'),
      getLatestReading: () => store.getLatestReading('cloud'),
      getStatus: async () => ({
        id: 'cloud',
        label: 'cloud',
        detail: 'cloud',
        freshness: 'current',
        origin: 'live',
        isLive: true,
      }),
    };
    const source = new CompositeGlucoseSource([live], store);

    await expect(source.getLatestReading()).resolves.toMatchObject({
      mmolL: 6.7,
    });
    await expect(
      source.getReadings({ start: NOW - 60_000, end: NOW + 60_000 }),
    ).resolves.toHaveLength(1);
    expect(refresh).not.toHaveBeenCalled();
  });

  it('does not wait for an active refresh before returning cached status', async () => {
    const store = new MemoryGlucoseHistoryStore();
    await store.upsertReadings([reading('cloud', 6.7)]);
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const live = new FakeSource('cloud', store, []);
    live.refresh = vi.fn(() => pending);
    const source = new CompositeGlucoseSource([live], store);

    const refresh = source.refresh();
    await expect(source.getStatus(NOW)).resolves.toMatchObject({
      freshness: 'current',
      dataThrough: NOW,
    });
    release();
    await refresh;
  });

  it('caches completed status and re-ages it without more source work', async () => {
    const store = new MemoryGlucoseHistoryStore();
    const getBounds = vi.spyOn(store, 'getBounds');
    const live = new FakeSource('cloud', store, [reading('cloud', 6.7)]);
    const source = new CompositeGlucoseSource([live], store);

    await source.refresh();
    const current = await source.getStatus(NOW);

    expect(current.freshness).toBe('current');
    expect(live.refreshCalls).toBe(1);
    expect(live.statusCalls).toBe(1);
    expect(getBounds).toHaveBeenCalledTimes(1);

    await expect(source.getStatus(NOW + 7 * 60_000)).resolves.toMatchObject({
      freshness: 'delayed',
    });
    expect(live.refreshCalls).toBe(1);
    expect(live.statusCalls).toBe(1);
    expect(getBounds).toHaveBeenCalledTimes(1);
  });

  it('reconciles cached status after a headless history write', async () => {
    const store = new MemoryGlucoseHistoryStore();
    const oldTimestamp = NOW - 20 * 60_000;
    await store.upsertReadings([reading('cloud', 7.2, oldTimestamp)]);
    const live = new FakeSource('cloud', store, []);
    const source = new CompositeGlucoseSource([live], store);

    await expect(source.getStatus(NOW)).resolves.toMatchObject({
      dataThrough: oldTimestamp,
      freshness: 'stale',
    });
    await store.upsertReadings([reading('cloud', 6.5, NOW)]);

    await expect(source.getStatus(NOW + 3 * 60_000)).resolves.toMatchObject({
      dataThrough: NOW,
      freshness: 'current',
    });
    expect(live.statusCalls).toBe(1);
  });
});
