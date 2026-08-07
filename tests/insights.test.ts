import { describe, expect, it } from 'vitest';

import { createDemoRepository } from '@/data/demoRepository';
import {
  answerInsightQuestion,
  buildContextEventEvidence,
  buildMealResponseEvidence,
  buildGlucoseEpisodeEvidence,
  buildInsightReport,
  classifyInsightQuestion,
  detectGlucoseEpisodes,
  glucoseEpisodeBurden,
  glucoseTimeByDayPart,
  observedMealWindows,
  rankGlucoseEpisodes,
} from '@/domain/insights';
import {
  DailyHealthMetrics,
  DailyMetricRecord,
} from '@/domain/dailyHealthMetrics';
import {
  ContextNoteEvent,
  GlucoseReading,
  MedicationEvent,
  TimelineData,
  WeightEvent,
} from '@/domain/models';
import { calculateInsulinStats } from '@/domain/stats';
import {
  addDays,
  dayRange,
  toDateKey,
  zonedDateTimeToTimestamp,
} from '@/domain/time';

describe('evidence-backed insights', () => {
  it('compares two complete weeks and links every finding to records', async () => {
    const now = Date.parse('2026-07-26T10:00:00+01:00');
    const today = toDateKey(now);
    const todayStart = dayRange(today, now).start;
    const currentStart = dayRange(addDays(today, -7), now).start;
    const previousStart = dayRange(addDays(today, -14), now).start;
    const repository = createDemoRepository(now);
    const [current, previous] = await Promise.all([
      repository.getTimeline({ start: currentStart, end: todayStart }),
      repository.getTimeline({ start: previousStart, end: currentStart }),
    ]);

    const report = buildInsightReport(current, previous, now);

    expect(report.ready).toBe(true);
    expect(report.findings.length).toBeGreaterThanOrEqual(4);
    expect(report.findings.some((finding) => finding.category === 'food')).toBe(
      true,
    );
    expect(report.findings.some((finding) => finding.category === 'sleep')).toBe(
      true,
    );
    expect(
      report.findings.some((finding) => finding.id === 'glucose-variability'),
    ).toBe(true);
    expect(
      report.findings.some((finding) => finding.id === 'post-meal-pattern'),
    ).toBe(true);
    const repeatedMeal = report.findings.find(
      (finding) => finding.id === 'repeated-meal-pattern',
    );
    expect(repeatedMeal?.summary).toContain(
      'at least three adequately covered glucose windows',
    );
    expect(repeatedMeal?.evidence[0]?.recordIds.length).toBeGreaterThan(3);
    expect(report.current.insulinUnitsPerDay).toBeDefined();
    expect(report.current.basalUnitsPerDay).toBeDefined();
    expect(report.current.bolusUnitsPerDay).toBeDefined();
    expect(
      report.findings.find((finding) => finding.id === 'insulin-change')
        ?.summary,
    ).toMatch(/U\/day \(.+ basal and .+ bolus\)/);
    for (const finding of report.findings) {
      expect(finding.evidence.length).toBeGreaterThan(0);
      expect(
        finding.evidence.every((item) => item.recordIds.length > 0),
      ).toBe(true);
    }

    const answer = answerInsightQuestion(
      'Why was my glucose worse?',
      report,
    );
    expect(answer.findingIds.length).toBeGreaterThan(0);
    expect(answer.answer).toContain('not proven causes');

    expect(
      classifyInsightQuestion('Were my lows related to food and exercise?'),
    ).toEqual(['glucose', 'food', 'activity']);
    expect(classifyInsightQuestion('Were there missing sensor gaps?')).toEqual([
      'data-quality',
    ]);

    const doseAnswer = answerInsightQuestion(
      'How much correction insulin should I take?',
      report,
    );
    expect(doseAnswer.title).toBe(
      'T1 Arc does not give treatment advice',
    );
    expect(doseAnswer.findingIds).toEqual([]);
    expect(doseAnswer.answer).toContain('will not recommend doses');
  });

  it('normalises daily context and insulin by London calendar days across BST', async () => {
    const now = Date.parse('2026-04-02T10:00:00+01:00');
    const repository = createDemoRepository(now);
    const currentRange = {
      start: zonedDateTimeToTimestamp('2026-03-27'),
      end: zonedDateTimeToTimestamp('2026-03-30'),
    };
    const previousRange = {
      start: zonedDateTimeToTimestamp('2026-03-24'),
      end: currentRange.start,
    };
    expect(currentRange.end - currentRange.start).toBe(71 * 60 * 60_000);
    const [current, previous] = await Promise.all([
      repository.getTimeline(currentRange),
      repository.getTimeline(previousRange),
    ]);
    const report = buildInsightReport(current, previous, now);
    const currentInsulin = calculateInsulinStats(
      current.basal,
      current.boluses,
      currentRange,
    );
    const currentCarbs = current.context
      .filter((event) => event.kind === 'meal')
      .reduce((total, event) => total + event.carbsGrams, 0);

    expect(report.ready).toBe(true);
    expect(report.current.insulinUnitsPerDay).toBe(
      Math.round((currentInsulin.totalUnits / 3) * 10) / 10,
    );
    expect(report.current.mealCarbsPerDay).toBe(
      Math.round((currentCarbs / 3) * 10) / 10,
    );
  });

  it('measures London-clock glucose blocks by elapsed time across DST', () => {
    const range = {
      start: zonedDateTimeToTimestamp('2026-03-29'),
      end: zonedDateTimeToTimestamp('2026-03-30'),
    };
    const parts = glucoseTimeByDayPart([], range);

    expect(parts.find((part) => part.id === 'overnight')?.expectedMinutes).toBe(
      300,
    );
    expect(parts.find((part) => part.id === 'morning')?.expectedMinutes).toBe(
      360,
    );
    expect(
      parts.reduce((total, part) => total + part.expectedMinutes, 0),
    ).toBe(23 * 60);
  });

  it('weights time-of-day patterns by observed duration rather than sample count', () => {
    const range = {
      start: zonedDateTimeToTimestamp('2026-07-20'),
      end: zonedDateTimeToTimestamp('2026-07-21'),
    };
    const morningStart = zonedDateTimeToTimestamp('2026-07-20', 6);
    const readings: GlucoseReading[] = [];
    for (let minute = 0; minute <= 30; minute += 1) {
      readings.push({
        id: `dense-high-${minute}`,
        timestamp: morningStart + minute * 60_000,
        receivedAt: morningStart + minute * 60_000,
        mmolL: 11,
        trend: 'flat',
        quality: 'measured',
        sourceId: 'test',
      });
    }
    for (let minute = 35; minute <= 120; minute += 5) {
      readings.push({
        id: `normal-${minute}`,
        timestamp: morningStart + minute * 60_000,
        receivedAt: morningStart + minute * 60_000,
        mmolL: 6,
        trend: 'flat',
        quality: 'measured',
        sourceId: 'test',
      });
    }

    const morning = glucoseTimeByDayPart(readings, range).find(
      (part) => part.id === 'morning',
    );
    expect(readings.filter((reading) => reading.mmolL > 10).length).toBe(31);
    expect(morning?.readings).toHaveLength(49);
    expect(morning?.observedMinutes).toBe(132);
    expect(morning?.highPercent).toBe(26.5);
  });

  it('withholds insulin comparisons when source totals materially disagree with detailed rows', async () => {
    const now = Date.parse('2026-07-26T10:00:00+01:00');
    const today = toDateKey(now);
    const todayStart = dayRange(today, now).start;
    const currentStartDate = addDays(today, -7);
    const currentStart = dayRange(currentStartDate, now).start;
    const previousStart = dayRange(addDays(today, -14), now).start;
    const repository = createDemoRepository(now);
    const [current, previous] = await Promise.all([
      repository.getTimeline({ start: currentStart, end: todayStart }),
      repository.getTimeline({ start: previousStart, end: currentStart }),
    ]);
    const firstDay = dayRange(currentStartDate, now);
    const detailed = calculateInsulinStats(
      current.basal,
      current.boluses,
      firstDay,
    );
    const sourceTotalId = 'glooko-total:mismatch';
    const report = buildInsightReport(
      {
        ...current,
        dailyInsulinTotals: [
          {
            id: sourceTotalId,
            sourceId: 'demo-glooko',
            timestamp: firstDay.end - 1,
            dateKey: currentStartDate,
            totalUnits: detailed.totalUnits + 10,
            importedAt: now,
          },
        ],
      },
      previous,
      now,
    );

    const finding = report.findings.find(
      (item) => item.id === 'insulin-total-reconciliation',
    );
    expect(finding?.kind).toBe('limitation');
    expect(finding?.category).toBe('data-quality');
    expect(finding?.summary).toContain('difference +10 U');
    expect(finding?.caveat).toContain(
      'does not mean the pump delivered the wrong amount',
    );
    expect(finding?.evidence[0]?.recordIds).toContain(sourceTotalId);
    expect(finding?.evidence[0]?.recordIds.length).toBeGreaterThan(1);
    expect(
      report.findings.some((item) => item.id === 'insulin-change'),
    ).toBe(false);
    expect(
      answerInsightQuestion('Why was my glucose worse?', report).findingIds,
    ).toContain('insulin-total-reconciliation');
  });

  it('links weight comparisons to the exact context records', async () => {
    const now = Date.parse('2026-07-26T10:00:00+01:00');
    const today = toDateKey(now);
    const todayStart = dayRange(today, now).start;
    const currentStart = dayRange(addDays(today, -7), now).start;
    const previousStart = dayRange(addDays(today, -14), now).start;
    const repository = createDemoRepository(now);
    const [current, previous] = await Promise.all([
      repository.getTimeline({ start: currentStart, end: todayStart }),
      repository.getTimeline({ start: previousStart, end: currentStart }),
    ]);
    const weight = (
      id: string,
      start: number,
      kilograms: number,
    ): WeightEvent => ({
      id,
      start,
      kind: 'weight',
      title: 'Weight',
      kilograms,
      sourceId: 'health-connect:example',
      origin: 'imported',
    });
    const report = buildInsightReport(
      {
        ...current,
        context: [
          ...current.context.filter((event) => event.kind !== 'weight'),
          weight('current-weight-1', currentStart + 86_400_000, 81.8),
          weight('current-weight-2', currentStart + 4 * 86_400_000, 82.2),
        ],
      },
      {
        ...previous,
        context: [
          ...previous.context.filter((event) => event.kind !== 'weight'),
          weight('previous-weight', previousStart + 86_400_000, 81.1),
        ],
      },
      now,
    );

    const finding = report.findings.find(
      (item) => item.id === 'weight-context',
    );
    expect(finding?.summary).toContain('82.0 kg');
    expect(finding?.evidence[0]?.recordIds).toEqual([
      'current-weight-1',
      'current-weight-2',
    ]);
    expect(finding?.evidence[1]?.recordIds).toEqual(['previous-weight']);
    expect(
      answerInsightQuestion('Did my weight change?', report).findingIds,
    ).toEqual(['weight-context']);
    expect(classifyInsightQuestion('Did my weight in kg change?')).toEqual([
      'weight',
    ]);
  });

  it('surfaces user-recorded context as an auditable clue, never a cause', async () => {
    const now = Date.parse('2026-07-26T10:00:00+01:00');
    const today = toDateKey(now);
    const todayStart = dayRange(today, now).start;
    const currentStart = dayRange(addDays(today, -7), now).start;
    const previousStart = dayRange(addDays(today, -14), now).start;
    const repository = createDemoRepository(now);
    const [current, previous] = await Promise.all([
      repository.getTimeline({ start: currentStart, end: todayStart }),
      repository.getTimeline({ start: previousStart, end: currentStart }),
    ]);
    const note: ContextNoteEvent = {
      id: 'context-note-site',
      kind: 'note',
      category: 'pump',
      title: 'Pod or site',
      detail: 'Changed pod after suspected site issue',
      start: currentStart + 2 * 86_400_000,
      sourceId: 'daymark-manual',
      origin: 'manual',
    };

    const report = buildInsightReport(
      { ...current, context: [...current.context, note] },
      previous,
      now,
    );
    const finding = report.findings.find(
      (item) => item.id === 'recorded-context-notes',
    );

    expect(finding?.category).toBe('context');
    expect(finding?.summary).toContain('Pod / site (1)');
    expect(finding?.caveat).toContain('not what caused');
    expect(finding?.evidence[0]?.recordIds).toEqual(['context-note-site']);
    expect(
      answerInsightQuestion('Did a pod or site issue change?', report)
        .findingIds,
    ).toContain('recorded-context-notes');

    const evidence = buildContextEventEvidence(note, {
      ...current,
      context: [...current.context, note],
    });
    expect(evidence.recordIds[0]).toBe('context-note-site');
    expect(evidence.recordIds.length).toBeGreaterThan(1);
    expect(evidence.description).toContain('does not establish cause');
  });

  it('answers medication questions from exact recorded entries', async () => {
    const now = Date.parse('2026-07-26T10:00:00+01:00');
    const today = toDateKey(now);
    const todayStart = dayRange(today, now).start;
    const currentStart = dayRange(addDays(today, -7), now).start;
    const previousStart = dayRange(addDays(today, -14), now).start;
    const repository = createDemoRepository(now);
    const [current, previous] = await Promise.all([
      repository.getTimeline({ start: currentStart, end: todayStart }),
      repository.getTimeline({ start: previousStart, end: currentStart }),
    ]);
    const medication: MedicationEvent = {
      id: 'medication-entry-1',
      kind: 'medication',
      title: 'Vitamin D',
      amount: 1,
      unit: 'tablet',
      start: currentStart + 3 * 86_400_000,
      sourceId: 'daymark-manual',
      origin: 'manual',
    };

    const report = buildInsightReport(
      { ...current, context: [...current.context, medication] },
      previous,
      now,
    );
    const finding = report.findings.find(
      (item) => item.id === 'medication-context',
    );

    expect(finding?.category).toBe('medication');
    expect(finding?.summary).toContain('Vitamin D · 1 tablet');
    expect(finding?.summary).toContain('none recorded');
    expect(finding?.evidence[0]?.recordIds).toEqual([
      'medication-entry-1',
    ]);
    expect(finding?.caveat).toContain('does not establish adherence');
    expect(
      answerInsightQuestion('Did my medication change?', report).findingIds,
    ).toEqual(['medication-context']);
    expect(classifyInsightQuestion('Did my medicine change?')).toEqual([
      'medication',
    ]);
    expect(
      answerInsightQuestion(
        'Should I take another tablet?',
        report,
      ).title,
    ).toBe('T1 Arc does not give treatment advice');
  });

  it('groups only consecutive threshold readings into sustained runs', () => {
    const start = Date.parse('2026-07-26T10:00:00+01:00');
    const reading = (
      minute: number,
      mmolL: number,
    ): GlucoseReading => ({
      id: `reading-${minute}`,
      timestamp: start + minute * 60_000,
      receivedAt: start + minute * 60_000,
      mmolL,
      trend: 'flat',
      quality: 'measured',
      sourceId: 'test',
    });
    const readings = [
      reading(0, 9.8),
      reading(5, 10.4),
      reading(10, 11.2),
      reading(15, 9.9),
      reading(40, 11.5),
      reading(60, 11.7),
      reading(65, 3.7),
      reading(70, 3.5),
    ];

    const highs = detectGlucoseEpisodes(readings, 'high');
    const lows = detectGlucoseEpisodes(readings, 'low');

    expect(highs).toHaveLength(1);
    expect(highs[0]?.readings.map((item) => item.id)).toEqual([
      'reading-5',
      'reading-10',
    ]);
    expect(highs[0]?.extremeMmolL).toBe(11.2);
    expect(lows).toHaveLength(1);
    expect(lows[0]?.extremeMmolL).toBe(3.5);

    const timeline: TimelineData = {
      range: { start: start - 60 * 60_000, end: start + 3 * 60 * 60_000 },
      glucose: readings,
      basal: [
        {
          id: 'basal-nearby',
          start: start,
          end: start + 30 * 60_000,
          rateUnitsPerHour: 0.8,
          units: 0.4,
          sourceId: 'test-insulin',
        },
      ],
      boluses: [
        {
          id: 'bolus-nearby',
          timestamp: start - 20 * 60_000,
          units: 2,
          sourceId: 'test-insulin',
        },
      ],
      context: [
        {
          id: 'meal-nearby',
          kind: 'meal',
          start: start - 30 * 60_000,
          sourceId: 'test-food',
          origin: 'manual',
          title: 'Toast',
          mealType: 'breakfast',
          carbsGrams: 30,
        },
      ],
      sources: [],
    };
    const evidence = buildGlucoseEpisodeEvidence(highs[0]!, timeline);
    expect(evidence.recordIds).toEqual(
      expect.arrayContaining([
        'reading-5',
        'reading-10',
        'basal-nearby',
        'bolus-nearby',
        'meal-nearby',
      ]),
    );
    expect(evidence.description).toContain('Nearby does not mean causal');
    expect(glucoseEpisodeBurden(highs[0]!)).toBeGreaterThan(0);
    expect(rankGlucoseEpisodes([...lows, ...highs], 1)[0]?.id).toBe(
      highs[0]?.id,
    );
  });

  it('keeps sustained high and low run evidence in separate references', () => {
    const end = Date.parse('2026-07-26T00:00:00+01:00');
    const week = 7 * 24 * 60 * 60_000;
    const makeWindow = (start: number, withExcursions: boolean): TimelineData => {
      const glucose: GlucoseReading[] = [];
      for (
        let timestamp = start, index = 0;
        timestamp < start + week;
        timestamp += 5 * 60_000, index += 1
      ) {
        let mmolL = 6.5;
        if (withExcursions && (index === 12 || index === 13)) mmolL = 11.2;
        if (withExcursions && (index === 30 || index === 31)) mmolL = 3.5;
        glucose.push({
          id: `glucose:${timestamp}`,
          timestamp,
          receivedAt: timestamp,
          mmolL,
          trend: 'flat',
          quality: 'measured',
          sourceId: 'test-glucose',
        });
      }
      return {
        range: { start, end: start + week },
        glucose,
        basal: [],
        boluses: [],
        context: [],
        sources: [
          {
            id: 'insulin-not-connected',
            label: 'Insulin',
            detail: 'Not connected',
            freshness: 'missing',
            origin: 'delayed',
            isLive: false,
          },
        ],
      };
    };
    const report = buildInsightReport(
      makeWindow(end - week, true),
      makeWindow(end - 2 * week, false),
      end,
    );
    const evidence = report.findings.find(
      (finding) => finding.id === 'glucose-runs',
    )?.evidence;

    expect(
      evidence?.find(
        (reference) => reference.id === 'current-high-glucose-runs',
      )?.label,
    ).toBe('Recent sustained high runs');
    expect(
      evidence?.find(
        (reference) => reference.id === 'current-low-glucose-runs',
      )?.label,
    ).toBe('Recent sustained low runs');
    expect(
      evidence
        ?.find(
          (reference) => reference.id === 'current-high-glucose-runs',
        )
        ?.examples.every((example) => Number.parseFloat(example.primary) > 10),
    ).toBe(true);
    expect(
      evidence
        ?.find((reference) => reference.id === 'current-low-glucose-runs')
        ?.examples.every((example) => Number.parseFloat(example.primary) < 3.9),
    ).toBe(true);
  });

  it('builds an auditable response for a meal with continuous glucose', () => {
    const start = Date.parse('2026-07-26T12:00:00+01:00');
    const glucose: GlucoseReading[] = [];
    for (let minute = -10; minute <= 130; minute += 5) {
      const rise =
        minute <= 75
          ? Math.max(0, minute) * (3.2 / 75)
          : 3.2 - (minute - 75) * (1.4 / 55);
      glucose.push({
        id: `meal-reading-${minute}`,
        timestamp: start + minute * 60_000,
        receivedAt: start + minute * 60_000,
        mmolL: Math.round((6 + rise) * 10) / 10,
        trend: 'flat',
        quality: 'measured',
        sourceId: 'test-glucose',
      });
    }
    const data: TimelineData = {
      range: {
        start: start - 60 * 60_000,
        end: start + 4 * 60 * 60_000,
      },
      glucose,
      basal: [
        {
          id: 'meal-basal',
          start: start - 30 * 60_000,
          end: start + 30 * 60_000,
          rateUnitsPerHour: 0.8,
          units: 0.8,
          sourceId: 'test-insulin',
        },
      ],
      boluses: [
        {
          id: 'meal-bolus',
          timestamp: start - 10 * 60_000,
          units: 3.1,
          sourceId: 'test-insulin',
        },
      ],
      context: [
        {
          id: 'meal-lunch',
          kind: 'meal',
          start,
          sourceId: 'test-food',
          origin: 'manual',
          title: 'Chicken wrap',
          mealType: 'lunch',
          carbsGrams: 42,
        },
      ],
      sources: [],
    };

    const responses = observedMealWindows(data);

    expect(responses).toHaveLength(1);
    expect(responses[0]?.baseline.mmolL).toBe(6);
    expect(responses[0]?.peak.mmolL).toBe(9.2);
    expect(responses[0]?.riseMmolL).toBe(3.2);
    const evidence = buildMealResponseEvidence(responses[0]!, data);
    expect(evidence.recordIds).toEqual(
      expect.arrayContaining([
        'meal-lunch',
        'meal-reading-0',
        'meal-reading-75',
        'meal-bolus',
        'meal-basal',
      ]),
    );
    expect(evidence.description).toContain('not proof');
  });

  it('withholds a meal response when two-hour coverage is incomplete', () => {
    const start = Date.parse('2026-07-26T12:00:00+01:00');
    const glucose = Array.from({ length: 12 }, (_, index) => ({
      id: `short-${index}`,
      timestamp: start + index * 5 * 60_000,
      receivedAt: start + index * 5 * 60_000,
      mmolL: 6 + index / 10,
      trend: 'flat' as const,
      quality: 'measured' as const,
      sourceId: 'test-glucose',
    }));
    const data: TimelineData = {
      range: { start, end: start + 4 * 60 * 60_000 },
      glucose,
      basal: [],
      boluses: [],
      context: [
        {
          id: 'short-meal',
          kind: 'meal',
          start,
          sourceId: 'test-food',
          origin: 'manual',
          title: 'Snack',
          mealType: 'snack',
          carbsGrams: 18,
        },
      ],
      sources: [],
    };

    expect(observedMealWindows(data)).toEqual([]);
  });

  it('resolves every meal response record from the repository range', async () => {
    const now = Date.parse('2026-07-27T01:42:00+01:00');
    const repository = createDemoRepository(now);
    const date = addDays(toDateKey(now), -1);
    const day = dayRange(date, now);
    const data = await repository.getTimeline(day);
    const responses = observedMealWindows(data);

    expect(responses.length).toBeGreaterThan(0);
    for (const response of responses) {
      const evidence = buildMealResponseEvidence(response, data);
      const reloaded = await repository.getTimeline(evidence.range);
      const available = new Set([
        ...reloaded.glucose.map((record) => record.id),
        ...reloaded.basal.map((record) => record.id),
        ...reloaded.boluses.map((record) => record.id),
        ...reloaded.context.map((record) => record.id),
      ]);
      expect(
        evidence.recordIds.filter((id) => !available.has(id)),
      ).toEqual([]);
    }
  });

  it('adds source-selected Health Connect activity and heart evidence', async () => {
    const now = Date.parse('2026-07-26T10:00:00+01:00');
    const today = toDateKey(now);
    const todayStart = dayRange(today, now).start;
    const currentStart = dayRange(addDays(today, -7), now).start;
    const previousStart = dayRange(addDays(today, -14), now).start;
    const repository = createDemoRepository(now);
    const [current, previous] = await Promise.all([
      repository.getTimeline({ start: currentStart, end: todayStart }),
      repository.getTimeline({ start: previousStart, end: currentStart }),
    ]);
    const health = (
      prefix: string,
      start: number,
      steps: number,
      restingHeartRate: number,
    ) => {
      const records: DailyMetricRecord[] = [
        {
          id: `${prefix}-steps`,
          kind: 'steps',
          sourcePackage: 'com.example.health',
          sourceLabel: 'Example Health',
          start,
          end: start + 7 * 86_400_000,
          value: steps,
          unit: 'count',
        },
        {
          id: `${prefix}-resting-heart`,
          kind: 'resting_heart_rate',
          sourcePackage: 'com.example.health',
          sourceLabel: 'Example Health',
          start,
          end: start,
          value: restingHeartRate,
          unit: 'bpm',
        },
      ];
      const metrics: DailyHealthMetrics = {
        steps,
        restingHeartRateBpm: restingHeartRate,
        sourceLabels: ['Example Health'],
        needsSource: [],
        recordCount: records.length,
        selectedRecordIds: records.map((record) => record.id),
      };
      return { metrics, records };
    };

    const report = buildInsightReport(current, previous, now, {
      current: health('current', currentStart, 70_000, 61),
      previous: health('previous', previousStart, 56_000, 65),
    });

    const activity = report.findings.find(
      (finding) => finding.id === 'health-connect-activity',
    );
    const heart = report.findings.find(
      (finding) => finding.id === 'health-connect-heart-rate',
    );
    expect(activity?.summary).toContain('10,000 steps/day');
    expect(activity?.evidence[0]?.recordIds).toEqual(['current-steps']);
    expect(heart?.summary).toContain('61 bpm');
    expect(heart?.evidence[1]?.recordIds).toEqual([
      'previous-resting-heart',
    ]);
    expect(
      answerInsightQuestion('Did my resting heart rate change?', report)
        .findingIds,
    ).toContain('health-connect-heart-rate');
  });

  it('compares body composition, hydration and material vital-sign changes with exact evidence', async () => {
    const now = Date.parse('2026-07-26T10:00:00+01:00');
    const today = toDateKey(now);
    const todayStart = dayRange(today, now).start;
    const currentStart = dayRange(addDays(today, -7), now).start;
    const previousStart = dayRange(addDays(today, -14), now).start;
    const repository = createDemoRepository(now);
    const [current, previous] = await Promise.all([
      repository.getTimeline({ start: currentStart, end: todayStart }),
      repository.getTimeline({ start: previousStart, end: currentStart }),
    ]);
    const health = (
      prefix: string,
      start: number,
      values: {
        bodyFat: number;
        leanMass: number;
        hydration: number;
        systolic: number;
        hrv: number;
      },
    ) => {
      const records: DailyMetricRecord[] = [
        {
          id: `${prefix}-body-fat`,
          kind: 'body_fat',
          sourcePackage: 'com.example.health',
          sourceLabel: 'Example Health',
          start,
          end: start,
          value: values.bodyFat,
          unit: 'percent',
        },
        {
          id: `${prefix}-lean-mass`,
          kind: 'lean_body_mass',
          sourcePackage: 'com.example.health',
          sourceLabel: 'Example Health',
          start,
          end: start,
          value: values.leanMass,
          unit: 'kg',
        },
        {
          id: `${prefix}-hydration`,
          kind: 'hydration',
          sourcePackage: 'com.example.health',
          sourceLabel: 'Example Health',
          start,
          end: start + 7 * 86_400_000,
          value: values.hydration,
          unit: 'litre',
        },
        {
          id: `${prefix}-systolic`,
          kind: 'blood_pressure_systolic',
          sourcePackage: 'com.example.health',
          sourceLabel: 'Example Health',
          start,
          end: start,
          value: values.systolic,
          unit: 'mmHg',
        },
        {
          id: `${prefix}-hrv`,
          kind: 'heart_rate_variability_rmssd',
          sourcePackage: 'com.example.health',
          sourceLabel: 'Example Health',
          start,
          end: start,
          value: values.hrv,
          unit: 'ms',
        },
      ];
      const metrics: DailyHealthMetrics = {
        bodyFatPercent: values.bodyFat,
        leanBodyMassKilograms: values.leanMass,
        hydrationLitres: values.hydration,
        bloodPressureSystolic: values.systolic,
        heartRateVariabilityRmssdMs: values.hrv,
        sourceLabels: ['Example Health'],
        needsSource: [],
        recordCount: records.length,
        selectedRecordIds: records.map((record) => record.id),
      };
      return { metrics, records };
    };

    const report = buildInsightReport(current, previous, now, {
      current: health('current', currentStart, {
        bodyFat: 23.8,
        leanMass: 60.5,
        hydration: 14,
        systolic: 130,
        hrv: 42,
      }),
      previous: health('previous', previousStart, {
        bodyFat: 24.7,
        leanMass: 59.8,
        hydration: 10.5,
        systolic: 122,
        hrv: 34,
      }),
    });

    const body = report.findings.find(
      (finding) => finding.id === 'health-connect-body-composition',
    );
    const hydration = report.findings.find(
      (finding) => finding.id === 'health-connect-hydration',
    );
    const vitals = report.findings.find(
      (finding) => finding.id === 'health-connect-vitals',
    );

    expect(body?.summary).toContain('Body fat was 23.8%');
    expect(body?.evidence[0]?.recordIds).toEqual([
      'current-body-fat',
      'current-lean-mass',
    ]);
    expect(body?.evidence[0]?.examples[0]?.primary).toBe('23.8%');
    expect(hydration?.summary).toContain('2.00 L/day');
    expect(hydration?.evidence[1]?.recordIds).toEqual([
      'previous-hydration',
    ]);
    expect(vitals?.summary).toContain(
      'Systolic blood pressure was 130 mmHg',
    );
    expect(vitals?.summary).toContain('HRV was 42 ms');
    expect(vitals?.evidence[0]?.recordIds).toEqual([
      'current-systolic',
      'current-hrv',
    ]);
    expect(
      answerInsightQuestion('Did my body composition change?', report)
        .findingIds,
    ).toContain('health-connect-body-composition');
    expect(
      answerInsightQuestion('How did my hydration change?', report)
        .findingIds,
    ).toContain('health-connect-hydration');
    expect(classifyInsightQuestion('Did my blood pressure change?')).toEqual([
      'vitals',
    ]);
  });

  it('explains source conflicts and one-sided health history instead of treating missing records as zero', async () => {
    const now = Date.parse('2026-07-26T10:00:00+01:00');
    const today = toDateKey(now);
    const todayStart = dayRange(today, now).start;
    const currentStart = dayRange(addDays(today, -7), now).start;
    const previousStart = dayRange(addDays(today, -14), now).start;
    const repository = createDemoRepository(now);
    const [current, previous] = await Promise.all([
      repository.getTimeline({ start: currentStart, end: todayStart }),
      repository.getTimeline({ start: previousStart, end: currentStart }),
    ]);
    const conflictingSteps: DailyMetricRecord[] = [
      {
        id: 'samsung-steps',
        kind: 'steps',
        sourcePackage: 'com.samsung.health',
        sourceLabel: 'Samsung Health',
        start: currentStart,
        end: todayStart,
        value: 70_000,
        unit: 'count',
      },
      {
        id: 'fitbit-steps',
        kind: 'steps',
        sourcePackage: 'com.fitbit.FitbitMobile',
        sourceLabel: 'Fitbit',
        start: currentStart,
        end: todayStart,
        value: 68_000,
        unit: 'count',
      },
      {
        id: 'current-hydration-only',
        kind: 'hydration',
        sourcePackage: 'com.samsung.health',
        sourceLabel: 'Samsung Health',
        start: currentStart,
        end: todayStart,
        value: 12,
        unit: 'litre',
      },
    ];
    const report = buildInsightReport(current, previous, now, {
      current: {
        metrics: {
          hydrationLitres: 12,
          sourceLabels: ['Samsung Health'],
          needsSource: ['steps'],
          recordCount: conflictingSteps.length,
          selectedRecordIds: ['current-hydration-only'],
        },
        records: conflictingSteps,
      },
      previous: {
        metrics: {
          sourceLabels: [],
          needsSource: [],
          recordCount: 0,
          selectedRecordIds: [],
        },
        records: [],
      },
    });

    const sourceChoice = report.findings.find(
      (finding) => finding.id === 'health-connect-source-choice',
    );
    const comparability = report.findings.find(
      (finding) => finding.id === 'health-context-comparability',
    );
    expect(sourceChoice?.summary).toContain('steps');
    expect(sourceChoice?.evidence[0]?.recordIds).toEqual([
      'samsung-steps',
      'fitbit-steps',
    ]);
    expect(comparability?.summary).toContain('hydration');
    expect(comparability?.summary).toContain(
      'does not treat the other window as zero',
    );
    expect(comparability?.evidence[0]?.recordIds).toEqual([
      'current-hydration-only',
    ]);
    expect(
      report.findings.some(
        (finding) => finding.id === 'health-connect-hydration',
      ),
    ).toBe(false);
  });

  it('withholds comparisons when personal history coverage is insufficient', () => {
    const emptyWindow = (
      start: number,
      end: number,
    ): TimelineData => ({
      range: { start, end },
      glucose: [],
      basal: [],
      boluses: [],
      context: [],
      sources: [
        {
          id: 'daymark-librelinkup',
          label: 'Glucose',
          detail: 'Collecting',
          freshness: 'missing',
          origin: 'live',
          isLive: true,
        },
        {
          id: 'insulin-not-connected',
          label: 'Insulin',
          detail: 'Not connected',
          freshness: 'missing',
          origin: 'delayed',
          isLive: false,
        },
      ],
    });
    const now = Date.parse('2026-07-26T10:00:00+01:00');
    const report = buildInsightReport(
      emptyWindow(now - 7 * 86_400_000, now),
      emptyWindow(now - 14 * 86_400_000, now - 7 * 86_400_000),
      now,
    );

    expect(report.ready).toBe(false);
    expect(report.headline).toBe('Building a trustworthy baseline');
    expect(report.findings).toHaveLength(1);
    expect(
      answerInsightQuestion('Why was glucose worse?', report).answer,
    ).toContain('not enough comparable coverage');
  });

  it('reports material sensor gaps without interpreting them as physiology', () => {
    const end = Date.parse('2026-07-26T00:00:00+01:00');
    const week = 7 * 24 * 60 * 60_000;
    const makeWindow = (
      start: number,
      gapStart?: number,
      gapEnd?: number,
    ): TimelineData => {
      const glucose: GlucoseReading[] = [];
      for (let timestamp = start; timestamp < start + week; timestamp += 5 * 60_000) {
        if (
          gapStart !== undefined &&
          gapEnd !== undefined &&
          timestamp >= gapStart &&
          timestamp < gapEnd
        ) {
          continue;
        }
        glucose.push({
          id: `glucose:${timestamp}`,
          timestamp,
          receivedAt: timestamp,
          mmolL: 6.5,
          trend: 'flat',
          quality: 'measured',
          sourceId: 'daymark-librelinkup',
        });
      }
      return {
        range: { start, end: start + week },
        glucose,
        basal: [],
        boluses: [],
        context: [],
        sources: [
          {
            id: 'insulin-not-connected',
            label: 'Insulin',
            detail: 'Not connected',
            freshness: 'missing',
            origin: 'delayed',
            isLive: false,
          },
        ],
      };
    };
    const currentStart = end - week;
    const previousStart = currentStart - week;
    const current = makeWindow(
      currentStart,
      currentStart + 2 * 24 * 60 * 60_000,
      currentStart + 2 * 24 * 60 * 60_000 + 8 * 60 * 60_000,
    );
    const report = buildInsightReport(
      current,
      makeWindow(previousStart),
      end,
    );

    const finding = report.findings.find(
      (item) => item.id === 'glucose-data-completeness',
    );
    expect(finding?.summary).toContain('longest uncovered interval');
    expect(finding?.caveat).toContain('does not interpret');
    expect(
      answerInsightQuestion('Were there missing sensor gaps?', report)
        .findingIds,
    ).toContain('glucose-data-completeness');
    expect(
      answerInsightQuestion('Were there missing sensor gaps?', report)
        .answer,
    ).toContain('longest uncovered interval');
  });
});
