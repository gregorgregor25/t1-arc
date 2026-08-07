import { describe, expect, it } from 'vitest';

import {
  normalizeNightscoutConnection,
} from '@/data/nightscout/connection';
import { NightscoutGlucoseSource } from '@/data/nightscout/NightscoutGlucoseSource';
import {
  NIGHTSCOUT_SOURCE_ID,
  NightscoutError,
} from '@/data/nightscout/types';
import { MemoryGlucoseHistoryStore } from '@/data/persistence/GlucoseHistoryStore';

describe('Nightscout connection', () => {
  it('extracts a pasted read token and removes it from the saved site URL', () => {
    expect(
      normalizeNightscoutConnection(
        ' https://example-nightscout.test/?token=reader-a1b2c3#ignored ',
      ),
    ).toEqual({
      baseUrl: 'https://example-nightscout.test',
      accessToken: 'reader-a1b2c3',
    });
  });

  it('refuses cleartext sites so tokens and readings are not exposed', () => {
    expect(() =>
      normalizeNightscoutConnection('http://example.test', 'reader'),
    ).toThrowError(
      expect.objectContaining({
        code: 'invalid-connection',
      }),
    );
  });
});

describe('Nightscout glucose source', () => {
  it('normalises SGV history, protects the token in query encoding and deduplicates refreshes', async () => {
    const now = Date.UTC(2026, 6, 27, 5, 0);
    const requested: string[] = [];
    const fetcher = (async (input: string | URL | Request) => {
      requested.push(String(input));
      return new Response(
        JSON.stringify([
          {
            _id: 'entry-2',
            sgv: 126,
            direction: 'FortyFiveUp',
            date: now - 5 * 60_000,
            dateString: '2026-07-27T04:55:00.000Z',
            device: 'nightscout-fixture',
          },
          {
            _id: 'entry-1',
            sgv: 108,
            direction: 'Flat',
            date: now - 10 * 60_000,
          },
        ]),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      );
    }) as typeof fetch;
    const store = new MemoryGlucoseHistoryStore();
    const source = new NightscoutGlucoseSource(
      {
        baseUrl: 'https://example.test',
        accessToken: 'reader + private',
      },
      store,
      fetcher,
      () => now,
    );

    await source.importInitialHistory(14);
    await source.importHistoryRange(
      now - 28 * 86_400_000,
      now - 14 * 86_400_000,
    );
    await source.refresh();

    expect(requested[0]).toContain(
      'token=reader%20%2B%20private',
    );
    expect(requested[0]).toContain('find%5Bdate%5D%5B%24gte%5D=');
    expect(requested[1]).toContain('find%5Bdate%5D%5B%24gte%5D=');
    expect(requested[1]).toContain('find%5Bdate%5D%5B%24lt%5D=');
    expect(requested[2]).not.toContain('find%5Bdate%5D');
    const readings = await source.getReadings({
      start: now - 60 * 60_000,
      end: now,
    });
    expect(readings).toHaveLength(2);
    expect(readings[0]).toMatchObject({
      mmolL: 6,
      trend: 'flat',
      sourceId: NIGHTSCOUT_SOURCE_ID,
    });
    expect(readings[1]).toMatchObject({
      id: `${NIGHTSCOUT_SOURCE_ID}:entry-2`,
      mmolL: 7,
      trend: 'slightUp',
      sourceId: NIGHTSCOUT_SOURCE_ID,
      sourceFactoryTimestamp: '2026-07-27T04:55:00.000Z',
      sourceDeviceId: 'nightscout-fixture',
    });
    await expect(source.getStatus(now)).resolves.toMatchObject({
      freshness: 'current',
      isLive: true,
      recordCount: 2,
    });
  });

  it('reports authentication failure without storing a reading', async () => {
    const now = Date.UTC(2026, 6, 27, 5, 0);
    const store = new MemoryGlucoseHistoryStore();
    const source = new NightscoutGlucoseSource(
      {
        baseUrl: 'https://secure.example.test',
        accessToken: 'wrong-token',
      },
      store,
      (async () => new Response('', { status: 401 })) as typeof fetch,
      () => now,
    );

    await expect(source.refresh()).rejects.toEqual(
      expect.objectContaining<Partial<NightscoutError>>({
        code: 'authentication',
      }),
    );
    await expect(
      store.getSyncState(NIGHTSCOUT_SOURCE_ID),
    ).resolves.toMatchObject({
      lastAttemptAt: now,
      lastErrorCode: 'authentication',
      recordCount: 0,
    });
  });
});
