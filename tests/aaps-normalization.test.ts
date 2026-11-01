import { describe, expect, it } from 'vitest';

import { normalizeAapsReading } from '@/data/aaps/normalizeAapsReading';
import type { AapsLocalReading } from '@/data/aaps/types';
import { MG_DL_PER_MMOL_L } from '@/domain/models';

const NOW = Date.UTC(2026, 10, 1, 12);
const base: AapsLocalReading = {
  id: 'receipt-1',
  receivedAt: NOW,
  writeEpoch: 3,
  selectionGeneration: 5,
};

describe('AAPS local observation normalization', () => {
  it('preserves source mg/dL and measured time while converting at full precision', () => {
    const observation = normalizeAapsReading({
      ...base,
      glucoseTimestamp: NOW - 60_000,
      glucoseMgdl: 221.8,
      trend: 'up',
      rawTrend: 'SingleUp',
      deltaMgdl: 10.2,
    }, NOW);
    expect(observation?.context).toMatchObject({
      glucoseTimestamp: NOW - 60_000,
      glucoseMgdl: 221.8,
      rawTrend: 'SingleUp',
      receivedAt: NOW,
    });
    expect(observation?.glucose).toMatchObject({
      timestamp: NOW - 60_000,
      receivedAt: NOW,
      mmolL: 221.8 / MG_DL_PER_MMOL_L,
      sourceId: 'aaps-local',
    });
  });

  it('keeps signed IOB and zero COB but treats unavailable COB as missing', () => {
    const zero = normalizeAapsReading({ ...base, iobUnits: -0.25, cobGrams: 0 }, NOW);
    const missing = normalizeAapsReading({ ...base, id: 'receipt-2', iobUnits: -0.25, cobGrams: -1 }, NOW);
    expect(zero?.context.iobUnits).toBe(-0.25);
    expect(zero?.context.cobGrams).toBe(0);
    expect(missing?.context.cobGrams).toBeUndefined();
    expect(zero?.glucose).toBeUndefined();
  });

  it('does not create glucose from a missing or implausible timestamp/value', () => {
    expect(normalizeAapsReading({ ...base, glucoseMgdl: 110 }, NOW)?.glucose)
      .toBeUndefined();
    expect(normalizeAapsReading({ ...base, glucoseTimestamp: NOW + 180_000, glucoseMgdl: 110 }, NOW)?.glucose)
      .toBeUndefined();
    expect(normalizeAapsReading({ ...base, glucoseTimestamp: NOW, glucoseMgdl: 800 }, NOW)?.glucose)
      .toBeUndefined();
  });

  it('uses a stable glucose identity for repeated status broadcasts', () => {
    const first = normalizeAapsReading({ ...base, glucoseTimestamp: NOW - 60_000, glucoseMgdl: 120 }, NOW);
    const repeat = normalizeAapsReading({ ...base, id: 'receipt-2', receivedAt: NOW + 30_000,
      glucoseTimestamp: NOW - 60_000, glucoseMgdl: 120 }, NOW + 30_000);
    expect(first?.glucose?.id).toBe(repeat?.glucose?.id);
    expect(first?.context.id).not.toBe(repeat?.context.id);
  });
});
