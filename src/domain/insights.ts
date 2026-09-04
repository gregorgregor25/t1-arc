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
} from "./models";
import {
  DailyHealthMetrics,
  DailyMetricCategory,
  DailyMetricRecord,
} from "./dailyHealthMetrics";
import {
  buildDataCompletenessReport,
  InsulinReconciliation,
} from "./dataCompleteness";
import {
  contextNoteCategoryLabel,
  contextNoteDisplayTitle,
} from "./contextNotes";
import { manualKetoneDraftFromEvent } from "@/data/manualContext";
import { formatManualKetoneTitle } from "@/data/manualKetones";
import { mealNutritionSummary } from "./mealNutrition";
import {
  nutritionCoverageNeedsReview,
  summarizeHealthTrendContext,
} from "./healthTrendContext";
import { calculateGlucoseStats, calculateInsulinStats } from "./stats";
import {
  addDays,
  formatShortDate,
  formatTime,
  getZonedDateTimeParts,
  toDateKey,
  zonedDateTimeToTimestamp,
} from "./time";
import type {
  EvidenceClockWindowOccurrence,
  EvidenceClockWindowSegment,
  EvidenceClockWindowTargetRange,
  EvidenceClockWindowVisualization,
} from "./evidenceClockWindowChart";
import type { EvidenceQueryVisualizationReference } from "./evidenceQueryChart";
import {
  formatDistance,
  formatElevation,
  formatEnergy,
  formatEnergyPerDay,
  formatGlucose,
  formatHeight,
  formatRegionalNumber,
  formatSpeed,
  formatTemperature,
} from "./regionalFormat";
import { getRuntimeRegionalDefaults } from "./regionalProfileRuntime";
import { formatRegionalWallClock } from "./regionalWallClock";

export type InsightCategory =
  | "glucose"
  | "insulin"
  | "food"
  | "sleep"
  | "activity"
  | "heart"
  | "weight"
  | "body"
  | "vitals"
  | "hydration"
  | "medication"
  | "context"
  | "data-quality";

export type InsightKind = "observation" | "context-clue" | "limitation";

export interface EvidenceRecordPreview {
  id: string;
  kind:
    | "glucose"
    | "basal"
    | "bolus"
    | "insulin-total"
    | "context"
    | "health-metric"
    | "source-record";
  timestamp: number;
  primary: string;
  secondary: string;
  sourceId: string;
}

export interface EvidenceCalculationReference {
  kind: "tarvis-local-glucose-v1";
  queryId: string;
  algorithmVersion: string;
  metrics: {
    id:
      | "glucose.mean"
      | "glucose.median"
      | "glucose.minimum"
      | "glucose.maximum"
      | "glucose.standard_deviation"
      | "glucose.coefficient_of_variation"
      | "glucose.gmi"
      | "glucose.time_in_range"
      | "glucose.low_episodes"
      | "glucose.high_episodes"
      | "glucose.low_readings"
      | "glucose.high_readings";
    value: number | null;
    unit: "mmol/L" | "%" | "events" | "readings";
  }[];
  thresholds: {
    operator: "lt" | "lte" | "gt" | "gte";
    role: "low" | "high" | "range_lower" | "range_upper";
    unit: "mmol/L";
    value: number;
  }[];
  requestedWindowCount: number;
  windowsWithData: number;
  coveragePercent: number;
  episodeDefinitionVersion?: string;
}

export interface EvidenceClockWindowVisualizationReference extends Omit<
  EvidenceClockWindowVisualization,
  "windows"
> {
  kind: "recurring-clock-overlay-v1";
  timezone: string;
  title: string;
  subtitle: string;
  coverageSummary: string;
  missingOccurrenceLabels: string[];
  targetRange?: EvidenceClockWindowTargetRange;
  /** New exact evidence never falls back to current appearance settings. */
  targetRangePolicy?: "persisted-only";
  targetRangeProvenance?: "query-thresholds";
  windows: (Omit<EvidenceClockWindowOccurrence, "segments"> & {
      clockTransitions: {
        kind: "gap" | "fold";
        atTimestamp: number;
        utcOffsetBeforeMinutes: number;
        utcOffsetAfterMinutes: number;
        changeMinutes: number;
        affectedStartMinute: number;
        affectedEndMinute: number;
      }[];
      segments: (EvidenceClockWindowSegment & {
          startsAfter: {
            sensorGap: boolean;
            clockTransition: "gap" | "fold" | null;
          };
        })[];
    })[];
}

export interface EvidenceReference {
  id: string;
  label: string;
  description: string;
  range: { start: number; end: number };
  recordIds: string[];
  examples: EvidenceRecordPreview[];
  calculation?: EvidenceCalculationReference;
  visualization?:
    | EvidenceClockWindowVisualizationReference
    | EvidenceQueryVisualizationReference;
  visualizationOmission?: {
    reason: "display-point-budget";
    originalKind:
      | "recurring-clock-overlay-v1"
      | EvidenceQueryVisualizationReference["kind"];
    sourcePointCount: number;
    maximumDisplayPoints: number;
  };
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
  /** Durable local evidence generation captured before this report was built. */
  inputGeneration?: number;
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
    "glucose",
    "sugar",
    "high",
    "highs",
    "hyper",
    "low",
    "lows",
    "hypo",
    "reading",
    "readings",
    "range",
    "variability",
    "stable",
    "spike",
    "overnight",
    "morning",
  ],
  insulin: [
    "insulin",
    "bolus",
    "basal",
    "pump",
    "units",
    "total daily dose",
    "tdd",
  ],
  food: [
    "food",
    "meal",
    "carb",
    "breakfast",
    "lunch",
    "dinner",
    "snack",
    "eating",
  ],
  sleep: ["sleep", "slept", "bed", "night", "rest"],
  activity: [
    "exercise",
    "activity",
    "active",
    "workout",
    "steps",
    "walk",
    "run",
    "cycling",
    "gym",
  ],
  heart: ["heart", "heart rate", "pulse", "bpm", "resting heart rate"],
  weight: ["weight", "body weight", "kilogram", "kilo", "kg"],
  body: [
    "body composition",
    "body fat",
    "lean mass",
    "muscle mass",
    "body water",
    "bone mass",
  ],
  vitals: [
    "vitals",
    "blood pressure",
    "blood oxygen",
    "oxygen saturation",
    "spo2",
    "respiratory rate",
    "breathing rate",
    "hrv",
    "vo2",
    "temperature",
  ],
  hydration: ["hydration", "water intake", "drank", "litres", "liters"],
  medication: ["medication", "medicine", "tablet", "prescription", "drug"],
  context: [
    "illness",
    "ill",
    "sick",
    "ketone",
    "ketones",
    "stress",
    "pod",
    "site",
    "sensor issue",
    "hormone",
    "period",
    "menstrual",
    "travel",
    "jet lag",
    "context",
    "note",
  ],
  "data-quality": [
    "coverage",
    "missing",
    "gap",
    "stale",
    "sensor",
    "data quality",
    "enough data",
  ],
};

const CATEGORY_ANSWER_LABELS: Record<InsightCategory, string> = {
  glucose: "glucose records",
  insulin: "insulin records",
  food: "food records",
  sleep: "sleep records",
  activity: "activity records",
  heart: "heart-rate records",
  weight: "weight records",
  body: "body-composition records",
  vitals: "vital-sign records",
  hydration: "hydration records",
  medication: "medication records",
  context: "recorded context notes",
  "data-quality": "data coverage",
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
  const categories = (
    Object.keys(QUESTION_CATEGORY_KEYWORDS) as InsightCategory[]
  ).filter((category) =>
    QUESTION_CATEGORY_KEYWORDS[category].some((keyword) =>
      new RegExp(
        `(?:^|[^a-z0-9])${keyword
          .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
          .replace(/\s+/g, "\\s+")}(?:$|[^a-z0-9])`,
        "i",
      ).test(normalized),
    ),
  );
  if (
    categories.length === 1 &&
    categories[0] === "glucose" &&
    /\b(why|worse|better|different|change|changed)\b/.test(normalized)
  ) {
    return [
      "glucose",
      "insulin",
      "food",
      "sleep",
      "activity",
      "heart",
      "weight",
      "body",
      "vitals",
      "hydration",
      "medication",
      "context",
    ];
  }
  return categories.length
    ? categories
    : [
        "glucose",
        "insulin",
        "food",
        "sleep",
        "activity",
        "heart",
        "weight",
        "body",
        "vitals",
        "hydration",
        "medication",
        "context",
      ];
}

export interface GlucoseEpisode {
  id: string;
  kind: "high" | "low";
  thresholdMmolL: number;
  start: number;
  end: number;
  /**
   * One deterministic physiological sample per timestamp. `recordIds` keeps
   * every source row that contributed to a same-instant average.
   */
  readings: (GlucoseReading & { recordIds: string[] })[];
  extremeMmolL: number;
  /** Whether `end` is a confirmed recovery or only the last observed sample. */
  endStatus: "confirmed-recovery" | "sensor-gap" | "observation-ended";
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
  mealType: MealEvent["mealType"];
  windows: ObservedMealWindow[];
  averageRiseMmolL: number;
  minimumRiseMmolL: number;
  maximumRiseMmolL: number;
}

function round(value: number, decimals = 0) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function signed(value: number, suffix = "") {
  const rounded = round(value, 1);
  return `${rounded > 0 ? "+" : ""}${regionalNumber(rounded, 1)}${suffix}`;
}

function regionalNumber(value: number, maximumFractionDigits = 2) {
  return formatRegionalNumber(
    value,
    getRuntimeRegionalDefaults().locale,
    { maximumFractionDigits },
  );
}

function regionalGlucose(mmolL: number, signedValue = false) {
  return formatGlucose(mmolL, getRuntimeRegionalDefaults(), {
    signed: signedValue,
  });
}

function regionalWeight(kilograms: number) {
  const regional = getRuntimeRegionalDefaults();
  const imperial = regional.measurementSystem === "imperial";
  const value = imperial ? kilograms * 2.2046226218 : kilograms;
  return `${formatRegionalNumber(value, regional.locale, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })} ${imperial ? "lb" : "kg"}`;
}

function regionalHydration(litres: number) {
  const regional = getRuntimeRegionalDefaults();
  const imperial = regional.measurementSystem === "imperial";
  const value = imperial ? litres * 33.814022702 : litres;
  return `${formatRegionalNumber(value, regional.locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} ${imperial ? "fl oz" : "L"}`;
}

function regionalDistance(kilometres: number) {
  return formatDistance(kilometres * 1_000, getRuntimeRegionalDefaults());
}

function regionalEnergy(kcal: number) {
  return formatEnergy(kcal, getRuntimeRegionalDefaults());
}

function rangeDays(range: { start: number; end: number }) {
  return Math.max(1, Math.round((range.end - range.start) / 86_400_000));
}

function localHour(timestamp: number) {
  const regional = getRuntimeRegionalDefaults();
  return getZonedDateTimeParts(timestamp, regional.timeZone).hour;
}

function glucosePreview(reading: GlucoseReading): EvidenceRecordPreview {
  return {
    id: reading.id,
    kind: "glucose",
    timestamp: reading.timestamp,
    primary: regionalGlucose(reading.mmolL),
    secondary: reading.quality,
    sourceId: reading.sourceId,
  };
}

function representativeGlucose(readings: GlucoseReading[]) {
  if (readings.length === 0) return [];
  const sorted = [...readings].sort((a, b) => a.timestamp - b.timestamp);
  const highest = [...readings].sort((a, b) => b.mmolL - a.mmolL)[0]!;
  const lowest = [...readings].sort((a, b) => a.mmolL - b.mmolL)[0]!;
  return [
    ...new Map(
      [sorted[0]!, highest, lowest, sorted[sorted.length - 1]!].map(
        (reading) => [reading.id, glucosePreview(reading)],
      ),
    ).values(),
  ];
}

const MAX_EPISODE_GAP_MS = 12 * 60_000;
const EPISODE_START_CONFIRMATION_MS = 15 * 60_000;
const EPISODE_RECOVERY_CONFIRMATION_MS = 15 * 60_000;

/** Versioned so persisted/replayed answers can state which event convention ran. */
export const GLUCOSE_EPISODE_DEFINITION_VERSION =
  "consensus-15m-start-recovery-t1arc-gap12-canonical-v3";

type GlucoseEpisodeReading = GlucoseReading & { recordIds: string[] };

/**
 * Episode thresholds describe the person at an instant, not the number or
 * ordering of import sources. Average duplicate source rows once and retain
 * every contributing ID so detection is deterministic and fully auditable.
 */
function canonicalEpisodeReadings(
  readings: readonly GlucoseReading[],
): GlucoseEpisodeReading[] {
  const sorted = [...readings].sort(
    (left, right) =>
      left.timestamp - right.timestamp || left.id.localeCompare(right.id),
  );
  const groups: { timestamp: number; readings: GlucoseReading[] }[] = [];
  sorted.forEach((reading) => {
    const previous = groups.at(-1);
    if (previous?.timestamp === reading.timestamp) {
      previous.readings.push(reading);
      return;
    }
    groups.push({ timestamp: reading.timestamp, readings: [reading] });
  });
  return groups.map(({ readings: group }) => {
    const representative = group[0]!;
    const recordIds = group.map(({ id }) => id);
    return {
      ...representative,
      id: recordIds[0]!,
      receivedAt: Math.max(...group.map(({ receivedAt }) => receivedAt)),
      mmolL:
        group.reduce((total, reading) => total + reading.mmolL, 0) /
        group.length,
      quality: group.every(({ quality }) => quality === "measured")
        ? "measured"
        : "estimated",
      recordIds,
    };
  });
}

type GlucoseEpisodeDetectionState =
  | { kind: "idle" }
  | {
      kind: "confirming-start";
      qualifyingReadings: GlucoseEpisodeReading[];
    }
  | {
      kind: "active";
      qualifyingReadings: GlucoseEpisodeReading[];
    }
  | {
      kind: "confirming-recovery";
      qualifyingReadings: GlucoseEpisodeReading[];
      recoveryStartedAt: number;
    };

export function detectGlucoseEpisodes(
  readings: GlucoseReading[],
  kind: "high" | "low",
  thresholdMmolL = kind === "high" ? 10 : 3.9,
): GlucoseEpisode[] {
  if (!Number.isFinite(thresholdMmolL) || thresholdMmolL <= 0) {
    throw new RangeError(
      "A glucose episode threshold must be a positive number.",
    );
  }
  const sorted = canonicalEpisodeReadings(readings);
  const qualifies = (reading: GlucoseEpisodeReading) =>
    kind === "high"
      ? reading.mmolL > thresholdMmolL
      : reading.mmolL < thresholdMmolL;
  const episodes: GlucoseEpisode[] = [];
  let state: GlucoseEpisodeDetectionState = { kind: "idle" };
  let previousObservedReading: GlucoseEpisodeReading | undefined;

  function emitEpisode(
    qualifyingReadings: GlucoseEpisodeReading[],
    end: number,
    endStatus: GlucoseEpisode["endStatus"],
  ) {
    const first = qualifyingReadings[0];
    if (!first) return;
    episodes.push({
      id: `${kind}:${thresholdMmolL}:${first.timestamp}:${end}`,
      kind,
      thresholdMmolL,
      start: first.timestamp,
      end,
      endStatus,
      readings: qualifyingReadings,
      extremeMmolL:
        kind === "high"
          ? Math.max(...qualifyingReadings.map((reading) => reading.mmolL))
          : Math.min(...qualifyingReadings.map((reading) => reading.mmolL)),
    });
  }

  function lastQualifyingTimestamp(
    qualifyingReadings: GlucoseEpisodeReading[],
  ) {
    return qualifyingReadings[qualifyingReadings.length - 1]!.timestamp;
  }

  function endObservedEpisodeForSensorGap() {
    if (state.kind === "active" || state.kind === "confirming-recovery") {
      emitEpisode(
        state.qualifyingReadings,
        lastQualifyingTimestamp(state.qualifyingReadings),
        "sensor-gap",
      );
    }
    state = { kind: "idle" };
  }

  for (const reading of sorted) {
    if (
      previousObservedReading &&
      reading.timestamp - previousObservedReading.timestamp > MAX_EPISODE_GAP_MS
    ) {
      // Missing sensor continuity cannot confirm either persistence or
      // recovery. Close an already-confirmed observed episode at its last
      // qualifying reading and require a new 15-minute start afterwards.
      endObservedEpisodeForSensorGap();
    }
    previousObservedReading = reading;

    const isQualifying = qualifies(reading);
    if (state.kind === "idle") {
      if (isQualifying) {
        state = {
          kind: "confirming-start",
          qualifyingReadings: [reading],
        };
      }
      continue;
    }

    if (state.kind === "confirming-start") {
      if (!isQualifying) {
        state = { kind: "idle" };
        continue;
      }
      const qualifyingReadings: GlucoseEpisodeReading[] =
        state.qualifyingReadings;
      qualifyingReadings.push(reading);
      const first: GlucoseEpisodeReading = qualifyingReadings[0]!;
      state =
        reading.timestamp - first.timestamp >= EPISODE_START_CONFIRMATION_MS
          ? { kind: "active", qualifyingReadings }
          : { kind: "confirming-start", qualifyingReadings };
      continue;
    }

    if (state.kind === "active") {
      if (isQualifying) {
        state.qualifyingReadings.push(reading);
      } else {
        state = {
          kind: "confirming-recovery",
          qualifyingReadings: state.qualifyingReadings,
          recoveryStartedAt: reading.timestamp,
        };
      }
      continue;
    }

    if (isQualifying) {
      // A return across the event threshold lasting less than 15 minutes is
      // a recovery attempt within the same episode, not a new episode.
      state.qualifyingReadings.push(reading);
      state = {
        kind: "active",
        qualifyingReadings: state.qualifyingReadings,
      };
      continue;
    }
    if (
      reading.timestamp - state.recoveryStartedAt >=
      EPISODE_RECOVERY_CONFIRMATION_MS
    ) {
      // The first recovery reading is the event boundary. Later readings
      // confirm that this boundary persisted for the required 15 minutes.
      emitEpisode(
        state.qualifyingReadings,
        state.recoveryStartedAt,
        "confirmed-recovery",
      );
      state = { kind: "idle" };
    }
  }

  if (state.kind === "active" || state.kind === "confirming-recovery") {
    // The reporting window ended before a confirmed recovery (or while the
    // event was still qualifying). Retain the confirmed observed episode and
    // end its displayed span at the last qualifying sample.
    emitEpisode(
      state.qualifyingReadings,
      lastQualifyingTimestamp(state.qualifyingReadings),
      "observation-ended",
    );
  }
  return episodes;
}

export function glucoseEpisodeDurationMinutes(episode: GlucoseEpisode) {
  return Math.max(0, Math.round((episode.end - episode.start) / 60_000));
}

export function glucoseEpisodeBurden(episode: GlucoseEpisode) {
  const threshold = episode.thresholdMmolL;
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

export function observedMealWindows(data: TimelineData): ObservedMealWindow[] {
  const readings = [...data.glucose].sort((a, b) => a.timestamp - b.timestamp);
  const meals = data.context
    .filter((event): event is MealEvent => event.kind === "meal")
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
    const normalizedTitle = window.meal.title.trim().toLocaleLowerCase("en-GB");
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
        windows: [...values].sort((a, b) => a.meal.start - b.meal.start),
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
      return a.label.localeCompare(b.label, "en-GB");
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
    Math.round((response.peak.timestamp - response.meal.start) / 60_000),
  );
  const bolusExamples = boluses.slice(0, 1).map((delivery) => ({
    id: delivery.id,
    kind: "bolus" as const,
    timestamp: delivery.timestamp,
    primary: `${regionalNumber(delivery.units, 1)} U bolus`,
    secondary: "Nearby recorded delivery",
    sourceId: delivery.sourceId,
  }));
  const basalExamples = basal.slice(0, 1).map((delivery) => ({
    id: delivery.id,
    kind: "basal" as const,
    timestamp: delivery.start,
    primary: `${regionalNumber(delivery.rateUnitsPerHour)} U/h basal`,
    secondary: `${regionalNumber(delivery.units)} U delivered in interval`,
    sourceId: delivery.sourceId,
  }));

  return {
    id: `meal-response:${response.meal.id}`,
    label: `${response.meal.title} · ${regionalGlucose(response.riseMmolL, true)} observed change`,
    description: `${regionalNumber(response.readings.length, 0)} glucose readings from ${regionalGlucose(response.baseline.mmolL)} to a ${regionalGlucose(response.peak.mmolL)} peak ${regionalNumber(minutesToPeak, 0)} minutes after the meal, plus ${regionalNumber(boluses.length + basal.length, 0)} nearby insulin records. This is a time association, not proof of a food or insulin effect`,
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
    description: `${regionalNumber(data.glucose.length, 0)} normalised glucose readings`,
    range: data.range,
    recordIds: data.glucose.map((reading) => reading.id),
    examples: representativeGlucose(data.glucose),
  };
}

function manualKetoneReadingFromContextEvent(event: HealthContextEvent) {
  const draft = manualKetoneDraftFromEvent(event);
  if (!draft) return undefined;
  return draft.ketoneType === "blood"
    ? { ketoneType: "blood" as const, value: draft.value }
    : { ketoneType: "urine" as const, value: draft.value };
}

function contextPreview(event: HealthContextEvent): EvidenceRecordPreview {
  const ketone = manualKetoneReadingFromContextEvent(event);
  const primary = ketone
    ? formatManualKetoneTitle(ketone)
    : event.kind === "note"
      ? contextNoteDisplayTitle(event, getRuntimeRegionalDefaults())
      : event.title;
  let secondary: string;
  switch (event.kind) {
    case "meal":
      secondary = mealNutritionSummary(event, { includeItems: true });
      break;
    case "activity":
      secondary =
        event.intensity === "unspecified"
          ? `${regionalNumber(event.durationMinutes, 0)} min`
          : `${regionalNumber(event.durationMinutes, 0)} min ${event.intensity}`;
      break;
    case "sleep":
      secondary = `${regionalNumber(Math.floor(event.durationMinutes / 60), 0)}h ${regionalNumber(event.durationMinutes % 60, 0)}m`;
      break;
    case "weight":
      secondary = regionalWeight(event.kilograms);
      break;
    case "medication":
      secondary =
        event.amount !== undefined
          ? `${regionalNumber(event.amount)}${event.unit ? ` ${event.unit}` : ""}`
          : "Recorded event";
      break;
    case "note":
      secondary = ketone
        ? ketone.ketoneType === "blood"
          ? `${regionalNumber(ketone.value)} mmol/L · manually entered blood ketone reading`
          : `${ketone.value === "negative" ? "Negative" : ketone.value === "trace" ? "Trace" : ketone.value} · manually entered urine ketone strip result`
        : event.detail
          ? `${contextNoteCategoryLabel(event.category)} · ${event.detail}`
          : contextNoteCategoryLabel(event.category);
      break;
  }
  return {
    id: event.id,
    kind: "context",
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
  const manualKetone = manualKetoneReadingFromContextEvent(event);
  const eventEnd = event.end ?? event.start;
  const desiredStart =
    event.kind === "sleep" ? event.start : event.start - 60 * 60_000;
  const desiredEnd =
    event.kind === "sleep"
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
    (delivery) => delivery.start < range.end && delivery.end > range.start,
  );
  const nearbyContext = data.context.filter(
    (candidate) =>
      candidate.id !== event.id &&
      candidate.start < range.end &&
      (candidate.end ?? candidate.start) >= range.start,
  );
  const bolusExamples = boluses.slice(0, 1).map((delivery) => ({
    id: delivery.id,
    kind: "bolus" as const,
    timestamp: delivery.timestamp,
    primary: `${regionalNumber(delivery.units, 1)} U bolus`,
    secondary: "Nearby recorded delivery",
    sourceId: delivery.sourceId,
  }));
  const basalExamples = basal.slice(0, 1).map((delivery) => ({
    id: delivery.id,
    kind: "basal" as const,
    timestamp: delivery.start,
    primary: `${regionalNumber(delivery.rateUnitsPerHour)} U/h basal`,
    secondary: `${regionalNumber(delivery.units)} U delivered in interval`,
    sourceId: delivery.sourceId,
  }));

  return {
    id: `context-window:${event.id}`,
    label: `${
      manualKetone
        ? formatManualKetoneTitle(manualKetone)
        : event.kind === "note"
          ? contextNoteDisplayTitle(event, getRuntimeRegionalDefaults())
          : event.title
    } · nearby records`,
    description: `${regionalNumber(glucose.length, 0)} glucose, ${regionalNumber(boluses.length + basal.length, 0)} insulin, and ${regionalNumber(nearbyContext.length, 0)} other context records in the loaded time window. Proximity is shown for inspection and does not establish cause`,
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
    description: `${regionalNumber(events.length, 0)} normalised context events`,
    range,
    recordIds: events.map((event) => event.id),
    examples: events.slice(0, 4).map(contextPreview),
  };
}

function noteCategorySummary(notes: ContextNoteEvent[]) {
  const counts = new Map<ContextNoteEvent["category"], number>();
  notes.forEach((note) =>
    counts.set(note.category, (counts.get(note.category) ?? 0) + 1),
  );
  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1])
    .map(
      ([category, count]) =>
        `${contextNoteCategoryLabel(category)} (${regionalNumber(count, 0)})`,
    )
    .join(", ");
}

function isManualKetoneContextEvent(event: ContextNoteEvent) {
  return manualKetoneReadingFromContextEvent(event) !== undefined;
}

function orderedManualKetoneEvents(events: readonly ContextNoteEvent[]) {
  return [...events].sort(
    (left, right) =>
      left.start - right.start || left.id.localeCompare(right.id),
  );
}

function manualKetoneReadingSummary(events: readonly ContextNoteEvent[]) {
  if (!events.length) return "none recorded";
  return orderedManualKetoneEvents(events)
    .map((event) => {
      const reading = manualKetoneReadingFromContextEvent(event)!;
      return `${formatManualKetoneTitle(reading)} at ${formatShortDate(toDateKey(event.start))} ${formatTime(event.start)}`;
    })
    .join("; ");
}

function manualKetoneEvidence(
  id: string,
  label: string,
  events: readonly ContextNoteEvent[],
  range: { start: number; end: number },
): EvidenceReference {
  const ordered = orderedManualKetoneEvents(events);
  return {
    id,
    label,
    description: `${regionalNumber(ordered.length, 0)} manually entered blood or urine ketone reading${ordered.length === 1 ? "" : "s"}. The saved value, modality and event time are kept together as one local record`,
    range,
    recordIds: ordered.map((event) => event.id),
    examples: ordered.slice(0, 4).map(contextPreview),
  };
}

function medicationEntrySummary(events: MedicationEvent[]) {
  if (!events.length) return "none recorded";
  const counts = new Map<string, number>();
  events.forEach((event) => {
    const amount =
      event.amount === undefined
        ? ""
        : ` · ${regionalNumber(event.amount)}${event.unit ? ` ${event.unit}` : ""}`;
    const label = `${event.title}${amount}`;
    counts.set(label, (counts.get(label) ?? 0) + 1);
  });
  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, 4)
    .map(([label, count]) =>
      count === 1 ? label : `${label} (${regionalNumber(count, 0)})`,
    )
    .join(", ");
}

function healthMetricPreview(record: DailyMetricRecord): EvidenceRecordPreview {
  const primary = (() => {
    switch (record.kind) {
      case "steps":
        return `${regionalNumber(Math.round(record.value), 0)} steps`;
      case "distance":
        return formatDistance(record.value, getRuntimeRegionalDefaults());
      case "elevation_gained":
        return `${formatElevation(record.value, getRuntimeRegionalDefaults())} elevation`;
      case "floors_climbed":
        return `${regionalNumber(record.value, 1)} floors`;
      case "active_calories":
        return `${regionalEnergy(record.value)} active energy`;
      case "total_calories":
        return `${regionalEnergy(record.value)} total energy`;
      case "workout_power":
        return `${regionalNumber(Math.round(record.value), 0)} W`;
      case "workout_speed":
        return formatSpeed(record.value, getRuntimeRegionalDefaults());
      case "walking_cadence":
        return `${regionalNumber(Math.round(record.value), 0)} steps/min`;
      case "cycling_cadence":
        return `${regionalNumber(Math.round(record.value), 0)} rpm`;
      case "heart_rate":
        return `${regionalNumber(Math.round(record.value), 0)} bpm`;
      case "resting_heart_rate":
        return `${regionalNumber(Math.round(record.value), 0)} bpm resting`;
      case "weight":
      case "lean_body_mass":
      case "body_water_mass":
      case "bone_mass":
        return regionalWeight(record.value);
      case "height":
        return formatHeight(record.value, getRuntimeRegionalDefaults());
      case "basal_metabolic_rate":
        return `${formatEnergyPerDay(record.value, getRuntimeRegionalDefaults())} basal metabolism`;
      case "blood_glucose":
        return `${regionalGlucose(record.value)} Health Connect glucose`;
      case "body_fat":
      case "oxygen_saturation":
        return `${regionalNumber(record.value, 1)}%`;
      case "blood_pressure_systolic":
        return `${regionalNumber(Math.round(record.value), 0)} mmHg systolic`;
      case "blood_pressure_diastolic":
        return `${regionalNumber(Math.round(record.value), 0)} mmHg diastolic`;
      case "respiratory_rate":
        return `${regionalNumber(record.value, 1)} breaths/min`;
      case "heart_rate_variability_rmssd":
        return `${regionalNumber(Math.round(record.value), 0)} ms HRV`;
      case "vo2_max":
        return `${regionalNumber(record.value, 1)} ml/kg/min VO₂ max`;
      case "body_temperature":
        return formatTemperature(record.value, getRuntimeRegionalDefaults());
      case "hydration":
        return `${regionalHydration(record.value)} hydration`;
    }
  })();
  return {
    id: record.id,
    kind: "health-metric",
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
  kinds: DailyMetricRecord["kind"][],
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
    description: `${regionalNumber(records.length, 0)} source-selected Health Connect records${
      input.metrics.sourceLabels.length
        ? ` from ${input.metrics.sourceLabels.join(", ")}`
        : ""
    }`,
    range,
    recordIds: records.map((record) => record.id),
    examples: records.slice(0, 4).map(healthMetricPreview),
  };
}

const HEALTH_CATEGORY_KINDS: Record<
  DailyMetricCategory,
  DailyMetricRecord["kind"][]
> = {
  steps: ["steps"],
  distance: ["distance", "elevation_gained", "floors_climbed"],
  active_calories: ["active_calories", "total_calories"],
  workouts: [
    "workout_power",
    "workout_speed",
    "walking_cadence",
    "cycling_cadence",
  ],
  heart_rate: ["heart_rate", "resting_heart_rate"],
  weight: ["weight"],
  body_composition: [
    "body_fat",
    "lean_body_mass",
    "body_water_mass",
    "bone_mass",
    "height",
    "basal_metabolic_rate",
  ],
  blood_glucose: ["blood_glucose"],
  vitals: [
    "blood_pressure_systolic",
    "blood_pressure_diastolic",
    "oxygen_saturation",
    "respiratory_rate",
    "heart_rate_variability_rmssd",
    "vo2_max",
    "body_temperature",
  ],
  hydration: ["hydration"],
};

function healthCategoryLabel(category: DailyMetricCategory) {
  switch (category) {
    case "active_calories":
      return "active energy";
    case "heart_rate":
      return "heart rate";
    case "workouts":
      return "workout detail";
    case "body_composition":
      return "body composition";
    case "blood_glucose":
      return "Health Connect glucose";
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
  kinds: DailyMetricRecord["kind"][],
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
    kind: "basal" as const,
    timestamp: delivery.start,
    primary: `${regionalNumber(delivery.rateUnitsPerHour)} U/h basal`,
    secondary: `${regionalNumber(delivery.units)} U delivered`,
    sourceId: delivery.sourceId,
  }));
  const bolusExamples = data.boluses.slice(0, 2).map((delivery) => ({
    id: delivery.id,
    kind: "bolus" as const,
    timestamp: delivery.timestamp,
    primary: `${regionalNumber(delivery.units, 1)} U bolus`,
    secondary: "Delivered event",
    sourceId: delivery.sourceId,
  }));
  return {
    id,
    label,
    description: `${regionalNumber(data.basal.length, 0)} basal intervals and ${regionalNumber(data.boluses.length, 0)} boluses`,
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
      : `${regionalNumber(total.basalUnits, 1)} U basal`,
    total.bolusUnits === undefined
      ? undefined
      : `${regionalNumber(total.bolusUnits, 1)} U bolus`,
  ].filter((part): part is string => Boolean(part));
  return {
    id: total.id,
    kind: "insulin-total",
    timestamp: total.timestamp,
    primary: `${regionalNumber(total.totalUnits, 1)} U source daily total`,
    secondary: parts.length
      ? parts.join(" · ")
      : "Reported aggregate insulin total",
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
  const basal = data.basal.filter((delivery) => organisedIds.has(delivery.id));
  const boluses = data.boluses.filter((delivery) =>
    organisedIds.has(delivery.id),
  );
  return {
    id,
    label,
    description: `${regionalNumber(reconciliation.reportedDays, 0)} source-reported daily total${reconciliation.reportedDays === 1 ? "" : "s"} compared only with detailed basal and bolus rows from the same complete ${getRuntimeRegionalDefaults().timeZone} calendar day${reconciliation.reportedDays === 1 ? "" : "s"}`,
    range: data.range,
    recordIds: [
      ...reconciliation.reportedRecordIds,
      ...reconciliation.organisedRecordIds,
    ],
    examples: [
      ...totals.slice(0, 2).map(dailyInsulinTotalPreview),
      ...basal.slice(0, 1).map((delivery) => ({
        id: delivery.id,
        kind: "basal" as const,
        timestamp: delivery.start,
        primary: `${regionalNumber(delivery.rateUnitsPerHour)} U/h basal`,
        secondary: `${regionalNumber(delivery.units)} U delivered`,
        sourceId: delivery.sourceId,
      })),
      ...boluses.slice(0, 1).map((delivery) => ({
        id: delivery.id,
        kind: "bolus" as const,
        timestamp: delivery.timestamp,
        primary: `${regionalNumber(delivery.units, 1)} U bolus`,
        secondary: "Delivered event",
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
  return `${label}, Glooko reported ${regionalNumber(reconciliation.reportedTotalUnits, 1)} U across ${regionalNumber(reconciliation.reportedDays, 0)} complete day${reconciliation.reportedDays === 1 ? "" : "s"}, while the detailed basal and bolus rows from those same days totalled ${regionalNumber(reconciliation.organisedTotalUnits, 1)} U (difference ${signed(reconciliation.differenceUnits, " U")}).`;
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
    description: `${regionalNumber(episodes.length, 0)} sustained period${episodes.length === 1 ? "" : "s"} found across ${regionalNumber(readings.length, 0)} readings`,
    range,
    recordIds: readings.flatMap((reading) => reading.recordIds),
    examples: representativeGlucose(readings),
  };
}

export function buildGlucoseEpisodeEvidence(
  episode: GlucoseEpisode,
  data: TimelineData,
): EvidenceReference {
  const contextStart = Math.max(
    data.range.start,
    episode.start - 3 * 60 * 60_000,
  );
  const contextEnd = Math.min(data.range.end, episode.end + 60 * 60_000);
  const nearbyContext = data.context.filter((event) => {
    const eventEnd = "end" in event && event.end ? event.end : event.start;
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
    episode.kind === "high" ? b.mmolL - a.mmolL : a.mmolL - b.mmolL,
  )[0]!;
  const durationMinutes = glucoseEpisodeDurationMinutes(episode);
  const nearbyRecordCount =
    nearbyContext.length + nearbyBoluses.length + overlappingBasal.length;
  const basalExamples = overlappingBasal.slice(0, 1).map((delivery) => ({
    id: delivery.id,
    kind: "basal" as const,
    timestamp: delivery.start,
    primary: `${regionalNumber(delivery.rateUnitsPerHour)} U/h basal`,
    secondary: `${regionalNumber(delivery.units)} U delivered in interval`,
    sourceId: delivery.sourceId,
  }));
  const bolusExamples = nearbyBoluses.slice(0, 1).map((delivery) => ({
    id: delivery.id,
    kind: "bolus" as const,
    timestamp: delivery.timestamp,
    primary: `${regionalNumber(delivery.units, 1)} U bolus`,
    secondary: "Nearby recorded delivery",
    sourceId: delivery.sourceId,
  }));

  return {
    id: `episode-detail:${episode.id}`,
    label: `${episode.kind === "high" ? "High" : "Low"} run to ${regionalGlucose(episode.extremeMmolL)}`,
    description: `${regionalNumber(episode.readings.length, 0)} readings across a ${regionalNumber(durationMinutes, 0)}-minute period, with ${regionalNumber(nearbyRecordCount, 0)} nearby food, activity, or insulin records. Nearby records may not explain the change`,
    range: { start: contextStart, end: Math.max(contextStart + 1, contextEnd) },
    recordIds: [
      ...episode.readings.flatMap((reading) => reading.recordIds),
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
    description: `${regionalNumber(windows.length, 0)} recorded meal${windows.length === 1 ? "" : "s"} with at least ${regionalNumber(2, 0)} hours of nearby glucose coverage`,
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
  const highGlucoseRuns = detectGlucoseEpisodes(data.glucose, "high");
  const lowGlucoseRuns = detectGlucoseEpisodes(data.glucose, "low");
  const insulinUnavailable = data.sources.some(
    (source) => source.label === "Insulin" && source.freshness === "missing",
  );
  const insulin = calculateInsulinStats(data.basal, data.boluses, data.range);
  const meals = data.context.filter(
    (event): event is MealEvent => event.kind === "meal",
  );
  const sleeps = data.context.filter(
    (event): event is SleepEvent => event.kind === "sleep",
  );
  const activities = data.context.filter(
    (event): event is ActivityEvent => event.kind === "activity",
  );
  const weights = data.context.filter(
    (event): event is WeightEvent => event.kind === "weight",
  );
  // Insight ranges are analysis-zone calendar periods. Dividing by elapsed
  // milliseconds would make a spring-clock-change day count as 23/24 of a
  // day (and an autumn day as 25/24), subtly skewing every daily comparison.
  const durationDays = rangeDays(data.range);
  const mealSummary = summarizeHealthTrendContext(meals, data.range);
  const carbohydrateCoverage = mealSummary.mealNutrientCoverage.carbsGrams;
  const carbohydrateComparisonReady =
    carbohydrateCoverage.recordCount > 0 &&
    !nutritionCoverageNeedsReview(carbohydrateCoverage) &&
    mealSummary.nutritionPossibleDuplicatePairs === 0;

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
    mealCarbsPerDay: carbohydrateComparisonReady
      ? round(mealSummary.mealCarbsGrams! / durationDays, 1)
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
        : round(health.metrics.distanceKilometres / durationDays, 1),
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
    healthConnectBloodGlucoseMmolL: health?.metrics.bloodGlucoseMmolL,
    bloodPressureSystolic: health?.metrics.bloodPressureSystolic,
    bloodPressureDiastolic: health?.metrics.bloodPressureDiastolic,
    oxygenSaturationPercent: health?.metrics.oxygenSaturationPercent,
    respiratoryRatePerMinute: health?.metrics.respiratoryRatePerMinute,
    heartRateVariabilityRmssdMs: health?.metrics.heartRateVariabilityRmssdMs,
    vo2MaxMillilitresPerKilogramMinute:
      health?.metrics.vo2MaxMillilitresPerKilogramMinute,
    bodyTemperatureCelsius: health?.metrics.bodyTemperatureCelsius,
  };
}

const DAY_PARTS = [
  { id: "overnight", label: "Overnight", start: 0, end: 6 },
  { id: "morning", label: "Morning", start: 6, end: 12 },
  { id: "afternoon", label: "Afternoon", start: 12, end: 18 },
  { id: "evening", label: "Evening", start: 18, end: 24 },
] as const;

const MAX_INSIGHT_OBSERVED_GAP_MS = 12 * 60_000;
const MIN_DAY_PART_COVERAGE_PERCENT = 70;

interface DayPartInterval {
  start: number;
  end: number;
}

interface DayPartGlucoseSummary {
  id: (typeof DAY_PARTS)[number]["id"];
  label: string;
  readings: GlucoseReading[];
  expectedMinutes: number;
  observedMinutes: number;
  coveragePercent: number;
  highPercent: number;
  lowPercent: number;
}

function dayPartIntervals(
  range: TimelineData["range"],
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
 * Summarises each analysis-zone clock quarter using elapsed observed time, not
 * reading counts. Expected minutes follow actual timezone boundaries, so the
 * overnight block naturally follows local clock changes.
 */
export function glucoseTimeByDayPart(
  readings: GlucoseReading[],
  range: TimelineData["range"],
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
  inputGeneration = 0,
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
      id: "baseline-limitation",
      kind: "limitation",
      category: "data-quality",
      title: "More personal history is needed",
      summary: `Coverage is ${regionalNumber(current.coveragePercent)}% for the recent window and ${regionalNumber(previous.coveragePercent)}% for the comparison window. T1 Arc waits for at least ${regionalNumber(70, 0)}% in both before comparing them.`,
      evidence: [
        glucoseEvidence("current-coverage", "Recent window", currentData),
        glucoseEvidence("previous-coverage", "Comparison window", previousData),
      ],
    });
    return {
      generatedAt,
      inputGeneration,
      currentRange: currentData.range,
      previousRange: previousData.range,
      ready,
      headline: "Building a trustworthy baseline",
      summary:
        "T1 Arc is collecting personal readings, but there is not enough comparable coverage yet for a responsible comparison.",
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
        ? "was similar"
        : coverageDelta > 0
          ? "was higher"
          : "was lower";
    findings.push({
      id: "glucose-data-completeness",
      kind: "limitation",
      category: "data-quality",
      title: "Glucose coverage affects comparison confidence",
      summary: `Coverage ${coverageDirection}: ${regionalNumber(currentCompleteness.glucose.coveragePercent)}% recently versus ${regionalNumber(previousCompleteness.glucose.coveragePercent)}% previously. This is not a glucose outcome; it tells you whether the two time-in-range denominators are similarly observed. The longest uncovered interval was ${regionalNumber(currentCompleteness.glucose.longestGapMinutes)} minutes recently and ${regionalNumber(previousCompleteness.glucose.longestGapMinutes)} minutes previously.`,
      caveat:
        "Missing sensor time can skew comparisons. T1 Arc does not assume glucose stayed steady while readings were missing.",
      evidence: [
        glucoseEvidence(
          "current-completeness",
          "Recent glucose coverage",
          currentData,
        ),
        glucoseEvidence(
          "previous-completeness",
          "Previous glucose coverage",
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
      id: "health-connect-source-choice",
      kind: "limitation",
      category: "data-quality",
      title: "Some health totals need one source selected",
      summary: `Overlapping Health Connect sources were found for ${healthSourceChoices
        .map(healthCategoryLabel)
        .join(
          ", ",
        )}. T1 Arc leaves those totals out until one source is selected.`,
      caveat:
        "This prevents duplicate records from being treated as extra activity or measurements. Choose the source in Settings; the original copies remain available.",
      evidence: [
        ...(health.current
          ? [
              healthMetricEvidence(
                "current-health-source-choice",
                "Recent overlapping health records",
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
                "previous-health-source-choice",
                "Previous overlapping health records",
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
    kinds: DailyMetricRecord["kind"][];
  }[] = [
    {
      id: "movement",
      label: "movement",
      categories: ["steps", "distance", "active_calories"],
      kinds: ["steps", "distance", "active_calories"],
    },
    {
      id: "heart",
      label: "heart rate",
      categories: ["heart_rate"],
      kinds: ["heart_rate", "resting_heart_rate"],
    },
    {
      id: "body",
      label: "body composition",
      categories: ["body_composition"],
      kinds: HEALTH_CATEGORY_KINDS.body_composition,
    },
    {
      id: "vitals",
      label: "vital signs",
      categories: ["blood_glucose", "vitals"],
      kinds: [
        ...HEALTH_CATEGORY_KINDS.blood_glucose,
        ...HEALTH_CATEGORY_KINDS.vitals,
      ],
    },
    {
      id: "hydration",
      label: "hydration",
      categories: ["hydration"],
      kinds: ["hydration"],
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
      id: "health-context-comparability",
      kind: "limitation",
      category: "data-quality",
      title: "Some health context cannot be compared",
      summary: `Information is available in only one comparison period for ${incomparableHealthGroups
        .map((group) => group.label)
        .join(", ")}. T1 Arc does not treat the other window as zero.`,
      caveat:
        "A missing record can mean the source did not write it, permission was unavailable, or no measurement was taken. It is not evidence that the value or activity was zero.",
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
      (source) => source.label === "Insulin" && source.freshness === "missing",
    );
  if (
    insulinIsAvailable(currentData) &&
    insulinIsAvailable(previousData) &&
    (currentCompleteness.basal.recordCount > 0 ||
      previousCompleteness.basal.recordCount > 0) &&
    (currentCompleteness.basal.coveragePercent < 90 ||
      previousCompleteness.basal.coveragePercent < 90)
  ) {
    findings.push({
      id: "basal-data-completeness",
      kind: "limitation",
      category: "data-quality",
      title: "Basal history has uncovered time",
      summary: `Recorded basal deliveries and known automated pauses cover ${regionalNumber(currentCompleteness.basal.coveragePercent)}% of the recent window and ${regionalNumber(previousCompleteness.basal.coveragePercent)}% of the previous window.`,
      caveat:
        "Known automated-pause intervals count as explained zero-delivery time. Any remaining uncovered interval has neither an imported basal delivery nor a known pause; it does not prove zero insulin was delivered.",
      evidence: [
        insulinEvidence(
          "current-basal-completeness",
          "Recent insulin records",
          currentData,
        ),
        insulinEvidence(
          "previous-basal-completeness",
          "Previous insulin records",
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
      id: "insulin-total-reconciliation",
      kind: "limitation",
      category: "data-quality",
      title: "T1 Arc could not reconcile all insulin export rows",
      summary: [
        currentInsulinMismatch && currentInsulinReconciliation
          ? insulinReconciliationSummary(
              "In the recent window",
              currentInsulinReconciliation,
            )
          : "",
        previousInsulinMismatch && previousInsulinReconciliation
          ? insulinReconciliationSummary(
              "In the comparison window",
              previousInsulinReconciliation,
            )
          : "",
      ]
        .filter(Boolean)
        .join(" "),
      caveat:
        "The Glooko daily aggregate is the reference check here. A mismatch means the detailed basal/bolus rows T1 Arc parsed do not add up to that aggregate—often because rows are missing, overlap, or were represented differently in the export. It does not mean the pump delivered the wrong amount or that Glooko is wrong, and it is not a dosing conclusion.",
      evidence: [
        ...(currentInsulinMismatch && currentInsulinReconciliation
          ? [
              insulinReconciliationEvidence(
                "current-insulin-reconciliation",
                "Recent insulin export check",
                currentData,
                currentInsulinReconciliation,
              ),
            ]
          : []),
        ...(previousInsulinMismatch && previousInsulinReconciliation
          ? [
              insulinReconciliationEvidence(
                "previous-insulin-reconciliation",
                "Previous insulin export check",
                previousData,
                previousInsulinReconciliation,
              ),
            ]
          : []),
      ],
    });
  }

  const tirDelta = current.timeInRangePercent - previous.timeInRangePercent;
  const averageDelta =
    (current.glucoseAverage ?? 0) - (previous.glucoseAverage ?? 0);
  const tirDirection =
    Math.abs(tirDelta) < 1
      ? "was essentially unchanged"
      : tirDelta > 0
        ? `rose by ${regionalNumber(round(tirDelta, 1), 1)} percentage points`
        : `fell by ${regionalNumber(round(Math.abs(tirDelta), 1), 1)} percentage points`;
  findings.push({
    id: "glucose-overview",
    kind: "observation",
    category: "glucose",
    title: `Time in range ${tirDirection}`,
    summary: `Recent time in range was ${regionalNumber(current.timeInRangePercent)}% versus ${regionalNumber(previous.timeInRangePercent)}%. Average glucose changed from ${regionalGlucose(previous.glucoseAverage ?? 0)} to ${regionalGlucose(current.glucoseAverage ?? 0)} (${regionalGlucose(averageDelta, true)}).`,
    evidence: [
      glucoseEvidence(
        "current-glucose",
        `Recent ${regionalNumber(comparisonDays, 0)} days`,
        currentData,
      ),
      glucoseEvidence(
        "previous-glucose",
        `Previous ${regionalNumber(comparisonDays, 0)} days`,
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
      id: "glucose-variability",
      kind: "observation",
      category: "glucose",
      title: `Glucose variability ${Math.abs(cvDelta) < 1 ? "was broadly similar" : cvDelta > 0 ? "was higher" : "was lower"}`,
      summary: `Coefficient of variation was ${regionalNumber(current.glucoseCvPercent)}% recently versus ${regionalNumber(previous.glucoseCvPercent)}% previously. Standard deviation was ${regionalGlucose(current.glucoseStandardDeviation)} versus ${regionalGlucose(previous.glucoseStandardDeviation)}.`,
      caveat:
        "These are descriptive dispersion statistics calculated only across observed sensor time; they do not suggest a treatment change.",
      evidence: [
        glucoseEvidence(
          "current-variability",
          "Recent variability inputs",
          currentData,
        ),
        glucoseEvidence(
          "previous-variability",
          "Previous variability inputs",
          previousData,
        ),
      ],
    });
  }

  const currentHighRuns = detectGlucoseEpisodes(currentData.glucose, "high");
  const currentLowRuns = detectGlucoseEpisodes(currentData.glucose, "low");
  const previousHighRuns = detectGlucoseEpisodes(previousData.glucose, "high");
  const previousLowRuns = detectGlucoseEpisodes(previousData.glucose, "low");
  const allCurrentRuns = [...currentHighRuns, ...currentLowRuns];
  const allPreviousRuns = [...previousHighRuns, ...previousLowRuns];
  const notableCurrentRuns = rankGlucoseEpisodes(allCurrentRuns, 3);
  if (allCurrentRuns.length || allPreviousRuns.length) {
    const leadingRun = notableCurrentRuns[0];
    findings.push({
      id: "glucose-runs",
      kind: "observation",
      category: "glucose",
      title: `${regionalNumber(current.highGlucoseRuns, 0)} high and ${regionalNumber(current.lowGlucoseRuns, 0)} low sustained glucose runs`,
      summary: `The recent window contained ${regionalNumber(current.highGlucoseRuns, 0)} high runs and ${regionalNumber(current.lowGlucoseRuns, 0)} low runs, versus ${regionalNumber(previous.highGlucoseRuns, 0)} high and ${regionalNumber(previous.lowGlucoseRuns, 0)} low previously. An event starts after readings remain across the threshold for at least ${regionalNumber(15, 0)} minutes and ends after they remain back across it for at least ${regionalNumber(15, 0)} minutes. A sensor gap over ${regionalNumber(12, 0)} minutes breaks continuity; gaps and reporting boundaries truncate the observed span rather than prove recovery.${
        leadingRun
          ? ` The largest recent observed excursion was a ${leadingRun.kind} run reaching ${regionalGlucose(leadingRun.extremeMmolL)} across ${regionalNumber(glucoseEpisodeDurationMinutes(leadingRun), 0)} minutes.`
          : ""
      }`,
      caveat:
        "These are grouped sensor readings, not a diagnosis. Nearby records are shown for context and are never treated as proof of a cause.",
      evidence: [
        ...(currentHighRuns.length
          ? [
              episodeEvidence(
                "current-high-glucose-runs",
                "Recent sustained high runs",
                currentHighRuns,
                currentData.range,
              ),
            ]
          : []),
        ...(currentLowRuns.length
          ? [
              episodeEvidence(
                "current-low-glucose-runs",
                "Recent sustained low runs",
                currentLowRuns,
                currentData.range,
              ),
            ]
          : []),
        ...notableCurrentRuns.map((episode) =>
          buildGlucoseEpisodeEvidence(episode, currentData),
        ),
        ...(previousHighRuns.length
          ? [
              episodeEvidence(
                "previous-high-glucose-runs",
                "Previous sustained high runs",
                previousHighRuns,
                previousData.range,
              ),
            ]
          : []),
        ...(previousLowRuns.length
          ? [
              episodeEvidence(
                "previous-low-glucose-runs",
                "Previous sustained low runs",
                previousLowRuns,
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
        excursion: "high" as const,
        currentPercent: part.highPercent,
        previousPercent: previousPart.highPercent,
        delta: part.highPercent - previousPart.highPercent,
      },
      {
        part,
        previousPart,
        excursion: "low" as const,
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
      changedPart.excursion === "high"
        ? `above ${regionalGlucose(TARGET_HIGH_MMOL_L)}`
        : `below ${regionalGlucose(TARGET_LOW_MMOL_L)}`;
    findings.push({
      id: "glucose-timing",
      kind: "observation",
      category: "glucose",
      title: `${part.label} ${changedPart.excursion} time increased most`,
      summary: `${regionalNumber(changedPart.currentPercent)}% of observed ${part.label.toLowerCase()} glucose time was ${threshold} recently, compared with ${regionalNumber(changedPart.previousPercent)}% previously. Coverage for this block was ${regionalNumber(part.coveragePercent)}% recently and ${regionalNumber(previousPart.coveragePercent)}% previously.`,
      caveat:
        `This comparison is duration-weighted and follows ${getRuntimeRegionalDefaults().timeZone} clock boundaries. T1 Arc withholds blocks below ${regionalNumber(70, 0)}% observed coverage; it describes timing, not a cause or treatment change.`,
      evidence: [
        {
          id: "current-glucose-timing",
          label: `Recent ${part.label.toLowerCase()} readings`,
          description: `${regionalNumber(part.readings.length, 0)} exact readings representing ${regionalNumber(part.observedMinutes)} of ${regionalNumber(part.expectedMinutes)} minutes`,
          range: currentData.range,
          recordIds: part.readings.map((reading) => reading.id),
          examples: representativeGlucose(part.readings),
        },
        {
          id: "previous-glucose-timing",
          label: `Previous ${part.label.toLowerCase()} readings`,
          description: `${regionalNumber(previousPart.readings.length, 0)} exact readings representing ${regionalNumber(previousPart.observedMinutes)} of ${regionalNumber(previousPart.expectedMinutes)} minutes`,
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
      id: "insulin-change",
      kind: "observation",
      category: "insulin",
      title: `Daily delivered insulin changed by ${signed(insulinDelta, " U/day")}`,
      summary: `Recent imported delivery records averaged ${regionalNumber(current.insulinUnitsPerDay, 1)} U/day (${regionalNumber(current.basalUnitsPerDay, 1)} basal and ${regionalNumber(current.bolusUnitsPerDay, 1)} bolus) versus ${regionalNumber(previous.insulinUnitsPerDay, 1)} U/day (${regionalNumber(previous.basalUnitsPerDay, 1)} basal and ${regionalNumber(previous.bolusUnitsPerDay, 1)} bolus).`,
      caveat:
        "This describes imported delivery history, not current pump state, insulin need, or dosing guidance. Uncovered basal time is reported separately.",
      evidence: [
        insulinEvidence(
          "current-insulin",
          "Recent insulin records",
          currentData,
        ),
        insulinEvidence(
          "previous-insulin",
          "Previous insulin records",
          previousData,
        ),
      ],
    });
  }

  const currentMeals = currentData.context.filter(
    (event): event is MealEvent => event.kind === "meal",
  );
  const previousMeals = previousData.context.filter(
    (event): event is MealEvent => event.kind === "meal",
  );
  if (current.mealCarbsPerDay !== null && previous.mealCarbsPerDay !== null) {
    const carbDelta = current.mealCarbsPerDay - previous.mealCarbsPerDay;
    findings.push({
      id: "food-context",
      kind: "context-clue",
      category: "food",
      title: `Logged carbohydrate context changed by ${signed(carbDelta, " g/day")}`,
      summary: `The recent window averaged ${regionalNumber(current.mealCarbsPerDay)} g/day across the available meal records, with ${regionalNumber(current.lateMeals, 0)} meals at or after ${formatRegionalWallClock("20:00", getRuntimeRegionalDefaults().locale)} versus ${regionalNumber(previous.lateMeals, 0)} previously.`,
      caveat:
        "This is a context change to inspect alongside glucose, not proof that food caused the glucose difference.",
      evidence: [
        contextEvidence(
          "current-meals",
          "Recent meal records",
          currentMeals,
          currentData.range,
        ),
        contextEvidence(
          "previous-meals",
          "Previous meal records",
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
      id: "post-meal-pattern",
      kind: "context-clue",
      category: "food",
      title: `Observed post-meal rise ${Math.abs(riseDelta) < 0.2 ? "was broadly similar" : riseDelta > 0 ? "was higher" : "was lower"}`,
      summary: `Across ${regionalNumber(currentMealWindows.length, 0)} recorded meals with adequate nearby glucose coverage, the average rise from the reading nearest the meal to the highest reading in the following window was ${regionalGlucose(currentRise)}, versus ${regionalGlucose(previousRise)} across ${regionalNumber(previousMealWindows.length, 0)} meals previously.`,
      caveat:
        "This is a time association, not proof of a food effect. Insulin, starting glucose, activity, meal composition and overlapping events may all contribute.",
      evidence: [
        mealWindowEvidence(
          "current-post-meal",
          "Recent meal windows",
          currentMealWindows,
          currentData.range,
        ),
        mealWindowEvidence(
          "previous-post-meal",
          "Previous meal windows",
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
      id: "repeated-meal-pattern",
      kind: "context-clue",
      category: "food",
      title: `${leadingRepeatedMeal.label} had the largest repeated observed rise`,
      summary: `Among meal labels with at least three adequately covered glucose windows, "${leadingRepeatedMeal.label}" had the largest recent average baseline-to-peak rise: ${regionalGlucose(leadingRepeatedMeal.averageRiseMmolL, true)} across ${regionalNumber(leadingRepeatedMeal.windows.length, 0)} meals (observed range ${regionalGlucose(leadingRepeatedMeal.minimumRiseMmolL, true)} to ${regionalGlucose(leadingRepeatedMeal.maximumRiseMmolL, true)}).${
        previousMatch
          ? ` The same label averaged ${regionalGlucose(previousMatch.averageRiseMmolL, true)} across ${regionalNumber(previousMatch.windows.length, 0)} meals in the comparison window.`
          : ""
      }`,
      caveat:
        "Meal labels are user-entered grouping clues, not proof that the foods caused the change. Portions, ingredients, starting glucose, insulin, activity and other context can differ between occurrences.",
      evidence: [
        mealWindowEvidence(
          "current-repeated-meal",
          `Recent ${leadingRepeatedMeal.label} windows`,
          leadingRepeatedMeal.windows,
          currentData.range,
        ),
        ...(previousMatch
          ? [
              mealWindowEvidence(
                "previous-repeated-meal",
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
    (event): event is SleepEvent => event.kind === "sleep",
  );
  const previousSleeps = previousData.context.filter(
    (event): event is SleepEvent => event.kind === "sleep",
  );
  if (
    current.sleepMinutesPerNight !== null &&
    previous.sleepMinutesPerNight !== null
  ) {
    const sleepDelta =
      current.sleepMinutesPerNight - previous.sleepMinutesPerNight;
    findings.push({
      id: "sleep-context",
      kind: "context-clue",
      category: "sleep",
      title: `Recorded sleep changed by ${signed(sleepDelta, " min/night")}`,
      summary: `Average recorded sleep was ${regionalNumber(round(current.sleepMinutesPerNight / 60, 1), 1)} hours recently versus ${regionalNumber(round(previous.sleepMinutesPerNight / 60, 1), 1)} hours previously.`,
      caveat:
        "Sleep is shown as a possible context signal only; this comparison does not establish causation.",
      evidence: [
        contextEvidence(
          "current-sleep",
          "Recent sleep records",
          currentSleeps,
          currentData.range,
        ),
        contextEvidence(
          "previous-sleep",
          "Previous sleep records",
          previousSleeps,
          previousData.range,
        ),
      ],
    });
  }

  const currentActivities = currentData.context.filter(
    (event): event is ActivityEvent => event.kind === "activity",
  );
  const previousActivities = previousData.context.filter(
    (event): event is ActivityEvent => event.kind === "activity",
  );
  if (current.activityMinutes !== null && previous.activityMinutes !== null) {
    const activityDelta = current.activityMinutes - previous.activityMinutes;
    findings.push({
      id: "activity-context",
      kind: "context-clue",
      category: "activity",
      title: `Recorded activity changed by ${signed(activityDelta, " min")}`,
      summary: `The recent comparison contains ${regionalNumber(current.activityMinutes)} activity minutes versus ${regionalNumber(previous.activityMinutes)} previously.`,
      caveat:
        "Activity records are contextual evidence, not an instruction to change exercise or insulin.",
      evidence: [
        contextEvidence(
          "current-activity",
          "Recent activity records",
          currentActivities,
          currentData.range,
        ),
        contextEvidence(
          "previous-activity",
          "Previous activity records",
          previousActivities,
          previousData.range,
        ),
      ],
    });
  }

  const currentNotes = currentData.context.filter(
    (event): event is ContextNoteEvent => event.kind === "note",
  );
  const previousNotes = previousData.context.filter(
    (event): event is ContextNoteEvent => event.kind === "note",
  );
  const currentKetones = currentNotes.filter(isManualKetoneContextEvent);
  const previousKetones = previousNotes.filter(isManualKetoneContextEvent);
  const currentContextNotes = currentNotes.filter(
    (event) => !isManualKetoneContextEvent(event),
  );
  const previousContextNotes = previousNotes.filter(
    (event) => !isManualKetoneContextEvent(event),
  );
  if (currentKetones.length || previousKetones.length) {
    findings.push({
      id: "recorded-ketone-readings",
      kind: "context-clue",
      category: "context",
      title: `${regionalNumber(currentKetones.length, 0)} manually logged ketone reading${currentKetones.length === 1 ? "" : "s"} recorded recently`,
      summary: `Recent manually logged ketone readings: ${manualKetoneReadingSummary(currentKetones)}. Previous manually logged ketone readings: ${manualKetoneReadingSummary(previousKetones)}.`,
      caveat:
        "These are manually entered historical observations with their saved times. They are not proof of a cause or a current ketone level and must not be used to infer or recommend insulin, medication or other treatment changes.",
      evidence: [
        ...(currentKetones.length
          ? [
              manualKetoneEvidence(
                "current-manual-ketones",
                "Recent manually logged ketone readings",
                currentKetones,
                currentData.range,
              ),
            ]
          : []),
        ...(previousKetones.length
          ? [
              manualKetoneEvidence(
                "previous-manual-ketones",
                "Previous manually logged ketone readings",
                previousKetones,
                previousData.range,
              ),
            ]
          : []),
      ],
    });
  }
  if (currentContextNotes.length || previousContextNotes.length) {
    findings.push({
      id: "recorded-context-notes",
      kind: "context-clue",
      category: "context",
      title: `${regionalNumber(currentContextNotes.length, 0)} health context note${currentContextNotes.length === 1 ? "" : "s"} recorded recently`,
      summary: `The recent window contains ${regionalNumber(currentContextNotes.length, 0)} user-recorded context note${currentContextNotes.length === 1 ? "" : "s"}${currentContextNotes.length ? `: ${noteCategorySummary(currentContextNotes)}` : ""}, versus ${regionalNumber(previousContextNotes.length, 0)} previously${previousContextNotes.length ? `: ${noteCategorySummary(previousContextNotes)}` : ""}.`,
      caveat:
        "These notes record what you observed, not what caused a glucose change. Different counts may also reflect different logging, so inspect the exact timing and readings.",
      evidence: [
        ...(currentContextNotes.length
          ? [
              contextEvidence(
                "current-context-notes",
                "Recent context notes",
                currentContextNotes,
                currentData.range,
              ),
            ]
          : []),
        ...(previousContextNotes.length
          ? [
              contextEvidence(
                "previous-context-notes",
                "Previous context notes",
                previousContextNotes,
                previousData.range,
              ),
            ]
          : []),
      ],
    });
  }

  const currentMedications = currentData.context.filter(
    (event): event is MedicationEvent => event.kind === "medication",
  );
  const previousMedications = previousData.context.filter(
    (event): event is MedicationEvent => event.kind === "medication",
  );
  if (currentMedications.length || previousMedications.length) {
    findings.push({
      id: "medication-context",
      kind: "context-clue",
      category: "medication",
      title: `${regionalNumber(currentMedications.length, 0)} medication entr${currentMedications.length === 1 ? "y" : "ies"} recorded recently`,
      summary: `Recent recorded entries: ${medicationEntrySummary(currentMedications)}. Previous recorded entries: ${medicationEntrySummary(previousMedications)}.`,
      caveat:
        "This only compares what was recorded. It does not establish adherence, explain a glucose change, or recommend starting, stopping, or changing medication.",
      evidence: [
        ...(currentMedications.length
          ? [
              contextEvidence(
                "current-medications",
                "Recent medication records",
                currentMedications,
                currentData.range,
              ),
            ]
          : []),
        ...(previousMedications.length
          ? [
              contextEvidence(
                "previous-medications",
                "Previous medication records",
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
        ? `Distance averaged ${regionalDistance(current.distanceKilometresPerDay)}/day versus ${regionalDistance(previous.distanceKilometresPerDay)}/day.`
        : "",
      current.activeCaloriesPerDay !== undefined &&
      previous.activeCaloriesPerDay !== undefined
        ? `Active energy averaged ${formatEnergyPerDay(current.activeCaloriesPerDay, getRuntimeRegionalDefaults())} versus ${formatEnergyPerDay(previous.activeCaloriesPerDay, getRuntimeRegionalDefaults())}.`
        : "",
    ]
      .filter(Boolean)
      .join(" ");
    findings.push({
      id: "health-connect-activity",
      kind: "context-clue",
      category: "activity",
      title: `Average recorded steps changed by ${signed(stepsDelta, "/day")}`,
      summary:
        `The source-selected Health Connect records averaged ${regionalNumber(current.stepsPerDay, 0)} steps/day recently versus ${regionalNumber(previous.stepsPerDay, 0)} previously. ${supportingDetails}`.trim(),
      caveat:
        "This is source-attributed activity context, not proof that activity caused a glucose change.",
      evidence: [
        healthMetricEvidence(
          "current-health-activity",
          "Recent Health Connect activity records",
          health.current,
          currentData.range,
          ["steps", "distance", "active_calories"],
        ),
        healthMetricEvidence(
          "previous-health-activity",
          "Previous Health Connect activity records",
          health.previous,
          previousData.range,
          ["steps", "distance", "active_calories"],
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
      id: "health-connect-heart-rate",
      kind: "context-clue",
      category: "heart",
      title: `${usesResting ? "Resting" : "Average"} heart rate changed by ${signed(currentHeart - previousHeart, " bpm")}`,
      summary: `${usesResting ? "Resting" : "Average"} heart rate was ${regionalNumber(currentHeart, 0)} bpm in the recent source-selected records versus ${regionalNumber(previousHeart, 0)} bpm previously.`,
      caveat:
        "Heart-rate records are contextual observations only and are not a diagnosis or treatment recommendation.",
      evidence: [
        healthMetricEvidence(
          "current-heart-rate",
          "Recent Health Connect heart-rate records",
          health.current,
          currentData.range,
          ["heart_rate", "resting_heart_rate"],
        ),
        healthMetricEvidence(
          "previous-heart-rate",
          "Previous Health Connect heart-rate records",
          health.previous,
          previousData.range,
          ["heart_rate", "resting_heart_rate"],
        ),
      ],
    });
  }

  if (health.current && health.previous) {
    const bodyComparisons = [
      {
        label: "Body fat",
        current: current.bodyFatPercent,
        previous: previous.bodyFatPercent,
        format: (value: number) => `${regionalNumber(value, 1)}%`,
        meaningfulChange: 0.2,
      },
      {
        label: "Lean mass",
        current: current.leanBodyMassKilograms,
        previous: previous.leanBodyMassKilograms,
        format: regionalWeight,
        meaningfulChange: 0.2,
      },
      {
        label: "Body water",
        current: current.bodyWaterMassKilograms,
        previous: previous.bodyWaterMassKilograms,
        format: regionalWeight,
        meaningfulChange: 0.2,
      },
    ].filter(
      (
        comparison,
      ): comparison is {
        label: string;
        current: number;
        previous: number;
        format: (value: number) => string;
        meaningfulChange: number;
      } =>
        comparison.current !== undefined && comparison.previous !== undefined,
    );
    if (bodyComparisons.length) {
      const changed = bodyComparisons.some(
        (comparison) =>
          Math.abs(comparison.current - comparison.previous) >=
          comparison.meaningfulChange,
      );
      findings.push({
        id: "health-connect-body-composition",
        kind: "context-clue",
        category: "body",
        title: changed
          ? "Recorded body composition changed"
          : "Recorded body composition was broadly similar",
        summary: bodyComparisons
          .map(
            (comparison) =>
              `${comparison.label} was ${comparison.format(comparison.current)} recently versus ${comparison.format(comparison.previous)} previously.`,
          )
          .join(" "),
        caveat:
          "These are source-selected measurements, not an explanation for glucose changes. Device method, hydration and measurement timing can affect them.",
        evidence: [
          healthMetricEvidence(
            "current-body-composition",
            "Recent body-composition records",
            health.current,
            currentData.range,
            HEALTH_CATEGORY_KINDS.body_composition,
          ),
          healthMetricEvidence(
            "previous-body-composition",
            "Previous body-composition records",
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
      id: "health-connect-hydration",
      kind: "context-clue",
      category: "hydration",
      title:
        Math.abs(hydrationDelta) < 0.1
          ? "Recorded hydration was broadly similar"
          : `Recorded hydration changed by ${regionalHydration(hydrationDelta)}/day`,
      summary: `Source-selected hydration records averaged ${regionalHydration(current.hydrationLitresPerDay)}/day recently versus ${regionalHydration(previous.hydrationLitresPerDay)}/day previously.`,
      caveat:
        "This compares only recorded drinks or hydration entries. It is not a complete fluid-balance assessment and does not establish a cause for glucose changes.",
      evidence: [
        healthMetricEvidence(
          "current-hydration",
          "Recent hydration records",
          health.current,
          currentData.range,
          ["hydration"],
        ),
        healthMetricEvidence(
          "previous-hydration",
          "Previous hydration records",
          health.previous,
          previousData.range,
          ["hydration"],
        ),
      ],
    });
  }

  if (health.current && health.previous) {
    const vitalChanges = [
      {
        label: "Health Connect blood glucose",
        current: current.healthConnectBloodGlucoseMmolL,
        previous: previous.healthConnectBloodGlucoseMmolL,
        format: regionalGlucose,
        threshold: 0.5,
      },
      {
        label: "Systolic blood pressure",
        current: current.bloodPressureSystolic,
        previous: previous.bloodPressureSystolic,
        format: (value: number) => `${regionalNumber(value, 0)} mmHg`,
        threshold: 3,
      },
      {
        label: "Diastolic blood pressure",
        current: current.bloodPressureDiastolic,
        previous: previous.bloodPressureDiastolic,
        format: (value: number) => `${regionalNumber(value, 0)} mmHg`,
        threshold: 3,
      },
      {
        label: "Blood oxygen",
        current: current.oxygenSaturationPercent,
        previous: previous.oxygenSaturationPercent,
        format: (value: number) => `${regionalNumber(value, 1)}%`,
        threshold: 1,
      },
      {
        label: "Respiratory rate",
        current: current.respiratoryRatePerMinute,
        previous: previous.respiratoryRatePerMinute,
        format: (value: number) => `${regionalNumber(value, 1)}/min`,
        threshold: 1,
      },
      {
        label: "HRV",
        current: current.heartRateVariabilityRmssdMs,
        previous: previous.heartRateVariabilityRmssdMs,
        format: (value: number) => `${regionalNumber(value, 0)} ms`,
        threshold: 3,
      },
      {
        label: "VO₂ max",
        current: current.vo2MaxMillilitresPerKilogramMinute,
        previous: previous.vo2MaxMillilitresPerKilogramMinute,
        format: (value: number) => `${regionalNumber(value, 1)} ml/kg/min`,
        threshold: 1,
      },
      {
        label: "Body temperature",
        current: current.bodyTemperatureCelsius,
        previous: previous.bodyTemperatureCelsius,
        format: (value: number) =>
          formatTemperature(value, getRuntimeRegionalDefaults()),
        threshold: 0.3,
      },
    ].filter(
      (
        comparison,
      ): comparison is {
        label: string;
        current: number;
        previous: number;
        format: (value: number) => string;
        threshold: number;
      } =>
        comparison.current !== undefined &&
        comparison.previous !== undefined &&
        Math.abs(comparison.current - comparison.previous) >=
          comparison.threshold,
    );
    if (vitalChanges.length) {
      findings.push({
        id: "health-connect-vitals",
        kind: "context-clue",
        category: "vitals",
        title:
          vitalChanges.length === 1
            ? `${vitalChanges[0]!.label} changed in recorded data`
            : `${regionalNumber(vitalChanges.length, 0)} recorded vital signs changed`,
        summary: vitalChanges
          .map(
            (comparison) =>
              `${comparison.label} was ${comparison.format(comparison.current)} recently versus ${comparison.format(comparison.previous)} previously.`,
          )
          .join(" "),
        caveat:
          "These are contextual measurements, not a diagnosis or proof of a glucose effect. Measurement method, timing and record frequency can differ between periods.",
        evidence: [
          healthMetricEvidence(
            "current-vitals",
            "Recent vital-sign records",
            health.current,
            currentData.range,
            [
              ...HEALTH_CATEGORY_KINDS.blood_glucose,
              ...HEALTH_CATEGORY_KINDS.vitals,
            ],
          ),
          healthMetricEvidence(
            "previous-vitals",
            "Previous vital-sign records",
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
    (event): event is WeightEvent => event.kind === "weight",
  );
  const previousWeights = previousData.context.filter(
    (event): event is WeightEvent => event.kind === "weight",
  );
  if (
    current.averageWeightKilograms !== undefined &&
    previous.averageWeightKilograms !== undefined
  ) {
    const weightDelta =
      current.averageWeightKilograms - previous.averageWeightKilograms;
    findings.push({
      id: "weight-context",
      kind: "context-clue",
      category: "weight",
      title:
        Math.abs(weightDelta) < 0.2
          ? "Average recorded weight was broadly similar"
          : `Average recorded weight changed by ${regionalWeight(weightDelta)}`,
      summary: `Average recorded weight was ${regionalWeight(current.averageWeightKilograms)} across ${regionalNumber(currentWeights.length, 0)} record${currentWeights.length === 1 ? "" : "s"} recently, versus ${regionalWeight(previous.averageWeightKilograms)} across ${regionalNumber(previousWeights.length, 0)} previously.`,
      caveat:
        "Weight is contextual evidence only. Measurement timing, clothing, hydration and source frequency can change this comparison; it does not establish a cause for glucose changes.",
      evidence: [
        contextEvidence(
          "current-weight",
          "Recent weight records",
          currentWeights,
          currentData.range,
        ),
        contextEvidence(
          "previous-weight",
          "Previous weight records",
          previousWeights,
          previousData.range,
        ),
      ],
    });
  }

  return {
    generatedAt,
    inputGeneration,
    currentRange: currentData.range,
    previousRange: previousData.range,
    ready,
    headline:
      tirDelta < -1
        ? `Time in range was lower in the recent ${regionalNumber(comparisonDays, 0)} days`
        : tirDelta > 1
          ? `Time in range was higher in the recent ${regionalNumber(comparisonDays, 0)} days`
          : averageDelta > 0.2
            ? `Average glucose was higher in the recent ${regionalNumber(comparisonDays, 0)} days`
            : averageDelta < -0.2
              ? `Average glucose was lower in the recent ${regionalNumber(comparisonDays, 0)} days`
              : `The two ${regionalNumber(comparisonDays, 0)}-day periods were broadly similar`,
    summary: `Time in range ${tirDirection}. T1 Arc found ${regionalNumber(findings.filter((finding) => finding.kind === "context-clue").length, 0)} context changes worth inspecting; none is presented as a proven cause.`,
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
      title: "T1 Arc does not give treatment advice",
      answer:
        "T1 Arc can show the insulin, medication, glucose and context records behind a pattern, but it will not recommend doses, correction boluses, medication changes, ratios, or pump-setting changes.",
      findingIds: [],
    };
  }

  if (!report.ready) {
    return {
      title: "Not enough comparable history yet",
      answer: report.summary,
      findingIds: report.findings.map((finding) => finding.id),
    };
  }

  const categories = classifyInsightQuestion(normalized);
  const categoryFindings = report.findings.filter((finding) =>
    categories.includes(finding.category),
  );
  const asksForExplanation =
    /\b(why|worse|better|different|change|changed|related)\b/.test(normalized);
  const selected = [
    ...new Map(
      [
        ...categoryFindings,
        ...(asksForExplanation
          ? report.findings.filter(
              (finding) =>
                finding.kind === "limitation" &&
                finding.category === "data-quality",
            )
          : []),
      ].map((finding) => [finding.id, finding]),
    ).values(),
  ];
  if (selected.length === 0) {
    return {
      title: "No supported answer from these records",
      answer:
        "T1 Arc could not find enough relevant normalised records for that question. It will not fill the gap with a guess.",
      findingIds: [],
    };
  }

  const observations = selected.filter(
    (finding) => finding.kind === "observation",
  );
  const clues = selected.filter((finding) => finding.kind === "context-clue");
  const limitations = selected.filter(
    (finding) => finding.kind === "limitation",
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
        ? "The context changes are associations to investigate, not proven causes."
        : "",
      limitations.length
        ? "These data limitations apply to the answer above."
        : "",
    ]
      .filter(Boolean)
      .join(" "),
    findingIds: selected.map((finding) => finding.id),
  };
}
