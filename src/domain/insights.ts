import {
  ActivityEvent,
  ContextNoteEvent,
  GlucoseReading,
  HealthContextEvent,
  InsulinDailyTotal,
  MealEvent,
  MedicationEvent,
  SleepEvent,
  TARGET_HIGH_MMOL_L,
  TARGET_LOW_MMOL_L,
  TimelineData,
  WeightEvent,
} from './models';
import {
  DailyHealthMetrics,
  DailyMetricCategory,
  DailyMetricRecord,
} from './dailyHealthMetrics';
import {
  buildDataCompletenessReport,
  InsulinReconciliation,
} from './dataCompleteness';
import { contextNoteCategoryLabel } from './contextNotes';
import { calculateGlucoseStats, calculateInsulinStats } from './stats';
import {
  addDays,
  toDateKey,
  zonedDateTimeToTimestamp,
} from './time';

export type InsightCategory =
  | 'glucose'
  | 'insulin'
  | 'food'
  | 'sleep'
  | 'activity'
  | 'heart'
  | 'weight'
  | 'body'
  | 'vitals'
  | 'hydration'
  | 'medication'
  | 'context'
  | 'data-quality';

export type InsightKind = 'observation' | 'context-clue' | 'limitation';

export interface EvidenceRecordPreview {
  id: string;
  kind:
    | 'glucose'
    | 'basal'
    | 'bolus'
    | 'insulin-total'
    | 'context'
    | 'health-metric'
    | 'source-record';
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
  insulinUnitsPerDay?: number;
  basalUnitsPerDay?: number;
  bolusUnitsPerDay?: number;
  mealCarbsPerDay: number | null;
  lateMeals: number;
  sleepMinutesPerNight: number | null;
  activityMinutes: number | null;
  stepsPerDay?: number;
  distanceKilometresPerDay?: number;
  activeCaloriesPerDay?: number;
  averageHeartRateBpm?: number;
  restingHeartRateBpm?: number;
  averageWeightKilograms?: number;
  weightRecords?: number;
  bodyFatPercent?: number;
  leanBodyMassKilograms?: number;
  bodyWaterMassKilograms?: number;
  hydrationLitresPerDay?: number;
  healthConnectBloodGlucoseMmolL?: number;
  bloodPressureSystolic?: number;
  bloodPressureDiastolic?: number;
  oxygenSaturationPercent?: number;
  respiratoryRatePerMinute?: number;
  heartRateVariabilityRmssdMs?: number;
  vo2MaxMillilitresPerKilogramMinute?: number;
  bodyTemperatureCelsius?: number;
}

export interface InsightHealthContext {
  metrics: DailyHealthMetrics;
  records: DailyMetricRecord[];
}

export interface InsightHealthComparison {
  current?: InsightHealthContext;
  previous?: InsightHealthContext;
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

const QUESTION_CATEGORY_KEYWORDS: Record<InsightCategory, string[]> = {
  glucose: [
    'glucose',
    'sugar',
    'high',
    'hyper',
    'low',
    'hypo',
    'range',
    'variability',
    'stable',
    'spike',
    'overnight',
    'morning',
  ],
  insulin: [
    'insulin',
    'bolus',
    'basal',
    'pump',
    'units',
    'total daily dose',
    'tdd',
  ],
  food: [
    'food',
    'meal',
    'carb',
    'breakfast',
    'lunch',
    'dinner',
    'snack',
    'eating',
  ],
  sleep: ['sleep', 'slept', 'bed', 'night', 'rest'],
  activity: [
    'exercise',
    'activity',
    'active',
    'workout',
    'steps',
    'walk',
    'run',
    'cycling',
    'gym',
  ],
  heart: [
    'heart',
    'heart rate',
    'pulse',
    'bpm',
    'resting heart rate',
  ],
  weight: ['weight', 'body weight', 'kilogram', 'kilo', 'kg'],
  body: [
    'body composition',
    'body fat',
    'lean mass',
    'muscle mass',
    'body water',
    'bone mass',
  ],
  vitals: [
    'vitals',
    'blood pressure',
    'blood oxygen',
    'oxygen saturation',
    'spo2',
    'respiratory rate',
    'breathing rate',
    'hrv',
    'vo2',
    'temperature',
  ],
  hydration: ['hydration', 'water intake', 'drank', 'litres', 'liters'],
  medication: [
    'medication',
    'medicine',
    'tablet',
    'prescription',
    'drug',
  ],
  context: [
    'illness',
    'ill',
    'sick',
    'stress',
    'pod',
    'site',
    'sensor issue',
    'hormone',
    'period',
    'menstrual',
    'travel',
    'jet lag',
    'context',
    'note',
  ],
  'data-quality': [
    'coverage',
    'missing',
    'gap',
    'stale',
    'sensor',
    'data quality',
    'enough data',
  ],
};

const CATEGORY_ANSWER_LABELS: Record<InsightCategory, string> = {
  glucose: 'glucose records',
  insulin: 'insulin records',
  food: 'food records',
  sleep: 'sleep records',
  activity: 'activity records',
  heart: 'heart-rate records',
  weight: 'weight records',
  body: 'body-composition records',
  vitals: 'vital-sign records',
  hydration: 'hydration records',
  medication: 'medication records',
  context: 'recorded context notes',
  'data-quality': 'data coverage',
};

function asksForTreatmentAdvice(question: string) {
  const advice =
    /\b(how much|what dose|should i|do i need|recommend|calculate|take|give|change my|adjust my|set my)\b/;
  const treatment =
    /\b(insulin|bolus|basal|correction|pump setting|carb ratio|sensitivity|units?|medication|medicine|tablet|prescription|drug)\b/;
  return advice.test(question) && treatment.test(question);
}

export function classifyInsightQuestion(question: string): InsightCategory[] {
  const normalized = question.trim().toLowerCase();
  const categories = (Object.keys(
    QUESTION_CATEGORY_KEYWORDS,
  ) as InsightCategory[]).filter((category) =>
    QUESTION_CATEGORY_KEYWORDS[category].some((keyword) =>
      normalized.includes(keyword),
    ),
  );
  if (
    categories.length === 1 &&
    categories[0] === 'glucose' &&
    /\b(why|worse|better|different|change|changed)\b/.test(normalized)
  ) {
    return [
      'glucose',
      'insulin',
      'food',
      'sleep',
      'activity',
      'heart',
      'weight',
      'body',
      'vitals',
      'hydration',
      'medication',
      'context',
    ];
  }
  return categories.length
    ? categories
    : [
        'glucose',
        'insulin',
        'food',
        'sleep',
        'activity',
        'heart',
        'weight',
        'body',
        'vitals',
        'hydration',
        'medication',
        'context',
      ];
}

export interface GlucoseEpisode {
  id: string;
  kind: 'high' | 'low';
  start: number;
  end: number;
  readings: GlucoseReading[];
  extremeMmolL: number;
}

export interface ObservedMealWindow {
  meal: MealEvent;
  baseline: GlucoseReading;
  peak: GlucoseReading;
  readings: GlucoseReading[];
  riseMmolL: number;
}

export interface RepeatedMealPattern {
  key: string;
  label: string;
  mealType: MealEvent['mealType'];
  windows: ObservedMealWindow[];
  averageRiseMmolL: number;
  minimumRiseMmolL: number;
  maximumRiseMmolL: number;
}

function round(value: number, decimals = 0) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function signed(value: number, suffix = '') {
  const rounded = round(value, 1);
  return `${rounded > 0 ? '+' : ''}${rounded}${suffix}`;
}

function rangeDays(range: { start: number; end: number }) {
  return Math.max(1, Math.round((range.end - range.start) / 86_400_000));
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

export function glucoseEpisodeDurationMinutes(episode: GlucoseEpisode) {
  return Math.max(0, Math.round((episode.end - episode.start) / 60_000));
}

export function glucoseEpisodeBurden(episode: GlucoseEpisode) {
  const threshold = episode.kind === 'high' ? 10 : 3.9;
  return round(
    episode.readings.slice(1).reduce((total, reading, index) => {
      const previous = episode.readings[index]!;
      const minutes = Math.min(
        MAX_EPISODE_GAP_MS / 60_000,
        Math.max(0, (reading.timestamp - previous.timestamp) / 60_000),
      );
      const previousExcursion = Math.abs(previous.mmolL - threshold);
      const currentExcursion = Math.abs(reading.mmolL - threshold);
      return total + ((previousExcursion + currentExcursion) / 2) * minutes;
    }, 0),
    1,
  );
}

export function rankGlucoseEpisodes(
  episodes: GlucoseEpisode[],
  limit = episodes.length,
) {
  return [...episodes]
    .sort((a, b) => {
      const burden = glucoseEpisodeBurden(b) - glucoseEpisodeBurden(a);
      if (burden !== 0) return burden;
      return b.end - b.start - (a.end - a.start);
    })
    .slice(0, Math.max(0, limit));
}

export function observedMealWindows(
  data: TimelineData,
): ObservedMealWindow[] {
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

export function repeatedMealPatterns(
  windows: ObservedMealWindow[],
  minimumOccurrences = 3,
): RepeatedMealPattern[] {
  const grouped = new Map<string, ObservedMealWindow[]>();
  windows.forEach((window) => {
    const normalizedTitle = window.meal.title.trim().toLocaleLowerCase('en-GB');
    const key = `${window.meal.mealType}:${normalizedTitle}`;
    grouped.set(key, [...(grouped.get(key) ?? []), window]);
  });

  return [...grouped.entries()]
    .filter(([, values]) => values.length >= minimumOccurrences)
    .map(([key, values]) => {
      const rises = values.map((value) => value.riseMmolL);
      return {
        key,
        label: values[0]!.meal.title.trim(),
        mealType: values[0]!.meal.mealType,
        windows: [...values].sort(
          (a, b) => a.meal.start - b.meal.start,
        ),
        averageRiseMmolL: round(average(rises) ?? 0, 1),
        minimumRiseMmolL: round(Math.min(...rises), 1),
        maximumRiseMmolL: round(Math.max(...rises), 1),
      };
    })
    .sort((a, b) => {
      const rise = b.averageRiseMmolL - a.averageRiseMmolL;
      if (rise !== 0) return rise;
      const count = b.windows.length - a.windows.length;
      if (count !== 0) return count;
      return a.label.localeCompare(b.label, 'en-GB');
    });
}

export function buildMealResponseEvidence(
  response: ObservedMealWindow,
  data: TimelineData,
): EvidenceReference {
  const windowStart = Math.max(
    data.range.start,
    response.meal.start - 30 * 60_000,
  );
  const finalReading = response.readings.reduce((latest, reading) =>
    reading.timestamp > latest.timestamp ? reading : latest,
  );
  // Timeline ranges use an exclusive end. Advance one millisecond so the
  // final supporting reading can be resolved again by the evidence inspector.
  const windowEnd = Math.min(
    data.range.end,
    Math.max(response.meal.start + 1, finalReading.timestamp + 1),
  );
  const boluses = data.boluses.filter(
    (delivery) =>
      delivery.timestamp >= windowStart && delivery.timestamp <= windowEnd,
  );
  const basal = data.basal.filter(
    (delivery) =>
      delivery.start <= windowEnd && delivery.end >= response.meal.start,
  );
  const minutesToPeak = Math.max(
    0,
    Math.round(
      (response.peak.timestamp - response.meal.start) / 60_000,
    ),
  );
  const bolusExamples = boluses.slice(0, 1).map((delivery) => ({
    id: delivery.id,
    kind: 'bolus' as const,
    timestamp: delivery.timestamp,
    primary: `${delivery.units.toFixed(1)} U bolus`,
    secondary: 'Nearby recorded delivery',
    sourceId: delivery.sourceId,
  }));
  const basalExamples = basal.slice(0, 1).map((delivery) => ({
    id: delivery.id,
    kind: 'basal' as const,
    timestamp: delivery.start,
    primary: `${delivery.rateUnitsPerHour.toFixed(2)} U/h basal`,
    secondary: `${delivery.units.toFixed(2)} U delivered in interval`,
    sourceId: delivery.sourceId,
  }));

  return {
    id: `meal-response:${response.meal.id}`,
    label: `${response.meal.title} · ${signed(response.riseMmolL, ' mmol/L')} observed change`,
    description: `${response.readings.length} glucose readings from ${response.baseline.mmolL.toFixed(1)} to a ${response.peak.mmolL.toFixed(1)} mmol/L peak ${minutesToPeak} minutes after the meal, plus ${boluses.length + basal.length} nearby insulin records. This is a time association, not proof of a food or insulin effect`,
    range: {
      start: windowStart,
      end: Math.max(windowStart + 1, windowEnd),
    },
    recordIds: [
      response.meal.id,
      ...response.readings.map((reading) => reading.id),
      ...boluses.map((delivery) => delivery.id),
      ...basal.map((delivery) => delivery.id),
    ],
    examples: [
      contextPreview(response.meal),
      glucosePreview(response.baseline),
      glucosePreview(response.peak),
      ...bolusExamples,
      ...basalExamples,
    ],
  };
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
    case 'note':
      secondary = event.detail
        ? `${contextNoteCategoryLabel(event.category)} · ${event.detail}`
        : contextNoteCategoryLabel(event.category);
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

export function buildContextEventEvidence(
  event: HealthContextEvent,
  data: TimelineData,
): EvidenceReference {
  const eventEnd = event.end ?? event.start;
  const desiredStart =
    event.kind === 'sleep'
      ? event.start
      : event.start - 60 * 60_000;
  const desiredEnd =
    event.kind === 'sleep'
      ? eventEnd + 60 * 60_000
      : eventEnd + 3 * 60 * 60_000;
  const range = {
    start: Math.max(data.range.start, desiredStart),
    end: Math.max(
      Math.max(data.range.start, desiredStart) + 1,
      Math.min(data.range.end, desiredEnd),
    ),
  };
  const glucose = data.glucose.filter(
    (reading) =>
      reading.timestamp >= range.start && reading.timestamp < range.end,
  );
  const boluses = data.boluses.filter(
    (delivery) =>
      delivery.timestamp >= range.start && delivery.timestamp < range.end,
  );
  const basal = data.basal.filter(
    (delivery) =>
      delivery.start < range.end && delivery.end > range.start,
  );
  const nearbyContext = data.context.filter(
    (candidate) =>
      candidate.id !== event.id &&
      candidate.start < range.end &&
      (candidate.end ?? candidate.start) >= range.start,
  );
  const bolusExamples = boluses.slice(0, 1).map((delivery) => ({
    id: delivery.id,
    kind: 'bolus' as const,
    timestamp: delivery.timestamp,
    primary: `${delivery.units.toFixed(1)} U bolus`,
    secondary: 'Nearby recorded delivery',
    sourceId: delivery.sourceId,
  }));
  const basalExamples = basal.slice(0, 1).map((delivery) => ({
    id: delivery.id,
    kind: 'basal' as const,
    timestamp: delivery.start,
    primary: `${delivery.rateUnitsPerHour.toFixed(2)} U/h basal`,
    secondary: `${delivery.units.toFixed(2)} U delivered in interval`,
    sourceId: delivery.sourceId,
  }));

  return {
    id: `context-window:${event.id}`,
    label: `${event.title} · nearby records`,
    description: `${glucose.length} glucose, ${boluses.length + basal.length} insulin, and ${nearbyContext.length} other context records in the loaded time window. Proximity is shown for inspection and does not establish cause`,
    range,
    recordIds: [
      event.id,
      ...glucose.map((reading) => reading.id),
      ...boluses.map((delivery) => delivery.id),
      ...basal.map((delivery) => delivery.id),
      ...nearbyContext.map((candidate) => candidate.id),
    ],
    examples: [
      contextPreview(event),
      ...representativeGlucose(glucose).slice(0, 2),
      ...bolusExamples,
      ...basalExamples,
      ...nearbyContext.slice(0, 1).map(contextPreview),
    ],
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

function noteCategorySummary(notes: ContextNoteEvent[]) {
  const counts = new Map<ContextNoteEvent['category'], number>();
  notes.forEach((note) =>
    counts.set(note.category, (counts.get(note.category) ?? 0) + 1),
  );
  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1])
    .map(
      ([category, count]) =>
        `${contextNoteCategoryLabel(category)} (${count})`,
    )
    .join(', ');
}

function medicationEntrySummary(events: MedicationEvent[]) {
  if (!events.length) return 'none recorded';
  const counts = new Map<string, number>();
  events.forEach((event) => {
    const amount =
      event.amount === undefined
        ? ''
        : ` · ${event.amount}${event.unit ? ` ${event.unit}` : ''}`;
    const label = `${event.title}${amount}`;
    counts.set(label, (counts.get(label) ?? 0) + 1);
  });
  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, 4)
    .map(([label, count]) => (count === 1 ? label : `${label} (${count})`))
    .join(', ');
}

function healthMetricPreview(
  record: DailyMetricRecord,
): EvidenceRecordPreview {
  const primary = (() => {
    switch (record.kind) {
      case 'steps':
        return `${Math.round(record.value).toLocaleString('en-GB')} steps`;
      case 'distance':
        return `${(record.value / 1_000).toFixed(2)} km`;
      case 'elevation_gained':
        return `${Math.round(record.value)} m elevation`;
      case 'floors_climbed':
        return `${record.value.toFixed(1)} floors`;
      case 'active_calories':
        return `${Math.round(record.value)} kcal active energy`;
      case 'total_calories':
        return `${Math.round(record.value)} kcal total energy`;
      case 'workout_power':
        return `${Math.round(record.value)} W`;
      case 'workout_speed':
        return `${(record.value * 3.6).toFixed(1)} km/h`;
      case 'walking_cadence':
        return `${Math.round(record.value)} steps/min`;
      case 'cycling_cadence':
        return `${Math.round(record.value)} rpm`;
      case 'heart_rate':
        return `${Math.round(record.value)} bpm`;
      case 'resting_heart_rate':
        return `${Math.round(record.value)} bpm resting`;
      case 'weight':
      case 'lean_body_mass':
      case 'body_water_mass':
      case 'bone_mass':
        return `${record.value.toFixed(1)} kg`;
      case 'height':
        return `${Math.round(record.value * 100)} cm`;
      case 'basal_metabolic_rate':
        return `${Math.round(record.value)} kcal/day basal metabolism`;
      case 'blood_glucose':
        return `${record.value.toFixed(1)} mmol/L Health Connect glucose`;
      case 'body_fat':
      case 'oxygen_saturation':
        return `${record.value.toFixed(1)}%`;
      case 'blood_pressure_systolic':
        return `${Math.round(record.value)} mmHg systolic`;
      case 'blood_pressure_diastolic':
        return `${Math.round(record.value)} mmHg diastolic`;
      case 'respiratory_rate':
        return `${record.value.toFixed(1)} breaths/min`;
      case 'heart_rate_variability_rmssd':
        return `${Math.round(record.value)} ms HRV`;
      case 'vo2_max':
        return `${record.value.toFixed(1)} ml/kg/min VO₂ max`;
      case 'body_temperature':
        return `${record.value.toFixed(1)} °C`;
      case 'hydration':
        return `${record.value.toFixed(2)} L hydration`;
    }
  })();
  return {
    id: record.id,
    kind: 'health-metric',
    timestamp: record.start,
    primary,
    secondary: record.sourceLabel,
    sourceId: `health-connect:${record.sourcePackage}`,
  };
}

function healthMetricEvidence(
  id: string,
  label: string,
  input: InsightHealthContext,
  range: { start: number; end: number },
  kinds: DailyMetricRecord['kind'][],
  selectedOnly = true,
): EvidenceReference {
  const selectedIds = new Set(input.metrics.selectedRecordIds);
  const records = input.records.filter(
    (record) =>
      (!selectedOnly || selectedIds.has(record.id)) &&
      kinds.includes(record.kind),
  );
  return {
    id,
    label,
    description: `${records.length} source-selected Health Connect records${
      input.metrics.sourceLabels.length
        ? ` from ${input.metrics.sourceLabels.join(', ')}`
        : ''
    }`,
    range,
    recordIds: records.map((record) => record.id),
    examples: records.slice(0, 4).map(healthMetricPreview),
  };
}

const HEALTH_CATEGORY_KINDS: Record<
  DailyMetricCategory,
  DailyMetricRecord['kind'][]
> = {
  steps: ['steps'],
  distance: ['distance', 'elevation_gained', 'floors_climbed'],
  active_calories: ['active_calories', 'total_calories'],
  workouts: [
    'workout_power',
    'workout_speed',
    'walking_cadence',
    'cycling_cadence',
  ],
  heart_rate: ['heart_rate', 'resting_heart_rate'],
  weight: ['weight'],
  body_composition: [
    'body_fat',
    'lean_body_mass',
    'body_water_mass',
    'bone_mass',
    'height',
    'basal_metabolic_rate',
  ],
  blood_glucose: ['blood_glucose'],
  vitals: [
    'blood_pressure_systolic',
    'blood_pressure_diastolic',
    'oxygen_saturation',
    'respiratory_rate',
    'heart_rate_variability_rmssd',
    'vo2_max',
    'body_temperature',
  ],
  hydration: ['hydration'],
};

function healthCategoryLabel(category: DailyMetricCategory) {
  switch (category) {
    case 'active_calories':
      return 'active energy';
    case 'heart_rate':
      return 'heart rate';
    case 'workouts':
      return 'workout detail';
    case 'body_composition':
      return 'body composition';
    case 'blood_glucose':
      return 'Health Connect glucose';
    default:
      return category;
  }
}

function healthKindsForCategories(categories: DailyMetricCategory[]) {
  return [
    ...new Set(
      categories.flatMap((category) => HEALTH_CATEGORY_KINDS[category]),
    ),
  ];
}

function hasSelectedHealthRecords(
  input: InsightHealthContext | undefined,
  kinds: DailyMetricRecord['kind'][],
) {
  if (!input) return false;
  const selectedIds = new Set(input.metrics.selectedRecordIds);
  return input.records.some(
    (record) => selectedIds.has(record.id) && kinds.includes(record.kind),
  );
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

function dailyInsulinTotalPreview(
  total: InsulinDailyTotal,
): EvidenceRecordPreview {
  const parts = [
    total.basalUnits === undefined
      ? undefined
      : `${total.basalUnits.toFixed(1)} U basal`,
    total.bolusUnits === undefined
      ? undefined
      : `${total.bolusUnits.toFixed(1)} U bolus`,
  ].filter((part): part is string => Boolean(part));
  return {
    id: total.id,
    kind: 'insulin-total',
    timestamp: total.timestamp,
    primary: `${total.totalUnits.toFixed(1)} U source daily total`,
    secondary: parts.length
      ? parts.join(' · ')
      : 'Reported aggregate insulin total',
    sourceId: total.sourceId,
  };
}

function insulinReconciliationEvidence(
  id: string,
  label: string,
  data: TimelineData,
  reconciliation: InsulinReconciliation,
): EvidenceReference {
  const reportedIds = new Set(reconciliation.reportedRecordIds);
  const organisedIds = new Set(reconciliation.organisedRecordIds);
  const totals = (data.dailyInsulinTotals ?? []).filter((total) =>
    reportedIds.has(total.id),
  );
  const basal = data.basal.filter((delivery) =>
    organisedIds.has(delivery.id),
  );
  const boluses = data.boluses.filter((delivery) =>
    organisedIds.has(delivery.id),
  );
  return {
    id,
    label,
    description: `${reconciliation.reportedDays} source-reported daily total${reconciliation.reportedDays === 1 ? '' : 's'} compared only with detailed basal and bolus rows from the same complete London calendar day${reconciliation.reportedDays === 1 ? '' : 's'}`,
    range: data.range,
    recordIds: [
      ...reconciliation.reportedRecordIds,
      ...reconciliation.organisedRecordIds,
    ],
    examples: [
      ...totals.slice(0, 2).map(dailyInsulinTotalPreview),
      ...basal.slice(0, 1).map((delivery) => ({
        id: delivery.id,
        kind: 'basal' as const,
        timestamp: delivery.start,
        primary: `${delivery.rateUnitsPerHour.toFixed(2)} U/h basal`,
        secondary: `${delivery.units.toFixed(2)} U delivered`,
        sourceId: delivery.sourceId,
      })),
      ...boluses.slice(0, 1).map((delivery) => ({
        id: delivery.id,
        kind: 'bolus' as const,
        timestamp: delivery.timestamp,
        primary: `${delivery.units.toFixed(1)} U bolus`,
        secondary: 'Delivered event',
        sourceId: delivery.sourceId,
      })),
    ],
  };
}

function hasMaterialInsulinDifference(
  reconciliation: InsulinReconciliation | undefined,
) {
  if (!reconciliation) return false;
  return (
    Math.abs(reconciliation.differenceUnits) >
    Math.max(1, reconciliation.reportedTotalUnits * 0.05)
  );
}

function insulinReconciliationSummary(
  label: string,
  reconciliation: InsulinReconciliation,
) {
  return `${label}, Glooko reported ${reconciliation.reportedTotalUnits.toFixed(1)} U across ${reconciliation.reportedDays} complete day${reconciliation.reportedDays === 1 ? '' : 's'}, while the detailed basal and bolus rows from those same days totalled ${reconciliation.organisedTotalUnits.toFixed(1)} U (difference ${signed(reconciliation.differenceUnits, ' U')}).`;
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

export function buildGlucoseEpisodeEvidence(
  episode: GlucoseEpisode,
  data: TimelineData,
): EvidenceReference {
  const contextStart = Math.max(data.range.start, episode.start - 3 * 60 * 60_000);
  const contextEnd = Math.min(data.range.end, episode.end + 60 * 60_000);
  const nearbyContext = data.context.filter((event) => {
    const eventEnd = 'end' in event && event.end ? event.end : event.start;
    return event.start <= contextEnd && eventEnd >= contextStart;
  });
  const nearbyBoluses = data.boluses.filter(
    (delivery) =>
      delivery.timestamp >= contextStart && delivery.timestamp <= contextEnd,
  );
  const overlappingBasal = data.basal.filter(
    (delivery) =>
      delivery.start <= episode.end && delivery.end >= episode.start,
  );
  const extreme = [...episode.readings].sort((a, b) =>
    episode.kind === 'high' ? b.mmolL - a.mmolL : a.mmolL - b.mmolL,
  )[0]!;
  const durationMinutes = glucoseEpisodeDurationMinutes(episode);
  const nearbyRecordCount =
    nearbyContext.length + nearbyBoluses.length + overlappingBasal.length;
  const basalExamples = overlappingBasal.slice(0, 1).map((delivery) => ({
    id: delivery.id,
    kind: 'basal' as const,
    timestamp: delivery.start,
    primary: `${delivery.rateUnitsPerHour.toFixed(2)} U/h basal`,
    secondary: `${delivery.units.toFixed(2)} U delivered in interval`,
    sourceId: delivery.sourceId,
  }));
  const bolusExamples = nearbyBoluses.slice(0, 1).map((delivery) => ({
    id: delivery.id,
    kind: 'bolus' as const,
    timestamp: delivery.timestamp,
    primary: `${delivery.units.toFixed(1)} U bolus`,
    secondary: 'Nearby recorded delivery',
    sourceId: delivery.sourceId,
  }));

  return {
    id: `episode-detail:${episode.id}`,
    label: `${episode.kind === 'high' ? 'High' : 'Low'} run to ${episode.extremeMmolL.toFixed(1)} mmol/L`,
    description: `${episode.readings.length} qualifying readings across an observed ${durationMinutes}-minute span, plus ${nearbyRecordCount} nearby recorded context or insulin records. Nearby does not mean causal`,
    range: { start: contextStart, end: Math.max(contextStart + 1, contextEnd) },
    recordIds: [
      ...episode.readings.map((reading) => reading.id),
      ...nearbyContext.map((event) => event.id),
      ...nearbyBoluses.map((delivery) => delivery.id),
      ...overlappingBasal.map((delivery) => delivery.id),
    ],
    examples: [
      glucosePreview(extreme),
      ...nearbyContext.slice(0, 2).map(contextPreview),
      ...bolusExamples,
      ...basalExamples,
    ],
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

function summarize(
  data: TimelineData,
  health?: InsightHealthContext,
): InsightWindowSummary {
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
  const weights = data.context.filter(
    (event): event is WeightEvent => event.kind === 'weight',
  );
  // Insight ranges are London calendar periods. Dividing by elapsed
  // milliseconds would make a spring-clock-change day count as 23/24 of a
  // day (and an autumn day as 25/24), subtly skewing every daily comparison.
  const durationDays = rangeDays(data.range);

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
    insulinUnitsPerDay: insulinUnavailable
      ? undefined
      : round(insulin.totalUnits / durationDays, 1),
    basalUnitsPerDay: insulinUnavailable
      ? undefined
      : round(insulin.basalUnits / durationDays, 1),
    bolusUnitsPerDay: insulinUnavailable
      ? undefined
      : round(insulin.bolusUnits / durationDays, 1),
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
    stepsPerDay:
      health?.metrics.steps === undefined
        ? undefined
        : round(health.metrics.steps / durationDays, 0),
    distanceKilometresPerDay:
      health?.metrics.distanceKilometres === undefined
        ? undefined
        : round(
            health.metrics.distanceKilometres / durationDays,
            1,
          ),
    activeCaloriesPerDay:
      health?.metrics.activeCaloriesKcal === undefined
        ? undefined
        : round(health.metrics.activeCaloriesKcal / durationDays, 0),
    averageHeartRateBpm: health?.metrics.averageHeartRateBpm,
    restingHeartRateBpm: health?.metrics.restingHeartRateBpm,
    averageWeightKilograms: weights.length
      ? round(average(weights.map((event) => event.kilograms))!, 1)
      : undefined,
    weightRecords: weights.length || undefined,
    bodyFatPercent: health?.metrics.bodyFatPercent,
    leanBodyMassKilograms: health?.metrics.leanBodyMassKilograms,
    bodyWaterMassKilograms: health?.metrics.bodyWaterMassKilograms,
    hydrationLitresPerDay:
      health?.metrics.hydrationLitres === undefined
        ? undefined
        : round(health.metrics.hydrationLitres / durationDays, 2),
    healthConnectBloodGlucoseMmolL:
      health?.metrics.bloodGlucoseMmolL,
    bloodPressureSystolic: health?.metrics.bloodPressureSystolic,
    bloodPressureDiastolic: health?.metrics.bloodPressureDiastolic,
    oxygenSaturationPercent: health?.metrics.oxygenSaturationPercent,
    respiratoryRatePerMinute: health?.metrics.respiratoryRatePerMinute,
    heartRateVariabilityRmssdMs:
      health?.metrics.heartRateVariabilityRmssdMs,
    vo2MaxMillilitresPerKilogramMinute:
      health?.metrics.vo2MaxMillilitresPerKilogramMinute,
    bodyTemperatureCelsius: health?.metrics.bodyTemperatureCelsius,
  };
}

const DAY_PARTS = [
  { id: 'overnight', label: 'Overnight', start: 0, end: 6 },
  { id: 'morning', label: 'Morning', start: 6, end: 12 },
  { id: 'afternoon', label: 'Afternoon', start: 12, end: 18 },
  { id: 'evening', label: 'Evening', start: 18, end: 24 },
] as const;

const MAX_INSIGHT_OBSERVED_GAP_MS = 12 * 60_000;
const MIN_DAY_PART_COVERAGE_PERCENT = 70;

interface DayPartInterval {
  start: number;
  end: number;
}

interface DayPartGlucoseSummary {
  id: (typeof DAY_PARTS)[number]['id'];
  label: string;
  readings: GlucoseReading[];
  expectedMinutes: number;
  observedMinutes: number;
  coveragePercent: number;
  highPercent: number;
  lowPercent: number;
}

function dayPartIntervals(
  range: TimelineData['range'],
  startHour: number,
  endHour: number,
) {
  const intervals: DayPartInterval[] = [];
  let date = toDateKey(range.start);
  const finalDate = toDateKey(Math.max(range.start, range.end - 1));
  while (date <= finalDate) {
    const naturalStart = zonedDateTimeToTimestamp(date, startHour);
    const naturalEnd =
      endHour === 24
        ? zonedDateTimeToTimestamp(addDays(date, 1))
        : zonedDateTimeToTimestamp(date, endHour);
    const start = Math.max(range.start, naturalStart);
    const end = Math.min(range.end, naturalEnd);
    if (end > start) intervals.push({ start, end });
    date = addDays(date, 1);
  }
  return intervals;
}

function overlapMilliseconds(
  start: number,
  end: number,
  intervals: DayPartInterval[],
) {
  return intervals.reduce(
    (total, interval) =>
      total +
      Math.max(
        0,
        Math.min(end, interval.end) - Math.max(start, interval.start),
      ),
    0,
  );
}

/**
 * Summarises each London-clock quarter using elapsed observed time, not
 * reading counts. Expected minutes follow actual timezone boundaries, so the
 * overnight block is naturally five or seven hours across UK clock changes.
 */
export function glucoseTimeByDayPart(
  readings: GlucoseReading[],
  range: TimelineData['range'],
): DayPartGlucoseSummary[] {
  const sorted = readings
    .filter(
      (reading) =>
        reading.timestamp >= range.start && reading.timestamp < range.end,
    )
    .sort((a, b) => a.timestamp - b.timestamp);

  return DAY_PARTS.map((part) => {
    const intervals = dayPartIntervals(range, part.start, part.end);
    const expectedMilliseconds = intervals.reduce(
      (total, interval) => total + interval.end - interval.start,
      0,
    );
    let observedMilliseconds = 0;
    let highMilliseconds = 0;
    let lowMilliseconds = 0;
    const represented = new Map<string, GlucoseReading>();

    sorted.forEach((reading, index) => {
      const next = sorted[index + 1];
      const observedEnd = Math.min(
        range.end,
        next?.timestamp ?? range.end,
        reading.timestamp + MAX_INSIGHT_OBSERVED_GAP_MS,
      );
      if (observedEnd <= reading.timestamp) return;
      const overlap = overlapMilliseconds(
        reading.timestamp,
        observedEnd,
        intervals,
      );
      if (overlap <= 0) return;
      represented.set(reading.id, reading);
      observedMilliseconds += overlap;
      if (reading.mmolL > TARGET_HIGH_MMOL_L) {
        highMilliseconds += overlap;
      } else if (reading.mmolL < TARGET_LOW_MMOL_L) {
        lowMilliseconds += overlap;
      }
    });

    const percent = (milliseconds: number) =>
      observedMilliseconds > 0
        ? round((milliseconds / observedMilliseconds) * 100, 1)
        : 0;
    return {
      id: part.id,
      label: part.label,
      readings: [...represented.values()],
      expectedMinutes: round(expectedMilliseconds / 60_000, 0),
      observedMinutes: round(observedMilliseconds / 60_000, 0),
      coveragePercent:
        expectedMilliseconds > 0
          ? round(
              Math.min(
                100,
                (observedMilliseconds / expectedMilliseconds) * 100,
              ),
              1,
            )
          : 0,
      highPercent: percent(highMilliseconds),
      lowPercent: percent(lowMilliseconds),
    };
  });
}

export function buildInsightReport(
  currentData: TimelineData,
  previousData: TimelineData,
  generatedAt = Date.now(),
  health: InsightHealthComparison = {},
): InsightReport {
  const current = summarize(currentData, health.current);
  const previous = summarize(previousData, health.previous);
  const comparisonDays = rangeDays(currentData.range);
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
      summary: `Coverage is ${current.coveragePercent}% for the recent window and ${previous.coveragePercent}% for the comparison window. T1 Arc waits for at least 70% in both before comparing them.`,
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
        'T1 Arc is collecting personal readings, but there is not enough comparable coverage yet for a responsible comparison.',
      current,
      previous,
      findings,
    };
  }

  const currentCompleteness = buildDataCompletenessReport(currentData);
  const previousCompleteness = buildDataCompletenessReport(previousData);
  const coverageDelta =
    currentCompleteness.glucose.coveragePercent -
    previousCompleteness.glucose.coveragePercent;
  if (
    currentCompleteness.glucose.coveragePercent < 97 ||
    previousCompleteness.glucose.coveragePercent < 97 ||
    Math.abs(coverageDelta) >= 2
  ) {
    const coverageDirection =
      Math.abs(coverageDelta) < 1
        ? 'was similar'
        : coverageDelta > 0
          ? 'was higher'
          : 'was lower';
    findings.push({
      id: 'glucose-data-completeness',
      kind: 'limitation',
      category: 'data-quality',
      title: `Glucose coverage ${coverageDirection}`,
      summary: `Recent glucose coverage was ${currentCompleteness.glucose.coveragePercent}% versus ${previousCompleteness.glucose.coveragePercent}%. The longest uncovered interval was ${currentCompleteness.glucose.longestGapMinutes} minutes recently and ${previousCompleteness.glucose.longestGapMinutes} minutes previously.`,
      caveat:
        'Missing sensor time can bias comparisons. T1 Arc does not interpret an uncovered interval as stable glucose or as a physiological event.',
      evidence: [
        glucoseEvidence(
          'current-completeness',
          'Recent glucose coverage',
          currentData,
        ),
        glucoseEvidence(
          'previous-completeness',
          'Previous glucose coverage',
          previousData,
        ),
      ],
    });
  }

  const healthSourceChoices = [
    ...new Set([
      ...(health.current?.metrics.needsSource ?? []),
      ...(health.previous?.metrics.needsSource ?? []),
    ]),
  ];
  if (healthSourceChoices.length) {
    const kinds = healthKindsForCategories(healthSourceChoices);
    findings.push({
      id: 'health-connect-source-choice',
      kind: 'limitation',
      category: 'data-quality',
      title: 'Some health totals need one source selected',
      summary: `Overlapping Health Connect sources were found for ${healthSourceChoices
        .map(healthCategoryLabel)
        .join(', ')}. T1 Arc leaves those totals out until one source is selected.`,
      caveat:
        'This prevents duplicate records from being treated as extra activity or measurements. Choose the source in Sources; the original copies remain available.',
      evidence: [
        ...(health.current
          ? [
              healthMetricEvidence(
                'current-health-source-choice',
                'Recent overlapping health records',
                health.current,
                currentData.range,
                kinds,
                false,
              ),
            ]
          : []),
        ...(health.previous
          ? [
              healthMetricEvidence(
                'previous-health-source-choice',
                'Previous overlapping health records',
                health.previous,
                previousData.range,
                kinds,
                false,
              ),
            ]
          : []),
      ].filter((reference) => reference.recordIds.length),
    });
  }

  const healthComparisonGroups: {
    id: string;
    label: string;
    categories: DailyMetricCategory[];
    kinds: DailyMetricRecord['kind'][];
  }[] = [
    {
      id: 'movement',
      label: 'movement',
      categories: ['steps', 'distance', 'active_calories'],
      kinds: ['steps', 'distance', 'active_calories'],
    },
    {
      id: 'heart',
      label: 'heart rate',
      categories: ['heart_rate'],
      kinds: ['heart_rate', 'resting_heart_rate'],
    },
    {
      id: 'body',
      label: 'body composition',
      categories: ['body_composition'],
      kinds: HEALTH_CATEGORY_KINDS.body_composition,
    },
    {
      id: 'vitals',
      label: 'vital signs',
      categories: ['blood_glucose', 'vitals'],
      kinds: [
        ...HEALTH_CATEGORY_KINDS.blood_glucose,
        ...HEALTH_CATEGORY_KINDS.vitals,
      ],
    },
    {
      id: 'hydration',
      label: 'hydration',
      categories: ['hydration'],
      kinds: ['hydration'],
    },
  ];
  const incomparableHealthGroups = healthComparisonGroups.filter((group) => {
    if (
      group.categories.some((category) =>
        healthSourceChoices.includes(category),
      )
    ) {
      return false;
    }
    return (
      hasSelectedHealthRecords(health.current, group.kinds) !==
      hasSelectedHealthRecords(health.previous, group.kinds)
    );
  });
  if (incomparableHealthGroups.length) {
    findings.push({
      id: 'health-context-comparability',
      kind: 'limitation',
      category: 'data-quality',
      title: 'Some health context cannot be compared',
      summary: `Selected-source records are present in only one comparison window for ${incomparableHealthGroups
        .map((group) => group.label)
        .join(', ')}. T1 Arc does not treat the other window as zero.`,
      caveat:
        'A missing record can mean the source did not write it, permission was unavailable, or no measurement was taken. It is not evidence that the value or activity was zero.',
      evidence: incomparableHealthGroups.flatMap((group) => [
        ...(health.current &&
        hasSelectedHealthRecords(health.current, group.kinds)
          ? [
              healthMetricEvidence(
                `current-${group.id}-comparison`,
                `Recent ${group.label} records`,
                health.current,
                currentData.range,
                group.kinds,
              ),
            ]
          : []),
        ...(health.previous &&
        hasSelectedHealthRecords(health.previous, group.kinds)
          ? [
              healthMetricEvidence(
                `previous-${group.id}-comparison`,
                `Previous ${group.label} records`,
                health.previous,
                previousData.range,
                group.kinds,
              ),
            ]
          : []),
      ]),
    });
  }

  const insulinIsAvailable = (data: TimelineData) =>
    !data.sources.some(
      (source) =>
        source.label === 'Insulin' && source.freshness === 'missing',
    );
  if (
    insulinIsAvailable(currentData) &&
    insulinIsAvailable(previousData) &&
    (currentCompleteness.basal.coveragePercent < 90 ||
      previousCompleteness.basal.coveragePercent < 90)
  ) {
    findings.push({
      id: 'basal-data-completeness',
      kind: 'limitation',
      category: 'data-quality',
      title: 'Basal history has uncovered time',
      summary: `Basal intervals represent ${currentCompleteness.basal.coveragePercent}% of the recent window and ${previousCompleteness.basal.coveragePercent}% of the previous window.`,
      caveat:
        'An uncovered interval means no basal record was imported for that time. It does not mean that zero basal insulin was delivered.',
      evidence: [
        insulinEvidence(
          'current-basal-completeness',
          'Recent insulin records',
          currentData,
        ),
        insulinEvidence(
          'previous-basal-completeness',
          'Previous insulin records',
          previousData,
        ),
      ],
    });
  }

  const currentInsulinReconciliation =
    currentCompleteness.insulinReconciliation;
  const previousInsulinReconciliation =
    previousCompleteness.insulinReconciliation;
  const currentInsulinMismatch = hasMaterialInsulinDifference(
    currentInsulinReconciliation,
  );
  const previousInsulinMismatch = hasMaterialInsulinDifference(
    previousInsulinReconciliation,
  );
  if (currentInsulinMismatch || previousInsulinMismatch) {
    findings.push({
      id: 'insulin-total-reconciliation',
      kind: 'limitation',
      category: 'data-quality',
      title: 'Insulin export totals need review',
      summary: [
        currentInsulinMismatch && currentInsulinReconciliation
          ? insulinReconciliationSummary(
              'In the recent window',
              currentInsulinReconciliation,
            )
          : '',
        previousInsulinMismatch && previousInsulinReconciliation
          ? insulinReconciliationSummary(
              'In the comparison window',
              previousInsulinReconciliation,
            )
          : '',
      ]
        .filter(Boolean)
        .join(' '),
      caveat:
        'This flags a difference between source aggregates and the export rows T1 Arc could organise. It does not mean the pump delivered the wrong amount, and it is not a dosing conclusion. T1 Arc withholds the detailed-row insulin comparison while this difference is material.',
      evidence: [
        ...(currentInsulinMismatch && currentInsulinReconciliation
          ? [
              insulinReconciliationEvidence(
                'current-insulin-reconciliation',
                'Recent insulin export check',
                currentData,
                currentInsulinReconciliation,
              ),
            ]
          : []),
        ...(previousInsulinMismatch && previousInsulinReconciliation
          ? [
              insulinReconciliationEvidence(
                'previous-insulin-reconciliation',
                'Previous insulin export check',
                previousData,
                previousInsulinReconciliation,
              ),
            ]
          : []),
      ],
    });
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
      glucoseEvidence(
        'current-glucose',
        `Recent ${comparisonDays} days`,
        currentData,
      ),
      glucoseEvidence(
        'previous-glucose',
        `Previous ${comparisonDays} days`,
        previousData,
      ),
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
  const notableCurrentRuns = rankGlucoseEpisodes(allCurrentRuns, 3);
  if (allCurrentRuns.length || allPreviousRuns.length) {
    const leadingRun = notableCurrentRuns[0];
    findings.push({
      id: 'glucose-runs',
      kind: 'observation',
      category: 'glucose',
      title: `${current.highGlucoseRuns} high and ${current.lowGlucoseRuns} low sustained glucose runs`,
      summary: `The recent window contained ${current.highGlucoseRuns} high runs and ${current.lowGlucoseRuns} low runs, versus ${previous.highGlucoseRuns} high and ${previous.lowGlucoseRuns} low previously. A run requires at least two qualifying readings no more than 12 minutes apart.${
        leadingRun
          ? ` The largest recent observed excursion was a ${leadingRun.kind} run reaching ${leadingRun.extremeMmolL.toFixed(1)} mmol/L across ${glucoseEpisodeDurationMinutes(leadingRun)} minutes.`
          : ''
      }`,
      caveat:
        'This is a deterministic grouping of sensor readings, not a clinical diagnosis. Nearby records are shown for inspection and never treated as proof of cause.',
      evidence: [
        ...(allCurrentRuns.length
          ? [
              episodeEvidence(
                'current-glucose-runs',
                'Recent sustained runs',
                allCurrentRuns,
                currentData.range,
              ),
              ...notableCurrentRuns.map((episode) =>
                buildGlucoseEpisodeEvidence(episode, currentData),
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

  const currentParts = glucoseTimeByDayPart(
    currentData.glucose,
    currentData.range,
  );
  const previousParts = glucoseTimeByDayPart(
    previousData.glucose,
    previousData.range,
  );
  const partChanges = currentParts.flatMap((part) => {
    const previousPart = previousParts.find(
      (candidate) => candidate.id === part.id,
    );
    if (
      !previousPart ||
      part.coveragePercent < MIN_DAY_PART_COVERAGE_PERCENT ||
      previousPart.coveragePercent < MIN_DAY_PART_COVERAGE_PERCENT
    ) {
      return [];
    }
    return [
      {
        part,
        previousPart,
        excursion: 'high' as const,
        currentPercent: part.highPercent,
        previousPercent: previousPart.highPercent,
        delta: part.highPercent - previousPart.highPercent,
      },
      {
        part,
        previousPart,
        excursion: 'low' as const,
        currentPercent: part.lowPercent,
        previousPercent: previousPart.lowPercent,
        delta: part.lowPercent - previousPart.lowPercent,
      },
    ];
  });
  const changedPart = partChanges.sort((a, b) => b.delta - a.delta)[0];
  if (changedPart && changedPart.delta >= 3) {
    const { part, previousPart } = changedPart;
    const threshold =
      changedPart.excursion === 'high'
        ? `above ${TARGET_HIGH_MMOL_L.toFixed(1)}`
        : `below ${TARGET_LOW_MMOL_L.toFixed(1)}`;
    findings.push({
      id: 'glucose-timing',
      kind: 'observation',
      category: 'glucose',
      title: `${part.label} ${changedPart.excursion} time increased most`,
      summary: `${changedPart.currentPercent}% of observed ${part.label.toLowerCase()} glucose time was ${threshold} mmol/L recently, compared with ${changedPart.previousPercent}% previously. Coverage for this block was ${part.coveragePercent}% recently and ${previousPart.coveragePercent}% previously.`,
      caveat:
        'This comparison is duration-weighted and follows Europe/London clock boundaries. T1 Arc withholds blocks below 70% observed coverage; it describes timing, not a cause or treatment change.',
      evidence: [
        {
          id: 'current-glucose-timing',
          label: `Recent ${part.label.toLowerCase()} readings`,
          description: `${part.readings.length} exact readings representing ${part.observedMinutes} of ${part.expectedMinutes} minutes`,
          range: currentData.range,
          recordIds: part.readings.map((reading) => reading.id),
          examples: representativeGlucose(part.readings),
        },
        {
          id: 'previous-glucose-timing',
          label: `Previous ${part.label.toLowerCase()} readings`,
          description: `${previousPart.readings.length} exact readings representing ${previousPart.observedMinutes} of ${previousPart.expectedMinutes} minutes`,
          range: previousData.range,
          recordIds: previousPart.readings.map((reading) => reading.id),
          examples: representativeGlucose(previousPart.readings),
        },
      ],
    });
  }

  if (
    current.insulinUnits !== null &&
    previous.insulinUnits !== null &&
    current.insulinUnitsPerDay !== undefined &&
    previous.insulinUnitsPerDay !== undefined &&
    current.basalUnitsPerDay !== undefined &&
    previous.basalUnitsPerDay !== undefined &&
    current.bolusUnitsPerDay !== undefined &&
    previous.bolusUnitsPerDay !== undefined &&
    !currentInsulinMismatch &&
    !previousInsulinMismatch
  ) {
    const insulinDelta =
      current.insulinUnitsPerDay - previous.insulinUnitsPerDay;
    findings.push({
      id: 'insulin-change',
      kind: 'observation',
      category: 'insulin',
      title: `Daily delivered insulin changed by ${signed(insulinDelta, ' U/day')}`,
      summary: `Recent imported delivery records averaged ${current.insulinUnitsPerDay.toFixed(1)} U/day (${current.basalUnitsPerDay.toFixed(1)} basal and ${current.bolusUnitsPerDay.toFixed(1)} bolus) versus ${previous.insulinUnitsPerDay.toFixed(1)} U/day (${previous.basalUnitsPerDay.toFixed(1)} basal and ${previous.bolusUnitsPerDay.toFixed(1)} bolus).`,
      caveat:
        'This describes imported delivery history, not current pump state, insulin need, or dosing guidance. Uncovered basal time is reported separately.',
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

  const leadingRepeatedMeal = repeatedMealPatterns(currentMealWindows)[0];
  if (leadingRepeatedMeal) {
    const previousMatch = repeatedMealPatterns(previousMealWindows).find(
      (pattern) => pattern.key === leadingRepeatedMeal.key,
    );
    findings.push({
      id: 'repeated-meal-pattern',
      kind: 'context-clue',
      category: 'food',
      title: `${leadingRepeatedMeal.label} had the largest repeated observed rise`,
      summary: `Among meal labels with at least three adequately covered glucose windows, "${leadingRepeatedMeal.label}" had the largest recent average baseline-to-peak rise: ${signed(leadingRepeatedMeal.averageRiseMmolL, ' mmol/L')} across ${leadingRepeatedMeal.windows.length} meals (observed range ${signed(leadingRepeatedMeal.minimumRiseMmolL)} to ${signed(leadingRepeatedMeal.maximumRiseMmolL)} mmol/L).${
        previousMatch
          ? ` The same label averaged ${signed(previousMatch.averageRiseMmolL, ' mmol/L')} across ${previousMatch.windows.length} meals in the comparison window.`
          : ''
      }`,
      caveat:
        'Meal labels are user-entered grouping clues, not proof that the foods caused the change. Portions, ingredients, starting glucose, insulin, activity and other context can differ between occurrences.',
      evidence: [
        mealWindowEvidence(
          'current-repeated-meal',
          `Recent ${leadingRepeatedMeal.label} windows`,
          leadingRepeatedMeal.windows,
          currentData.range,
        ),
        ...(previousMatch
          ? [
              mealWindowEvidence(
                'previous-repeated-meal',
                `Previous ${previousMatch.label} windows`,
                previousMatch.windows,
                previousData.range,
              ),
            ]
          : []),
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

  const currentNotes = currentData.context.filter(
    (event): event is ContextNoteEvent => event.kind === 'note',
  );
  const previousNotes = previousData.context.filter(
    (event): event is ContextNoteEvent => event.kind === 'note',
  );
  if (currentNotes.length || previousNotes.length) {
    findings.push({
      id: 'recorded-context-notes',
      kind: 'context-clue',
      category: 'context',
      title: `${currentNotes.length} health context note${currentNotes.length === 1 ? '' : 's'} recorded recently`,
      summary: `The recent window contains ${currentNotes.length} user-recorded context note${currentNotes.length === 1 ? '' : 's'}${currentNotes.length ? `: ${noteCategorySummary(currentNotes)}` : ''}, versus ${previousNotes.length} previously${previousNotes.length ? `: ${noteCategorySummary(previousNotes)}` : ''}.`,
      caveat:
        'These notes record what you observed, not what caused a glucose change. Different counts may also reflect different logging, so inspect the exact timing and readings.',
      evidence: [
        ...(currentNotes.length
          ? [
              contextEvidence(
                'current-context-notes',
                'Recent context notes',
                currentNotes,
                currentData.range,
              ),
            ]
          : []),
        ...(previousNotes.length
          ? [
              contextEvidence(
                'previous-context-notes',
                'Previous context notes',
                previousNotes,
                previousData.range,
              ),
            ]
          : []),
      ],
    });
  }

  const currentMedications = currentData.context.filter(
    (event): event is MedicationEvent => event.kind === 'medication',
  );
  const previousMedications = previousData.context.filter(
    (event): event is MedicationEvent => event.kind === 'medication',
  );
  if (currentMedications.length || previousMedications.length) {
    findings.push({
      id: 'medication-context',
      kind: 'context-clue',
      category: 'medication',
      title: `${currentMedications.length} medication entr${currentMedications.length === 1 ? 'y' : 'ies'} recorded recently`,
      summary: `Recent recorded entries: ${medicationEntrySummary(currentMedications)}. Previous recorded entries: ${medicationEntrySummary(previousMedications)}.`,
      caveat:
        'This only compares what was recorded. It does not establish adherence, explain a glucose change, or recommend starting, stopping, or changing medication.',
      evidence: [
        ...(currentMedications.length
          ? [
              contextEvidence(
                'current-medications',
                'Recent medication records',
                currentMedications,
                currentData.range,
              ),
            ]
          : []),
        ...(previousMedications.length
          ? [
              contextEvidence(
                'previous-medications',
                'Previous medication records',
                previousMedications,
                previousData.range,
              ),
            ]
          : []),
      ],
    });
  }

  if (
    health.current &&
    health.previous &&
    current.stepsPerDay !== undefined &&
    previous.stepsPerDay !== undefined
  ) {
    const stepsDelta = current.stepsPerDay - previous.stepsPerDay;
    const supportingDetails = [
      current.distanceKilometresPerDay !== undefined &&
      previous.distanceKilometresPerDay !== undefined
        ? `Distance averaged ${current.distanceKilometresPerDay} km/day versus ${previous.distanceKilometresPerDay} km/day.`
        : '',
      current.activeCaloriesPerDay !== undefined &&
      previous.activeCaloriesPerDay !== undefined
        ? `Active energy averaged ${current.activeCaloriesPerDay} kcal/day versus ${previous.activeCaloriesPerDay} kcal/day.`
        : '',
    ]
      .filter(Boolean)
      .join(' ');
    findings.push({
      id: 'health-connect-activity',
      kind: 'context-clue',
      category: 'activity',
      title: `Average recorded steps changed by ${signed(stepsDelta, '/day')}`,
      summary: `The source-selected Health Connect records averaged ${current.stepsPerDay.toLocaleString('en-GB')} steps/day recently versus ${previous.stepsPerDay.toLocaleString('en-GB')} previously. ${supportingDetails}`.trim(),
      caveat:
        'This is source-attributed activity context, not proof that activity caused a glucose change.',
      evidence: [
        healthMetricEvidence(
          'current-health-activity',
          'Recent Health Connect activity records',
          health.current,
          currentData.range,
          ['steps', 'distance', 'active_calories'],
        ),
        healthMetricEvidence(
          'previous-health-activity',
          'Previous Health Connect activity records',
          health.previous,
          previousData.range,
          ['steps', 'distance', 'active_calories'],
        ),
      ],
    });
  }

  if (
    health.current &&
    health.previous &&
    (current.restingHeartRateBpm !== undefined ||
      current.averageHeartRateBpm !== undefined) &&
    (previous.restingHeartRateBpm !== undefined ||
      previous.averageHeartRateBpm !== undefined)
  ) {
    const currentHeart =
      current.restingHeartRateBpm ?? current.averageHeartRateBpm!;
    const previousHeart =
      previous.restingHeartRateBpm ?? previous.averageHeartRateBpm!;
    const usesResting =
      current.restingHeartRateBpm !== undefined &&
      previous.restingHeartRateBpm !== undefined;
    findings.push({
      id: 'health-connect-heart-rate',
      kind: 'context-clue',
      category: 'heart',
      title: `${usesResting ? 'Resting' : 'Average'} heart rate changed by ${signed(currentHeart - previousHeart, ' bpm')}`,
      summary: `${usesResting ? 'Resting' : 'Average'} heart rate was ${currentHeart} bpm in the recent source-selected records versus ${previousHeart} bpm previously.`,
      caveat:
        'Heart-rate records are contextual observations only and are not a diagnosis or treatment recommendation.',
      evidence: [
        healthMetricEvidence(
          'current-heart-rate',
          'Recent Health Connect heart-rate records',
          health.current,
          currentData.range,
          ['heart_rate', 'resting_heart_rate'],
        ),
        healthMetricEvidence(
          'previous-heart-rate',
          'Previous Health Connect heart-rate records',
          health.previous,
          previousData.range,
          ['heart_rate', 'resting_heart_rate'],
        ),
      ],
    });
  }

  if (health.current && health.previous) {
    const bodyComparisons = [
      {
        label: 'Body fat',
        current: current.bodyFatPercent,
        previous: previous.bodyFatPercent,
        suffix: '%',
        decimals: 1,
        meaningfulChange: 0.2,
      },
      {
        label: 'Lean mass',
        current: current.leanBodyMassKilograms,
        previous: previous.leanBodyMassKilograms,
        suffix: ' kg',
        decimals: 1,
        meaningfulChange: 0.2,
      },
      {
        label: 'Body water',
        current: current.bodyWaterMassKilograms,
        previous: previous.bodyWaterMassKilograms,
        suffix: ' kg',
        decimals: 1,
        meaningfulChange: 0.2,
      },
    ].filter(
      (
        comparison,
      ): comparison is {
        label: string;
        current: number;
        previous: number;
        suffix: string;
        decimals: number;
        meaningfulChange: number;
      } =>
        comparison.current !== undefined &&
        comparison.previous !== undefined,
    );
    if (bodyComparisons.length) {
      const changed = bodyComparisons.some(
        (comparison) =>
          Math.abs(comparison.current - comparison.previous) >=
          comparison.meaningfulChange,
      );
      findings.push({
        id: 'health-connect-body-composition',
        kind: 'context-clue',
        category: 'body',
        title: changed
          ? 'Recorded body composition changed'
          : 'Recorded body composition was broadly similar',
        summary: bodyComparisons
          .map(
            (comparison) =>
              `${comparison.label} was ${comparison.current.toFixed(
                comparison.decimals,
              )}${comparison.suffix} recently versus ${comparison.previous.toFixed(
                comparison.decimals,
              )}${comparison.suffix} previously.`,
          )
          .join(' '),
        caveat:
          'These are source-selected measurements, not an explanation for glucose changes. Device method, hydration and measurement timing can affect them.',
        evidence: [
          healthMetricEvidence(
            'current-body-composition',
            'Recent body-composition records',
            health.current,
            currentData.range,
            HEALTH_CATEGORY_KINDS.body_composition,
          ),
          healthMetricEvidence(
            'previous-body-composition',
            'Previous body-composition records',
            health.previous,
            previousData.range,
            HEALTH_CATEGORY_KINDS.body_composition,
          ),
        ],
      });
    }
  }

  if (
    health.current &&
    health.previous &&
    current.hydrationLitresPerDay !== undefined &&
    previous.hydrationLitresPerDay !== undefined
  ) {
    const hydrationDelta =
      current.hydrationLitresPerDay - previous.hydrationLitresPerDay;
    findings.push({
      id: 'health-connect-hydration',
      kind: 'context-clue',
      category: 'hydration',
      title:
        Math.abs(hydrationDelta) < 0.1
          ? 'Recorded hydration was broadly similar'
          : `Recorded hydration changed by ${signed(
              hydrationDelta,
              ' L/day',
            )}`,
      summary: `Source-selected hydration records averaged ${current.hydrationLitresPerDay.toFixed(2)} L/day recently versus ${previous.hydrationLitresPerDay.toFixed(2)} L/day previously.`,
      caveat:
        'This compares only recorded drinks or hydration entries. It is not a complete fluid-balance assessment and does not establish a cause for glucose changes.',
      evidence: [
        healthMetricEvidence(
          'current-hydration',
          'Recent hydration records',
          health.current,
          currentData.range,
          ['hydration'],
        ),
        healthMetricEvidence(
          'previous-hydration',
          'Previous hydration records',
          health.previous,
          previousData.range,
          ['hydration'],
        ),
      ],
    });
  }

  if (health.current && health.previous) {
    const vitalChanges = [
      {
        label: 'Health Connect blood glucose',
        current: current.healthConnectBloodGlucoseMmolL,
        previous: previous.healthConnectBloodGlucoseMmolL,
        suffix: ' mmol/L',
        decimals: 1,
        threshold: 0.5,
      },
      {
        label: 'Systolic blood pressure',
        current: current.bloodPressureSystolic,
        previous: previous.bloodPressureSystolic,
        suffix: ' mmHg',
        decimals: 0,
        threshold: 3,
      },
      {
        label: 'Diastolic blood pressure',
        current: current.bloodPressureDiastolic,
        previous: previous.bloodPressureDiastolic,
        suffix: ' mmHg',
        decimals: 0,
        threshold: 3,
      },
      {
        label: 'Blood oxygen',
        current: current.oxygenSaturationPercent,
        previous: previous.oxygenSaturationPercent,
        suffix: '%',
        decimals: 1,
        threshold: 1,
      },
      {
        label: 'Respiratory rate',
        current: current.respiratoryRatePerMinute,
        previous: previous.respiratoryRatePerMinute,
        suffix: '/min',
        decimals: 1,
        threshold: 1,
      },
      {
        label: 'HRV',
        current: current.heartRateVariabilityRmssdMs,
        previous: previous.heartRateVariabilityRmssdMs,
        suffix: ' ms',
        decimals: 0,
        threshold: 3,
      },
      {
        label: 'VO₂ max',
        current: current.vo2MaxMillilitresPerKilogramMinute,
        previous: previous.vo2MaxMillilitresPerKilogramMinute,
        suffix: ' ml/kg/min',
        decimals: 1,
        threshold: 1,
      },
      {
        label: 'Body temperature',
        current: current.bodyTemperatureCelsius,
        previous: previous.bodyTemperatureCelsius,
        suffix: ' °C',
        decimals: 1,
        threshold: 0.3,
      },
    ].filter(
      (
        comparison,
      ): comparison is {
        label: string;
        current: number;
        previous: number;
        suffix: string;
        decimals: number;
        threshold: number;
      } =>
        comparison.current !== undefined &&
        comparison.previous !== undefined &&
        Math.abs(comparison.current - comparison.previous) >=
          comparison.threshold,
    );
    if (vitalChanges.length) {
      findings.push({
        id: 'health-connect-vitals',
        kind: 'context-clue',
        category: 'vitals',
        title:
          vitalChanges.length === 1
            ? `${vitalChanges[0]!.label} changed in recorded data`
            : `${vitalChanges.length} recorded vital signs changed`,
        summary: vitalChanges
          .map(
            (comparison) =>
              `${comparison.label} was ${comparison.current.toFixed(
                comparison.decimals,
              )}${comparison.suffix} recently versus ${comparison.previous.toFixed(
                comparison.decimals,
              )}${comparison.suffix} previously.`,
          )
          .join(' '),
        caveat:
          'These are contextual measurements, not a diagnosis or proof of a glucose effect. Measurement method, timing and record frequency can differ between periods.',
        evidence: [
          healthMetricEvidence(
            'current-vitals',
            'Recent vital-sign records',
            health.current,
            currentData.range,
            [
              ...HEALTH_CATEGORY_KINDS.blood_glucose,
              ...HEALTH_CATEGORY_KINDS.vitals,
            ],
          ),
          healthMetricEvidence(
            'previous-vitals',
            'Previous vital-sign records',
            health.previous,
            previousData.range,
            [
              ...HEALTH_CATEGORY_KINDS.blood_glucose,
              ...HEALTH_CATEGORY_KINDS.vitals,
            ],
          ),
        ],
      });
    }
  }

  const currentWeights = currentData.context.filter(
    (event): event is WeightEvent => event.kind === 'weight',
  );
  const previousWeights = previousData.context.filter(
    (event): event is WeightEvent => event.kind === 'weight',
  );
  if (
    current.averageWeightKilograms !== undefined &&
    previous.averageWeightKilograms !== undefined
  ) {
    const weightDelta =
      current.averageWeightKilograms - previous.averageWeightKilograms;
    findings.push({
      id: 'weight-context',
      kind: 'context-clue',
      category: 'weight',
      title:
        Math.abs(weightDelta) < 0.2
          ? 'Average recorded weight was broadly similar'
          : `Average recorded weight changed by ${signed(weightDelta, ' kg')}`,
      summary: `Average recorded weight was ${current.averageWeightKilograms.toFixed(1)} kg across ${currentWeights.length} record${currentWeights.length === 1 ? '' : 's'} recently, versus ${previous.averageWeightKilograms.toFixed(1)} kg across ${previousWeights.length} previously.`,
      caveat:
        'Weight is contextual evidence only. Measurement timing, clothing, hydration and source frequency can change this comparison; it does not establish a cause for glucose changes.',
      evidence: [
        contextEvidence(
          'current-weight',
          'Recent weight records',
          currentWeights,
          currentData.range,
        ),
        contextEvidence(
          'previous-weight',
          'Previous weight records',
          previousWeights,
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
        ? `Time in range was lower in the recent ${comparisonDays} days`
        : tirDelta > 1
          ? `Time in range was higher in the recent ${comparisonDays} days`
          : averageDelta > 0.2
            ? `Average glucose was higher in the recent ${comparisonDays} days`
            : averageDelta < -0.2
              ? `Average glucose was lower in the recent ${comparisonDays} days`
              : `The two ${comparisonDays}-day periods were broadly similar`,
    summary: `Time in range ${tirDirection}. T1 Arc found ${findings.filter((finding) => finding.kind === 'context-clue').length} context changes worth inspecting; none is presented as a proven cause.`,
    current,
    previous,
    findings,
  };
}

export function answerInsightQuestion(
  question: string,
  report: InsightReport,
): InsightAnswer {
  const normalized = question.trim().toLowerCase();
  if (asksForTreatmentAdvice(normalized)) {
    return {
      title: 'T1 Arc does not give treatment advice',
      answer:
        'T1 Arc can show the insulin, medication, glucose and context records behind a pattern, but it will not recommend doses, correction boluses, medication changes, ratios, or pump-setting changes.',
      findingIds: [],
    };
  }

  if (!report.ready) {
    return {
      title: 'Not enough comparable history yet',
      answer: report.summary,
      findingIds: report.findings.map((finding) => finding.id),
    };
  }

  const categories = classifyInsightQuestion(normalized);
  const categoryFindings = report.findings.filter((finding) =>
    categories.includes(finding.category),
  );
  const asksForExplanation =
    /\b(why|worse|better|different|change|changed|related)\b/.test(
      normalized,
    );
  const selected = [
    ...new Map(
      [
        ...categoryFindings,
        ...(asksForExplanation
          ? report.findings.filter(
              (finding) =>
                finding.kind === 'limitation' &&
                finding.category === 'data-quality',
            )
          : []),
      ].map((finding) => [finding.id, finding]),
    ).values(),
  ];
  if (selected.length === 0) {
    return {
      title: 'No supported answer from these records',
      answer:
        'T1 Arc could not find enough relevant normalised records for that question. It will not fill the gap with a guess.',
      findingIds: [],
    };
  }

  const observations = selected.filter(
    (finding) => finding.kind === 'observation',
  );
  const clues = selected.filter(
    (finding) => finding.kind === 'context-clue',
  );
  const limitations = selected.filter(
    (finding) => finding.kind === 'limitation',
  );
  return {
    title:
      categories.length > 1
        ? report.headline
        : `What the ${CATEGORY_ANSWER_LABELS[categories[0]!]} show`,
    answer: [
      ...observations.map((finding) => finding.summary),
      ...clues.map((finding) => finding.summary),
      ...limitations.map((finding) => finding.summary),
      clues.length
        ? 'The context changes are associations to investigate, not proven causes.'
        : '',
      limitations.length
        ? 'These data limitations apply to the answer above.'
        : '',
    ]
      .filter(Boolean)
      .join(' '),
    findingIds: selected.map((finding) => finding.id),
  };
}
