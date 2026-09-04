import { describe, expect, it } from 'vitest';

import {
  dexcomShareDraftFromSaved,
  normalizeDexcomShareConnection,
  resolveDexcomSharePassword,
} from '@/data/dexcomShare/connection';
import { DexcomShareGlucoseSource } from '@/data/dexcomShare/DexcomShareGlucoseSource';
import {
  DEXCOM_SHARE_SOURCE_ID,
  DexcomShareError,
} from '@/data/dexcomShare/types';
import { MemoryGlucoseHistoryStore } from '@/data/persistence/GlucoseHistoryStore';

describe('Dexcom Share connection', () => {
  it('normalises a publisher account without changing its password', () => {
    expect(
      normalizeDexcomShareConnection(
        ' publisher@example.test ',
        ' p@ss ',
        'international',
      ),
    ).toEqual({
      username: 'publisher@example.test',
      password: ' p@ss ',
      region: 'international',
    });
  });

  it('reuses a blank password only for the same normalized username and region', () => {
    const saved = normalizeDexcomShareConnection(
      'publisher@example.test',
      'protected',
      'international',
    );
    expect(
      resolveDexcomSharePassword(
        saved,
        ' publisher@example.test ',
        'international',
        '',
      ),
    ).toBe('protected');
    expect(
      resolveDexcomSharePassword(
        saved,
        'other@example.test',
        'international',
        '',
      ),
    ).toBe('');
    expect(resolveDexcomSharePassword(saved, saved.username, 'us', '')).toBe(
      '',
    );
    expect(dexcomShareDraftFromSaved(saved)).toEqual({
      username: 'publisher@example.test',
      region: 'international',
      password: '',
    });
  });

  it('authenticates through the publisher flow and imports Share readings', async () => {
    const now = Date.UTC(2026, 7, 14, 14, 0);
    const requested: { url: string; body?: string }[] = [];
    const responses = [
      new Response(JSON.stringify('account-id'), { status: 200 }),
      new Response(JSON.stringify('session-id'), { status: 200 }),
      new Response(
        JSON.stringify([
          {
            WT: `Date(${now - 5 * 60_000})`,
            DT: `Date(${now - 5 * 60_000}+0000)`,
            Value: 126,
            Trend: 'FortyFiveUp',
          },
          {
            WT: `Date(${now - 10 * 60_000})`,
            Value: 108,
            Trend: 4,
          },
        ]),
        { status: 200 },
      ),
    ];
    const fetcher = (async (
      input: string | URL | Request,
      init?: RequestInit,
    ) => {
      requested.push({ url: String(input), body: String(init?.body ?? '') });
      return responses.shift()!;
    }) as typeof fetch;
    const store = new MemoryGlucoseHistoryStore();
    const source = new DexcomShareGlucoseSource(
      {
        username: 'publisher@example.test',
        password: 'secret',
        region: 'international',
      },
      store,
      fetcher,
      () => now,
    );

    await source.refresh();

    expect(requested).toHaveLength(3);
    expect(requested[0]!.url).toContain('AuthenticatePublisherAccount');
    expect(JSON.parse(requested[0]!.body!)).toMatchObject({
      accountName: 'publisher@example.test',
      password: 'secret',
    });
    expect(requested[1]!.url).toContain('LoginPublisherAccountById');
    expect(requested[2]!.url).toContain('sessionId=session-id');
    const readings = await source.getReadings({
      start: now - 60 * 60_000,
      end: now,
    });
    expect(readings).toHaveLength(2);
    expect(readings[0]).toMatchObject({ mmolL: 6, trend: 'flat' });
    expect(readings[1]).toMatchObject({
      mmolL: 7,
      trend: 'slightUp',
      sourceId: DEXCOM_SHARE_SOURCE_ID,
    });
  });

  it('rejects the all-zero account id used for invalid credentials', async () => {
    const source = new DexcomShareGlucoseSource(
      { username: 'wrong', password: 'wrong', region: 'us' },
      new MemoryGlucoseHistoryStore(),
      (async () =>
        new Response(JSON.stringify('00000000-0000-0000-0000-000000000000'), {
          status: 200,
        })) as typeof fetch,
    );
    await expect(source.refresh()).rejects.toEqual(
      expect.objectContaining<Partial<DexcomShareError>>({
        code: 'authentication',
      }),
    );
  });
});
