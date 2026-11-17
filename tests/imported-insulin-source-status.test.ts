import { describe, expect, it, vi } from 'vitest';

import { ImportedInsulinSource } from '@/data/live/ImportedInsulinSource';
import type { HealthRecordStore } from '@/data/persistence/HealthRecordStore';
import { LocalDataWriteSupersededError } from '@/data/privacy/localDataWriteEpoch';
import { NightscoutError } from '@/data/nightscout/types';

vi.mock('@/data/persistence/SqliteHealthRecordStore', () => ({
  SqliteHealthRecordStore: class {},
}));

const NOW = Date.UTC(2030, 4, 14, 10);
const HOUR = 60 * 60 * 1000;

function fakeStore(bounds: { count: number; latest?: number; earliest?: number }) {
  return {
    getInsulinBounds: vi.fn(async () => bounds),
    getManualInsulinBounds: vi.fn(async () => ({ count: 0 })),
    getLatestImport: vi.fn(async (sourceId: string) =>
      sourceId === 'nightscout'
        ? { id: 'batch-1', sourceId, importedAt: NOW - HOUR, recordCount: bounds.count }
        : undefined,
    ),
  } as unknown as HealthRecordStore;
}

function importer(refresh: () => Promise<unknown>) {
  return { label: 'Nightscout', capabilities: [], refresh };
}

describe('insulin source status', () => {
  it('keeps glucose unblocked when treatments fail, and shows the failure', async () => {
    const live = importer(() =>
      Promise.reject(
        new NightscoutError('authentication', 'Rejected with private details.'),
      ),
    );
    const source = new ImportedInsulinSource(
      fakeStore({ count: 3, latest: NOW - HOUR }),
      live,
      [],
      () => NOW,
    );
    await expect(source.refresh()).resolves.toBeUndefined();
    const status = await source.getStatus(NOW);
    expect(status.errorCode).toBe('authentication');
    expect(status.lastAttemptAt).toBe(NOW);
    expect(status.detail).toBe(
      'Nightscout treatments could not be read. Check that the token allows reading treatments. Glucose is not affected.',
    );
    expect(status.detail).not.toContain('private details');
  });

  it('uses a general message for other failures and clears it after a success', async () => {
    let fail = true;
    const live = importer(async () => {
      if (fail) throw new Error('socket closed');
      return undefined;
    });
    const source = new ImportedInsulinSource(
      fakeStore({ count: 0 }),
      live,
      [],
      () => NOW,
    );
    await source.refresh();
    const failed = await source.getStatus(NOW);
    expect(failed.errorCode).toBe('unknown');
    expect(failed.detail).toBe(
      'Nightscout treatments could not be read at the last check. Glucose is not affected.',
    );
    fail = false;
    await source.refresh();
    const recovered = await source.getStatus(NOW);
    expect(recovered.errorCode).toBeUndefined();
    expect(recovered.detail).toBe(
      'Nightscout connected; no insulin treatments supplied yet',
    );
  });

  it('still stops when a privacy erase superseded the pass', async () => {
    const source = new ImportedInsulinSource(
      fakeStore({ count: 0 }),
      importer(() => Promise.reject(new LocalDataWriteSupersededError())),
      [],
      () => NOW,
    );
    await expect(source.refresh()).rejects.toBeInstanceOf(
      LocalDataWriteSupersededError,
    );
  });

  it('never shows records through a time later than now', async () => {
    const running = new ImportedInsulinSource(
      fakeStore({ count: 2, latest: NOW + 2 * HOUR }),
      importer(async () => undefined),
      [],
      () => NOW,
    );
    expect((await running.getStatus(NOW)).dataThrough).toBe(NOW);

    const past = new ImportedInsulinSource(
      fakeStore({ count: 2, latest: NOW - 5 * HOUR }),
      importer(async () => undefined),
      [],
      () => NOW,
    );
    expect((await past.getStatus(NOW)).dataThrough).toBe(NOW - 5 * HOUR);
  });

  it('leaves the no-records status unchanged', async () => {
    const status = await new ImportedInsulinSource(
      fakeStore({ count: 0 }),
      importer(async () => undefined),
      [],
      () => NOW,
    ).getStatus(NOW);
    expect(status.dataThrough).toBeUndefined();
    expect(status.freshness).toBe('missing');
  });
  it('reports where stored insulin history starts', async () => {
    const source = new ImportedInsulinSource(
      fakeStore({ count: 3, earliest: NOW - 48 * HOUR, latest: NOW - HOUR }),
      undefined,
      [],
      () => NOW,
    );
    expect((await source.getStatus(NOW)).dataFrom).toBe(NOW - 48 * HOUR);
    const empty = new ImportedInsulinSource(fakeStore({ count: 0 }), undefined, [], () => NOW);
    expect((await empty.getStatus(NOW)).dataFrom).toBeUndefined();
  });
});
