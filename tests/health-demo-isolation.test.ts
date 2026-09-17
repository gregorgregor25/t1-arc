import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  readHealthMetricSnapshot,
  readHealthTrendSnapshot,
} from '@/data/healthMetricReader';
import {
  getDailyHealthMetricSnapshot,
  getHealthTrendSnapshot,
} from '@/data/healthConnect/dailyHealthMetrics';
import { SyntheticContextSource } from '@/data/synthetic/SyntheticContextSource';
import { dayRange } from '@/domain/time';

vi.mock('@/data/healthConnect/dailyHealthMetrics', () => ({
  getDailyHealthMetricSnapshot: vi.fn(() => {
    throw new Error('Personal daily store accessed');
  }),
  getHealthTrendSnapshot: vi.fn(() => {
    throw new Error('Personal trend store accessed');
  }),
}));

const now = Date.parse('2026-09-06T22:00:00Z');
const range = dayRange('2026-09-06', now);
describe('populated Health demo isolation', () => {
  beforeEach(() => vi.clearAllMocks());
  it('populates cards and exact records without invoking personal readers', async () => {
    const snapshot = await readHealthMetricSnapshot('demo', range, now);
    expect(snapshot.metrics.steps).toBeGreaterThan(0);
    expect(snapshot.metrics.weightKilograms).toBeGreaterThan(0);
    expect(snapshot.metrics.averageHeartRateBpm).toBeGreaterThan(0);
    expect(snapshot.metrics.hydrationLitres).toBeGreaterThan(0);
    expect(
      snapshot.records.every(
        (record) => record.sourceLabel === 'Demo · example data',
      ),
    ).toBe(true);
    expect(
      snapshot.context.every((event) => event.origin === 'synthetic'),
    ).toBe(true);
    expect(getDailyHealthMetricSnapshot).not.toHaveBeenCalled();
    expect(getHealthTrendSnapshot).not.toHaveBeenCalled();
  });
  it('uses the same context and weight as the rest of the demo', async () => {
    const snapshot = await readHealthMetricSnapshot('demo', range, now);
    const context = await new SyntheticContextSource(now).getEvents(range);
    expect(snapshot.context).toEqual(context);
    const weight = context.find((event) => event.kind === 'weight');
    expect(
      snapshot.records.find((record) => record.kind === 'weight')?.value,
    ).toBe(weight?.kind === 'weight' ? weight.kilograms : undefined);
  });
  it('keeps seven-day cards, selected-day details and earlier dates consistent', async () => {
    const trend = await readHealthTrendSnapshot('demo', '2026-09-06', 7, now);
    for (const day of trend) {
      const detail = await readHealthMetricSnapshot(
        'demo',
        dayRange(day.date, now),
        now,
      );
      expect(detail.metrics).toEqual(day.metrics);
    }
    expect(trend.some((day) => day.sleepMinutes > 0)).toBe(true);
    expect(trend.some((day) => day.workoutMinutes > 0)).toBe(true);
    expect(trend.every((day) => day.mealCount > 0)).toBe(true);
    expect(getHealthTrendSnapshot).not.toHaveBeenCalled();
  });
  it('does not fill future time or dates outside the demo with sample values', async () => {
    const early = Date.parse('2026-09-06T01:00:00Z');
    const snapshot = await readHealthMetricSnapshot(
      'demo',
      dayRange('2026-09-06', early),
      early,
    );
    expect(snapshot.records.every((record) => record.end <= early)).toBe(true);
    const old = await readHealthMetricSnapshot(
      'demo',
      dayRange('2026-01-01', now),
      now,
    );
    expect(old.records).toEqual([]);
    expect(old.context).toEqual([]);
  });
  it('returns to the live reader on demo exit without caching synthetic records', async () => {
    await readHealthMetricSnapshot('demo', range, now);
    expect(() => readHealthMetricSnapshot('live', range, now)).toThrow(
      'Personal daily store accessed',
    );
    expect(() => readHealthTrendSnapshot('live', '2026-09-06', 7, now)).toThrow(
      'Personal trend store accessed',
    );
    expect(getDailyHealthMetricSnapshot).toHaveBeenCalledExactlyOnceWith(range);
  });
  it('guards detail reads, hides goal editing in demo and keys async results by mode', () => {
    const ui = readFileSync('src/components/HealthMetricCards.tsx', 'utf8');
    expect(ui).toContain('readHealthMetricSnapshot(dataMode, range, now)');
    expect(ui).not.toContain('SqliteHealthRecordStore');
    expect(ui).toContain('definition.id === "steps" && dataMode === "live"');
    expect(ui).toContain('if (dataMode === "live") return observeStepGoal');
    expect(ui).toContain('<DemoModeNotice />');
    expect(readFileSync('src/screens/RecordsScreen.tsx', 'utf8')).toContain(
      'key={dataMode}',
    );
    for (const hook of ['useDailyHealthMetrics', 'useHealthTrend']) {
      expect(readFileSync(`src/hooks/${hook}.ts`, 'utf8')).toContain(
        '`${dataMode}:',
      );
    }
  });
});
