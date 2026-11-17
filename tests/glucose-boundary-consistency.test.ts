import { afterEach, describe, expect, it } from 'vitest';

import {
  assertGlucoseAnswerBundleV2,
  createGlucoseAnswerBundleV2,
  type GlucoseAnswerBundleV2,
} from '@/data/tarvis/glucoseAnswerBundleV2';
import {
  isReadyTarvisIntent,
  resolveTarvisIntent,
  tarvisPersonalTargetProfile,
  type TarvisGlucoseTargetProfile,
} from '@/data/tarvis/intent';
import { buildLocalGlucoseAnswer } from '@/data/tarvis/localGlucoseAnswer';
import { buildLocalGlucoseRangeAnswer } from '@/data/tarvis/localGlucoseRangeAnswer';
import {
  calculateGlucoseRangeSummary,
  glucoseMeetsThreshold,
  personalGlucoseRange,
} from '@/domain/glucoseRanges';
import { type GlucoseReading, MG_DL_PER_MMOL_L } from '@/domain/models';
import { isEvidenceQueryVisualizationReference } from '@/domain/evidenceQueryChart';
import { DEFAULT_REGIONAL_PROFILE } from '@/domain/regionalProfile';
import { setRuntimeRegionalProfile } from '@/domain/regionalProfileRuntime';

const AS_OF = Date.parse('2026-08-07T20:00:00+01:00');
const YESTERDAY = {
  start: Date.parse('2026-08-06T00:00:00+01:00'),
  end: Date.parse('2026-08-07T00:00:00+01:00'),
};

afterEach(() => {
  setRuntimeRegionalProfile({ ...DEFAULT_REGIONAL_PROFILE });
});

function ready(question: string, personal?: TarvisGlucoseTargetProfile) {
  const resolution = resolveTarvisIntent(question, {
    now: AS_OF,
    timezone: 'Europe/London',
    personalTargetProfile: personal,
  });
  if (!isReadyTarvisIntent(resolution)) {
    throw new Error(`Expected ready intent, received ${resolution.outcome.code}`);
  }
  return resolution.intent;
}

/** Yesterday, one reading every 5 minutes, all at the same level. */
function steadyDay(mmolL: number): GlucoseReading[] {
  return Array.from({ length: 288 }, (_, index) => {
    const timestamp = YESTERDAY.start + index * 5 * 60_000;
    return { id: `g-${index}`, timestamp, receivedAt: timestamp, mmolL, trend: 'unknown', quality: 'measured', sourceId: 'test-cgm' };
  });
}

function tarvisPercent(question: string, readings: GlucoseReading[], personal?: TarvisGlucoseTargetProfile) {
  const result = buildLocalGlucoseRangeAnswer({ asOf: AS_OF, intent: ready(question, personal), readings });
  const match = /: (\d+(?:\.\d+)?)%/.exec(result.answer.headline);
  if (!match) throw new Error(`No percentage in headline: ${result.answer.headline}`);
  return Number(match[1]);
}

const mg = (value: number) => value / MG_DL_PER_MMOL_L;

// The five consensus boundaries, each just below, at and just above in both
// published units. mg/dL values are stored integers converted to mmol/L.
const BOUNDARY_READINGS: readonly [string, number][] = [
  [53, 54, 55].map((v) => [`${v} mg/dL`, mg(v)] as [string, number]),
  [69, 70, 71].map((v) => [`${v} mg/dL`, mg(v)] as [string, number]),
  [139, 140, 141].map((v) => [`${v} mg/dL`, mg(v)] as [string, number]),
  [179, 180, 181].map((v) => [`${v} mg/dL`, mg(v)] as [string, number]),
  [249, 250, 251].map((v) => [`${v} mg/dL`, mg(v)] as [string, number]),
  [2.9, 3.0, 3.1, 3.8, 3.9, 4.0, 7.7, 7.8, 7.9, 9.9, 10.0, 10.1, 13.8, 13.9, 14.0]
    .map((v) => [`${v.toFixed(1)} mmol/L`, v] as [string, number]),
].flat();

describe('History and Tarv1s classify boundary readings the same way', () => {
  it.each(BOUNDARY_READINGS)('a day at %s', (_label, mmolL) => {
    const readings = steadyDay(mmolL);
    const history = calculateGlucoseRangeSummary({
      readings,
      range: YESTERDAY,
      personalRange: personalGlucoseRange({ targetMin: 3.9, targetMax: 10 }),
    });
    const bands = history.bands;
    const sum = (...values: (number | null)[]) => values.reduce<number>((total, value) => total + (value ?? 0), 0);
    const personal = tarvisPersonalTargetProfile({ targetMin: 3.9, targetMax: 10 })!;

    expect(tarvisPercent('What was my time in range yesterday?', readings)).toBe(history.standard.inRange.percent);
    expect(tarvisPercent('What was my time in tight range yesterday?', readings)).toBe(history.tight.inRange.percent);
    expect(tarvisPercent('What was my time in my range yesterday?', readings, personal)).toBe(history.personal!.inRange.percent);
    expect(tarvisPercent('time below range yesterday', readings)).toBe(history.standard.below.percent);
    expect(tarvisPercent('time above range yesterday', readings)).toBe(history.standard.above.percent);
    expect(tarvisPercent('time very low yesterday', readings)).toBe(bands.veryLow.percent);
    expect(tarvisPercent('time very high yesterday', readings)).toBe(bands.veryHigh.percent);

    expect(tarvisPercent('What was my time below 3 yesterday?', readings)).toBe(bands.veryLow.percent);
    expect(tarvisPercent('What was my time below 3.9 yesterday?', readings)).toBe(sum(bands.veryLow.percent, bands.low.percent));
    expect(tarvisPercent('What was my time above 7.8 yesterday?', readings)).toBe(history.tight.above.percent);
    expect(tarvisPercent('What was my time above 10 yesterday?', readings)).toBe(sum(bands.high.percent, bands.veryHigh.percent));
    expect(tarvisPercent('What was my time above 13.9 yesterday?', readings)).toBe(bands.veryHigh.percent);

    expect(tarvisPercent('time below 54 mg/dL yesterday', readings)).toBe(bands.veryLow.percent);
    expect(tarvisPercent('time below 70 mg/dL yesterday', readings)).toBe(sum(bands.veryLow.percent, bands.low.percent));
    expect(tarvisPercent('time above 140 mg/dL yesterday', readings)).toBe(history.tight.above.percent);
    expect(tarvisPercent('time above 180 mg/dL yesterday', readings)).toBe(sum(bands.high.percent, bands.veryHigh.percent));
    expect(tarvisPercent('time above 250 mg/dL yesterday', readings)).toBe(bands.veryHigh.percent);
  });

  it('counts 70 mg/dL and 180 mg/dL as in range, as the History card does', () => {
    expect(tarvisPercent('What was my time in range yesterday?', steadyDay(mg(70)))).toBe(100);
    expect(tarvisPercent('What was my time below 3.9 yesterday?', steadyDay(mg(70)))).toBe(0);
    expect(tarvisPercent('What was my time in range yesterday?', steadyDay(mg(180)))).toBe(100);
    expect(tarvisPercent('What was my time below 3.9 yesterday?', steadyDay(mg(69)))).toBe(100);
    expect(tarvisPercent('What was my time above 10 yesterday?', steadyDay(10.05))).toBe(100);
  });

  it('gives the same result to mg/dL users', () => {
    setRuntimeRegionalProfile({ ...DEFAULT_REGIONAL_PROFILE, glucoseUnit: 'mgDl' });
    expect(tarvisPercent('What was my time in range yesterday?', steadyDay(3.9))).toBe(100);
    expect(tarvisPercent('What was my time in range yesterday?', steadyDay(mg(70)))).toBe(100);
    expect(tarvisPercent('time below 54 mg/dL yesterday', steadyDay(3.0))).toBe(0);
    expect(tarvisPercent('time below 54 mg/dL yesterday', steadyDay(mg(53)))).toBe(100);
  });

  it('uses the same rule in clock-window answers', () => {
    const question = 'What was my TIR over the last three days between midnight and 7 a.m.?';
    for (const [mmolL, expected] of [[mg(70), 100], [mg(69), 0], [mg(180), 100], [10.05, 0]] as const) {
      const result = buildLocalGlucoseAnswer({ asOf: AS_OF, intent: ready(question), readings: steadyDay(mmolL) });
      expect(result.answer.headline).toMatch(new RegExp(`: ${expected}(?:\\.0)?%`));
    }
  });

  it('uses the personal range exactly as History does', () => {
    const profile = tarvisPersonalTargetProfile({ targetMin: 4, targetMax: 9 })!;
    const personalRange = personalGlucoseRange({ targetMin: 4, targetMax: 9 });
    for (const mmolL of [mg(72), 3.99, 4, 4.01, 8.99, 9, 9.01, mg(162)]) {
      const readings = steadyDay(mmolL);
      const history = calculateGlucoseRangeSummary({ readings, range: YESTERDAY, personalRange });
      expect(tarvisPercent('What was my time in my range yesterday?', readings, profile)).toBe(history.personal!.inRange.percent);
    }
  });
});

describe('one boundary rule for every threshold', () => {
  it('treats both published forms of a consensus boundary as the boundary itself', () => {
    expect(glucoseMeetsThreshold(mg(70), 'gte', 3.9)).toBe(true);
    expect(glucoseMeetsThreshold(mg(70), 'lt', 3.9)).toBe(false);
    expect(glucoseMeetsThreshold(3.9, 'gte', mg(70))).toBe(true);
    expect(glucoseMeetsThreshold(mg(180), 'lte', 10)).toBe(true);
    expect(glucoseMeetsThreshold(10, 'lte', mg(180))).toBe(true);
    expect(glucoseMeetsThreshold(10, 'gt', 10)).toBe(false);
    expect(glucoseMeetsThreshold(mg(250), 'gt', 13.9)).toBe(false);
    expect(glucoseMeetsThreshold(mg(251), 'gt', 13.9)).toBe(true);
  });

  it('compares other levels exactly, after converting the question to mmol/L', () => {
    expect(glucoseMeetsThreshold(4.5, 'lt', 4.5)).toBe(false);
    expect(glucoseMeetsThreshold(4.49, 'lt', 4.5)).toBe(true);
    expect(glucoseMeetsThreshold(mg(81), 'lt', mg(81))).toBe(false);
    expect(glucoseMeetsThreshold(mg(80), 'lt', mg(81))).toBe(true);
    // 4.5 mmol/L is 81.07 mg/dL, so it is not below 81 mg/dL.
    expect(glucoseMeetsThreshold(4.5, 'lt', mg(81))).toBe(false);
    expect(tarvisPercent('What was my time below 4.5 yesterday?', steadyDay(4.5))).toBe(0);
    expect(tarvisPercent('What was my time below 4.5 yesterday?', steadyDay(4.49))).toBe(100);
    expect(tarvisPercent('time below 81 mg/dL yesterday', steadyDay(mg(81)))).toBe(0);
    expect(tarvisPercent('time below 81 mg/dL yesterday', steadyDay(mg(80)))).toBe(100);
  });
});

function mutableClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** Rebuilds a bundle as an earlier version of T1 Arc saved it. */
function savedByEarlierVersion(bundle: GlucoseAnswerBundleV2, timeInRangeVersion: string, timeInRangeValue: number) {
  const readings = new Map(bundle.records.map((record) => [record.id, {
    id: record.id, timestamp: record.timestamp, receivedAt: record.timestamp, mmolL: record.mmolL,
    trend: 'unknown' as const, quality: 'measured' as const, sourceId: record.sourceId,
  }]));
  return createGlucoseAnswerBundleV2({
    executor: bundle.executor,
    originalIntent: mutableClone(bundle.intent.original),
    normalizedThresholds: mutableClone(bundle.thresholds),
    timezone: bundle.scope.timezone,
    asOf: bundle.scope.asOf,
    windows: bundle.scope.windows.map((window) => ({
      id: window.id,
      label: window.label,
      role: window.role,
      calculationRange: window.calculationRange,
      evidenceContextRange: window.evidenceContextRange,
      calculationReadings: window.calculationRecordIds.map((id) => readings.get(id)!),
      contextReadings: window.contextRecordIds.map((id) => readings.get(id)!),
      observationIntervals: mutableClone(window.observationIntervals),
    })),
    algorithms: {
      ...mutableClone(bundle.algorithms),
      metricVersions: bundle.algorithms.metricVersions.map((entry) =>
        entry.metric === 'glucose.time_in_range' ? { ...entry, version: timeInRangeVersion } : entry),
    },
    claims: bundle.claims.map((claim) => ({
      id: claim.id,
      metric: claim.metric,
      value: claim.metric === 'glucose.time_in_range' ? timeInRangeValue : claim.value,
      unit: claim.unit,
      windowIds: claim.windowIds,
    })),
    charts: bundle.charts.map((chart) => ({
      id: chart.id, kind: chart.kind, sourceReferenceId: chart.sourceReferenceId, windowIds: chart.windowIds, recordIds: chart.recordIds,
    })),
  });
}

describe('saved Tarv1s answers stay valid', () => {
  const readings = steadyDay(mg(70));

  it('new answers are checked with the shared boundary rule', () => {
    const result = buildLocalGlucoseRangeAnswer({ asOf: AS_OF, intent: ready('What was my time in range yesterday?'), readings });
    const claim = result.answerBundle.claims.find(({ metric }) => metric === 'glucose.time_in_range')!;
    expect(claim.value).toBe(100);
    expect(() => assertGlucoseAnswerBundleV2(mutableClone(result.answerBundle))).not.toThrow();
  });

  it('answers saved before the change are still checked with the exact comparison they used', () => {
    const result = buildLocalGlucoseRangeAnswer({ asOf: AS_OF, intent: ready('What was my time in range yesterday?'), readings });
    // Earlier versions compared with the literal 3.9 and found 0% in range.
    const legacy = savedByEarlierVersion(result.answerBundle, 'duration-forward-cap-12m-v1', 0);
    expect(() => assertGlucoseAnswerBundleV2(mutableClone(legacy))).not.toThrow();
    // A saved value that matches neither rule is still rejected.
    expect(() => savedByEarlierVersion(result.answerBundle, 'duration-forward-cap-12m-v1', 100)).toThrow(/not reproducible/);
  });

  it('range charts saved before the change still validate with their exact comparison', () => {
    const result = buildLocalGlucoseRangeAnswer({ asOf: AS_OF, intent: ready('What was my time in range over the last 7 days?'), readings });
    const chart = result.evidence.map(({ visualization }) => visualization).find((item) => item?.kind === 'range-distribution-v1');
    expect(chart).toBeDefined();
    expect(isEvidenceQueryVisualizationReference(mutableClone(chart))).toBe(true);
    const legacy = mutableClone(chart!) as unknown as Record<string, unknown> & { windows: { distribution: unknown; recordCount: number }[] };
    delete legacy.boundaryRule;
    // Under the shared rule the chart says 100% in range; old charts said 0%.
    expect(isEvidenceQueryVisualizationReference(legacy)).toBe(false);
    legacy.windows.forEach((window) => {
      if (window.recordCount > 0) window.distribution = { belowPercent: 100, inRangePercent: 0, abovePercent: 0 };
    });
    expect(isEvidenceQueryVisualizationReference(legacy)).toBe(true);
    expect(isEvidenceQueryVisualizationReference({ ...legacy, boundaryRule: 'dual-unit-boundaries-v1' })).toBe(false);
  });
});
