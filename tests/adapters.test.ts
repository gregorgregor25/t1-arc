import { describe, expect, it } from 'vitest';

import {
  mapXdripDirection,
  normalizeXdripReading,
} from '@/data/adapters/xdrip';

describe('xDrip adapter', () => {
  it('converts mg/dL, direction and timestamp into a normalised reading', () => {
    const reading = normalizeXdripReading(
      {
        sgv: 108,
        direction: 'FortyFiveUp',
        date: 1_752_960_000_000,
      },
      'test-gdh',
      1_752_960_010_000,
    );

    expect(reading.mmolL).toBe(6);
    expect(reading.trend).toBe('slightUp');
    expect(reading.timestamp).toBe(1_752_960_000_000);
    expect(reading.sourceId).toBe('test-gdh');
  });

  it('maps known and unknown direction values safely', () => {
    expect(mapXdripDirection('SingleDown')).toBe('down');
    expect(mapXdripDirection('Flat')).toBe('flat');
    expect(mapXdripDirection('unexpected')).toBe('unknown');
    expect(mapXdripDirection()).toBe('unknown');
  });

  it('rejects invalid glucose payloads', () => {
    expect(() =>
      normalizeXdripReading({ sgv: 0, direction: 'Flat', date: 1000 }),
    ).toThrow(/positive numeric sgv/);
  });
});
