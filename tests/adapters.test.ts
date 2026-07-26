import { describe, expect, it } from 'vitest';

import {
  mapXdripDirection,
  normalizeXdripReading,
} from '@/data/adapters/xdrip';
import { normalizeGlookoInsulinRow } from '@/data/adapters/glookoNormalized';

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

describe('normalised Glooko adapter contract', () => {
  it('normalises a bolus row', () => {
    const delivery = normalizeGlookoInsulinRow({
      externalId: 'b-1',
      kind: 'bolus',
      deliveredAt: '2026-07-25T12:30:00+01:00',
      units: 4.2,
    });

    expect('timestamp' in delivery).toBe(true);
    expect(delivery.units).toBe(4.2);
  });

  it('normalises a basal interval', () => {
    const delivery = normalizeGlookoInsulinRow({
      externalId: 'base-1',
      kind: 'basal',
      deliveredAt: '2026-07-25T12:00:00+01:00',
      endAt: '2026-07-25T12:30:00+01:00',
      units: 0.3,
      rateUnitsPerHour: 0.6,
    });

    expect('start' in delivery).toBe(true);
    expect('rateUnitsPerHour' in delivery && delivery.rateUnitsPerHour).toBe(0.6);
  });

  it('rejects a basal interval with an invalid end', () => {
    expect(() =>
      normalizeGlookoInsulinRow({
        externalId: 'base-bad',
        kind: 'basal',
        deliveredAt: '2026-07-25T12:00:00+01:00',
        endAt: '2026-07-25T11:30:00+01:00',
        units: 0.3,
        rateUnitsPerHour: 0.6,
      }),
    ).toThrow(/end after it starts/);
  });
});
