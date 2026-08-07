import { describe, expect, it } from 'vitest';

import { MemoryGlucoseHistoryStore } from '@/data/persistence/GlucoseHistoryStore';
import {
  normalizeXdripConnection,
  xdripEndpointLabel,
} from '@/data/xdrip/connection';
import { XdripGlucoseSource } from '@/data/xdrip/XdripGlucoseSource';
import {
  XDRIP_SOURCE_ID,
  XdripError,
} from '@/data/xdrip/types';

describe('xDrip-compatible connection', () => {
  it('makes the same-phone setup a one-field local endpoint', () => {
    expect(normalizeXdripConnection('127.0.0.1:17580')).toEqual({
      endpointUrl: 'http://127.0.0.1:17580/sgv.json',
    });
    expect(normalizeXdripConnection('localhost')).toEqual({
      endpointUrl: 'http://localhost:17580/sgv.json',
    });
    expect(
      xdripEndpointLabel(
        normalizeXdripConnection('https://relay.example/sgv.json'),
      ),
    ).toBe('relay.example/sgv.json');
  });

  it('allows cleartext only on this phone and rejects hidden URL material', () => {
    expect(() =>
      normalizeXdripConnection('http://192.168.1.4:17580'),
    ).toThrowError(
      expect.objectContaining<Partial<XdripError>>({
        code: 'invalid-connection',
      }),
    );
    expect(() =>
      normalizeXdripConnection('https://relay.example/other.json'),
    ).toThrow(/must end in \/sgv\.json/);
    expect(() =>
      normalizeXdripConnection(
        'https://reader:secret@relay.example/sgv.json',
      ),
    ).toThrow(/username or password/);
    expect(() =>
      normalizeXdripConnection(
        'https://relay.example/sgv.json?token=secret',
      ),
    ).toThrow(/query parameters/);
  });
});

describe('xDrip-compatible glucose source', () => {
  it('accepts the GDH object response and stores normalised provenance', async () => {
    const now = Date.UTC(2026, 6, 27, 7, 0);
    const store = new MemoryGlucoseHistoryStore();
    const source = new XdripGlucoseSource(
      normalizeXdripConnection('127.0.0.1:17580'),
      store,
      (async () =>
        new Response(
          JSON.stringify({
            sgv: 126,
            direction: 'SingleDown',
            date: now - 60_000,
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        )) as typeof fetch,
      () => now,
    );

    await source.refresh();

    await expect(source.getLatestReading()).resolves.toMatchObject({
      id: `${XDRIP_SOURCE_ID}:${now - 60_000}:126`,
      mmolL: 7,
      trend: 'down',
      sourceId: XDRIP_SOURCE_ID,
      receivedAt: now,
    });
    await expect(source.getStatus(now)).resolves.toMatchObject({
      freshness: 'current',
      recordCount: 1,
      isLive: true,
      lastAttemptAt: now,
      lastUpdatedAt: now,
    });
  });

  it('bounds an array response and ignores malformed rows without inventing data', async () => {
    const now = Date.UTC(2026, 6, 27, 7, 0);
    const store = new MemoryGlucoseHistoryStore();
    const source = new XdripGlucoseSource(
      normalizeXdripConnection('https://relay.example/sgv.json'),
      store,
      (async () =>
        new Response(
          JSON.stringify([
            { sgv: 'bad', date: now - 30_000 },
            { sgv: 108, direction: 'Flat', date: now - 5 * 60_000 },
            { sgv: 117, direction: 'FortyFiveUp', date: now - 60_000 },
          ]),
          { status: 200 },
        )) as typeof fetch,
      () => now,
    );

    await source.refresh();
    await source.refresh();

    await expect(
      source.getReadings({ start: now - 10 * 60_000, end: now }),
    ).resolves.toMatchObject([
      { mmolL: 6, trend: 'flat' },
      { mmolL: 6.5, trend: 'slightUp' },
    ]);
    await expect(
      store.getBounds(XDRIP_SOURCE_ID),
    ).resolves.toMatchObject({ count: 2 });
  });

  it('records a safe error when timestamps are unusable', async () => {
    const now = Date.UTC(2026, 6, 27, 7, 0);
    const store = new MemoryGlucoseHistoryStore();
    const source = new XdripGlucoseSource(
      normalizeXdripConnection('127.0.0.1:17580'),
      store,
      (async () =>
        new Response(
          JSON.stringify({
            sgv: 108,
            direction: 'Flat',
            date: Math.floor(now / 1_000),
          }),
          { status: 200 },
        )) as typeof fetch,
      () => now,
    );

    await expect(source.refresh()).rejects.toEqual(
      expect.objectContaining<Partial<XdripError>>({
        code: 'invalid-response',
      }),
    );
    await expect(
      store.getSyncState(XDRIP_SOURCE_ID),
    ).resolves.toMatchObject({
      lastAttemptAt: now,
      lastErrorCode: 'invalid-response',
      recordCount: 0,
    });
  });

  it('rejects an advertised oversized response before parsing it', async () => {
    const store = new MemoryGlucoseHistoryStore();
    const source = new XdripGlucoseSource(
      normalizeXdripConnection('127.0.0.1:17580'),
      store,
      (async () =>
        new Response('{}', {
          status: 200,
          headers: { 'Content-Length': '1000001' },
        })) as typeof fetch,
    );

    await expect(source.refresh()).rejects.toThrow(
      /larger than T1 Arc accepts/,
    );
  });
});
