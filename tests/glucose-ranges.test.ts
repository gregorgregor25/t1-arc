import { describe, expect, it } from 'vitest';

import {
  calculateGlucoseRangeSummary,
  consensusGlucoseBand,
  consensusGlucoseBandBounds,
  formatGlucoseRangeBounds,
  formatGlucoseThreshold,
  glucoseRangePosition,
  glucoseTargetRangeLabel,
  glucoseTargetRangePhrase,
  glycemiaRiskIndex,
  personalGlucoseRange,
  STANDARD_GLUCOSE_RANGE,
  TIGHT_GLUCOSE_RANGE,
} from '@/domain/glucoseRanges';
import { DEFAULT_GLUCOSE_APPEARANCE } from '@/domain/glucoseAppearance';
import { type GlucoseReading, MG_DL_PER_MMOL_L } from '@/domain/models';
import { calculateGlucoseStats } from '@/domain/stats';
import { dayRange } from '@/domain/time';

const MINUTE = 60_000;
const MMOL = { locale: 'en-GB', glucoseUnit: 'mmolL' } as const;
const MG_DL = { locale: 'en-US', glucoseUnit: 'mgDl' } as const;
const mgDl = (value: number) => value / MG_DL_PER_MMOL_L;

function reading(id: string, minute: number, mmolL: number, origin = 0): GlucoseReading {
  const timestamp = origin + minute * MINUTE;
  return {
    id,
    timestamp,
    receivedAt: timestamp,
    mmolL,
    trend: 'flat',
    quality: 'measured',
    sourceId: 'test-cgm',
  };
}

describe('consensus glucose bands', () => {
  it.each([
    [2.99, 'veryLow'],
    [3.0, 'low'],
    [3.8, 'low'],
    [3.88, 'low'],
    [3.9, 'inRange'],
    [7.8, 'inRange'],
    [10.0, 'inRange'],
    [10.05, 'high'],
    [10.1, 'high'],
    [13.9, 'high'],
    [13.95, 'veryHigh'],
    [14.0, 'veryHigh'],
  ] as const)('places %s mmol/L in %s', (mmolL, band) => {
    expect(consensusGlucoseBand(mmolL)).toBe(band);
  });

  it.each([
    [53, 'veryLow'],
    [54, 'low'],
    [69, 'low'],
    [70, 'inRange'],
    [180, 'inRange'],
    [181, 'high'],
    [250, 'high'],
    [251, 'veryHigh'],
  ] as const)('places a reading saved as %s mg/dL in %s', (value, band) => {
    expect(consensusGlucoseBand(mgDl(value))).toBe(band);
  });

  it('treats both published forms of each range edge as inside the range', () => {
    expect(glucoseRangePosition(3.9, STANDARD_GLUCOSE_RANGE)).toBe('in');
    expect(glucoseRangePosition(mgDl(70), STANDARD_GLUCOSE_RANGE)).toBe('in');
    expect(glucoseRangePosition(mgDl(69), STANDARD_GLUCOSE_RANGE)).toBe('below');
    expect(glucoseRangePosition(10.0, STANDARD_GLUCOSE_RANGE)).toBe('in');
    expect(glucoseRangePosition(mgDl(180), STANDARD_GLUCOSE_RANGE)).toBe('in');
    expect(glucoseRangePosition(10.05, STANDARD_GLUCOSE_RANGE)).toBe('above');
    expect(glucoseRangePosition(7.8, TIGHT_GLUCOSE_RANGE)).toBe('in');
    expect(glucoseRangePosition(mgDl(140), TIGHT_GLUCOSE_RANGE)).toBe('in');
    expect(glucoseRangePosition(mgDl(141), TIGHT_GLUCOSE_RANGE)).toBe('above');
    expect(glucoseRangePosition(7.85, TIGHT_GLUCOSE_RANGE)).toBe('above');
  });
});

describe('range labels in each display unit', () => {
  it('uses the published mg/dL equivalents rather than rounded conversions', () => {
    expect(formatGlucoseThreshold(3.0, MG_DL)).toBe('54 mg/dL');
    expect(formatGlucoseThreshold(3.9, MG_DL)).toBe('70 mg/dL');
    expect(formatGlucoseThreshold(7.8, MG_DL)).toBe('140 mg/dL');
    expect(formatGlucoseThreshold(10, MG_DL)).toBe('180 mg/dL');
    expect(formatGlucoseThreshold(13.9, MG_DL)).toBe('250 mg/dL');
    // An mg/dL-entered boundary is recognised as the same consensus value.
    expect(formatGlucoseThreshold(mgDl(70), MMOL)).toBe('3.9 mmol/L');
  });

  it('names every range with its bounds', () => {
    expect(glucoseTargetRangeLabel(STANDARD_GLUCOSE_RANGE, MMOL)).toBe(
      'Standard range 3.9–10.0 mmol/L',
    );
    expect(glucoseTargetRangeLabel(TIGHT_GLUCOSE_RANGE, MMOL)).toBe(
      'Tight range 3.9–7.8 mmol/L',
    );
    expect(glucoseTargetRangeLabel(STANDARD_GLUCOSE_RANGE, MG_DL)).toBe(
      'Standard range 70–180 mg/dL',
    );
    expect(glucoseTargetRangeLabel(TIGHT_GLUCOSE_RANGE, MG_DL)).toBe(
      'Tight range 70–140 mg/dL',
    );
    expect(glucoseTargetRangePhrase(TIGHT_GLUCOSE_RANGE, MG_DL)).toBe(
      'the tight range 70–140 mg/dL',
    );
    const personal = personalGlucoseRange({ targetMin: 4, targetMax: 9 })!;
    expect(glucoseTargetRangeLabel(personal, MMOL)).toBe('Your range 4.0–9.0 mmol/L');
    expect(formatGlucoseRangeBounds(personal, MG_DL)).toBe('72–162 mg/dL');
  });

  it('describes the five bands with consensus limits', () => {
    expect(
      (['veryLow', 'low', 'inRange', 'high', 'veryHigh'] as const).map((band) =>
        consensusGlucoseBandBounds(band, MMOL),
      ),
    ).toEqual([
      'below 3.0 mmol/L',
      '3.0–3.8 mmol/L',
      '3.9–10.0 mmol/L',
      '10.1–13.9 mmol/L',
      'above 13.9 mmol/L',
    ]);
    expect(
      (['veryLow', 'low', 'inRange', 'high', 'veryHigh'] as const).map((band) =>
        consensusGlucoseBandBounds(band, MG_DL),
      ),
    ).toEqual([
      'below 54 mg/dL',
      '54–69 mg/dL',
      '70–180 mg/dL',
      '181–250 mg/dL',
      'above 250 mg/dL',
    ]);
  });
});

describe('duration-weighted range summary', () => {
  it('weights each reading by its observed duration', () => {
    // Readings every 5 minutes; the final reading carries to the range end.
    const summary = calculateGlucoseRangeSummary({
      readings: [
        reading('very-low', 0, 2.8),
        reading('low', 5, 3.5),
        reading('tight', 10, 6),
        reading('standard-only', 15, 9),
        reading('high', 20, 12),
        reading('very-high', 25, 15),
      ],
      range: { start: 0, end: 30 * MINUTE },
    });
    expect(summary.coveragePercent).toBe(100);
    expect(summary.bands.veryLow.percent).toBe(16.7);
    expect(summary.bands.low.percent).toBe(16.7);
    expect(summary.bands.inRange.percent).toBe(33.3);
    expect(summary.bands.high.percent).toBe(16.7);
    expect(summary.bands.veryHigh.percent).toBe(16.7);
    expect(summary.standard.inRange.milliseconds).toBe(10 * MINUTE);
    expect(summary.standard.below.milliseconds).toBe(10 * MINUTE);
    expect(summary.standard.above.milliseconds).toBe(10 * MINUTE);
    expect(summary.tight.inRange.milliseconds).toBe(5 * MINUTE);
    expect(summary.tight.above.milliseconds).toBe(15 * MINUTE);
  });

  it('gives a reading followed by a long interval more weight than a brief one', () => {
    const summary = calculateGlucoseRangeSummary({
      readings: [reading('high', 0, 12), reading('in', 2, 6), reading('in-2', 12, 6)],
      range: { start: 0, end: 22 * MINUTE },
    });
    expect(summary.bands.high.milliseconds).toBe(2 * MINUTE);
    expect(summary.bands.inRange.milliseconds).toBe(20 * MINUTE);
    expect(summary.standard.inRange.percent).toBe(90.9);
  });

  it('excludes sensor gaps beyond 12 minutes instead of counting them in any band', () => {
    const summary = calculateGlucoseRangeSummary({
      readings: [reading('before-gap', 0, 12), reading('after-gap', 60, 6)],
      range: { start: 0, end: 72 * MINUTE },
    });
    expect(summary.observedMilliseconds).toBe(24 * MINUTE);
    expect(summary.bands.high.milliseconds).toBe(12 * MINUTE);
    expect(summary.bands.inRange.milliseconds).toBe(12 * MINUTE);
    expect(summary.standard.inRange.percent).toBe(50);
    expect(summary.coveragePercent).toBe(33.3);
    expect(summary.representative).toBe(false);
  });

  it('returns null percentages, not zero, with no observed readings', () => {
    const summary = calculateGlucoseRangeSummary({ readings: [], range: { start: 0, end: MINUTE } });
    expect(summary.bands.inRange.percent).toBeNull();
    expect(summary.standard.inRange.percent).toBeNull();
    expect(summary.glycemiaRiskIndex).toBeNull();
    expect(summary.representative).toBe(false);
  });

  it('marks coverage of at least 70% as representative', () => {
    // Twelve 5-minute intervals plus the final 12-minute carry = 72 minutes.
    const readings = Array.from({ length: 13 }, (_, index) => reading(`r${index}`, index * 5, 6));
    const covered = calculateGlucoseRangeSummary({ readings, range: { start: 0, end: 100 * MINUTE } });
    expect(covered.coveragePercent).toBe(72);
    expect(covered.representative).toBe(true);
    const sparse = calculateGlucoseRangeSummary({ readings: readings.slice(0, 12), range: { start: 0, end: 100 * MINUTE } });
    expect(sparse.coveragePercent).toBe(67);
    expect(sparse.representative).toBe(false);
  });

  it('gives the same result for the same readings whatever the display unit', () => {
    // A source that stores mg/dL integers, such as AAPS, saves 70 mg/dL as
    // 3.885 mmol/L. It is in range for mmol/L and mg/dL users alike.
    const readings = [reading('edge-70', 0, mgDl(70)), reading('edge-180', 5, mgDl(180)), reading('above', 10, mgDl(181))];
    const range = { start: 0, end: 15 * MINUTE };
    const stats = calculateGlucoseStats(readings, range);
    expect(stats.timeInRangePercent).toBe(66.7);
    expect(stats.timeAbovePercent).toBe(33.3);
    expect(stats.timeBelowPercent).toBe(0);
    expect(stats.timeInTightRangePercent).toBe(33.3);
  });

  it('follows Europe/London clock days across the autumn clock change', () => {
    // 25 October 2026 lasts 25 hours in Europe/London.
    const range = dayRange('2026-10-25', Date.parse('2026-11-01T00:00:00Z'));
    expect(range.end - range.start).toBe(25 * 60 * MINUTE);
    const readings = Array.from({ length: 25 * 12 }, (_, index) =>
      reading(`r${index}`, index * 5, index < 12 * 12 ? 6 : 11, range.start),
    );
    const summary = calculateGlucoseRangeSummary({ readings, range });
    expect(summary.coveragePercent).toBe(100);
    expect(summary.bands.inRange.milliseconds).toBe(12 * 60 * MINUTE);
    expect(summary.bands.high.milliseconds).toBe(13 * 60 * MINUTE);
    expect(summary.bands.inRange.percent).toBe(48);
  });

  it('follows Europe/London clock days across the spring clock change', () => {
    // 29 March 2026 lasts 23 hours in Europe/London.
    const range = dayRange('2026-03-29', Date.parse('2026-04-05T00:00:00Z'));
    expect(range.end - range.start).toBe(23 * 60 * MINUTE);
    const readings = Array.from({ length: 23 * 12 }, (_, index) =>
      reading(`r${index}`, index * 5, 6, range.start),
    );
    const summary = calculateGlucoseRangeSummary({ readings, range });
    expect(summary.coveragePercent).toBe(100);
    expect(summary.standard.inRange.percent).toBe(100);
  });
});

describe('personal range', () => {
  const readings = [reading('a', 0, 3.95), reading('b', 5, 5), reading('c', 10, 8.5), reading('d', 15, 9.5)];
  const range = { start: 0, end: 20 * MINUTE };

  it('matches the standard range when the colour band is left at its default', () => {
    const personal = personalGlucoseRange(DEFAULT_GLUCOSE_APPEARANCE);
    const stats = calculateGlucoseStats(readings, range, personal);
    expect(stats.personalRange).toEqual({
      lowerMmolL: 3.9,
      upperMmolL: 10,
      timeBelowPercent: 0,
      timeInRangePercent: stats.timeInRangePercent,
      timeAbovePercent: 0,
    });
  });

  it('recalculates when the person edits their In range band', () => {
    const personal = personalGlucoseRange({ targetMin: 4, targetMax: 9 });
    const stats = calculateGlucoseStats(readings, range, personal);
    expect(stats.personalRange).toMatchObject({
      timeBelowPercent: 25,
      timeInRangePercent: 50,
      timeAbovePercent: 25,
    });
    // Standard figures are unchanged by the personal setting.
    expect(stats.timeInRangePercent).toBe(100);
  });

  it('treats a boundary entered in mg/dL the same as its mmol/L form', () => {
    const personal = personalGlucoseRange({ targetMin: mgDl(70), targetMax: mgDl(180) })!;
    expect(glucoseRangePosition(3.9, personal)).toBe('in');
    expect(glucoseRangePosition(10, personal)).toBe('in');
    expect(glucoseTargetRangeLabel(personal, MG_DL)).toBe('Your range 70–180 mg/dL');
  });

  it('rejects an invalid band instead of guessing', () => {
    expect(personalGlucoseRange({ targetMin: 10, targetMax: 4 })).toBeNull();
    expect(personalGlucoseRange({ targetMin: Number.NaN, targetMax: 9 })).toBeNull();
    expect(calculateGlucoseStats(readings, range, null).personalRange).toBeUndefined();
  });
});

describe('Glycemia Risk Index', () => {
  it('applies the published weights', () => {
    // 1% very low, 4% low, 20% high, 5% very high.
    const result = glycemiaRiskIndex(
      { veryLow: 1, low: 4, inRange: 70, high: 20, veryHigh: 5 },
      100,
    )!;
    expect(result.hypoglycaemiaComponent).toBe(4.2);
    expect(result.hyperglycaemiaComponent).toBe(15);
    // 3.0 × 4.2 + 1.6 × 15 = 36.6
    expect(result.value).toBe(36.6);
  });

  it('is capped at 100', () => {
    expect(
      glycemiaRiskIndex({ veryLow: 50, low: 0, inRange: 0, high: 0, veryHigh: 50 }, 100)!.value,
    ).toBe(100);
  });
});
