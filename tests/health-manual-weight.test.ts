import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  buildHealthMetricSnapshot,
  buildHealthTrendSnapshot,
  manualWeightMetricRecords,
} from '@/data/healthConnect/healthMetricSnapshot';
import type { DailyMetricRecord } from '@/domain/dailyHealthMetrics';
import type { WeightEvent } from '@/domain/models';
import { formatWeight } from '@/domain/regionalFormat';
import {
  DEFAULT_REGIONAL_PROFILE,
  resolveRegionalDefaults,
} from '@/domain/regionalProfile';
import { dayRange, zonedDateTimeToTimestamp } from '@/domain/time';

const now = Date.parse('2026-09-06T22:00:00Z');
const range = dayRange('2026-09-06', now);
const weight = (
  id: string,
  kilograms = 80,
  start = range.start + 3_600_000,
): WeightEvent => ({
  id,
  kilograms,
  start,
  kind: 'weight',
  title: 'Weight',
  sourceId: 'manual-entry',
  origin: 'manual',
});
const connected = (sourcePackage = 'scale'): DailyMetricRecord => ({
  id: `connected:${sourcePackage}`,
  kind: 'weight',
  sourcePackage,
  sourceLabel: sourcePackage,
  start: range.start + 1,
  end: range.start + 1,
  value: 79,
  unit: 'kg',
});

describe('manual weight in Health', () => {
  it('includes a just-saved measurement instead of rounding the read boundary down', () => {
    const instant = range.start + 3_654_321;
    const result = buildHealthMetricSnapshot({ records: [], context: [weight('fresh', 81, instant - 1)] },
      { start: range.start, end: instant });
    expect(result.metrics.weightKilograms).toBe(81);
    const screen = readFileSync('src/screens/RecordsScreen.tsx', 'utf8');
    expect(screen).toContain('dayRange(selectedDate, now)');
    expect(screen).not.toContain('dayRange(selectedDate, healthTimeBucket)');
  });
  it('projects exact canonical values and provenance without changing the stored event', () => {
    const event = Object.freeze(weight('one', 80.016554));
    const result = buildHealthMetricSnapshot(
      { records: [], context: [event] },
      range,
    );
    expect(result.metrics.weightKilograms).toBe(80.016554);
    expect(result.records[0]).toMatchObject({
      id: 'context-weight:one',
      value: 80.016554,
      unit: 'kg',
      sourceLabel: 'Manual log',
    });
    expect(result.metrics.selectedRecordIds).toEqual(['context-weight:one']);
    expect(event.kilograms).toBe(80.016554);
  });
  it('uses the latest manual entry, including an edit, and immediately respects deletion', () => {
    const earlier = weight('earlier', 80);
    const latest = weight('latest', 81, earlier.start + 100);
    const snapshot = (context: WeightEvent[]) =>
      buildHealthMetricSnapshot({ records: [], context }, range);
    expect(snapshot([latest, earlier]).metrics.weightKilograms).toBe(81);
    expect(
      snapshot([{ ...latest, kilograms: 82 }, earlier]).metrics.weightKilograms,
    ).toBe(82);
    expect(snapshot([earlier]).metrics.weightKilograms).toBe(80);
    expect(snapshot([]).metrics.weightKilograms).toBeUndefined();
  });
  it('preserves selected connected-source precedence without counting manual rows twice', () => {
    const result = buildHealthMetricSnapshot(
      { records: [connected()], context: [weight('manual')] },
      range,
    );
    expect(result.metrics.weightKilograms).toBe(79);
    expect(result.metrics.selectedRecordIds).toEqual(['connected:scale']);
    expect(result.metrics.recordCount).toBe(1);
  });
  it('fills missing preferred-source days but keeps unresolved connected conflicts visible', () => {
    const input = {
      records: [connected('a'), connected('b')],
      context: [weight('manual')],
    };
    const conflict = buildHealthMetricSnapshot(input, range);
    expect(conflict.metrics.weightKilograms).toBe(80);
    expect(conflict.metrics.needsSource).toContain('weight');
    const selected = buildHealthMetricSnapshot(
      { ...input, preferredSources: { weight: 'b' } },
      range,
    );
    expect(selected.metrics.weightKilograms).toBe(79);
    const missing = buildHealthMetricSnapshot(
      { ...input, preferredSources: { weight: 'missing' } },
      range,
    );
    expect(missing.metrics.weightKilograms).toBe(80);
  });
  it('does not carry yesterday forward or project imported/synthetic/invalid weights as manual', () => {
    const context: WeightEvent[] = [
      weight('yesterday', 80, range.start - 1),
      weight('future', 80, range.end),
      { ...weight('imported'), origin: 'imported' },
      { ...weight('demo'), origin: 'synthetic' },
      weight('nan', NaN),
      weight('negative', -1),
      weight('zero', 0),
    ];
    expect(
      buildHealthMetricSnapshot({ records: [], context }, range).metrics
        .weightKilograms,
    ).toBeUndefined();
    expect(
      manualWeightMetricRecords(context).map((record) => record.id),
    ).toEqual(['context-weight:yesterday', 'context-weight:future']);
  });
  it('agrees between daily cards and trends across date boundaries', () => {
    const yesterday = dayRange('2026-09-05', now);
    const input = {
      records: [],
      context: [
        weight('yesterday', 78, yesterday.start + 3_600_000),
        weight('today', 80),
      ],
    };
    const trend = buildHealthTrendSnapshot(input, '2026-09-06', 3, now);
    expect(trend.map((day) => day.metrics.weightKilograms)).toEqual([
      undefined,
      78,
      80,
    ]);
    expect(trend[2]?.metrics).toEqual(
      buildHealthMetricSnapshot(input, range).metrics,
    );
  });
  it.each(['Europe/London', 'America/New_York', 'Asia/Tokyo'])(
    'uses exact instants at DST/travel boundaries in %s',
    (zone) => {
      const start = zonedDateTimeToTimestamp('2026-10-25', 0, 0, 0, zone);
      const end = zonedDateTimeToTimestamp('2026-10-26', 0, 0, 0, zone);
      const result = buildHealthMetricSnapshot(
        {
          records: [],
          context: [
            weight('before', 79, start - 1),
            weight('inside', 80, end - 1),
            weight('after', 81, end),
          ],
        },
        { start, end },
      );
      expect(result.metrics.weightKilograms).toBe(80);
      expect(result.metrics.selectedRecordIds).toEqual([
        'context-weight:inside',
      ]);
    },
  );
  it('formats one canonical weight in the selected regional units', () => {
    const kg = resolveRegionalDefaults({
      ...DEFAULT_REGIONAL_PROFILE,
      languageTag: 'en-GB',
      measurementSystem: 'metric',
    });
    const lb = resolveRegionalDefaults({
      ...DEFAULT_REGIONAL_PROFILE,
      languageTag: 'en-GB',
      measurementSystem: 'imperial',
    });
    expect(formatWeight(80, kg)).toContain('80');
    expect(formatWeight(80, lb)).toBe('176.37 lb');
  });
});
