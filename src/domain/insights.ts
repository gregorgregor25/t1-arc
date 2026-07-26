import {
  ActivityEvent,
  GlucoseReading,
  HealthContextEvent,
  MealEvent,
  SleepEvent,
  TimelineData,
} from './models';
import { calculateGlucoseStats, calculateInsulinStats } from './stats';

export type InsightCategory =
  | 'glucose'
  | 'insulin'
  | 'food'
  | 'sleep'
  | 'activity'
  | 'data-quality';

export type InsightKind = 'observation' | 'context-clue' | 'limitation';

export interface EvidenceRecordPreview {
  id: string;
  kind: 'glucose' | 'basal' | 'bolus' | 'context';
  timestamp: number;
  primary: string;
  secondary: string;
  sourceId: string;
}

export interface EvidenceReference {
  id: string;
  label: string;
  description: string;
  range: { start: number; end: number };
  recordIds: string[];
  examples: EvidenceRecordPreview[];
}

export interface InsightFinding {
  id: string;
  kind: InsightKind;
  category: InsightCategory;
  title: string;
  summary: string;
  caveat?: string;
  evidence: EvidenceReference[];
}

export interface InsightWindowSummary {
  glucoseAverage: number | null;
  glucoseStandardDeviation: number | null;
  glucoseCvPercent: number | null;
  timeInRangePercent: number;
  timeAbovePercent: number;
  timeBelowPercent: number;
  coveragePercent: number;
  glucoseReadings: number;
  highGlucoseRuns: number;
  lowGlucoseRuns: number;
  insulinUnits: number | null;
  mealCarbsPerDay: number | null;
  lateMeals: number;
  sleepMinutesPerNight: number | null;
  activityMinutes: number | null;
}

export interface InsightReport {
  generatedAt: number;
  currentRange: { start: number; end: number };
  previousRange: { start: number; end: number };
  ready: boolean;
  headline: string;
  summary: string;
  current: InsightWindowSummary;
  previous: InsightWindowSummary;
  findings: InsightFinding[];
}

export interface InsightAnswer {
  title: string;
  answer: string;
  findingIds: string[];
}

export interface GlucoseEpisode {
  id: string;
  kind: 'high' | 'low';
  start: number;
  end: number;
  readings: GlucoseReading[];
  extremeMmolL: number;
}

interface ObservedMealWindow {
  meal: MealEvent;
  baseline: GlucoseReading;
  peak: GlucoseReading;
  readings: GlucoseReading[];
  riseMmolL: number;
}

function round(value: number, decimals = 0) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function signed(value: number, suffix = '') {
  const rounded = round(value, 1);
  return `${rounded > 0 ? '+' : ''}${rounded}${suffix}`;
}

function localHour(timestamp: number) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    hour: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(timestamp);
  return Number(parts.find((part) => part.type === 'hour')?.value ?? 0);
}

function glucosePreview(reading: GlucoseReading): EvidenceRecordPreview {
  return {
    id: reading.id,
    kind: 'glucose',
    timestamp: reading.timestamp,
    primary: `${reading.mmolL.toFixed(1)} mmol/L`,
    secondary: reading.quality,
    sourceId: reading.sourceId,
  };
}

function representativeGlucose(readings: GlucoseReading[]) {
  if (readings.length === 0) return [];
  const sorted = [...readings].sort((a, b) => a.timestamp - b.timestamp);
  const highest = [...readings].sort((a, b) => b.mmolL - a.mmolL)[0]!;
  const lowest = [...readings].sort((a, b) => a.mmolL - b.mmolL)[0]!;
  return [...new Map(
    [sorted[0]!, highest, lowest, sorted[sorted.length - 1]!].map((reading) => [
      reading.id,
      glucosePreview(reading),
    ]),
  ).values()];
}

const MAX_EPISODE_GAP_MS = 12 * 60_000;
const MIN_EPISODE_SPAN_MS = 4 * 60_000;

export function detectGlucoseEpisodes(
  readings: GlucoseReading[],
  kind: 'high' | 'low',
): GlucoseEpisode[] {
  const sorted = [...readings].sort((a, b) => a.timestamp - b.timestamp);
  const qualifies = (reading: GlucoseReading) =>
    kind === 'high' ? reading.mmolL > 10 : reading.mmolL < 3.9;
  const episodes: GlucoseEpisode[] = [];
  let run: GlucoseReading[] = [];

  function finishRun() {
    const first = run[0];
    const last = run[run.length - 1];
    if (
      first &&
      last &&
      run.length >= 2 &&
      last.timestamp - first.timestamp >= MIN_EPISODE_SPAN_MS
    ) {
      episodes.push({
        id: `${kind}:${first.timestamp}:${last.timestamp}`,
        kind,
        start: first.timestamp,
        end: last.timestamp,
        readings: run,
        extremeMmolL:
          kind === 'high'
            ? Math.max(...run.map((reading) => reading.mmolL))
            : Math.min(...run.map((reading) => reading.mmolL)),
      });
    }
    run = [];
  }

  for (const reading of sorted) {
    if (!qualifies(reading)) {
      finishRun();
      continue;
    }
    const previous = run[run.length - 1];
    if (
      previous &&
      reading.timestamp - previous.timestamp > MAX_EPISODE_GAP_MS
    ) {
      finishRun();
    }
    run.push(reading);
  }
  finishRun();
  return episodes;
}

function observedMealWindows(data: TimelineData): ObservedMealWindow[] {
  const readings = [...data.glucose].sort(
    (a, b) => a.timestamp - b.timestamp,
  );
  const meals = data.context
    .filter((event): event is MealEvent => event.kind === 'meal')
    .sort((a, b) => a.start - b.start);

  return meals.flatMap((meal, index) => {
    const nextMeal = meals[index + 1];
    const windowEnd = Math.min(
      meal.start + 3 * 60 * 60_000,
      nextMeal?.start ?? Number.POSITIVE_INFINITY,
      data.range.end,
    );
    const baseline = readings
      .filter(
        (reading) =>
          reading.timestamp >= meal.start - 15 * 60_000 &&
          reading.timestamp <= meal.start + 15 * 60_000,
      )
      .sort(
        (a, b) =>
          Math.abs(a.timestamp - meal.start) -
          Math.abs(b.timestamp - meal.start),
      )[0];
    const after = readings.filter(
      (reading) =>
        reading.timestamp >= meal.start && reading.timestamp <= windowEnd,
    );
    const finalReading = after[after.length - 1];
    const hasTwoHours =
      finalReading !== undefined &&
      finalReading.timestamp - meal.start >= 2 * 60 * 60_000;
    const hasLongGap = after.some((reading, readingIndex) => {
      const previous = after[readingIndex - 1];
      return (
        previous !== undefined &&
        reading.timestamp - previous.timestamp > 20 * 60_000
      );
    });
    if (!baseline || after.length < 18 || !hasTwoHours || hasLongGap) {
      return [];
    }
    const peak = [...after].sort((a, b) => b.mmolL - a.mmolL)[0]!;
    const allReadings = [
      ...new Map(
        [baseline, ...after].map((reading) => [reading.id, reading]),
      ).values(),
    ];
    return [
      {
        meal,
        baseline,
        peak,
        readings: allReadings,
        riseMmolL: round(peak.mmolL - baseline.mmolL, 1),
      },
    ];
  });
}

function glucoseEvidence(
  id: string,
  label: string,
  data: TimelineData,
): EvidenceReference {
  return {
    id,
    label,
    description: `${data.glucose.length} normalised glucose readings`,
    range: data.range,
    recordIds: data.glucose.map((reading) => reading.id),
    examples: representativeGlucose(data.glucose),
  };
}

function contextPreview(event: HealthContextEvent): EvidenceRecordPreview {
  let primary = event.title;
  let secondary: string;
  switch (event.kind) {
    case 'meal':
      secondary = `${event.carbsGrams} g carbohydrate`;
      break;
    case 'activity':
      secondary = `${event.durationMinutes} min ${event.intensity}`;
      break;
    case 'sleep':
      secondary = `${Math.floor(event.durationMinutes / 60)}h ${event.durationMinutes % 60}m`;
      break;
    case 'weight':
      secondary = `${event.kilograms.toFixed(1)} kg`;
      break;
    case 'medication':
      secondary =
        event.amount !== undefined
          ? `${event.amount}${event.unit ? ` ${event.unit}` : ''}`
          : 'Recorded event';
      break;
  }
  return {
    id: event.id,
    kind: 'context',
    timestamp: event.start,
    primary,
    secondary,
    sourceId: event.sourceId,
  };
}

function contextEvidence(
  id: string,
  label: string,
  events: HealthContextEvent[],
  range: { start: number; end: number },
): EvidenceReference {
  return {
    id,
    label,
    description: `${events.length} normalised context events`,
    range,
    recordIds: events.map((event) => event.id),
    examples: events.slice(0, 4).map(contextPreview),
  };
}

function insulinEvidence(
  id: string,
  label: string,
  data: TimelineData,
): EvidenceReference {
  const basalExamples = data.basal.slice(0, 2).map((delivery) => ({
    id: delivery.id,
    kind: 'basal' as const,
    timestamp: delivery.start,
    primary: `${delivery.rateUnitsPerHour.toFixed(2)} U/h basal`,
    secondary: `${delivery.units.toFixed(2)} U delivered`,
    sourceId: delivery.sourceId,
  }));
  const bolusExamples = data.boluses.slice(0, 2).map((delivery) => ({
    id: delivery.id,
    kind: 'bolus' as const,
    timestamp: delivery.timestamp,
    primary: `${delivery.units.toFixed(1)} U bolus`,
    secondary: 'Delivered event',
    sourceId: delivery.sourceId,
  }));
  return {
    id,
    label,
    description: `${data.basal.length} basal intervals and ${data.boluses.length} boluses`,
    range: data.range,
    recordIds: [
      ...data.basal.map((delivery) => delivery.id),
      ...data.boluses.map((delivery) => delivery.id),
    ],
    examples: [...basalExamples, ...bolusExamples],
  };
}

function episodeEvidence(
  id: string,
  label: string,
  episodes: GlucoseEpisode[],
  range: { start: number; end: number },
): EvidenceReference {
  const readings = [
    ...new Map(
      episodes
        .flatMap((episode) => episode.readings)
        .map((reading) => [reading.id, reading]),
    ).values(),
  ];
  return {
    id,
    label,
    description: `${episodes.length} sustained run${episodes.length === 1 ? '' : 's'} across ${readings.length} readings`,
    range,
    recordIds: readings.map((reading) => reading.id),
    examples: representativeGlucose(readings),
  };
}

function mealWindowEvidence(
  id: string,
  label: string,
  windows: ObservedMealWindow[],
  range: { start: number; end: number },
): EvidenceReference {
  const readings = [
    ...new Map(
      windows
        .flatMap((window) => window.readings)
        .map((reading) => [reading.id, reading]),
    ).values(),
  ];
  return {
    id,
    label,
    description: `${windows.length} recorded meal${windows.length === 1 ? '' : 's'} with at least 2 hours of nearby glucose coverage`,
    range,
    recordIds: [
      ...windows.map((window) => window.meal.id),
      ...readings.map((reading) => reading.id),
    ],
    examples: [
      ...windows.slice(0, 2).map((window) => contextPreview(window.meal)),
      ...representativeGlucose(readings).slice(0, 3),
    ],
  };
}

function average(values: number[]) {
  return values.length
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : null;
}

function summarize(data: TimelineData): InsightWindowSummary {
  const glucose = calculateGlucoseStats(data.glucose, data.range);
  const highGlucoseRuns = detectGlucoseEpisodes(data.glucose, 'high');
  const lowGlucoseRuns = detectGlucoseEpisodes(data.glucose, 'low');
  const insulinUnavailable = data.sources.some(
    (source) => source.label === 'Insulin' && source.freshness === 'missing',
  );
  const insulin = calculateInsulinStats(
    data.basal,
    data.boluses,
    data.range,
  );
  const meals = data.context.filter(
    (event): event is MealEvent => event.kind === 'meal',
  );
  const sleeps = data.context.filter(
    (event): event is SleepEvent => event.kind === 'sleep',
  );
  const activities = data.context.filter(
    (event): event is ActivityEvent => event.kind === 'activity',
  );
  const durationDays = Math.max(
    1,
    (data.range.end - data.range.start) / 86_400_000,
  );

  return {
    glucoseAverage: glucose.averageMmolL,
    glucoseStandardDeviation: glucose.standardDeviationMmolL,
    glucoseCvPercent: glucose.coefficientOfVariationPercent,
    timeInRangePercent: glucose.timeInRangePercent,
    timeAbovePercent: glucose.timeAbovePercent,
    timeBelowPercent: glucose.timeBelowPercent,
    coveragePercent: glucose.coveragePercent,
    glucoseReadings: data.glucose.length,
    highGlucoseRuns: highGlucoseRuns.length,
    lowGlucoseRuns: lowGlucoseRuns.length,
    insulinUnits: insulinUnavailable ? null : insulin.totalUnits,
    mealCarbsPerDay: meals.length
      ? round(
          meals.reduce((sum, event) => sum + event.carbsGrams, 0) /
            durationDays,
          1,
        )
      : null,
    lateMeals: meals.filter((event) => localHour(event.start) >= 20).length,
    sleepMinutesPerNight:
      average(sleeps.map((event) => event.durationMinutes)) === null
        ? null
        : round(average(sleeps.map((event) => event.durationMinutes))!, 0),
    activityMinutes: activities.length
      ? activities.reduce((sum, event) => sum + event.durationMinutes, 0)
      : null,
  };
}

const DAY_PARTS = [
  { id: 'overnight', label: 'Overnight', start: 0, end: 6 },
  { id: 'morning', label: 'Morning', start: 6, end: 12 },
  { id: 'afternoon', label: 'Afternoon', start: 12, end: 18 },
  { id: 'evening', label: 'Evening', start: 18, end: 24 },
] as const;

function highPercentByPart(readings: GlucoseReading[]) {
  return DAY_PARTS.map((part) => {
    const values = readings.filter((reading) => {
      const hour = localHour(reading.timestamp);
      return hour >= part.start && hour < part.end;
    });
    return {
      ...part,
      readings: values,
      highPercent: values.length
        ? (values.filter((reading) => reading.mmolL > 10).length /
            values.length) *
          100
        : 0,
    };
  });
}

export function buildInsightReport(
  currentData: TimelineData,
  previousData: TimelineData,
  generatedAt = Date.now(),
): InsightReport {
  const current = summarize(currentData);
  const previous = summarize(previousData);
  const ready =
    current.coveragePercent >= 70 &&
    previous.coveragePercent >= 70 &&
    current.glucoseReadings >= 100 &&
    previous.glucoseReadings >= 100;
  const findings: InsightFinding[] = [];

  if (!ready) {
    findings.push({
      id: 'baseline-limitation',
      kind: 'limitation',
      category: 'data-quality',
      title: 'More personal history is needed',
      summary: `Coverage is ${current.coveragePercent}% for the recent window and ${previous.coveragePercent}% for the comparison window. Daymark waits for at least 70% in both before comparing them.`,
      evidence: [
        glucoseEvidence('current-coverage', 'Recent window', currentData),
        glucoseEvidence('previous-coverage', 'Comparison window', previousData),
      ],
    });
    return {
      generatedAt,
      currentRange: currentData.range,
      previousRange: previousData.range,
      ready,
      headline: 'Building a trustworthy baseline',
      summary:
        'Daymark is collecting personal readings, but there is not enough comparable coverage yet for a responsible weekly explanation.',
      current,
      previous,
      findings,
    };
  }

  const tirDelta =
    current.timeInRangePercent - previous.timeInRangePercent;
  const averageDelta =
    (current.glucoseAverage ?? 0) - (previous.glucoseAverage ?? 0);
  const tirDirection =
    Math.abs(tirDelta) < 1
      ? 'was essentially unchanged'
      : tirDelta > 0
        ? `rose by ${round(tirDelta, 1)} percentage points`
        : `fell by ${round(Math.abs(tirDelta), 1)} percentage points`;
  findings.push({
    id: 'glucose-overview',
    kind: 'observation',
    category: 'glucose',
    title: `Time in range ${tirDirection}`,
    summary: `Recent time in range was ${current.timeInRangePercent}% versus ${previous.timeInRangePercent}%. Average glucose changed from ${previous.glucoseAverage?.toFixed(1)} to ${current.glucoseAverage?.toFixed(1)} mmol/L (${signed(averageDelta)} mmol/L).`,
    evidence: [
      glucoseEvidence('current-glucose', 'Recent 7 days', currentData),
      glucoseEvidence('previous-glucose', 'Previous 7 days', previousData),
    ],
  });

  if (
    current.glucoseCvPercent !== null &&
    previous.glucoseCvPercent !== null &&
    current.glucoseStandardDeviation !== null &&
    previous.glucoseStandardDeviation !== null
  ) {
    const cvDelta = current.glucoseCvPercent - previous.glucoseCvPercent;
    findings.push({
      id: 'glucose-variability',
      kind: 'observation',
      category: 'glucose',
      title: `Glucose variability ${Math.abs(cvDelta) < 1 ? 'was broadly similar' : cvDelta > 0 ? 'was higher' : 'was lower'}`,
      summary: `Coefficient of variation was ${current.glucoseCvPercent}% recently versus ${previous.glucoseCvPercent}% previously. Standard deviation was ${current.glucoseStandardDeviation.toFixed(1)} versus ${previous.glucoseStandardDeviation.toFixed(1)} mmol/L.`,
      caveat:
        'These are descriptive dispersion statistics calculated only across observed sensor time; they do not suggest a treatment change.',
      evidence: [
        glucoseEvidence(
          'current-variability',
          'Recent variability inputs',
          currentData,
        ),
        glucoseEvidence(
          'previous-variability',
          'Previous variability inputs',
          previousData,
        ),
      ],
    });
  }

  const currentHighRuns = detectGlucoseEpisodes(currentData.glucose, 'high');
  const currentLowRuns = detectGlucoseEpisodes(currentData.glucose, 'low');
  const previousHighRuns = detectGlucoseEpisodes(previousData.glucose, 'high');
  const previousLowRuns = detectGlucoseEpisodes(previousData.glucose, 'low');
  const allCurrentRuns = [...currentHighRuns, ...currentLowRuns];
  const allPreviousRuns = [...previousHighRuns, ...previousLowRuns];
  if (allCurrentRuns.length || allPreviousRuns.length) {
    findings.push({
      id: 'glucose-runs',
      kind: 'observation',
      category: 'glucose',
      title: `${current.highGlucoseRuns} high and ${current.lowGlucoseRuns} low sustained glucose runs`,
      summary: `The recent window contained ${current.highGlucoseRuns} high runs and ${current.lowGlucoseRuns} low runs, versus ${previous.highGlucoseRuns} high and ${previous.lowGlucoseRuns} low previously. A run requires at least two qualifying readings no more than 12 minutes apart.`,
      caveat:
        'This is a deterministic grouping of sensor readings, not a clinical diagnosis of an event.',
      evidence: [
        ...(allCurrentRuns.length
          ? [
              episodeEvidence(
                'current-glucose-runs',
                'Recent sustained runs',
                allCurrentRuns,
                currentData.range,
              ),
            ]
          : []),
        ...(allPreviousRuns.length
          ? [
              episodeEvidence(
                'previous-glucose-runs',
                'Previous sustained runs',
                allPreviousRuns,
                previousData.range,
              ),
            ]
          : []),
      ],
    });
  }

  const currentParts = highPercentByPart(currentData.glucose);
  const previousParts = highPercentByPart(previousData.glucose);
  const partChanges = currentParts
    .map((part, index) => ({
      ...part,
      previousHighPercent: previousParts[index]?.highPercent ?? 0,
      delta:
        part.highPercent - (previousParts[index]?.highPercent ?? 0),
    }))
    .sort((a, b) => b.delta - a.delta);
  const changedPart = partChanges[0];
  if (changedPart && changedPart.delta >= 3) {
    const currentPartReadings = changedPart.readings;
    const previousPartReadings =
      previousParts.find((part) => part.id === changedPart.id)?.readings ?? [];
    findings.push({
      id: 'high-timing',
      kind: 'observation',
      category: 'glucose',
      title: `${changedPart.label} highs increased most`,
      summary: `${round(changedPart.highPercent, 1)}% of ${changedPart.label.toLowerCase()} readings were above 10.0 mmol/L recently, compared with ${round(changedPart.previousHighPercent, 1)}% previously.`,
      evidence: [
        {
          id: 'current-high-timing',
          label: `Recent ${changedPart.label.toLowerCase()} readings`,
          description: `${currentPartReadings.length} glucose readings`,
          range: currentData.range,
          recordIds: currentPartReadings.map((reading) => reading.id),
          examples: representativeGlucose(currentPartReadings),
        },
        {
          id: 'previous-high-timing',
          label: `Previous ${changedPart.label.toLowerCase()} readings`,
          description: `${previousPartReadings.length} glucose readings`,
          range: previousData.range,
          recordIds: previousPartReadings.map((reading) => reading.id),
          examples: representativeGlucose(previousPartReadings),
        },
      ],
    });
  }

  if (current.insulinUnits !== null && previous.insulinUnits !== null) {
    const insulinDelta = current.insulinUnits - previous.insulinUnits;
    findings.push({
      id: 'insulin-change',
      kind: 'observation',
      category: 'insulin',
      title: `Delivered insulin changed by ${signed(insulinDelta, ' U')}`,
      summary: `The recent delayed records total ${current.insulinUnits.toFixed(1)} U versus ${previous.insulinUnits.toFixed(1)} U in the comparison window.`,
      caveat:
        'This describes delayed delivery records; it is not a recommendation or live pump status.',
      evidence: [
        insulinEvidence('current-insulin', 'Recent insulin records', currentData),
        insulinEvidence(
          'previous-insulin',
          'Previous insulin records',
          previousData,
        ),
      ],
    });
  }

  const currentMeals = currentData.context.filter(
    (event): event is MealEvent => event.kind === 'meal',
  );
  const previousMeals = previousData.context.filter(
    (event): event is MealEvent => event.kind === 'meal',
  );
  if (
    current.mealCarbsPerDay !== null &&
    previous.mealCarbsPerDay !== null
  ) {
    const carbDelta =
      current.mealCarbsPerDay - previous.mealCarbsPerDay;
    findings.push({
      id: 'food-context',
      kind: 'context-clue',
      category: 'food',
      title: `Logged carbohydrate context changed by ${signed(carbDelta, ' g/day')}`,
      summary: `The recent window averaged ${current.mealCarbsPerDay} g/day across the available meal records, with ${current.lateMeals} meals at or after 20:00 versus ${previous.lateMeals} previously.`,
      caveat:
        'This is a context change to inspect alongside glucose, not proof that food caused the glucose difference.',
      evidence: [
        contextEvidence(
          'current-meals',
          'Recent meal records',
          currentMeals,
          currentData.range,
        ),
        contextEvidence(
          'previous-meals',
          'Previous meal records',
          previousMeals,
          previousData.range,
        ),
      ],
    });
  }

  const currentMealWindows = observedMealWindows(currentData);
  const previousMealWindows = observedMealWindows(previousData);
  if (currentMealWindows.length >= 2 && previousMealWindows.length >= 2) {
    const currentRise =
      average(currentMealWindows.map((window) => window.riseMmolL)) ?? 0;
    const previousRise =
      average(previousMealWindows.map((window) => window.riseMmolL)) ?? 0;
    const riseDelta = currentRise - previousRise;
    findings.push({
      id: 'post-meal-pattern',
      kind: 'context-clue',
      category: 'food',
      title: `Observed post-meal rise ${Math.abs(riseDelta) < 0.2 ? 'was broadly similar' : riseDelta > 0 ? 'was higher' : 'was lower'}`,
      summary: `Across ${currentMealWindows.length} recorded meals with adequate nearby glucose coverage, the average rise from the reading nearest the meal to the highest reading in the following window was ${round(currentRise, 1)} mmol/L, versus ${round(previousRise, 1)} mmol/L across ${previousMealWindows.length} meals previously.`,
      caveat:
        'This is a time association, not proof of a food effect. Insulin, starting glucose, activity, meal composition and overlapping events may all contribute.',
      evidence: [
        mealWindowEvidence(
          'current-post-meal',
          'Recent meal windows',
          currentMealWindows,
          currentData.range,
        ),
        mealWindowEvidence(
          'previous-post-meal',
          'Previous meal windows',
          previousMealWindows,
          previousData.range,
        ),
      ],
    });
  }

  const currentSleeps = currentData.context.filter(
    (event): event is SleepEvent => event.kind === 'sleep',
  );
  const previousSleeps = previousData.context.filter(
    (event): event is SleepEvent => event.kind === 'sleep',
  );
  if (
    current.sleepMinutesPerNight !== null &&
    previous.sleepMinutesPerNight !== null
  ) {
    const sleepDelta =
      current.sleepMinutesPerNight - previous.sleepMinutesPerNight;
    findings.push({
      id: 'sleep-context',
      kind: 'context-clue',
      category: 'sleep',
      title: `Recorded sleep changed by ${signed(sleepDelta, ' min/night')}`,
      summary: `Average recorded sleep was ${round(current.sleepMinutesPerNight / 60, 1)} hours recently versus ${round(previous.sleepMinutesPerNight / 60, 1)} hours previously.`,
      caveat:
        'Sleep is shown as a possible context signal only; this comparison does not establish causation.',
      evidence: [
        contextEvidence(
          'current-sleep',
          'Recent sleep records',
          currentSleeps,
          currentData.range,
        ),
        contextEvidence(
          'previous-sleep',
          'Previous sleep records',
          previousSleeps,
          previousData.range,
        ),
      ],
    });
  }

  const currentActivities = currentData.context.filter(
    (event): event is ActivityEvent => event.kind === 'activity',
  );
  const previousActivities = previousData.context.filter(
    (event): event is ActivityEvent => event.kind === 'activity',
  );
  if (
    current.activityMinutes !== null &&
    previous.activityMinutes !== null
  ) {
    const activityDelta =
      current.activityMinutes - previous.activityMinutes;
    findings.push({
      id: 'activity-context',
      kind: 'context-clue',
      category: 'activity',
      title: `Recorded activity changed by ${signed(activityDelta, ' min')}`,
      summary: `The recent comparison contains ${current.activityMinutes} activity minutes versus ${previous.activityMinutes} previously.`,
      caveat:
        'Activity records are contextual evidence, not an instruction to change exercise or insulin.',
      evidence: [
        contextEvidence(
          'current-activity',
          'Recent activity records',
          currentActivities,
          currentData.range,
        ),
        contextEvidence(
          'previous-activity',
          'Previous activity records',
          previousActivities,
          previousData.range,
        ),
      ],
    });
  }

  return {
    generatedAt,
    currentRange: currentData.range,
    previousRange: previousData.range,
    ready,
    headline:
      tirDelta < -1
        ? 'Time in range was lower in the recent week'
        : tirDelta > 1
          ? 'Time in range was higher in the recent week'
          : averageDelta > 0.2
            ? 'Average glucose was higher in the recent week'
            : averageDelta < -0.2
              ? 'Average glucose was lower in the recent week'
              : 'The two weeks were broadly similar',
    summary: `Time in range ${tirDirection}. Daymark found ${findings.filter((finding) => finding.kind === 'context-clue').length} context changes worth inspecting; none is presented as a proven cause.`,
    current,
    previous,
    findings,
  };
}

export function answerInsightQuestion(
  question: string,
  report: InsightReport,
): InsightAnswer {
  if (!report.ready) {
    return {
      title: 'Not enough comparable history yet',
      answer: report.summary,
      findingIds: report.findings.map((finding) => finding.id),
    };
  }

  const normalized = question.trim().toLowerCase();
  const categories: InsightCategory[] =
    normalized.includes('insulin')
      ? ['insulin']
      : normalized.includes('sleep')
        ? ['sleep']
        : normalized.includes('food') ||
            normalized.includes('meal') ||
            normalized.includes('carb')
          ? ['food']
          : normalized.includes('exercise') ||
              normalized.includes('activity')
            ? ['activity']
            : normalized.includes('high')
              ? ['glucose']
              : ['glucose', 'insulin', 'food', 'sleep', 'activity'];
  const selected = report.findings.filter((finding) =>
    categories.includes(finding.category),
  );
  if (selected.length === 0) {
    return {
      title: 'No supported answer from these records',
      answer:
        'Daymark could not find enough relevant normalised records for that question. It will not fill the gap with a guess.',
      findingIds: [],
    };
  }

  const observations = selected.filter(
    (finding) => finding.kind === 'observation',
  );
  const clues = selected.filter(
    (finding) => finding.kind === 'context-clue',
  );
  return {
    title:
      categories.length > 1
        ? report.headline
        : `What the ${categories[0]} records show`,
    answer: [
      ...observations.map((finding) => finding.summary),
      ...clues.map((finding) => finding.summary),
      clues.length
        ? 'The context changes are associations to investigate, not proven causes.'
        : '',
    ]
      .filter(Boolean)
      .join(' '),
    findingIds: selected.map((finding) => finding.id),
  };
}
