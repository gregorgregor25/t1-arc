import { describe, expect, it } from 'vitest';

import {
  NIGHTSCOUT_IOB_COB_MAX_AGE_MS,
  normalizeNightscoutPebbleIobCob,
} from '@/data/nightscout/iobCobSnapshot';

const NOW = Date.UTC(2026, 7, 19, 1, 0);

describe('Nightscout Pebble IOB and COB snapshot', () => {
  it('uses the upstream bgs datetime as the snapshot as-of time', () => {
    const timestamp = NOW - 2 * 60_000;
    expect(
      normalizeNightscoutPebbleIobCob(
        { bgs: [{ iob: '1.25', cob: '9', datetime: timestamp }] },
        NOW,
      ),
    ).toEqual({ iobUnits: 1.25, cobGrams: 9, timestamp });
  });

  it('fails closed when the upstream timestamp is missing or invalid', () => {
    expect(
      normalizeNightscoutPebbleIobCob({ bgs: [{ iob: 1.25, cob: 9 }] }, NOW),
    ).toBeUndefined();
    expect(
      normalizeNightscoutPebbleIobCob(
        { bgs: [{ iob: 1.25, datetime: 'not-a-time' }] },
        NOW,
      ),
    ).toBeUndefined();
    expect(
      normalizeNightscoutPebbleIobCob(
        { bgs: [{ iob: 1.25, datetime: '2026-08-19T00:58:00' }] },
        NOW,
      ),
    ).toBeUndefined();
  });

  it('fails closed when the payload timestamp is stale', () => {
    expect(
      normalizeNightscoutPebbleIobCob(
        {
          bgs: [
            {
              iob: 1.25,
              datetime: NOW - NIGHTSCOUT_IOB_COB_MAX_AGE_MS - 1,
            },
          ],
        },
        NOW,
      ),
    ).toBeUndefined();
  });
});
