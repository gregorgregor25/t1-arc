import { describe, expect, it } from 'vitest';

import {
  calculateGlucoseRangeSummary,
  personalGlucoseRange,
} from '@/domain/glucoseRanges';
import { presentGlucoseRangeStatistics } from '@/domain/glucoseRangePresentation';
import type { GlucoseReading } from '@/domain/models';

const MINUTE = 60_000;
const MMOL = { locale: 'en-GB', glucoseUnit: 'mmolL' } as const;
const MG_DL = { locale: 'en-US', glucoseUnit: 'mgDl' } as const;

function readings(values: number[], stepMinutes = 5): GlucoseReading[] {
  return values.map((mmolL, index) => ({
    id: `r${index}`,
    timestamp: index * stepMinutes * MINUTE,
    receivedAt: index * stepMinutes * MINUTE,
    mmolL,
    trend: 'flat',
    quality: 'measured',
    sourceId: 'test-cgm',
  }));
}

describe('time in ranges presentation', () => {
  const values = [2.8, 3.5, 6, 9, 12, 15, 6, 6];
  const range = { start: 0, end: values.length * 5 * MINUTE };

  it('labels every figure with its range and band limits', () => {
    const summary = calculateGlucoseRangeSummary({
      readings: readings(values),
      range,
      personalRange: personalGlucoseRange({ targetMin: 4, targetMax: 8 }),
    });
    const presentation = presentGlucoseRangeStatistics(summary, MMOL);
    expect(presentation.coverageNotice).toBeUndefined();
    expect(presentation.bands.map(({ name, bounds, value }) => `${name} ${bounds} ${value}`)).toEqual([
      'Very low below 3.0 mmol/L 12.5%',
      'Low 3.0–3.8 mmol/L 12.5%',
      'In range 3.9–10.0 mmol/L 50%',
      'High 10.1–13.9 mmol/L 12.5%',
      'Very high above 13.9 mmol/L 12.5%',
    ]);
    expect(presentation.ranges.map(({ label, value }) => `${label}: ${value}`)).toEqual([
      'Standard range 3.9–10.0 mmol/L: 50%',
      'Tight range 3.9–7.8 mmol/L: 37.5%',
      'Your range 4.0–8.0 mmol/L: 37.5%',
    ]);
    expect(presentation.ranges[0]!.accessibilityLabel).toBe(
      'Standard range 3.9–10.0 mmol/L: 50% of observed time in range. Below 25% · Above 25%.',
    );
    expect(presentation.riskIndex.status).toBe('available');
  });

  it('uses mg/dL limits without changing any percentage', () => {
    const summary = calculateGlucoseRangeSummary({ readings: readings(values), range });
    const mmol = presentGlucoseRangeStatistics(summary, MMOL);
    const mgDl = presentGlucoseRangeStatistics(summary, MG_DL);
    expect(mgDl.bands.map(({ value }) => value)).toEqual(mmol.bands.map(({ value }) => value));
    expect(mgDl.bands.map(({ bounds }) => bounds)).toEqual([
      'below 54 mg/dL',
      '54–69 mg/dL',
      '70–180 mg/dL',
      '181–250 mg/dL',
      'above 250 mg/dL',
    ]);
    expect(mgDl.ranges.map(({ label }) => label)).toEqual([
      'Standard range 70–180 mg/dL',
      'Tight range 70–140 mg/dL',
    ]);
  });

  it('states incomplete coverage and withholds the risk index below 70%', () => {
    // Readings every 30 minutes cover 12 of every 30 minutes (40%).
    const sparse = readings([6, 6, 6, 6], 30);
    const summary = calculateGlucoseRangeSummary({ readings: sparse, range: { start: 0, end: 120 * MINUTE } });
    const presentation = presentGlucoseRangeStatistics(summary, MMOL);
    expect(presentation.coverage).toBe('40%');
    expect(presentation.coverageNotice).toBe(
      'Sensor readings cover 40% of this period, so these figures describe the recorded time only. Consensus reports use at least 70% coverage.',
    );
    expect(presentation.bands[2]!.value).toBe('100%');
    expect(presentation.riskIndex).toMatchObject({ status: 'withheld', detail: 'Shown when sensor coverage is at least 70%.' });
  });

  it('shows unavailable figures instead of zero when nothing was recorded', () => {
    const presentation = presentGlucoseRangeStatistics(
      calculateGlucoseRangeSummary({ readings: [], range: { start: 0, end: 60 * MINUTE } }),
      MMOL,
    );
    expect(presentation.observed).toBe(false);
    expect(presentation.coverageNotice).toContain('No sensor readings');
    expect(presentation.bands.every(({ value }) => value === '—')).toBe(true);
  });

  it('uses neutral wording', () => {
    const summary = calculateGlucoseRangeSummary({ readings: readings(values), range });
    const text = JSON.stringify(presentGlucoseRangeStatistics(summary, MMOL));
    expect(text).not.toMatch(/\b(?:good|bad|poor|excellent|better|worse)\b/i);
  });
});
