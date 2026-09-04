import type {
  TarvisEvidenceMetric,
  TarvisEvidencePresentation,
} from "./evidencePresentation";
import {
  resolveTarvisIntentRange,
  type ResolvedTarvisIntentRange,
} from "./intentRange";
import type { TarvisIntentV1, TarvisMetric } from "./intent";
import {
  formatTarvisLocalDateTime,
  formatTarvisRequestedPeriod,
} from "./timePresentation";
import type { TarvisAnswer } from "./types";
import { buildDataCompletenessReport } from "@/domain/dataCompleteness";
import { glucoseFreshness } from "@/domain/freshness";
import type {
  ActivityEvent,
  DataSourceStatus,
  GlucoseReading,
  MealEvent,
  SleepEvent,
  TimelineData,
  TimeRange,
} from "@/domain/models";
import type {
  EvidenceRecordPreview,
  EvidenceReference,
} from "@/domain/insights";
import { sourceSupports } from "@/domain/sourceCapabilities";
import { summarizeInsulinRange } from "@/domain/timelineInsulinSummary";
import { toDateKey } from "@/domain/time";
import { assessGlucoseTrend, presentTrend } from "@/domain/trend";
import {
  mealNutrientIsPartial,
  mealNutritionSummary,
} from "@/domain/mealNutrition";
import { summarizeHealthTrendContext } from "@/domain/healthTrendContext";
import {
  formatGlucose,
  glucoseFromMmolL,
  glucoseUnitLabel,
} from "@/domain/regionalFormat";
import { getRuntimeRegionalDefaults } from "@/domain/regionalProfileRuntime";
import {
  formatTarvisFixedNumber,
  formatTarvisNumber,
} from "./regionalNumberPresentation";

const EXECUTOR_VERSION = "tarvis-local-personal-data-v1";
const CURRENT_LOOKBACK_MS = 24 * 60 * 60_000;

function regionalGlucose(mmolL: number) {
  return formatGlucose(mmolL, getRuntimeRegionalDefaults());
}

function presentedGlucoseValue(mmolL: number) {
  const regional = getRuntimeRegionalDefaults();
  return {
    value: glucoseFromMmolL(mmolL, regional.glucoseUnit),
    decimals: regional.glucoseUnit === "mgDl" ? (0 as const) : (1 as const),
    unit: glucoseUnitLabel(regional.glucoseUnit),
  };
}

const SUPPORTED_METRICS = new Set<TarvisMetric>([
  "glucose.current",
  "insulin.delivered_total",
  "insulin.basal_total",
  "insulin.bolus_total",
  "food.carbohydrate_total",
  "activity.duration",
  "sleep.duration",
  "data_quality.coverage",
  "data_quality.gaps",
]);

type PersonalMetric =
  | "glucose.current"
  | "insulin.delivered_total"
  | "insulin.basal_total"
  | "insulin.bolus_total"
  | "food.carbohydrate_total"
  | "activity.duration"
  | "sleep.duration"
  | "data_quality.coverage"
  | "data_quality.gaps";

type ResultStatus = "available" | "limited" | "unavailable";

interface MetricResult {
  metric: PersonalMetric;
  value: number | null;
  unit: TarvisEvidenceMetric["unit"];
  decimals: 0 | 1;
  status: ResultStatus;
  label: string;
  sentence: string;
  limitations: string[];
  recordIds: string[];
  examples: EvidenceRecordPreview[];
  recordLabel: string;
  coveragePercent?: number;
}

export interface LocalPersonalDataRanges {
  current: TimeRange;
  previous: TimeRange | null;
}

export interface BuildLocalPersonalDataAnswerInput {
  asOf: number;
  intent: TarvisIntentV1;
  current: TimelineData;
  previous?: TimelineData;
}

export interface LocalPersonalDataAnswerResult {
  answer: TarvisAnswer;
  evidence: EvidenceReference[];
  presentation: TarvisEvidencePresentation;
}

export class UnsupportedLocalPersonalDataIntentError extends Error {
  readonly code = "unsupported-local-personal-data-intent";

  constructor(message: string) {
    super(message);
    this.name = "UnsupportedLocalPersonalDataIntentError";
  }
}

function unsupported(message: string): never {
  throw new UnsupportedLocalPersonalDataIntentError(message);
}

function round(value: number, decimals = 1) {
  const factor = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function answerForPeriod(sentence: string, range: TimeRange) {
  return `${sentence} The requested period was ${formatTarvisRequestedPeriod(range)}.`;
}

function conciseRecordTiming(
  timestamps: readonly number[],
  singular: string,
  plural: string,
) {
  const sorted = [...new Set(timestamps)].sort((left, right) => left - right);
  if (!sorted.length) return "";
  if (sorted.length === 1) {
    return ` The ${singular} was recorded at ${formatTarvisLocalDateTime(sorted[0]!)}.`;
  }
  if (sorted.length <= 3) {
    return ` The ${plural} were recorded at ${sorted.map(formatTarvisLocalDateTime).join(", ")}.`;
  }
  return ` There were ${formatTarvisNumber(sorted.length, { maximumFractionDigits: 0 })} recorded ${plural}, from ${formatTarvisLocalDateTime(sorted[0]!)} to ${formatTarvisLocalDateTime(sorted.at(-1)!)}.`;
}

function contextTiming(contributions: readonly ContextContribution[]) {
  const sorted = [...contributions].sort(
    (left, right) => left.event.start - right.event.start,
  );
  if (!sorted.length) return "";
  const description = ({ event }: ContextContribution) => {
    if (event.kind === "meal") {
      return `${event.title} at ${formatTarvisLocalDateTime(event.start)}`;
    }
    const end = event.end ?? event.start + event.durationMinutes * 60_000;
    return `${event.title} from ${formatTarvisLocalDateTime(event.start)} to ${formatTarvisLocalDateTime(end)}`;
  };
  if (sorted.length === 1) return ` ${description(sorted[0]!)}.`;
  if (sorted.length <= 3) {
    return ` The records were ${sorted.map(description).join("; ")}.`;
  }
  return ` The first record was ${description(sorted[0]!)}; the most recent was ${description(sorted.at(-1)!)}.`;
}

function metric(intent: TarvisIntentV1): PersonalMetric {
  if (intent.metrics.length !== 1) {
    return unsupported(
      "This local personal-data executor requires exactly one metric.",
    );
  }
  const value = intent.metrics[0]!.value;
  if (!SUPPORTED_METRICS.has(value)) {
    return unsupported(`${value} is not supported by this local executor.`);
  }
  if (intent.thresholds.length > 0) {
    return unsupported(
      "Personal-data totals do not accept glucose thresholds.",
    );
  }
  return value as PersonalMetric;
}

function resolvedRanges(
  intent: TarvisIntentV1,
  asOf: number,
): ResolvedTarvisIntentRange {
  const result = resolveTarvisIntentRange({ intent, asOf });
  if (result.status !== "resolved") {
    return unsupported(
      result.status === "delegate"
        ? "Recurring clock windows are not supported for this personal-data metric."
        : result.message,
    );
  }
  return result;
}

/** Returns the exact half-open repository ranges required by the typed intent. */
export function rangesForLocalPersonalDataIntent(
  intent: TarvisIntentV1,
  asOf: number,
): LocalPersonalDataRanges {
  const selected = metric(intent);
  if (!Number.isFinite(asOf) || asOf < 0) {
    return unsupported("asOf must be a finite non-negative timestamp.");
  }
  if (selected === "glucose.current") {
    if (intent.comparison !== null || intent.clockWindow !== null) {
      return unsupported(
        "Current glucose cannot be compared or clock-filtered.",
      );
    }
    return {
      current: { start: Math.max(0, asOf - CURRENT_LOOKBACK_MS), end: asOf },
      previous: null,
    };
  }
  const result = resolvedRanges(intent, asOf);
  return { current: result.current, previous: result.previous };
}

function assertRange(actual: TimeRange, expected: TimeRange, label: string) {
  if (actual.start !== expected.start || actual.end !== expected.end) {
    unsupported(
      `${label} timeline range does not exactly match the resolved intent range.`,
    );
  }
}

function inRange(timestamp: number, range: TimeRange) {
  return timestamp >= range.start && timestamp < range.end;
}

function relevantSources(
  data: TimelineData,
  label: string,
): DataSourceStatus[] {
  return data.sources.filter((source) => source.label === label);
}

function connected(sources: readonly DataSourceStatus[]) {
  return sources.some((source) => source.freshness !== "missing");
}

function hasCapability(
  sources: readonly DataSourceStatus[],
  kind: Parameters<typeof sourceSupports>[1],
) {
  return sources.some((source) => sourceSupports(source.capabilities, kind));
}

function glucosePreview(reading: GlucoseReading): EvidenceRecordPreview {
  return {
    id: reading.id,
    kind: "glucose",
    timestamp: reading.timestamp,
    primary: regionalGlucose(reading.mmolL),
    secondary: `${reading.quality} - saved reading`,
    sourceId: reading.sourceId,
  };
}

interface ContextContribution {
  event: MealEvent | ActivityEvent | SleepEvent;
  value: number;
  evidenceTimestamp: number;
  clipped: boolean;
}

function contextPreview({
  event,
  value,
  evidenceTimestamp,
  clipped,
}: ContextContribution): EvidenceRecordPreview {
  let primary = event.title;
  let secondary: string = event.kind;
  if (event.kind === "meal") {
    primary = event.title;
    secondary = `${event.mealType} - ${mealNutritionSummary(event, {
      includeItems: true,
    })}`;
  } else if (event.kind === "activity") {
    primary = `${event.title} - ${round(value, 1)} min in period`;
    secondary = `${event.intensity === "unspecified" ? "" : `${event.intensity} `}${event.activityType}${clipped ? " - clipped at period boundary" : ""}`;
  } else if (event.kind === "sleep") {
    primary = `${event.title} - ${round(value, 1)} min in period`;
    secondary = `recorded sleep${clipped ? " - clipped at period boundary" : ""}`;
  }
  return {
    id: event.id,
    kind: "context",
    // The preview is evidence for the clipped contribution, not a claim that
    // the underlying source interval began inside the requested period.
    timestamp: evidenceTimestamp,
    primary,
    secondary,
    sourceId: event.sourceId,
  };
}

function representative<T>(values: readonly T[], limit = 5) {
  if (values.length <= limit) return [...values];
  return Array.from(
    { length: limit },
    (_, index) =>
      values[Math.round((index * (values.length - 1)) / (limit - 1))]!,
  );
}

function latestReading(data: TimelineData, asOf: number) {
  return data.glucose
    .filter((reading) => reading.timestamp <= asOf)
    .sort(
      (left, right) =>
        right.timestamp - left.timestamp || right.receivedAt - left.receivedAt,
    )[0];
}

function currentGlucoseResult(data: TimelineData, asOf: number): MetricResult {
  const latest = latestReading(data, asOf);
  if (!latest) {
    return {
      metric: "glucose.current",
      value: null,
      unit: "mmol/L",
      decimals: 1,
      status: "unavailable",
      label: "Current glucose",
      sentence: `No glucose reading was available in the last ${formatTarvisNumber(24, { maximumFractionDigits: 0 })} hours.`,
      limitations: ["No last-known value was presented as current."],
      recordIds: [],
      examples: [],
      recordLabel: "glucose readings",
    };
  }
  const freshness = glucoseFreshness(latest.timestamp, asOf);
  const ageMinutes = Math.max(
    0,
    Math.round((asOf - latest.timestamp) / 60_000),
  );
  const history = data.glucose.filter(
    (reading) =>
      reading.timestamp <= latest.timestamp &&
      reading.timestamp >= latest.timestamp - 20 * 60_000,
  );
  const trend = assessGlucoseTrend(latest, history);
  const trendText = presentTrend(trend.direction).label;
  const stale = freshness === "stale";
  const trendSentence = stale
    ? "It is too old to use as a current direction."
    : trend.origin === "unavailable"
      ? "A reliable direction was not available."
      : `The ${trend.origin === "source" ? "source-reported" : "locally calculated"} direction was ${trendText}.`;
  const support = [
    ...new Map(
      [latest, ...trend.supportingReadings].map((reading) => [
        reading.id,
        reading,
      ]),
    ).values(),
  ].sort((left, right) => left.timestamp - right.timestamp);
  return {
    metric: "glucose.current",
    value: latest.mmolL,
    unit: "mmol/L",
    decimals: 1,
    status: freshness === "current" ? "available" : "limited",
    label: stale ? "Last known glucose" : "Latest glucose",
    sentence: `${stale ? "The last known" : "The latest"} glucose was ${regionalGlucose(latest.mmolL)}, recorded at ${formatTarvisLocalDateTime(latest.timestamp)} (${formatTarvisNumber(ageMinutes, { maximumFractionDigits: 0 })} minute${ageMinutes === 1 ? "" : "s"} ago). ${trendSentence}`,
    limitations: [
      ...(freshness === "delayed"
        ? ["The latest reading is delayed, so it may not describe glucose now."]
        : freshness === "stale"
          ? ["The reading is stale and was not presented as current."]
          : []),
      ...(trend.origin === "calculated"
        ? [
            "Direction was calculated from recent same-source readings; it is not a forecast.",
          ]
        : []),
      ...(trend.origin === "unavailable" && !stale && trend.reason
        ? [trend.reason]
        : []),
    ],
    recordIds: support.map(({ id }) => id),
    examples: representative(support).map(glucosePreview),
    recordLabel: "supporting glucose readings",
  };
}

function evidenceTimestamp(timestamp: number, range: TimeRange) {
  return Math.max(range.start, Math.min(timestamp, range.end - 1));
}

function insulinExamples(data: TimelineData, ids: Set<string>) {
  const previews: EvidenceRecordPreview[] = [];
  for (const total of data.dailyInsulinTotals ?? []) {
    if (!ids.has(total.id)) continue;
    previews.push({
      id: total.id,
      kind: "insulin-total",
      timestamp: evidenceTimestamp(total.timestamp, data.range),
      primary: `${formatTarvisFixedNumber(total.totalUnits, 1)} U total insulin`,
      secondary: `${total.dateKey} - source daily total`,
      sourceId: total.sourceId,
    });
  }
  for (const basal of data.basal) {
    if (!ids.has(basal.id)) continue;
    previews.push({
      id: basal.id,
      kind: "basal",
      // Basal evidence is an interval. Place its preview at the first instant
      // of overlap so a source interval that began before the query can be
      // safely persisted inside the evidence range.
      timestamp: Math.max(basal.start, data.range.start),
      primary: `${formatTarvisFixedNumber(basal.units, 2)} U basal`,
      secondary: "insulin delivered during this time",
      sourceId: basal.sourceId,
    });
  }
  for (const bolus of data.boluses) {
    if (!ids.has(bolus.id)) continue;
    previews.push({
      id: bolus.id,
      kind: "bolus",
      timestamp: bolus.timestamp,
      primary: `${formatTarvisFixedNumber(bolus.units, 2)} U bolus`,
      secondary: bolus.deliveryType ?? "recorded bolus",
      sourceId: bolus.sourceId,
    });
  }
  return representative(previews.sort((a, b) => a.timestamp - b.timestamp));
}

function insulinResult(
  selected: Extract<PersonalMetric, `insulin.${string}`>,
  data: TimelineData,
): MetricResult {
  const sources = relevantSources(data, "Insulin");
  const summary = summarizeInsulinRange(
    data.basal,
    data.boluses,
    data.range,
    data.dailyInsulinTotals,
  );
  const completeness = buildDataCompletenessReport(data);
  const authoritativeTotal = summary.sourceCoversEveryDay;
  const authoritativeBasal = summary.sourceProvidesBasalEveryDay;
  const authoritativeBolus = summary.sourceProvidesBolusEveryDay;
  const spansMultipleLocalDays =
    toDateKey(data.range.start) !== toDateKey(data.range.end - 1);
  const detailedBasal =
    (hasCapability(sources, "basal-events") || data.basal.length > 0) &&
    completeness.basal.coveragePercent >= 95;
  // A connected source with no bolus rows is not, by itself, proof of zero.
  // Zero is authoritative only when a source daily total explicitly supplies
  // a zero bolus breakdown. Detailed-event fallback therefore needs at least
  // one returned event in the exact requested range.
  const detailedBolus = data.boluses.some(({ timestamp }) =>
    inRange(timestamp, data.range),
  );
  // One or more detailed rows prove only that those rows happened. For a
  // multi-day total they do not prove that a day with no rows was truly zero,
  // so every requested analysis-zone date needs an authoritative source total.
  const allowDetailedFallback = !spansMultipleLocalDays;
  const available =
    selected === "insulin.delivered_total"
      ? authoritativeTotal ||
        (allowDetailedFallback && detailedBasal && detailedBolus)
      : selected === "insulin.basal_total"
        ? authoritativeBasal || (allowDetailedFallback && detailedBasal)
        : authoritativeBolus || (allowDetailedFallback && detailedBolus);
  const value =
    selected === "insulin.delivered_total"
      ? summary.stats.totalUnits
      : selected === "insulin.basal_total"
        ? summary.stats.basalUnits
        : summary.stats.bolusUnits;
  const label =
    selected === "insulin.delivered_total"
      ? "Delivered insulin"
      : selected === "insulin.basal_total"
        ? "Basal insulin"
        : "Bolus insulin";
  const relevantBasal = data.basal.filter(
    ({ start, end }) => start < data.range.end && end > data.range.start,
  );
  const relevantBoluses = data.boluses.filter(({ timestamp }) =>
    inRange(timestamp, data.range),
  );
  const sourceIds = new Set([
    ...summary.sourceTotals.map(({ id }) => id),
    ...relevantBasal.map(({ id }) => id),
    ...relevantBoluses.map(({ id }) => id),
  ]);
  if (!available) {
    return {
      metric: selected,
      value: null,
      unit: "U",
      decimals: 1,
      status: "unavailable",
      label,
      sentence: connected(sources)
        ? `The available insulin records do not support a reliable ${label.toLowerCase()} total for this period.`
        : "No insulin source is connected for this period.",
      limitations: [
        "Missing insulin records were not treated as zero delivery.",
      ],
      recordIds: [...sourceIds],
      examples: insulinExamples(data, sourceIds),
      recordLabel: "insulin records",
    };
  }
  const status: ResultStatus =
    summary.partial || summary.sourceConflictCount > 0
      ? "limited"
      : "available";
  const provenance = summary.sourceTotals.length
    ? "the daily totals saved in your records"
    : "the individual deliveries saved in your records";
  const bolusTiming =
    selected === "insulin.bolus_total"
      ? conciseRecordTiming(
          relevantBoluses.map(({ timestamp }) => timestamp),
          "bolus",
          "boluses",
        )
      : "";
  return {
    metric: selected,
    value,
    unit: "U",
    decimals: 1,
    status,
    label,
    sentence: `Recorded ${label.toLowerCase()} was ${formatTarvisFixedNumber(value, 1)} U, calculated from ${provenance}.${bolusTiming}`,
    limitations: [
      ...(summary.partial
        ? [
            "At least one source daily total was a partial snapshot for the requested period.",
          ]
        : []),
      ...(summary.sourceConflictCount > 0
        ? [
            `${formatTarvisNumber(summary.sourceConflictCount, { maximumFractionDigits: 0 })} alternative source total${summary.sourceConflictCount === 1 ? " was" : "s were"} retained but not double-counted.`,
          ]
        : []),
    ],
    recordIds: [...sourceIds],
    examples: insulinExamples(data, sourceIds),
    recordLabel: "insulin records",
  };
}

function contextResult(
  selected: "food.carbohydrate_total" | "activity.duration" | "sleep.duration",
  data: TimelineData,
): MetricResult {
  const mealsInRange =
    selected === "food.carbohydrate_total"
      ? data.context.filter(
          (event): event is MealEvent =>
            event.kind === "meal" && inRange(event.start, data.range),
        )
      : [];
  const contributions = data.context.flatMap((event): ContextContribution[] => {
    if (
      selected === "food.carbohydrate_total" &&
      event.kind === "meal" &&
      event.carbsGrams !== undefined &&
      inRange(event.start, data.range)
    ) {
      return [
        {
          event,
          value: event.carbsGrams,
          evidenceTimestamp: event.start,
          clipped: false,
        },
      ];
    }
    if (
      (selected === "activity.duration" && event.kind === "activity") ||
      (selected === "sleep.duration" && event.kind === "sleep")
    ) {
      const recordedEnd =
        event.end ?? event.start + event.durationMinutes * 60_000;
      const overlapStart = Math.max(event.start, data.range.start);
      const overlapEnd = Math.min(recordedEnd, data.range.end);
      if (overlapEnd <= overlapStart) return [];
      return [
        {
          event,
          value: (overlapEnd - overlapStart) / 60_000,
          evidenceTimestamp: overlapStart,
          clipped: overlapStart !== event.start || overlapEnd !== recordedEnd,
        },
      ];
    }
    return [];
  });
  const label =
    selected === "food.carbohydrate_total"
      ? "Recorded carbohydrates"
      : selected === "activity.duration"
        ? "Recorded activity"
        : "Recorded sleep";
  const unit = selected === "food.carbohydrate_total" ? "g" : "min";
  const pluralRecordLabel =
    selected === "food.carbohydrate_total"
      ? "recorded meals"
      : selected === "activity.duration"
        ? "recorded activities"
        : "recorded sleep sessions";
  const singularRecordLabel =
    selected === "food.carbohydrate_total"
      ? "meal"
      : selected === "activity.duration"
        ? "activity"
        : "sleep session";
  const countedRecordLabel =
    contributions.length === 1
      ? singularRecordLabel
      : pluralRecordLabel.replace(/^recorded /, "");
  if (!contributions.length) {
    if (selected === "food.carbohydrate_total" && mealsInRange.length) {
      return {
        metric: selected,
        value: null,
        unit,
        decimals: 1,
        status: "unavailable",
        label,
        sentence: `${formatTarvisNumber(mealsInRange.length, { maximumFractionDigits: 0 })} recorded ${mealsInRange.length === 1 ? "meal was" : "meals were"} available in this period, but ${mealsInRange.length === 1 ? "it did" : "they did"} not include a carbohydrate value.`,
        limitations: [
          "Missing carbohydrate values are unknown and are not treated as zero.",
          "Other supplied meal nutrients and exact native food items remain available in the evidence.",
        ],
        recordIds: mealsInRange.map((meal) => meal.id),
        examples: representative(
          mealsInRange.map((event) => ({
            event,
            value: 0,
            evidenceTimestamp: event.start,
            clipped: false,
          })),
        ).map(contextPreview),
        recordLabel: pluralRecordLabel,
      };
    }
    return {
      metric: selected,
      value: null,
      unit,
      decimals: selected === "food.carbohydrate_total" ? 1 : 0,
      status: "unavailable",
      label,
      sentence: `No ${pluralRecordLabel} were available in this period.`,
      limitations: [
        `No records does not mean zero ${selected === "food.carbohydrate_total" ? "carbohydrate intake" : selected === "activity.duration" ? "activity" : "sleep"}.`,
      ],
      recordIds: [],
      examples: [],
      recordLabel: pluralRecordLabel,
    };
  }
  const value = round(
    contributions.reduce((sum, contribution) => sum + contribution.value, 0),
    selected === "food.carbohydrate_total" ? 1 : 0,
  );
  const mealsMissingCarbohydrate =
    selected === "food.carbohydrate_total"
      ? mealsInRange.length - contributions.length
      : 0;
  const mealsWithPartialCarbohydrate =
    selected === "food.carbohydrate_total"
      ? mealsInRange.filter((meal) => mealNutrientIsPartial(meal, "carbsGrams"))
          .length
      : 0;
  const possibleDuplicateMeals =
    selected === "food.carbohydrate_total"
      ? summarizeHealthTrendContext(mealsInRange, data.range)
          .nutritionPossibleDuplicatePairs
      : 0;
  const presentedLabel =
    possibleDuplicateMeals > 0 || mealsWithPartialCarbohydrate > 0
      ? "Known carbohydrate from retained meal records"
      : label;
  return {
    metric: selected,
    value,
    unit,
    decimals: selected === "food.carbohydrate_total" ? 1 : 0,
    status:
      mealsMissingCarbohydrate > 0 ||
      mealsWithPartialCarbohydrate > 0 ||
      possibleDuplicateMeals > 0
        ? "limited"
        : "available",
    label: presentedLabel,
    sentence: `${presentedLabel} totalled ${formatTarvisFixedNumber(value, selected === "food.carbohydrate_total" ? 1 : 0)} ${unit} across ${formatTarvisNumber(contributions.length, { maximumFractionDigits: 0 })} ${countedRecordLabel}.${contextTiming(contributions)}`,
    limitations: [
      `Only explicitly recorded ${pluralRecordLabel.replace(/^recorded /, "")} are included; unrecorded events are not inferred.`,
      ...(mealsMissingCarbohydrate > 0
        ? [
            `${formatTarvisNumber(mealsMissingCarbohydrate, { maximumFractionDigits: 0 })} recorded ${mealsMissingCarbohydrate === 1 ? "meal had" : "meals had"} no carbohydrate value and ${mealsMissingCarbohydrate === 1 ? "was" : "were"} excluded rather than counted as zero.`,
          ]
        : []),
      ...(mealsWithPartialCarbohydrate > 0
        ? [
            `${formatTarvisNumber(mealsWithPartialCarbohydrate, { maximumFractionDigits: 0 })} itemised ${mealsWithPartialCarbohydrate === 1 ? "meal contains" : "meals contain"} a carbohydrate subtotal because at least one food item did not supply carbohydrate.`,
          ]
        : []),
      ...(possibleDuplicateMeals > 0
        ? [
            `${formatTarvisNumber(possibleDuplicateMeals, { maximumFractionDigits: 0 })} cross-source meal ${possibleDuplicateMeals === 1 ? "pair was" : "pairs were"} recorded close together. Both records remain in the evidence, so this known total may overlap.`,
          ]
        : []),
      ...(selected === "activity.duration"
        ? [
            "Only the part of an activity that falls inside the requested time is counted.",
          ]
        : []),
      ...(selected === "sleep.duration"
        ? [
            "Only the part of sleep that falls inside the requested time is counted. Sleep across midnight is divided between the two days.",
          ]
        : []),
    ],
    recordIds: contributions.map(({ event }) => event.id),
    examples: representative(contributions).map(contextPreview),
    recordLabel:
      contributions.length === 1
        ? `recorded ${singularRecordLabel}`
        : pluralRecordLabel,
  };
}

function dataQualityResult(
  selected: "data_quality.coverage" | "data_quality.gaps",
  data: TimelineData,
): MetricResult {
  const completeness = buildDataCompletenessReport(data).glucose;
  const glucoseSources = relevantSources(data, "Glucose");
  const sourceConnected = connected(glucoseSources) || data.glucose.length > 0;
  if (!sourceConnected) {
    return {
      metric: selected,
      value: null,
      unit: selected === "data_quality.coverage" ? "%" : "gaps",
      decimals: selected === "data_quality.coverage" ? 1 : 0,
      status: "unavailable",
      label:
        selected === "data_quality.coverage"
          ? "Sensor coverage"
          : "Sensor gaps",
      sentence: "No glucose source was available for this period.",
      limitations: ["Missing information was not treated as no change."],
      recordIds: [],
      examples: [],
      recordLabel: "glucose readings",
    };
  }
  const gapCount = completeness.gaps.length;
  const value =
    selected === "data_quality.coverage"
      ? completeness.coveragePercent
      : gapCount;
  const limited = completeness.coveragePercent < 70;
  const readings = data.glucose
    .filter((reading) => inRange(reading.timestamp, data.range))
    .sort((a, b) => a.timestamp - b.timestamp);
  return {
    metric: selected,
    value,
    unit: selected === "data_quality.coverage" ? "%" : "gaps",
    decimals: selected === "data_quality.coverage" ? 1 : 0,
    status: limited ? "limited" : "available",
    label:
      selected === "data_quality.coverage" ? "Sensor coverage" : "Sensor gaps",
    sentence:
      selected === "data_quality.coverage"
        ? `Observed sensor coverage was ${formatTarvisFixedNumber(completeness.coveragePercent, 1)}%, with ${formatTarvisFixedNumber(completeness.missingMinutes, 1)} missing minutes.`
        : `There ${gapCount === 1 ? "was" : "were"} ${formatTarvisNumber(gapCount, { maximumFractionDigits: 0 })} uncovered sensor gap${gapCount === 1 ? "" : "s"}; the longest was ${formatTarvisFixedNumber(completeness.longestGapMinutes, 1)} minutes.`,
    limitations: [
      `Coverage uses a ${formatTarvisNumber(12, { maximumFractionDigits: 0 })}-minute observation window after each reading; uncovered time is not treated as stable glucose.`,
    ],
    recordIds: readings.map(({ id }) => id),
    examples: representative(readings).map(glucosePreview),
    recordLabel: "glucose readings",
    coveragePercent: completeness.coveragePercent,
  };
}

function calculateMetric(
  selected: PersonalMetric,
  data: TimelineData,
  asOf: number,
): MetricResult {
  if (selected === "glucose.current") return currentGlucoseResult(data, asOf);
  if (
    selected === "insulin.delivered_total" ||
    selected === "insulin.basal_total" ||
    selected === "insulin.bolus_total"
  ) {
    return insulinResult(
      selected as Extract<PersonalMetric, `insulin.${string}`>,
      data,
    );
  }
  if (
    selected === "food.carbohydrate_total" ||
    selected === "activity.duration" ||
    selected === "sleep.duration"
  ) {
    return contextResult(selected, data);
  }
  return dataQualityResult(
    selected as "data_quality.coverage" | "data_quality.gaps",
    data,
  );
}

function metricId(metric: PersonalMetric): TarvisEvidenceMetric["id"] {
  switch (metric) {
    case "glucose.current":
      return "current-glucose";
    case "insulin.delivered_total":
      return "insulin-total";
    case "insulin.basal_total":
      return "basal-insulin";
    case "insulin.bolus_total":
      return "bolus-insulin";
    case "food.carbohydrate_total":
      return "carbohydrates";
    case "activity.duration":
      return "activity-duration";
    case "sleep.duration":
      return "sleep-duration";
    case "data_quality.coverage":
      return "sensor-coverage";
    case "data_quality.gaps":
      return "sensor-gaps";
  }
}

function evidenceFor(
  selected: PersonalMetric,
  data: TimelineData,
  result: MetricResult,
  label: string,
) {
  const queryId = `${EXECUTOR_VERSION}:${JSON.stringify({
    schemaVersion: 1,
    timezone: getRuntimeRegionalDefaults().timeZone,
    metric: selected,
    range: data.range,
    algorithm: selected.startsWith("insulin.")
      ? "timeline-insulin-summary-authoritative-daily-v2"
      : selected.startsWith("data_quality.")
        ? "data-completeness-observation-window-12m-v1"
        : selected === "glucose.current"
          ? "latest-freshness-trend-v1"
          : selected === "food.carbohydrate_total"
            ? "recorded-point-event-in-range-sum-v1"
            : "recorded-interval-overlap-clipped-v2",
  })}`;
  return {
    id: `${queryId}:${label === "Requested period" ? "current" : "previous"}`,
    label: `${label}: records used for ${result.label.toLowerCase()}`,
    description: `${formatTarvisNumber(result.recordIds.length, { maximumFractionDigits: 0 })} saved record${result.recordIds.length === 1 ? "" : "s"} support this answer. Missing information was not counted as zero.`,
    range: { ...data.range },
    recordIds: [...new Set(result.recordIds)],
    examples: result.examples,
  } satisfies EvidenceReference;
}

function presentationWindow(
  label: string,
  data: TimelineData,
  result: MetricResult,
) {
  const displayedGlucose =
    result.unit === "mmol/L" && result.value !== null
      ? presentedGlucoseValue(result.value)
      : undefined;
  return {
    label,
    range: { ...data.range },
    recordCount: result.recordIds.length,
    coveragePercent: result.coveragePercent,
    coverageStatus:
      result.status === "available"
        ? ("sufficient" as const)
        : result.status === "limited"
          ? ("limited" as const)
          : ("unavailable" as const),
    recordLabel: result.recordLabel,
    metrics: [
      {
        id: metricId(result.metric),
        label: result.label,
        value: displayedGlucose?.value ?? result.value,
        decimals: displayedGlucose?.decimals ?? result.decimals,
        unit: displayedGlucose?.unit ?? result.unit,
      },
    ],
  };
}

function comparisonSentence(
  current: MetricResult,
  previous: MetricResult,
  currentRange: TimeRange,
  previousRange: TimeRange,
) {
  if (current.value === null || previous.value === null) {
    return `${answerForPeriod(current.sentence, currentRange)} For the previous equal period (${formatTarvisRequestedPeriod(previousRange)}), ${previous.sentence} I did not calculate a difference.`;
  }
  const difference = round(current.value - previous.value, current.decimals);
  if (current.unit === "mmol/L" && previous.unit === "mmol/L") {
    const currentDisplayed = presentedGlucoseValue(difference);
    const previousDisplayed = presentedGlucoseValue(previous.value);
    const sign = difference > 0 ? "+" : difference < 0 ? "-" : "";
    return `${answerForPeriod(current.sentence, currentRange)} For the previous equal period, ${formatTarvisRequestedPeriod(previousRange)}, the value was ${formatTarvisFixedNumber(previousDisplayed.value, previousDisplayed.decimals)} ${previousDisplayed.unit}; the difference was ${sign}${formatTarvisFixedNumber(Math.abs(currentDisplayed.value), currentDisplayed.decimals)} ${currentDisplayed.unit}.`;
  }
  const sign = difference > 0 ? "+" : "";
  return `${answerForPeriod(current.sentence, currentRange)} For the previous equal period, ${formatTarvisRequestedPeriod(previousRange)}, the value was ${formatTarvisFixedNumber(previous.value, previous.decimals)} ${previous.unit}; the difference was ${sign}${formatTarvisFixedNumber(difference, current.decimals)} ${current.unit}.`;
}

/** Executes one validated exact personal-data intent without a model request. */
export function buildLocalPersonalDataAnswer({
  asOf,
  intent,
  current,
  previous,
}: BuildLocalPersonalDataAnswerInput): LocalPersonalDataAnswerResult {
  const selected = metric(intent);
  const ranges = rangesForLocalPersonalDataIntent(intent, asOf);
  assertRange(current.range, ranges.current, "Current");
  if (ranges.previous) {
    if (!previous)
      unsupported("The comparison intent requires previous timeline data.");
    assertRange(previous.range, ranges.previous, "Previous");
  } else if (previous) {
    unsupported(
      "Previous timeline data was supplied for a non-comparison intent.",
    );
  }

  const currentResult = calculateMetric(selected, current, asOf);
  const previousResult = previous
    ? calculateMetric(selected, previous, previous.range.end)
    : undefined;
  const evidence = [
    evidenceFor(selected, current, currentResult, "Requested period"),
    ...(previousResult && previous
      ? [evidenceFor(selected, previous, previousResult, "Previous period")]
      : []),
  ];
  const limitations = [
    ...new Set([
      ...currentResult.limitations,
      ...(previousResult?.limitations ?? []),
    ]),
  ].slice(0, 5);
  const unavailable =
    currentResult.status === "unavailable" ||
    previousResult?.status === "unavailable";
  const limited =
    currentResult.status === "limited" || previousResult?.status === "limited";
  const answer: TarvisAnswer = {
    headline:
      currentResult.value === null
        ? `${currentResult.label} unavailable`
        : previousResult
          ? `${currentResult.label} comparison`
          : `${currentResult.label}: ${formatTarvisFixedNumber(currentResult.value, currentResult.decimals)} ${currentResult.unit}`,
    answer: previousResult
      ? comparisonSentence(
          currentResult,
          previousResult,
          current.range,
          previous!.range,
        )
      : selected === "glucose.current"
        ? currentResult.sentence
        : answerForPeriod(currentResult.sentence, current.range),
    confidence: unavailable || limited ? "limited" : "high",
    evidenceIds: evidence.map(({ id }) => id),
    limitations,
  };
  const presentation: TarvisEvidencePresentation = {
    kind: selected === "glucose.current" ? "current-glucose" : "personal-data",
    title: previousResult
      ? `${currentResult.label} comparison`
      : `${currentResult.label} for this period`,
    detail:
      `Based on the date and time you asked about in ${getRuntimeRegionalDefaults().timeZone}. Missing information is left out rather than counted as zero.`,
    windows: [
      presentationWindow("Requested period", current, currentResult),
      ...(previousResult && previous
        ? [
            presentationWindow(
              "Previous equal period",
              previous,
              previousResult,
            ),
          ]
        : []),
    ],
  };
  return { answer, evidence, presentation };
}
