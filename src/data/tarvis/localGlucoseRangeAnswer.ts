import type {
  TarvisEvidenceMetric,
  TarvisEvidencePresentation,
} from "./evidencePresentation";
import {
  createGlucoseAnswerBundleV2,
  type GlucoseAnswerBundleV2,
} from "./glucoseAnswerBundleV2";
import type {
  TarvisGlucoseThreshold,
  TarvisIntentV1,
  TarvisMetric,
  TarvisOperation,
} from "./intent";
import {
  resolveTarvisIntentRange,
  type TarvisIntentComparisonBasis,
} from "./intentRange";
import {
  calculateGlucoseStatistics,
  canonicalGlucoseSamples,
  GMI_FORMULA_VERSION,
  GLUCOSE_STATISTICS_VERSION,
  GLUCOSE_MEAN_METRIC_VERSION,
} from "./query/glucoseStatistics";
import type { TarvisAnswer } from "./types";
import { isLocalGlucoseScopeWithinLimit } from "./localScopeLimit";
import {
  describeGlucoseExtremeTiming,
  summarizeGlucoseExtreme,
} from "./glucoseExtrema";
import {
  detectGlucoseEpisodes,
  type EvidenceCalculationReference,
  type EvidenceReference,
  GLUCOSE_EPISODE_DEFINITION_VERSION,
} from "@/domain/insights";
import {
  type GlucoseReading,
  MG_DL_PER_MMOL_L,
  TARGET_HIGH_MMOL_L,
  TARGET_LOW_MMOL_L,
  type TimeRange,
} from "@/domain/models";
import { toDateKey, zonedDateTimeToTimestamp } from "@/domain/time";
import {
  isEvidenceQueryVisualizationReference,
  type EvidenceQueryEvent,
  type EvidenceQueryVisualizationReference,
} from "@/domain/evidenceQueryChart";
import { formatTarvisRequestedPeriod, tarvisComparisonDurationNote } from "./timePresentation";
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

const LOCAL_RANGE_ANSWER_VERSION = "tarvis-local-glucose-range-v1";
const OBSERVATION_GAP_MS = 12 * 60_000;
const EPISODE_BOUNDARY_CONTEXT_MS = 15 * 60_000;
const SUFFICIENT_COVERAGE_PERCENT = 70;
const GMI_MINIMUM_EXPECTED_MILLISECONDS = 14 * 24 * 60 * 60_000;

function regionalGlucose(mmolL: number) {
  return formatGlucose(mmolL, getRuntimeRegionalDefaults());
}

function regionalGlucoseMetric(value: number | null) {
  const regional = getRuntimeRegionalDefaults();
  return {
    value:
      value === null ? null : glucoseFromMmolL(value, regional.glucoseUnit),
    decimals: regional.glucoseUnit === "mgDl" ? (0 as const) : (1 as const),
    unit: glucoseUnitLabel(regional.glucoseUnit),
  };
}

function regionalGlucoseRange(lowerMmolL: number, upperMmolL: number) {
  const regional = getRuntimeRegionalDefaults();
  return `${formatGlucose(lowerMmolL, regional, { withUnit: false })}–${formatGlucose(upperMmolL, regional, { withUnit: false })} ${glucoseUnitLabel(regional.glucoseUnit)}`;
}

type SupportedMetric = Extract<
  TarvisMetric,
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
  | "glucose.high_readings"
>;

const SUPPORTED_METRICS = new Set<SupportedMetric>([
  "glucose.mean",
  "glucose.median",
  "glucose.minimum",
  "glucose.maximum",
  "glucose.standard_deviation",
  "glucose.coefficient_of_variation",
  "glucose.gmi",
  "glucose.time_in_range",
  "glucose.low_episodes",
  "glucose.high_episodes",
  "glucose.low_readings",
  "glucose.high_readings",
]);

const EXPECTED_OPERATION: Record<SupportedMetric, TarvisOperation> = {
  "glucose.mean": "aggregate",
  "glucose.median": "aggregate",
  "glucose.minimum": "aggregate",
  "glucose.maximum": "aggregate",
  "glucose.standard_deviation": "aggregate",
  "glucose.coefficient_of_variation": "aggregate",
  "glucose.gmi": "aggregate",
  "glucose.time_in_range": "range_distribution",
  "glucose.low_episodes": "count_episodes",
  "glucose.high_episodes": "count_episodes",
  "glucose.low_readings": "count_readings",
  "glucose.high_readings": "count_readings",
};

interface NormalizedThreshold extends Omit<TarvisGlucoseThreshold, "unit"> {
  unit: "mmol/L";
}

interface ExecutableRangeIntent {
  intent: TarvisIntentV1;
  metrics: SupportedMetric[];
  thresholds: NormalizedThreshold[];
}

interface RangeCalculation {
  coveragePercent: number;
  metrics: EvidenceCalculationReference["metrics"];
  observationIntervals: {
    start: number;
    end: number;
    mmolL: number;
    recordIds: string[];
  }[];
  observedMilliseconds: number;
  readings: GlucoseReading[];
  evidenceReadings: GlucoseReading[];
  evidenceRange: TimeRange;
  range: TimeRange;
  distribution: {
    abovePercent: number | null;
    belowPercent: number | null;
    inRangePercent: number | null;
  } | null;
}

interface LabeledRangeCalculation {
  id: string;
  label: string;
  role: "requested" | "comparison";
  value: RangeCalculation;
}

const SAMPLE_STATISTIC_METRICS = new Set<SupportedMetric>([
  "glucose.mean",
  "glucose.median",
  "glucose.minimum",
  "glucose.maximum",
  "glucose.standard_deviation",
  "glucose.coefficient_of_variation",
  "glucose.gmi",
  "glucose.low_readings",
  "glucose.high_readings",
]);

function metricAlgorithmVersion(metric: SupportedMetric) {
  if (metric === "glucose.mean") return GLUCOSE_MEAN_METRIC_VERSION;
  if (metric === "glucose.time_in_range") {
    return "duration-forward-cap-12m-v1";
  }
  if (metric.endsWith("_episodes")) {
    return GLUCOSE_EPISODE_DEFINITION_VERSION;
  }
  if (metric === "glucose.gmi") {
    return `${GLUCOSE_STATISTICS_VERSION}:${GMI_FORMULA_VERSION}:unique-timestamp-rounded-2dp`;
  }
  if (metric.endsWith("_readings")) {
    return `${GLUCOSE_STATISTICS_VERSION}:threshold-count-unique-timestamp-v1`;
  }
  return `${GLUCOSE_STATISTICS_VERSION}:${metric.split(".").at(-1)}-unique-timestamp-rounded-2dp`;
}

function completeLocalCalendarDayCount(range: TimeRange) {
  const startDate = toDateKey(range.start);
  const endDate = toDateKey(range.end);
  if (
    zonedDateTimeToTimestamp(startDate) !== range.start ||
    zonedDateTimeToTimestamp(endDate) !== range.end
  ) {
    return null;
  }
  const utcDate = (date: string) => Date.parse(`${date}T00:00:00.000Z`);
  return Math.round((utcDate(endDate) - utcDate(startDate)) / 86_400_000);
}

function hasRepresentativeGmiDuration(range: TimeRange) {
  const localCalendarDays = completeLocalCalendarDayCount(range);
  return localCalendarDays !== null
    ? localCalendarDays >= 14
    : range.end - range.start >= GMI_MINIMUM_EXPECTED_MILLISECONDS;
}

export interface LocalGlucoseRangeAnswerResult {
  answer: TarvisAnswer;
  /** Immutable, runtime-validated calculation provenance for this answer. */
  answerBundle: GlucoseAnswerBundleV2;
  evidence: EvidenceReference[];
  presentation: TarvisEvidencePresentation;
}

interface LocalGlucoseRangeAnswerInput {
  asOf: number;
  intent: TarvisIntentV1;
  readings: GlucoseReading[];
}

export type LocalGlucoseRangeComponentResult = Omit<
  LocalGlucoseRangeAnswerResult,
  "answerBundle"
>;

export class UnsupportedLocalGlucoseRangeIntentError extends Error {
  readonly code = "unsupported-local-glucose-range-intent";

  constructor(message: string) {
    super(message);
    this.name = "UnsupportedLocalGlucoseRangeIntentError";
  }
}

function unsupported(message: string): never {
  throw new UnsupportedLocalGlucoseRangeIntentError(message);
}

function round(value: number, decimals: number) {
  const factor = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function normalizeThreshold(
  threshold: TarvisGlucoseThreshold,
): NormalizedThreshold {
  if (!Number.isFinite(threshold.value) || threshold.value <= 0) {
    return unsupported("Glucose thresholds must be finite positive values.");
  }
  return {
    ...threshold,
    unit: "mmol/L",
    value:
      threshold.unit === "mg/dL"
        ? threshold.value / MG_DL_PER_MMOL_L
        : threshold.value,
  };
}

function validateIntent(intent: TarvisIntentV1): ExecutableRangeIntent {
  if (!isLocalGlucoseScopeWithinLimit(intent)) {
    return unsupported(
      "Local glucose answers support at most 90 total days per query.",
    );
  }
  if (intent.schemaVersion !== 1 || intent.domain.value !== "glucose") {
    return unsupported(
      "Only schema-v1 glucose intents are locally executable.",
    );
  }
  if (intent.clockWindow !== null) {
    return unsupported(
      "Recurring clock windows use the clock-window executor.",
    );
  }
  if (!intent.metrics.length) {
    return unsupported("A local glucose calculation requires a metric.");
  }
  const metrics = intent.metrics.map(({ value }) => value);
  if (
    new Set(metrics).size !== metrics.length ||
    metrics.some((metric) => !SUPPORTED_METRICS.has(metric as SupportedMetric))
  ) {
    return unsupported(
      "The intent contains an unsupported or duplicate metric.",
    );
  }
  const supportedMetrics = metrics as SupportedMetric[];
  if (
    supportedMetrics.some(
      (metric) => EXPECTED_OPERATION[metric] !== intent.operation.value,
    )
  ) {
    return unsupported("The metric and operation do not agree.");
  }

  const thresholds = intent.thresholds.map(({ value }) =>
    normalizeThreshold(value),
  );
  const roles = new Set(thresholds.map(({ role }) => role));
  if (roles.size !== thresholds.length) {
    return unsupported("The intent contains duplicate threshold roles.");
  }
  const expectedRoles = new Set<NormalizedThreshold["role"]>();
  if (supportedMetrics.includes("glucose.time_in_range")) {
    expectedRoles.add("range_lower");
    expectedRoles.add("range_upper");
  }
  if (
    supportedMetrics.includes("glucose.low_episodes") ||
    supportedMetrics.includes("glucose.low_readings")
  ) {
    expectedRoles.add("low");
  }
  if (
    supportedMetrics.includes("glucose.high_episodes") ||
    supportedMetrics.includes("glucose.high_readings")
  ) {
    expectedRoles.add("high");
  }
  if (
    thresholds.length !== expectedRoles.size ||
    thresholds.some(({ role }) => !expectedRoles.has(role))
  ) {
    return unsupported(
      "The threshold roles do not exactly match the requested calculation.",
    );
  }
  const lower = thresholds.find(({ role }) => role === "range_lower");
  const upper = thresholds.find(({ role }) => role === "range_upper");
  if (
    (lower && lower.operator !== "gt" && lower.operator !== "gte") ||
    (upper && upper.operator !== "lt" && upper.operator !== "lte") ||
    (lower && upper && lower.value >= upper.value)
  ) {
    return unsupported("The requested glucose range is invalid or inverted.");
  }
  const low = thresholds.find(({ role }) => role === "low");
  const high = thresholds.find(({ role }) => role === "high");
  if ((low && low.operator !== "lt") || (high && high.operator !== "gt")) {
    return unsupported(
      "Low/high calculations support strict below/above thresholds only.",
    );
  }
  return { intent, metrics: supportedMetrics, thresholds };
}

function resolveRanges(executable: ExecutableRangeIntent, asOf: number) {
  const resolution = resolveTarvisIntentRange({
    asOf,
    intent: executable.intent,
    timezone: getRuntimeRegionalDefaults().timeZone,
  });
  if (resolution.status !== "resolved") {
    return unsupported(
      resolution.status === "rejected"
        ? resolution.message
        : "The requested period requires the recurring-window executor.",
    );
  }
  return resolution;
}

/** The smallest half-open repository range needed for the exact calculation. */
export function rangeForLocalGlucoseRangeIntent(
  intent: TarvisIntentV1,
  asOf: number,
): TimeRange {
  const executable = validateIntent(intent);
  const resolved = resolveRanges(executable, asOf);
  const exact = {
    start: Math.min(
      resolved.current.start,
      resolved.previous?.start ?? Infinity,
    ),
    end: Math.max(resolved.current.end, resolved.previous?.end ?? -Infinity),
  };
  return executable.metrics.some((metric) => metric.endsWith("_episodes"))
    ? {
        start: Math.max(0, exact.start - EPISODE_BOUNDARY_CONTEXT_MS),
        end: Math.min(asOf, exact.end + EPISODE_BOUNDARY_CONTEXT_MS),
      }
    : exact;
}

function canonicalReadings(readings: readonly GlucoseReading[]) {
  const ids = new Set<string>();
  return [...readings]
    .map((reading) => {
      if (!reading.id.trim() || ids.has(reading.id)) {
        return unsupported(
          reading.id.trim()
            ? `Duplicate glucose record ID: ${reading.id}.`
            : "A glucose record ID was empty.",
        );
      }
      ids.add(reading.id);
      if (
        !Number.isFinite(reading.timestamp) ||
        reading.timestamp < 0 ||
        !Number.isFinite(reading.mmolL) ||
        reading.mmolL <= 0 ||
        !reading.sourceId.trim()
      ) {
        return unsupported("A glucose record was not valid for calculation.");
      }
      return reading;
    })
    .sort(
      (left, right) =>
        left.timestamp - right.timestamp || left.id.localeCompare(right.id),
    );
}

function thresholdFor(
  thresholds: NormalizedThreshold[],
  role: NormalizedThreshold["role"],
) {
  const threshold = thresholds.find((candidate) => candidate.role === role);
  return threshold ?? unsupported(`Missing ${role} threshold.`);
}

function matchesThreshold(value: number, threshold: NormalizedThreshold) {
  switch (threshold.operator) {
    case "lt":
      return value < threshold.value;
    case "lte":
      return value <= threshold.value;
    case "gt":
      return value > threshold.value;
    case "gte":
      return value >= threshold.value;
  }
}

function observationIntervals(
  readings: readonly GlucoseReading[],
  range: TimeRange,
) {
  const groups: {
    timestamp: number;
    mmolL: number;
    recordIds: string[];
  }[] = [];
  readings.forEach((reading) => {
    const previous = groups.at(-1);
    if (previous?.timestamp === reading.timestamp) {
      const count = previous.recordIds.length;
      previous.mmolL = (previous.mmolL * count + reading.mmolL) / (count + 1);
      previous.recordIds.push(reading.id);
      return;
    }
    groups.push({
      timestamp: reading.timestamp,
      mmolL: reading.mmolL,
      recordIds: [reading.id],
    });
  });
  return groups.flatMap((group, index) => {
    const end = Math.min(
      range.end,
      groups[index + 1]?.timestamp ?? range.end,
      group.timestamp + OBSERVATION_GAP_MS,
    );
    return end > group.timestamp
      ? [
          {
            start: group.timestamp,
            end,
            mmolL: group.mmolL,
            recordIds: [...group.recordIds],
          },
        ]
      : [];
  });
}

function calculateRange(
  executable: ExecutableRangeIntent,
  allReadings: readonly GlucoseReading[],
  range: TimeRange,
  asOf: number,
): RangeCalculation {
  const readings = allReadings.filter(
    ({ timestamp }) => timestamp >= range.start && timestamp < range.end,
  );
  const needsEpisodeContext = executable.metrics.some((metric) =>
    metric.endsWith("_episodes"),
  );
  const evidenceRange = needsEpisodeContext
    ? {
        start: Math.max(0, range.start - EPISODE_BOUNDARY_CONTEXT_MS),
        end: Math.min(asOf, range.end + EPISODE_BOUNDARY_CONTEXT_MS),
      }
    : range;
  const evidenceReadings = needsEpisodeContext
    ? allReadings.filter(
        ({ timestamp }) =>
          timestamp >= evidenceRange.start && timestamp < evidenceRange.end,
      )
    : readings;
  const intervals = observationIntervals(readings, range);
  const observedMilliseconds = intervals.reduce(
    (total, interval) => total + interval.end - interval.start,
    0,
  );
  const expectedMilliseconds = range.end - range.start;
  const roundedCoveragePercent =
    expectedMilliseconds > 0
      ? round((observedMilliseconds / expectedMilliseconds) * 100, 1)
      : 0;
  const coveragePercent =
    observedMilliseconds > 0 && roundedCoveragePercent === 0
      ? 0.1
      : roundedCoveragePercent;

  let distribution: RangeCalculation["distribution"] = null;
  if (executable.metrics.includes("glucose.time_in_range")) {
    const lower = thresholdFor(executable.thresholds, "range_lower");
    const upper = thresholdFor(executable.thresholds, "range_upper");
    let below = 0;
    let within = 0;
    let above = 0;
    intervals.forEach((interval) => {
      const duration = interval.end - interval.start;
      if (
        matchesThreshold(interval.mmolL, lower) &&
        matchesThreshold(interval.mmolL, upper)
      ) {
        within += duration;
      } else if (
        interval.mmolL < lower.value ||
        (interval.mmolL === lower.value && lower.operator === "gt")
      ) {
        below += duration;
      } else {
        above += duration;
      }
    });
    const percent = (duration: number) =>
      observedMilliseconds > 0
        ? round((duration / observedMilliseconds) * 100, 1)
        : null;
    distribution = {
      abovePercent: percent(above),
      belowPercent: percent(below),
      inRangePercent: percent(within),
    };
  }

  const statistics = calculateGlucoseStatistics({
    readings,
    range,
    observationGapCapMilliseconds: OBSERVATION_GAP_MS,
  });
  const samples = canonicalGlucoseSamples(readings, range);
  const statistic = (value: number | null) =>
    value === null ? null : round(value, 2);
  const metrics = executable.metrics.map((metric) => {
    switch (metric) {
      case "glucose.mean":
        return {
          id: metric,
          unit: "mmol/L" as const,
          value: statistics.arithmeticMeanMmolL,
        };
      case "glucose.median":
        return {
          id: metric,
          unit: "mmol/L" as const,
          value: statistic(statistics.medianMmolL),
        };
      case "glucose.minimum":
        return {
          id: metric,
          unit: "mmol/L" as const,
          value: statistic(statistics.minimumMmolL),
        };
      case "glucose.maximum":
        return {
          id: metric,
          unit: "mmol/L" as const,
          value: statistic(statistics.maximumMmolL),
        };
      case "glucose.standard_deviation":
        return {
          id: metric,
          unit: "mmol/L" as const,
          value: statistic(statistics.populationStandardDeviationMmolL),
        };
      case "glucose.coefficient_of_variation":
        return {
          id: metric,
          unit: "%" as const,
          value: statistic(statistics.coefficientOfVariationPercent),
        };
      case "glucose.gmi":
        return {
          id: metric,
          unit: "%" as const,
          value: statistic(statistics.glucoseManagementIndicatorPercent),
        };
      case "glucose.time_in_range":
        return {
          id: metric,
          unit: "%" as const,
          value: distribution?.inRangePercent ?? null,
        };
      case "glucose.low_episodes":
        return {
          id: metric,
          unit: "events" as const,
          value: readings.length
            ? detectGlucoseEpisodes(
                evidenceReadings,
                "low",
                thresholdFor(executable.thresholds, "low").value,
              ).filter(
                (episode) =>
                  episode.start >= range.start && episode.start < range.end,
              ).length
            : null,
        };
      case "glucose.high_episodes":
        return {
          id: metric,
          unit: "events" as const,
          value: readings.length
            ? detectGlucoseEpisodes(
                evidenceReadings,
                "high",
                thresholdFor(executable.thresholds, "high").value,
              ).filter(
                (episode) =>
                  episode.start >= range.start && episode.start < range.end,
              ).length
            : null,
        };
      case "glucose.low_readings":
      case "glucose.high_readings": {
        const threshold = thresholdFor(
          executable.thresholds,
          metric === "glucose.low_readings" ? "low" : "high",
        );
        return {
          id: metric,
          unit: "readings" as const,
          value: readings.length
            ? samples.filter(({ mmolL }) => matchesThreshold(mmolL, threshold))
                .length
            : null,
        };
      }
    }
  });
  return {
    coveragePercent,
    distribution,
    evidenceRange,
    evidenceReadings,
    metrics,
    observationIntervals: intervals,
    observedMilliseconds,
    range,
    readings,
  };
}

function arithmeticMean(readings: readonly GlucoseReading[], range: TimeRange) {
  const value = calculateGlucoseStatistics({
    readings,
    range,
    observationGapCapMilliseconds: OBSERVATION_GAP_MS,
  }).arithmeticMeanMmolL;
  return value;
}

function queryChartEvents(
  executable: ExecutableRangeIntent,
  calculation: RangeCalculation,
  selectedKind: "high" | "low" | null,
): EvidenceQueryEvent[] {
  return executable.metrics
    .filter(
      (
        metric,
      ): metric is Extract<
        SupportedMetric,
        "glucose.low_episodes" | "glucose.high_episodes"
      > => metric.endsWith("_episodes"),
    )
    .flatMap((metric) => {
      const kind = metric === "glucose.low_episodes" ? "low" : "high";
      if (selectedKind !== null && kind !== selectedKind) return [];
      const threshold = thresholdFor(executable.thresholds, kind);
      return detectGlucoseEpisodes(
        calculation.evidenceReadings,
        kind,
        threshold.value,
      )
        .filter(
          (episode) =>
            episode.start >= calculation.range.start &&
            episode.start < calculation.range.end,
        )
        .map((episode): EvidenceQueryEvent => {
          const exactReadings = episode.readings.filter(
            ({ timestamp }) =>
              timestamp >= calculation.range.start &&
              timestamp < calculation.range.end,
          );
          const recoveryConfirmedInside =
            episode.endStatus === "confirmed-recovery" &&
            episode.end <= calculation.range.end;
          const lastObservedInside =
            exactReadings.at(-1)?.timestamp ?? episode.start;
          const displayedEnd = recoveryConfirmedInside
            ? episode.end
            : lastObservedInside;
          const continuesBeyondWindow =
            !recoveryConfirmedInside &&
            (episode.end > calculation.range.end ||
              episode.readings.some(
                ({ timestamp }) => timestamp >= calculation.range.end,
              ));
          return {
            id: `${kind}:${threshold.value}:${episode.start}:${displayedEnd}:${
              recoveryConfirmedInside ? "confirmed" : "observed"
            }`,
            kind,
            start: episode.start,
            end: displayedEnd,
            endStatus: recoveryConfirmedInside
              ? "confirmed-recovery"
              : "observed-through",
            continuesBeyondWindow: recoveryConfirmedInside
              ? false
              : continuesBeyondWindow,
            // Boundary context may classify the event, but cannot supply a
            // plotted extreme or any other displayed chart value.
            extremeMmolL:
              kind === "high"
                ? Math.max(...exactReadings.map(({ mmolL }) => mmolL))
                : Math.min(...exactReadings.map(({ mmolL }) => mmolL)),
            recordIds: exactReadings.flatMap(({ recordIds }) => recordIds),
          };
        });
    })
    .sort(
      (left, right) =>
        left.start - right.start || left.id.localeCompare(right.id),
    );
}

function queryVisualizationFor(
  executable: ExecutableRangeIntent,
  calculations: readonly LabeledRangeCalculation[],
): EvidenceQueryVisualizationReference | null {
  // The current visualization grammar can prove only one of these exact
  // semantics. Suppress charts for median/min/max/dispersion/GMI/sample-count
  // questions instead of displaying an arithmetic-mean line under another
  // metric's answer.
  if (
    executable.metrics.length !== 1 ||
    ![
      "glucose.mean",
      "glucose.time_in_range",
      "glucose.low_episodes",
      "glucose.high_episodes",
    ].includes(executable.metrics[0]!)
  ) {
    return null;
  }
  const requestedEventMetrics = executable.metrics.filter((metric) =>
    metric.endsWith("_episodes"),
  );
  // The current evidence grammar has one event kind per timeline. Suppressing
  // a compound low+high chart is safer than silently visualising only one
  // claim; the complete exact records remain available in the Records tab.
  if (
    requestedEventMetrics.includes("glucose.low_episodes") &&
    requestedEventMetrics.includes("glucose.high_episodes")
  ) {
    return null;
  }
  const rangeLower = executable.thresholds.find(
    ({ role }) => role === "range_lower",
  )?.value;
  const rangeUpper = executable.thresholds.find(
    ({ role }) => role === "range_upper",
  )?.value;
  const targetRange = {
    minimum: rangeLower ?? TARGET_LOW_MMOL_L,
    maximum: rangeUpper ?? TARGET_HIGH_MMOL_L,
  };
  const values = [
    targetRange.minimum,
    targetRange.maximum,
    ...calculations.flatMap(({ value }) =>
      value.readings.map(({ mmolL }) => mmolL),
    ),
  ];
  const rawMinimum = Math.min(...values);
  const rawMaximum = Math.max(...values);
  const padding = Math.max(0.5, (rawMaximum - rawMinimum) * 0.08);
  const valueDomain = {
    minimum: Math.max(0, Math.floor((rawMinimum - padding) * 10) / 10),
    maximum: Math.ceil((rawMaximum + padding) * 10) / 10,
  };
  if (valueDomain.maximum <= valueDomain.minimum) {
    valueDomain.maximum = valueDomain.minimum + 1;
  }
  const selectedEventMetric = executable.metrics.find(
    (
      metric,
    ): metric is Extract<
      SupportedMetric,
      "glucose.low_episodes" | "glucose.high_episodes"
    > => metric.endsWith("_episodes"),
  );
  const selectedEventKind = selectedEventMetric
    ? selectedEventMetric === "glucose.low_episodes"
      ? "low"
      : "high"
    : null;
  const windows = calculations.map(({ id, label, value }) => {
    const samples = canonicalGlucoseSamples(value.readings, value.range);
    return {
      id,
      label,
      range: { ...value.range },
      // Source-record count remains auditable while each plotted point is one
      // timestamp-normalised physiological sample retaining every source ID.
      recordCount: value.readings.length,
      coveragePercent: value.coveragePercent,
      coverageStatus:
        value.readings.length === 0
          ? ("unavailable" as const)
          : value.coveragePercent < SUFFICIENT_COVERAGE_PERCENT
            ? ("limited" as const)
            : ("sufficient" as const),
      meanMmolL: arithmeticMean(value.readings, value.range),
      meanPrecisionDecimals: 4 as const,
      points: samples.map(({ recordIds, mmolL, timestamp }) => ({
        recordIds,
        mmolL,
        timestamp,
      })),
      distribution: value.distribution ? { ...value.distribution } : null,
      events: queryChartEvents(executable, value, selectedEventKind),
    };
  });
  const common = {
    schemaVersion: 1 as const,
    timezone: getRuntimeRegionalDefaults().timeZone,
    units: "mmol/L" as const,
    gapThresholdMilliseconds: OBSERVATION_GAP_MS,
    targetRange,
    valueDomain,
    windows,
  };
  if (executable.metrics.includes("glucose.time_in_range")) {
    return {
      ...common,
      kind: "range-distribution-v1",
      metric: "glucose.time_in_range",
      title:
        calculations.length > 1
          ? "Time in range across the comparison periods"
          : "Time in range for the requested period",
      subtitle:
        "Only readings from the requested time are counted; missing sensor time is left out.",
      lowerBoundMmolL: targetRange.minimum,
      upperBoundMmolL: targetRange.maximum,
    };
  }
  const eventMetric = selectedEventMetric;
  if (eventMetric) {
    const eventKind = eventMetric === "glucose.low_episodes" ? "low" : "high";
    return {
      ...common,
      kind: "event-timeline-v1",
      metric: eventMetric,
      eventKind,
      thresholdMmolL: thresholdFor(executable.thresholds, eventKind).value,
      title:
        calculations.length > 1
          ? `${eventKind === "low" ? "Low" : "High"}-glucose events across the comparison periods`
          : `${eventKind === "low" ? "Low" : "High"}-glucose events in the requested period`,
      subtitle:
        "Only readings from the requested time appear on the chart. A few nearby readings may help decide whether a high or low started or ended during that time, but they do not change the plotted values.",
    };
  }
  if (calculations.length > 1) {
    return {
      ...common,
      kind: "period-comparison-v1",
      metric: "glucose.mean",
      title: "Glucose across the comparison periods",
      subtitle:
        "Each period keeps its own readings, coverage and average glucose.",
    };
  }
  return {
    ...common,
    kind: "range-trace-v1",
    metric: "glucose.mean",
    title: "Glucose readings and observed average",
    subtitle:
      "Readings from the time you asked about are shown. The chart may show fewer points to stay clear, but calculations still use them all. Lines stop where readings are missing.",
  };
}

function representativeReadings(readings: readonly GlucoseReading[]) {
  if (!readings.length) return [];
  const chronological = [...readings].sort(
    (left, right) =>
      left.timestamp - right.timestamp || left.id.localeCompare(right.id),
  );
  const byLow = [...readings].sort(
    (left, right) =>
      left.mmolL - right.mmolL ||
      left.timestamp - right.timestamp ||
      left.id.localeCompare(right.id),
  );
  const byHigh = [...readings].sort(
    (left, right) =>
      right.mmolL - left.mmolL ||
      left.timestamp - right.timestamp ||
      left.id.localeCompare(right.id),
  );
  return [
    chronological[0]!,
    byLow[0]!,
    byHigh[0]!,
    chronological.at(-1)!,
  ].filter(
    (reading, index, values) =>
      values.findIndex((candidate) => candidate.id === reading.id) === index,
  );
}

function metricPresentation(
  calculation: RangeCalculation,
): TarvisEvidenceMetric[] {
  return calculation.metrics.flatMap((metric): TarvisEvidenceMetric[] => {
    const displayedGlucose = regionalGlucoseMetric(metric.value);
    switch (metric.id) {
      case "glucose.mean":
        return [
          {
            id: "average-glucose",
            label: "Average glucose",
            value: displayedGlucose.value,
            decimals: displayedGlucose.decimals,
            unit: displayedGlucose.unit,
          },
        ];
      case "glucose.median":
        return [
          {
            id: "median-glucose",
            label: "Median glucose",
            value: displayedGlucose.value,
            decimals: displayedGlucose.decimals,
            unit: displayedGlucose.unit,
          },
        ];
      case "glucose.minimum":
        return [
          {
            id: "minimum-glucose",
            label: "Lowest glucose",
            value: displayedGlucose.value,
            decimals: displayedGlucose.decimals,
            unit: displayedGlucose.unit,
          },
        ];
      case "glucose.maximum":
        return [
          {
            id: "maximum-glucose",
            label: "Highest glucose",
            value: displayedGlucose.value,
            decimals: displayedGlucose.decimals,
            unit: displayedGlucose.unit,
          },
        ];
      case "glucose.standard_deviation":
        return [
          {
            id: "glucose-standard-deviation",
            label: "Glucose variation (SD)",
            value: displayedGlucose.value,
            decimals: displayedGlucose.decimals,
            unit: displayedGlucose.unit,
          },
        ];
      case "glucose.coefficient_of_variation":
        return [
          {
            id: "glucose-coefficient-of-variation",
            label: "Glucose variation (CV)",
            value: metric.value,
            decimals: 1,
            unit: "%",
          },
        ];
      case "glucose.gmi":
        return [
          {
            id: "glucose-management-indicator",
            label: "Estimated GMI",
            value: metric.value,
            decimals: 1,
            unit: "%",
          },
        ];
      case "glucose.low_episodes":
        return [
          {
            id: "low-events",
            label: "Sustained lows",
            value: metric.value,
            decimals: 0,
          },
        ];
      case "glucose.high_episodes":
        return [
          {
            id: "high-events",
            label: "Sustained highs",
            value: metric.value,
            decimals: 0,
          },
        ];
      case "glucose.low_readings":
        return [
          {
            id: "low-readings",
            label: "Readings below your chosen level",
            value: metric.value,
            decimals: 0,
          },
        ];
      case "glucose.high_readings":
        return [
          {
            id: "high-readings",
            label: "Readings above your chosen level",
            value: metric.value,
            decimals: 0,
          },
        ];
      case "glucose.time_in_range":
        return [
          {
            id: "time-below-range",
            label: "Time below range",
            value: calculation.distribution?.belowPercent ?? null,
            decimals: 1,
            unit: "%",
          },
          {
            id: "time-in-range",
            label: "Time in range",
            value: calculation.distribution?.inRangePercent ?? null,
            decimals: 1,
            unit: "%",
          },
          {
            id: "time-above-range",
            label: "Time above range",
            value: calculation.distribution?.abovePercent ?? null,
            decimals: 1,
            unit: "%",
          },
        ];
    }
  });
}

function metricCopy(
  executable: ExecutableRangeIntent,
  calculation: RangeCalculation,
) {
  return calculation.metrics.map((metric) => {
    if (metric.value === null) return "the requested result is unavailable";
    switch (metric.id) {
      case "glucose.mean":
        return `your average glucose from the available readings was ${regionalGlucose(metric.value)}`;
      case "glucose.median":
        return `the observed median was ${regionalGlucose(metric.value)}`;
      case "glucose.minimum":
        return `the lowest recorded reading was ${regionalGlucose(metric.value)} ${describeGlucoseExtremeTiming(summarizeGlucoseExtreme(calculation.readings, calculation.range, "minimum")!)}`;
      case "glucose.maximum":
        return `the highest recorded reading was ${regionalGlucose(metric.value)} ${describeGlucoseExtremeTiming(summarizeGlucoseExtreme(calculation.readings, calculation.range, "maximum")!)}`;
      case "glucose.standard_deviation":
        return `the observed population standard deviation was ${regionalGlucose(metric.value)}`;
      case "glucose.coefficient_of_variation":
        return `the observed coefficient of variation was ${formatTarvisFixedNumber(metric.value, 1)}%`;
      case "glucose.gmi":
        return `the estimated glucose management indicator was ${formatTarvisFixedNumber(metric.value, 1)}% (derived from mean sensor glucose, not a laboratory HbA1c result)`;
      case "glucose.time_in_range": {
        const lower = thresholdFor(executable.thresholds, "range_lower");
        const upper = thresholdFor(executable.thresholds, "range_upper");
        return `${formatTarvisFixedNumber(metric.value, 1)}% of observed sensor time was within ${regionalGlucoseRange(lower.value, upper.value)} range`;
      }
      case "glucose.low_episodes":
        return `${formatTarvisNumber(metric.value, { maximumFractionDigits: 0 })} sustained low-glucose event${metric.value === 1 ? " was" : "s were"} observed`;
      case "glucose.high_episodes":
        return `${formatTarvisNumber(metric.value, { maximumFractionDigits: 0 })} sustained high-glucose event${metric.value === 1 ? " was" : "s were"} observed`;
      case "glucose.low_readings":
      case "glucose.high_readings": {
        const kind = metric.id === "glucose.low_readings" ? "below" : "above";
        const threshold = thresholdFor(
          executable.thresholds,
          metric.id === "glucose.low_readings" ? "low" : "high",
        );
        return `${formatTarvisNumber(metric.value, { maximumFractionDigits: 0 })} reading${metric.value === 1 ? " was" : "s were"} ${kind} ${regionalGlucose(threshold.value)}`;
      }
    }
  });
}

function evidenceFor(
  executable: ExecutableRangeIntent,
  calculation: RangeCalculation,
  label: string,
  queryKey: string,
) {
  const canonicalThresholds = [...executable.thresholds]
    .sort(
      (left, right) =>
        left.role.localeCompare(right.role) ||
        left.operator.localeCompare(right.operator) ||
        left.value - right.value,
    )
    .map(({ operator, role, unit, value }) => ({
      operator,
      role,
      unit,
      value,
    }));
  const queryId = `${LOCAL_RANGE_ANSWER_VERSION}:${JSON.stringify({
    schemaVersion: 1,
    timezone: getRuntimeRegionalDefaults().timeZone,
    queryKey,
    range: calculation.range,
    evidenceRange: calculation.evidenceRange,
    metrics: executable.metrics,
    thresholds: canonicalThresholds,
    observationGapMilliseconds: OBSERVATION_GAP_MS,
    episodeBoundaryContextMilliseconds: EPISODE_BOUNDARY_CONTEXT_MS,
    episodeDefinitionVersion: executable.metrics.some((metric) =>
      metric.endsWith("_episodes"),
    )
      ? GLUCOSE_EPISODE_DEFINITION_VERSION
      : null,
    metricAlgorithmVersions: executable.metrics.map((metric) => ({
      metric,
      version: metricAlgorithmVersion(metric),
    })),
  })}`;
  const calculationReference: EvidenceCalculationReference = {
    kind: "tarvis-local-glucose-v1",
    queryId,
    algorithmVersion: [
      LOCAL_RANGE_ANSWER_VERSION,
      ...(executable.metrics.some((metric) =>
        SAMPLE_STATISTIC_METRICS.has(metric),
      )
        ? [
            ...new Set(
              executable.metrics
                .filter((metric) => SAMPLE_STATISTIC_METRICS.has(metric))
                .map(metricAlgorithmVersion),
            ),
          ]
        : []),
      ...(executable.metrics.includes("glucose.time_in_range")
        ? ["duration-forward-cap-12m-v1"]
        : []),
      ...(executable.metrics.some((metric) => metric.endsWith("_episodes"))
        ? [GLUCOSE_EPISODE_DEFINITION_VERSION]
        : []),
    ].join("+"),
    metrics: calculation.metrics,
    thresholds: executable.thresholds.map((threshold) => ({
      operator: threshold.operator,
      role: threshold.role,
      unit: "mmol/L",
      value: threshold.value,
    })),
    requestedWindowCount: 1,
    windowsWithData: calculation.readings.length > 0 ? 1 : 0,
    coveragePercent: calculation.coveragePercent,
    ...(executable.metrics.some((metric) => metric.endsWith("_episodes"))
      ? { episodeDefinitionVersion: GLUCOSE_EPISODE_DEFINITION_VERSION }
      : {}),
  };
  const evidence: EvidenceReference = {
    id: `${queryId}:${label === "Requested period" ? "current" : "previous"}`,
    label: `${label}: readings used for ${executable.metrics.map(metricTitle).join(" and ").toLocaleLowerCase("en-GB")}`,
    description: `${formatTarvisNumber(calculation.readings.length, { maximumFractionDigits: 0 })} glucose readings from the time you asked about.${calculation.evidenceRange.start !== calculation.range.start || calculation.evidenceRange.end !== calculation.range.end ? " A few nearby readings are used only to tell whether a high or low began during that time; they do not change the calculation or All Records list." : ""} Missing time is not counted as zero.`,
    range: { ...calculation.range },
    recordIds: calculation.readings.map(({ id }) => id),
    examples: representativeReadings(calculation.readings).map((reading) => ({
      id: reading.id,
      kind: "glucose",
      timestamp: reading.timestamp,
      primary: regionalGlucose(reading.mmolL),
      secondary: `${reading.quality} · saved reading`,
      sourceId: reading.sourceId,
    })),
    calculation: calculationReference,
  };
  return evidence;
}

function presentationKind(metrics: SupportedMetric[]) {
  if (metrics.length > 1) return "glucose-summary" as const;
  switch (metrics[0]) {
    case "glucose.mean":
      return "average-glucose" as const;
    case "glucose.time_in_range":
      return "time-in-range" as const;
    case "glucose.low_episodes":
      return "low-events" as const;
    case "glucose.high_episodes":
      return "high-events" as const;
    case "glucose.low_readings":
    case "glucose.high_readings":
      return "glucose-reading-count" as const;
    default:
      return "glucose-statistic" as const;
  }
}

function answerHeadline(calculation: RangeCalculation) {
  const first = calculation.metrics[0];
  if (!first || first.value === null) return "Glucose result unavailable";
  if (calculation.metrics.length > 1) return "Observed glucose results";
  switch (first.id) {
    case "glucose.mean":
      return `${calculation.coveragePercent < SUFFICIENT_COVERAGE_PERCENT ? "Observed" : "Your"} average glucose: ${regionalGlucose(first.value)}`;
    case "glucose.median":
      return `Observed median glucose: ${regionalGlucose(first.value)}`;
    case "glucose.minimum":
      return `Observed minimum glucose: ${regionalGlucose(first.value)}`;
    case "glucose.maximum":
      return `Observed maximum glucose: ${regionalGlucose(first.value)}`;
    case "glucose.standard_deviation":
      return `Observed glucose standard deviation: ${regionalGlucose(first.value)}`;
    case "glucose.coefficient_of_variation":
      return `Observed glucose coefficient of variation: ${formatTarvisFixedNumber(first.value, 1)}%`;
    case "glucose.gmi":
      return `Estimated glucose management indicator: ${formatTarvisFixedNumber(first.value, 1)}%`;
    case "glucose.time_in_range":
      return `Observed time in range: ${formatTarvisFixedNumber(first.value, 1)}%`;
    case "glucose.low_episodes":
      return `Observed low-glucose events: ${formatTarvisNumber(first.value, { maximumFractionDigits: 0 })}`;
    case "glucose.high_episodes":
      return `Observed high-glucose events: ${formatTarvisNumber(first.value, { maximumFractionDigits: 0 })}`;
    case "glucose.low_readings":
      return `Observed readings below threshold: ${formatTarvisNumber(first.value, { maximumFractionDigits: 0 })}`;
    case "glucose.high_readings":
      return `Observed readings above threshold: ${formatTarvisNumber(first.value, { maximumFractionDigits: 0 })}`;
  }
}

function metricTitle(metric: SupportedMetric) {
  switch (metric) {
    case "glucose.mean":
      return "Average glucose";
    case "glucose.median":
      return "Median glucose";
    case "glucose.minimum":
      return "Minimum glucose";
    case "glucose.maximum":
      return "Maximum glucose";
    case "glucose.standard_deviation":
      return "Glucose standard deviation";
    case "glucose.coefficient_of_variation":
      return "Glucose coefficient of variation";
    case "glucose.gmi":
      return "Estimated glucose management indicator";
    case "glucose.time_in_range":
      return "Time in range";
    case "glucose.low_episodes":
      return "Low-glucose events";
    case "glucose.high_episodes":
      return "High-glucose events";
    case "glucose.low_readings":
      return "Readings below the low threshold";
    case "glucose.high_readings":
      return "Readings above the high threshold";
  }
}

function metricDetail(executable: ExecutableRangeIntent) {
  const metric = executable.metrics[0];
  if (executable.metrics.length > 1) {
    return "Each result uses the same readings from the time you asked about. Missing readings are not guessed.";
  }
  if (metric === "glucose.time_in_range") {
    return "Observed duration is carried forward only until the next reading or 12 minutes, whichever comes first. Missing time is excluded.";
  }
  if (metric?.endsWith("_episodes")) {
    return "A high or low is counted after glucose stays beyond the threshold for 15 minutes. Recovery requires 15 minutes back across it, and a sensor gap over 12 minutes ends the observed event.";
  }
  if (metric?.endsWith("_readings")) {
    return "This counts individual readings, not sustained high or low periods. Readings saved at the same moment are combined once.";
  }
  if (metric === "glucose.gmi") {
    return "GMI is estimated from your average sensor glucose. It is not the same as a laboratory HbA1c result.";
  }
  if (metric === "glucose.standard_deviation") {
    return "This shows how widely your readings varied during the time you asked about. Missing readings are not guessed.";
  }
  if (metric === "glucose.coefficient_of_variation") {
    return "This compares the amount of glucose variation with your average glucose for the same time.";
  }
  const name =
    metric === "glucose.mean"
      ? "Arithmetic mean"
      : metric === "glucose.median"
        ? "Median"
        : metric === "glucose.minimum"
          ? "Minimum"
          : "Maximum";
  return `${name} for the time you asked about. Readings saved at the same moment are combined once.`;
}

function previousPeriodLabel(basis: TarvisIntentComparisonBasis | null) {
  switch (basis) {
    case "adjacent_equal_elapsed_time":
      return "Previous equal elapsed period";
    case "adjacent_local_calendar_days":
      return "Previous local calendar days";
    case "previous_local_calendar_week":
      return "Previous local calendar week";
    case "previous_local_calendar_month":
      return "Previous local calendar month";
    case "matching_local_wall_clock_progress":
      return "Previous matching local-clock period";
    default:
      return "Previous comparison period";
  }
}

/**
 * Executes exact rolling/calendar glucose intents locally. The model is never
 * allowed to replace the resolved half-open range with a nearby report.
 */
export function buildLocalGlucoseRangeAnswer(
  input: LocalGlucoseRangeAnswerInput,
): LocalGlucoseRangeAnswerResult {
  return executeLocalGlucoseRangeAnswer(input, true);
}

/**
 * Compound answers retain each component's exact calculations, references and
 * presentation, not a misleading single-metric answer bundle. Avoid creating
 * that discarded snapshot while using the same validated calculation path.
 */
export function buildLocalGlucoseRangeComponent(
  input: LocalGlucoseRangeAnswerInput,
): LocalGlucoseRangeComponentResult {
  return executeLocalGlucoseRangeAnswer(input, false);
}

function executeLocalGlucoseRangeAnswer(
  input: LocalGlucoseRangeAnswerInput,
  includeAnswerBundle: true,
): LocalGlucoseRangeAnswerResult;
function executeLocalGlucoseRangeAnswer(
  input: LocalGlucoseRangeAnswerInput,
  includeAnswerBundle: false,
): LocalGlucoseRangeComponentResult;
function executeLocalGlucoseRangeAnswer(
  { asOf, intent, readings }: LocalGlucoseRangeAnswerInput,
  includeAnswerBundle: boolean,
): LocalGlucoseRangeAnswerResult | LocalGlucoseRangeComponentResult {
  const executable = validateIntent(intent);
  const resolved = resolveRanges(executable, asOf);
  const canonical = canonicalReadings(readings);
  const calculations: LabeledRangeCalculation[] = [
    {
      id: "requested-period",
      label: "Requested period",
      role: "requested",
      value: calculateRange(executable, canonical, resolved.current, asOf),
    },
    ...(resolved.previous
      ? [
          {
            id: "comparison-period",
            label: previousPeriodLabel(resolved.comparisonBasis),
            role: "comparison" as const,
            value: calculateRange(
              executable,
              canonical,
              resolved.previous,
              asOf,
            ),
          },
        ]
      : []),
  ];
  const visualization = queryVisualizationFor(executable, calculations);
  if (
    visualization !== null &&
    !isEvidenceQueryVisualizationReference(visualization)
  ) {
    return unsupported("The exact-range evidence chart failed validation.");
  }
  const periodEvidence = calculations.map(({ label, value }) =>
    evidenceFor(
      executable,
      value,
      label,
      `${asOf}:${resolved.comparisonBasis ?? "none"}`,
    ),
  );
  const combinedCalculationIds = new Set(
    calculations.flatMap(({ value }) => value.readings.map(({ id }) => id)),
  );
  const combinedCalculationReadings = canonical.filter(({ id }) =>
    combinedCalculationIds.has(id),
  );
  const combinedChartEvidence: EvidenceReference | null =
    visualization && calculations.length > 1
      ? {
          id: `${periodEvidence[0]!.id}:combined-chart:${visualization.kind}`,
          label: "Readings used for the comparison chart",
          description: `${formatTarvisNumber(combinedCalculationReadings.length, { maximumFractionDigits: 0 })} glucose readings across both periods. Each result still keeps its own supporting records.`,
          range: {
            start: Math.min(
              ...calculations.map(({ value }) => value.range.start),
            ),
            end: Math.max(...calculations.map(({ value }) => value.range.end)),
          },
          recordIds: combinedCalculationReadings.map(({ id }) => id),
          examples: representativeReadings(combinedCalculationReadings).map(
            (reading) => ({
              id: reading.id,
              kind: "glucose" as const,
              timestamp: reading.timestamp,
              primary: regionalGlucose(reading.mmolL),
              secondary: `${reading.quality} · saved reading`,
              sourceId: reading.sourceId,
            }),
          ),
          visualization,
        }
      : null;
  const evidence: EvidenceReference[] = [
    ...periodEvidence.map((reference) =>
      visualization && calculations.length === 1
        ? { ...reference, visualization }
        : reference,
    ),
    ...(combinedChartEvidence ? [combinedChartEvidence] : []),
  ];
  const answerBundle = includeAnswerBundle ? createGlucoseAnswerBundleV2({
    executor: "exact-range",
    originalIntent: intent,
    normalizedThresholds: executable.thresholds,
    timezone: getRuntimeRegionalDefaults().timeZone,
    asOf,
    windows: calculations.map(({ id, label, role, value }) => ({
      id,
      label,
      role,
      calculationRange: value.range,
      evidenceContextRange: value.evidenceRange,
      calculationReadings: value.readings,
      contextReadings: value.evidenceReadings.filter(
        ({ timestamp }) =>
          timestamp < value.range.start || timestamp >= value.range.end,
      ),
      observationIntervals: value.observationIntervals,
    })),
    algorithms: {
      answerVersion: LOCAL_RANGE_ANSWER_VERSION,
      coverageVersion: "forward-observation-capped-at-gap-v1",
      maximumObservedGapMilliseconds: OBSERVATION_GAP_MS,
      observationValuePrecisionDecimals: null,
      metricVersions: executable.metrics.map((metric) => ({
        metric,
        version: metricAlgorithmVersion(metric),
      })),
      episodeDefinitionVersion: executable.metrics.some((metric) =>
        metric.endsWith("_episodes"),
      )
        ? GLUCOSE_EPISODE_DEFINITION_VERSION
        : null,
      chartVersions: visualization ? [visualization.kind] : [],
    },
    claims: calculations.flatMap(({ id, value }, calculationIndex) =>
      value.metrics.map((metric) => ({
        id: `${evidence[calculationIndex]!.id}:claim:${metric.id}`,
        metric: metric.id as SupportedMetric,
        value: metric.value,
        unit: metric.unit,
        windowIds: [id],
      })),
    ),
    charts: visualization
      ? [
          {
            id: `${
              combinedChartEvidence?.id ?? periodEvidence[0]!.id
            }:chart:${visualization.kind}`,
            kind: visualization.kind,
            sourceReferenceId:
              combinedChartEvidence?.id ?? periodEvidence[0]!.id,
            windowIds: calculations.map(({ id }) => id),
            recordIds: calculations.flatMap(({ value }) =>
              value.readings.map(({ id }) => id),
            ),
          },
        ]
      : [],
  }) : undefined;
  const current = calculations[0]!.value;
  const answerParts = calculations.map(({ label, value }) => {
    const datedLabel = `${label} (${formatTarvisRequestedPeriod(value.range)})`;
    if (!value.readings.length) {
      return `${datedLabel} has no glucose readings, so its result is unavailable`;
    }
    const coverage = `${formatTarvisFixedNumber(value.coveragePercent, 1)}% observed sensor coverage`;
    return `${datedLabel}: ${metricCopy(executable, value).join("; ")}. ${coverage}`;
  });
  const limited = calculations.some(
    ({ value }) => value.coveragePercent < SUFFICIENT_COVERAGE_PERCENT,
  );
  const noData = calculations.some(({ value }) => !value.readings.length);
  const gmiInsufficient =
    executable.metrics.includes("glucose.gmi") &&
    calculations.some(
      ({ value }) =>
        !hasRepresentativeGmiDuration(value.range) ||
        value.coveragePercent < SUFFICIENT_COVERAGE_PERCENT,
    );
  const durationNote = tarvisComparisonDurationNote(resolved);
  const limitations = [
    ...(limited
      ? [
          "At least one period had less than 70% sensor coverage, so values describe observed sensor time only.",
        ]
      : []),
    ...(executable.metrics.includes("glucose.time_in_range")
      ? ["Missing sensor time was excluded rather than estimated."]
      : []),
    ...(executable.metrics.some((metric) => metric.endsWith("_episodes"))
      ? [
          "A high or low must last at least 15 minutes to count. Readings just outside the requested dates help determine when an event started; they are not included in your average.",
        ]
      : []),
    ...(executable.metrics.includes("glucose.gmi")
      ? [
          "GMI is estimated from average sensor glucose, not a laboratory HbA1c result. It does not account for pregnancy or individual treatment targets.",
        ]
      : []),
    ...(gmiInsufficient
      ? [
          "GMI confidence is limited because at least one period was shorter than 14 days or had less than 70% observed sensor coverage.",
        ]
      : []),
    ...(durationNote ? [durationNote] : []),
  ];
  const kind = presentationKind(executable.metrics);
  return {
    answer: {
      headline:
        calculations.length > 1
          ? noData
            ? "Glucose comparison incomplete"
            : "Observed glucose comparison"
          : answerHeadline(current),
      answer: `${answerParts.join(". ")}.`,
      confidence: limited || noData || gmiInsufficient ? "limited" : "high",
      evidenceIds: evidence.map(({ id }) => id),
      limitations: limitations.slice(0, 5),
    },
    ...(answerBundle ? { answerBundle } : {}),
    evidence,
    presentation: {
      kind,
      title:
        calculations.length > 1
          ? "Glucose comparison for the selected periods"
          : `${metricTitle(executable.metrics[0]!)} for the requested period`,
      detail: metricDetail(executable),
      windows: calculations.map(({ label, value }) => ({
        label,
        range: { ...value.range },
        recordCount: value.readings.length,
        coveragePercent: value.coveragePercent,
        coverageStatus:
          value.readings.length === 0
            ? ("unavailable" as const)
            : value.coveragePercent < SUFFICIENT_COVERAGE_PERCENT
              ? ("limited" as const)
              : ("sufficient" as const),
        metrics: metricPresentation(value),
      })),
    },
  };
}
