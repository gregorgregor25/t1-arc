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
  executeScopedGlucoseQuery,
  formatClockTimeForDisplay,
  resolveMostRecentCompletedRecurringWindows,
  type RecurringClockWindow,
  type ScopedGlucoseEvidenceBundle,
} from "./query";
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
import { buildEvidenceClockWindowScale } from "@/domain/evidenceClockWindowChart";
import {
  type GlucoseReading,
  MG_DL_PER_MMOL_L,
  type TimeRange,
} from "@/domain/models";
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

const LOCAL_ANSWER_VERSION = "tarvis-local-glucose-v1";
const OBSERVATION_GAP_MINUTES = 12;
const CHART_BIN_MINUTES = 15;
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

const SUPPORTED_METRICS = new Set<TarvisMetric>([
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

const EXPECTED_OPERATION: Record<
  Extract<
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
  >,
  TarvisOperation
> = {
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

type SupportedMetric = keyof typeof EXPECTED_OPERATION;

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
    return `duration-gap-cap-${OBSERVATION_GAP_MINUTES}m-v1`;
  }
  if (metric.endsWith("_episodes")) return GLUCOSE_EPISODE_DEFINITION_VERSION;
  if (metric === "glucose.gmi") {
    return `${GLUCOSE_STATISTICS_VERSION}:${GMI_FORMULA_VERSION}:unique-timestamp-rounded-2dp`;
  }
  if (metric.endsWith("_readings")) {
    return `${GLUCOSE_STATISTICS_VERSION}:threshold-count-unique-timestamp-v1`;
  }
  return `${GLUCOSE_STATISTICS_VERSION}:${metric.split(".").at(-1)}-unique-timestamp-rounded-2dp`;
}

function metricTitle(metric: SupportedMetric) {
  switch (metric) {
    case "glucose.mean":
      return "average glucose";
    case "glucose.median":
      return "median glucose";
    case "glucose.minimum":
      return "minimum glucose";
    case "glucose.maximum":
      return "maximum glucose";
    case "glucose.standard_deviation":
      return "glucose standard deviation";
    case "glucose.coefficient_of_variation":
      return "glucose coefficient of variation";
    case "glucose.gmi":
      return "estimated glucose management indicator";
    case "glucose.time_in_range":
      return "time in range";
    case "glucose.low_episodes":
      return "low-glucose events";
    case "glucose.high_episodes":
      return "high-glucose events";
    case "glucose.low_readings":
      return "readings below the low threshold";
    case "glucose.high_readings":
      return "readings above the high threshold";
  }
}

function metricDetail(executable: ExecutableLocalGlucoseIntent) {
  const metric = executable.metrics[0];
  if (executable.metrics.length > 1) {
    return "Each result uses the same readings from the times you asked about. Missing readings are not guessed.";
  }
  if (metric === "glucose.time_in_range") {
    return `Observed duration is carried forward only until the next reading or ${OBSERVATION_GAP_MINUTES} minutes, whichever comes first. Missing time is excluded.`;
  }
  if (metric?.endsWith("_episodes")) {
    return `Events ${[
      ...executable.thresholds
        .filter((threshold) => threshold.role === "low")
        .map((threshold) => `below ${regionalGlucose(threshold.value)}`),
      ...executable.thresholds
        .filter((threshold) => threshold.role === "high")
        .map((threshold) => `above ${regionalGlucose(threshold.value)}`),
    ].join(
      " or ",
    )} are counted after glucose stays beyond the threshold for 15 minutes. Recovery requires 15 minutes back across it, and a sensor gap over 12 minutes ends the observed event.`;
  }
  if (metric?.endsWith("_readings")) {
    return "This counts individual readings, not sustained high or low periods. Readings saved at the same moment are combined once.";
  }
  if (metric === "glucose.gmi") {
    return "GMI is estimated from your average sensor glucose. It is not the same as a laboratory HbA1c result.";
  }
  if (metric === "glucose.standard_deviation") {
    return "This shows how widely your readings varied during the times you asked about. Missing readings are not guessed.";
  }
  if (metric === "glucose.coefficient_of_variation") {
    return "This compares the amount of glucose variation with your average glucose for the same times.";
  }
  const name =
    metric === "glucose.mean"
      ? "Arithmetic mean"
      : metric === "glucose.median"
        ? "Median"
        : metric === "glucose.minimum"
          ? "Minimum"
          : "Maximum";
  return `${name} for the times you asked about. Readings saved at the same moment are combined once.`;
}

interface NormalizedThreshold extends Omit<TarvisGlucoseThreshold, "unit"> {
  unit: "mmol/L";
}

interface ExecutableLocalGlucoseIntent {
  clockWindow: RecurringClockWindow;
  metrics: SupportedMetric[];
  thresholds: NormalizedThreshold[];
  windowCount: number;
}

interface DurationDistribution {
  abovePercent: number | null;
  belowPercent: number | null;
  inRangePercent: number | null;
  observedMilliseconds: number;
}

export interface BuildLocalGlucoseAnswerInput {
  asOf: number;
  intent: TarvisIntentV1;
  readings: GlucoseReading[];
}

export interface LocalGlucoseAnswerResult {
  answer: TarvisAnswer;
  /** Immutable, runtime-validated calculation provenance for this answer. */
  answerBundle: GlucoseAnswerBundleV2;
  bundle: ScopedGlucoseEvidenceBundle;
  evidence: EvidenceReference;
  presentation: TarvisEvidencePresentation;
}

export class UnsupportedLocalGlucoseIntentError extends Error {
  readonly code = "unsupported-local-glucose-intent";

  constructor(message: string) {
    super(message);
    this.name = "UnsupportedLocalGlucoseIntentError";
  }
}

/** Converts an ambiguous/nonexistent local clock boundary into safe UI copy. */
export function localGlucoseClockBoundaryCapability(
  reason: unknown,
): TarvisAnswer | null {
  if (
    !(reason instanceof Error) ||
    !/boundary .*daylight-saving clock change/i.test(reason.message)
  ) {
    return null;
  }
  const repeated = /occurs more than once/i.test(reason.message);
  return {
    headline: "That clock time needs a safer boundary",
    answer: repeated
      ? `On the requested daylight-saving night, that local clock time occurred twice. I have not guessed which occurrence you meant or calculated an answer. Please ask again with an unambiguous boundary outside the repeated hour, such as ending at ${formatClockTimeForDisplay({ hour: 1, minute: 0 })} or starting at ${formatClockTimeForDisplay({ hour: 2, minute: 0 })}.`
      : `On the requested daylight-saving night, that local clock time did not exist. I have not shifted the time or calculated an answer. Please ask again with an unambiguous boundary outside the skipped hour, such as ending at ${formatClockTimeForDisplay({ hour: 1, minute: 0 })} or starting at ${formatClockTimeForDisplay({ hour: 2, minute: 0 })}.`,
    confidence: "limited",
    evidenceIds: [],
    limitations: [
      "No glucose calculation ran because the requested local boundary was not a unique instant.",
    ],
  };
}

function unsupported(message: string): never {
  throw new UnsupportedLocalGlucoseIntentError(message);
}

function round(value: number, decimals: number) {
  const factor = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function normalizedThreshold(
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

function validateIntent(intent: TarvisIntentV1): ExecutableLocalGlucoseIntent {
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
  if (!intent.metrics.length) {
    return unsupported("A local glucose calculation requires a metric.");
  }
  const metrics = intent.metrics.map(({ value }) => value);
  if (
    new Set(metrics).size !== metrics.length ||
    metrics.some((metric) => !SUPPORTED_METRICS.has(metric))
  ) {
    return unsupported(
      "The ready intent contains unsupported or duplicate metrics.",
    );
  }
  const supportedMetrics = metrics as SupportedMetric[];
  if (supportedMetrics.includes("glucose.gmi")) {
    return unsupported(
      "GMI needs a complete date range. It cannot be calculated from selected hours repeated across several days.",
    );
  }
  if (
    supportedMetrics.some(
      (metric) => EXPECTED_OPERATION[metric] !== intent.operation.value,
    )
  ) {
    return unsupported(
      "The metric and operation in the ready intent do not agree.",
    );
  }
  if (intent.comparison !== null) {
    return unsupported(
      "Local recurring-window comparison is not executable yet.",
    );
  }
  const scope = intent.temporalScope.value;
  if (
    scope.kind !== "recent_local_days" ||
    scope.include !== "most_recent_completed_windows" ||
    !Number.isInteger(scope.count) ||
    scope.count < 1 ||
    scope.count > 366
  ) {
    return unsupported(
      "Only most-recent completed recurring local-clock windows are executable.",
    );
  }
  const clock = intent.clockWindow?.value;
  if (!clock || clock.occurrenceAnchor !== "start_date") {
    return unsupported(
      "The ready intent does not contain a recurring clock window.",
    );
  }

  const thresholds = intent.thresholds.map(({ value }) =>
    normalizedThreshold(value),
  );
  const roles = new Set(thresholds.map(({ role }) => role));
  if (roles.size !== thresholds.length) {
    return unsupported("The ready intent contains duplicate threshold roles.");
  }
  const hasMetric = (metric: SupportedMetric) =>
    supportedMetrics.includes(metric);
  const expectedRoles = new Set<NormalizedThreshold["role"]>();
  if (hasMetric("glucose.time_in_range")) {
    expectedRoles.add("range_lower");
    expectedRoles.add("range_upper");
  }
  if (hasMetric("glucose.low_episodes") || hasMetric("glucose.low_readings")) {
    expectedRoles.add("low");
  }
  if (
    hasMetric("glucose.high_episodes") ||
    hasMetric("glucose.high_readings")
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

  return {
    clockWindow: {
      start: { ...clock.start },
      end: { ...clock.end },
      crossesMidnight: clock.crossesMidnight,
    },
    metrics: supportedMetrics,
    thresholds,
    windowCount: scope.count,
  };
}

function resolvedWindows(
  executable: ExecutableLocalGlucoseIntent,
  asOf: number,
) {
  if (!Number.isFinite(asOf) || asOf < 0) {
    return unsupported("asOf must be a finite non-negative timestamp.");
  }
  return resolveMostRecentCompletedRecurringWindows({
    asOf,
    clockWindow: executable.clockWindow,
    count: executable.windowCount,
    timezone: getRuntimeRegionalDefaults().timeZone,
  });
}

/** Returns the smallest half-open repository range needed by the local query. */
export function rangeForLocalGlucoseIntent(
  intent: TarvisIntentV1,
  asOf: number,
): TimeRange {
  const executable = validateIntent(intent);
  const windows = resolvedWindows(executable, asOf);
  const first = windows[0];
  const last = windows.at(-1);
  if (!first || !last) {
    return unsupported("The recurring scope did not resolve any windows.");
  }
  const needsEpisodeContext = executable.metrics.some((metric) =>
    metric.endsWith("_episodes"),
  );
  return needsEpisodeContext
    ? {
        start: Math.max(0, first.range.start - EPISODE_BOUNDARY_CONTEXT_MS),
        end: Math.min(asOf, last.range.end + EPISODE_BOUNDARY_CONTEXT_MS),
      }
    : { start: first.range.start, end: last.range.end };
}

function recurringEpisodeContextRange(
  range: TimeRange,
  asOf: number,
): TimeRange {
  return {
    start: Math.max(0, range.start - EPISODE_BOUNDARY_CONTEXT_MS),
    end: Math.min(asOf, range.end + EPISODE_BOUNDARY_CONTEXT_MS),
  };
}

function recurringEpisodeCount(
  executable: ExecutableLocalGlucoseIntent,
  bundle: ScopedGlucoseEvidenceBundle,
  allReadings: readonly GlucoseReading[],
  asOf: number,
  kind: "low" | "high",
) {
  const threshold = thresholdFor(executable.thresholds, kind).value;
  return bundle.windows.reduce((count, window) => {
    const contextRange = recurringEpisodeContextRange(window.range, asOf);
    const contextReadings = allReadings.filter(
      ({ timestamp }) =>
        timestamp >= contextRange.start && timestamp < contextRange.end,
    );
    const startsInside = detectGlucoseEpisodes(
      contextReadings,
      kind,
      threshold,
    ).filter(
      (episode) =>
        episode.start >= window.range.start && episode.start < window.range.end,
    );
    return count + startsInside.length;
  }, 0);
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

function durationDistribution(
  bundle: ScopedGlucoseEvidenceBundle,
  thresholds: NormalizedThreshold[],
): DurationDistribution {
  const lower = thresholds.find(({ role }) => role === "range_lower");
  const upper = thresholds.find(({ role }) => role === "range_upper");
  if (!lower || !upper) {
    return unsupported(
      "Tell me both the lower and upper levels for time in range.",
    );
  }
  let belowMilliseconds = 0;
  let inRangeMilliseconds = 0;
  let aboveMilliseconds = 0;
  bundle.windows.forEach((window) => {
    window.observationIntervals.forEach((interval) => {
      const duration = interval.end - interval.start;
      if (
        matchesThreshold(interval.mmolL, lower) &&
        matchesThreshold(interval.mmolL, upper)
      ) {
        inRangeMilliseconds += duration;
      } else if (
        interval.mmolL < lower.value ||
        (interval.mmolL === lower.value && lower.operator === "gt")
      ) {
        belowMilliseconds += duration;
      } else {
        aboveMilliseconds += duration;
      }
    });
  });
  const observedMilliseconds =
    belowMilliseconds + inRangeMilliseconds + aboveMilliseconds;
  const percent = (duration: number) =>
    observedMilliseconds > 0
      ? round((duration / observedMilliseconds) * 100, 1)
      : null;
  return {
    abovePercent: percent(aboveMilliseconds),
    belowPercent: percent(belowMilliseconds),
    inRangePercent: percent(inRangeMilliseconds),
    observedMilliseconds,
  };
}

function scopedReadings(
  readings: GlucoseReading[],
  bundle: ScopedGlucoseEvidenceBundle,
) {
  const ids = new Set(bundle.evidence.recordIds);
  return readings
    .filter((reading) => ids.has(reading.id))
    .sort(
      (left, right) =>
        left.timestamp - right.timestamp || left.id.localeCompare(right.id),
    );
}

function representativeReadings(readings: GlucoseReading[]) {
  if (!readings.length) return [];
  const chronological = [...readings].sort(
    (left, right) =>
      left.timestamp - right.timestamp || left.id.localeCompare(right.id),
  );
  const lowest = [...readings].sort(
    (left, right) =>
      left.mmolL - right.mmolL ||
      left.timestamp - right.timestamp ||
      left.id.localeCompare(right.id),
  )[0]!;
  const highest = [...readings].sort(
    (left, right) =>
      right.mmolL - left.mmolL ||
      left.timestamp - right.timestamp ||
      left.id.localeCompare(right.id),
  )[0]!;
  return [
    ...new Map(
      [chronological[0]!, lowest, highest, chronological.at(-1)!].map(
        (reading) => [reading.id, reading],
      ),
    ).values(),
  ];
}

function coverageStatus(bundle: ScopedGlucoseEvidenceBundle) {
  if (bundle.result.readingCount === 0) return "unavailable" as const;
  return bundle.result.coverage.percent < SUFFICIENT_COVERAGE_PERCENT
    ? ("limited" as const)
    : ("sufficient" as const);
}

function clockTransitionSummary(bundle: ScopedGlucoseEvidenceBundle) {
  const descriptions = bundle.chart.windows.flatMap((window) =>
    window.clockTransitions.map((transition) => {
      const minutes = Math.abs(transition.changeMinutes);
      return `${window.label} ${transition.kind === "gap" ? "skips" : "repeats"} ${formatTarvisNumber(minutes, { maximumFractionDigits: 0 })} local minute${minutes === 1 ? "" : "s"}`;
    }),
  );
  if (!descriptions.length) return null;
  const bounded =
    descriptions.length <= 4
      ? descriptions.join("; ")
      : `${descriptions.slice(0, 3).join("; ")}; and ${formatTarvisNumber(descriptions.length - 3, { maximumFractionDigits: 0 })} more`;
  return `Daylight-saving clock change: ${bounded}. This is a local clock transition, not missing sensor data.`;
}

function thresholdFor(
  thresholds: NormalizedThreshold[],
  role: NormalizedThreshold["role"],
) {
  const threshold = thresholds.find((candidate) => candidate.role === role);
  if (!threshold) return unsupported(`Missing ${role} threshold.`);
  return threshold;
}

function clockLabel(executable: ExecutableLocalGlucoseIntent) {
  return `${formatClockTimeForDisplay(executable.clockWindow.start)}–${formatClockTimeForDisplay(executable.clockWindow.end)}`;
}

function occurrenceNoun(executable: ExecutableLocalGlucoseIntent) {
  const start =
    executable.clockWindow.start.hour * 60 +
    executable.clockWindow.start.minute;
  const end =
    executable.clockWindow.end.hour * 60 + executable.clockWindow.end.minute;
  return executable.clockWindow.crossesMidnight ||
    start >= 18 * 60 ||
    end <= 7 * 60
    ? "overnight windows"
    : "clock windows";
}

function requestedCoverageSentence(
  bundle: ScopedGlucoseEvidenceBundle,
  executable: ExecutableLocalGlucoseIntent,
) {
  return `I found readings in ${formatTarvisNumber(bundle.result.windowsWithData, { maximumFractionDigits: 0 })} of the ${formatTarvisNumber(bundle.result.requestedWindowCount, { maximumFractionDigits: 0 })} requested ${occurrenceNoun(executable)} from ${clockLabel(executable)}.`;
}

function metricResults(
  executable: ExecutableLocalGlucoseIntent,
  bundle: ScopedGlucoseEvidenceBundle,
  readings: GlucoseReading[],
  distribution: DurationDistribution | null,
  allReadings: readonly GlucoseReading[],
  asOf: number,
) {
  const hasData = bundle.result.readingCount > 0;
  const firstRange = bundle.windows[0]!.range;
  const lastRange = bundle.windows.at(-1)!.range;
  const statistics = calculateGlucoseStatistics({
    readings,
    range: { start: firstRange.start, end: lastRange.end },
    observationGapCapMilliseconds: OBSERVATION_GAP_MINUTES * 60_000,
  });
  const samples = canonicalGlucoseSamples(readings, {
    start: firstRange.start,
    end: lastRange.end,
  });
  const statistic = (value: number | null) =>
    value === null ? null : round(value, 2);
  return executable.metrics.map((metric) => {
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
          value: hasData
            ? recurringEpisodeCount(
                executable,
                bundle,
                allReadings,
                asOf,
                "low",
              )
            : null,
        };
      case "glucose.high_episodes":
        return {
          id: metric,
          unit: "events" as const,
          value: hasData
            ? recurringEpisodeCount(
                executable,
                bundle,
                allReadings,
                asOf,
                "high",
              )
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
          value: hasData
            ? samples.filter(({ mmolL }) => matchesThreshold(mmolL, threshold))
                .length
            : null,
        };
      }
    }
  });
}

function answerFor(
  executable: ExecutableLocalGlucoseIntent,
  bundle: ScopedGlucoseEvidenceBundle,
  metrics: EvidenceCalculationReference["metrics"],
  distribution: DurationDistribution | null,
  evidenceId: string,
  readings: readonly GlucoseReading[],
): TarvisAnswer {
  if (bundle.result.readingCount === 0) {
    return {
      headline: "Glucose result unavailable",
      answer: `I couldn't find glucose readings in any of the ${formatTarvisNumber(bundle.result.requestedWindowCount, { maximumFractionDigits: 0 })} requested ${occurrenceNoun(executable)} from ${clockLabel(executable)}. I haven't treated missing time as zero, so the requested result is unavailable.`,
      confidence: "limited",
      evidenceIds: [evidenceId],
      limitations: [
        "No glucose readings were available during the times you asked about.",
      ],
    };
  }

  const copies = metrics.map((metric) => {
    if (metric.value === null) return "the requested result was unavailable";
    switch (metric.id) {
      case "glucose.mean":
        return `Your average glucose from the available readings was ${regionalGlucose(metric.value)}`;
      case "glucose.median":
        return `Across those readings, your observed median was ${regionalGlucose(metric.value)}`;
      case "glucose.minimum":
        return `Across those readings, your lowest recorded reading was ${regionalGlucose(metric.value)} ${describeGlucoseExtremeTiming(summarizeGlucoseExtreme(readings, { start: bundle.windows[0]!.range.start, end: bundle.windows.at(-1)!.range.end }, "minimum")!)}`;
      case "glucose.maximum":
        return `Across those readings, your highest recorded reading was ${regionalGlucose(metric.value)} ${describeGlucoseExtremeTiming(summarizeGlucoseExtreme(readings, { start: bundle.windows[0]!.range.start, end: bundle.windows.at(-1)!.range.end }, "maximum")!)}`;
      case "glucose.standard_deviation":
        return `Across those readings, the observed population standard deviation was ${regionalGlucose(metric.value)}`;
      case "glucose.coefficient_of_variation":
        return `Across those readings, the observed coefficient of variation was ${formatTarvisFixedNumber(metric.value, 1)}%`;
      case "glucose.gmi":
        return `Across those readings, the estimated glucose management indicator was ${formatTarvisFixedNumber(metric.value, 1)}% (derived from mean sensor glucose, not a laboratory HbA1c result)`;
      case "glucose.time_in_range": {
        const lower = thresholdFor(executable.thresholds, "range_lower");
        const upper = thresholdFor(executable.thresholds, "range_upper");
        return `Across those readings, ${formatTarvisFixedNumber(metric.value, 1)}% of observed sensor time was within the requested ${regionalGlucoseRange(lower.value, upper.value)} range`;
      }
      case "glucose.low_episodes":
        return `Across those readings, I found ${formatTarvisNumber(metric.value, { maximumFractionDigits: 0 })} sustained low-glucose event${metric.value === 1 ? "" : "s"}`;
      case "glucose.high_episodes":
        return `Across those readings, I found ${formatTarvisNumber(metric.value, { maximumFractionDigits: 0 })} sustained high-glucose event${metric.value === 1 ? "" : "s"}`;
      case "glucose.low_readings":
      case "glucose.high_readings": {
        const threshold = thresholdFor(
          executable.thresholds,
          metric.id === "glucose.low_readings" ? "low" : "high",
        );
        return `Across those readings, I found ${formatTarvisNumber(metric.value, { maximumFractionDigits: 0 })} reading${metric.value === 1 ? "" : "s"} ${metric.id === "glucose.low_readings" ? "below" : "above"} ${regionalGlucose(threshold.value)}`;
      }
    }
  });
  const status = coverageStatus(bundle);
  const limitations = [
    ...(status === "limited"
      ? ["Coverage was below 70%, so this describes observed sensor time only."]
      : []),
    ...(bundle.result.missingWindowCount > 0
      ? ["At least one requested window contained no glucose readings."]
      : []),
    ...(distribution
      ? ["Missing sensor time was excluded rather than estimated."]
      : []),
    ...(executable.metrics.some((metric) => metric.endsWith("_episodes"))
      ? [
          `Episode counts use ${GLUCOSE_EPISODE_DEFINITION_VERSION}; records outside the requested windows were excluded.`,
        ]
      : []),
    ...(executable.metrics.includes("glucose.gmi")
      ? [
          "GMI is estimated from average sensor glucose, not a laboratory HbA1c result. It does not account for pregnancy or individual treatment targets.",
        ]
      : []),
    ...(executable.metrics.includes("glucose.gmi") &&
    (bundle.windows.at(-1)!.range.end - bundle.windows[0]!.range.start <
      GMI_MINIMUM_EXPECTED_MILLISECONDS ||
      bundle.result.coverage.percent < SUFFICIENT_COVERAGE_PERCENT)
      ? [
          "GMI confidence is limited because the requested scope was shorter than 14 days or had less than 70% observed sensor coverage.",
        ]
      : []),
    ...(clockTransitionSummary(bundle)
      ? [clockTransitionSummary(bundle)!]
      : []),
  ];
  const first = metrics[0];
  const headline =
    metrics.length > 1
      ? executable.metrics.every((metric) => metric.endsWith("_episodes"))
        ? "Observed glucose events"
        : "Observed glucose results"
      : first?.id === "glucose.mean"
        ? `${status === "limited" ? "Observed" : "Your"} average glucose: ${first.value === null || first.value === undefined ? "unavailable" : regionalGlucose(first.value)}`
        : first?.id === "glucose.median"
          ? `Observed median glucose: ${first.value === null || first.value === undefined ? "unavailable" : regionalGlucose(first.value)}`
          : first?.id === "glucose.minimum"
            ? `Observed minimum glucose: ${first.value === null || first.value === undefined ? "unavailable" : regionalGlucose(first.value)}`
            : first?.id === "glucose.maximum"
              ? `Observed maximum glucose: ${first.value === null || first.value === undefined ? "unavailable" : regionalGlucose(first.value)}`
              : first?.id === "glucose.standard_deviation"
                ? `Observed glucose standard deviation: ${first.value === null || first.value === undefined ? "unavailable" : regionalGlucose(first.value)}`
                : first?.id === "glucose.coefficient_of_variation"
                  ? `Observed glucose coefficient of variation: ${first.value == null ? "unavailable" : formatTarvisFixedNumber(first.value, 1)}%`
                  : first?.id === "glucose.gmi"
                    ? `Estimated glucose management indicator: ${first.value == null ? "unavailable" : formatTarvisFixedNumber(first.value, 1)}%`
                    : first?.id === "glucose.time_in_range"
                      ? `Observed time in range: ${first.value == null ? "unavailable" : formatTarvisFixedNumber(first.value, 1)}%`
                      : first?.id === "glucose.low_episodes"
                        ? `Observed low-glucose events: ${first.value == null ? "unavailable" : formatTarvisNumber(first.value, { maximumFractionDigits: 0 })}`
                        : first?.id === "glucose.high_episodes"
                          ? `Observed high-glucose events: ${first.value == null ? "unavailable" : formatTarvisNumber(first.value, { maximumFractionDigits: 0 })}`
                          : first?.id === "glucose.low_readings"
                            ? `Observed readings below threshold: ${first.value == null ? "unavailable" : formatTarvisNumber(first.value, { maximumFractionDigits: 0 })}`
                            : `Observed readings above threshold: ${first?.value == null ? "unavailable" : formatTarvisNumber(first.value, { maximumFractionDigits: 0 })}`;
  const gmiInsufficient =
    executable.metrics.includes("glucose.gmi") &&
    (bundle.windows.at(-1)!.range.end - bundle.windows[0]!.range.start <
      GMI_MINIMUM_EXPECTED_MILLISECONDS ||
      bundle.result.coverage.percent < SUFFICIENT_COVERAGE_PERCENT);
  return {
    headline,
    answer: `${copies.join("; ")}. ${requestedCoverageSentence(bundle, executable)}`,
    confidence:
      status === "sufficient" && !gmiInsufficient ? "high" : "limited",
    evidenceIds: [evidenceId],
    limitations: limitations.slice(0, 5),
  };
}

function presentationFor(
  executable: ExecutableLocalGlucoseIntent,
  bundle: ScopedGlucoseEvidenceBundle,
  metrics: EvidenceCalculationReference["metrics"],
  distribution: DurationDistribution | null,
): TarvisEvidencePresentation {
  const metricPresentations: TarvisEvidenceMetric[] = metrics.flatMap(
    (metric): TarvisEvidenceMetric[] => {
      const displayedGlucose = regionalGlucoseMetric(metric.value);
      switch (metric.id) {
        case "glucose.mean":
          return [
            {
              id: "average-glucose" as const,
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
              id: "low-events" as const,
              label: "Sustained lows",
              value: metric.value,
              decimals: 0 as const,
            },
          ];
        case "glucose.high_episodes":
          return [
            {
              id: "high-events" as const,
              label: "Sustained highs",
              value: metric.value,
              decimals: 0 as const,
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
              id: "time-below-range" as const,
              label: "Time below range",
              value: distribution?.belowPercent ?? null,
              decimals: 1 as const,
              unit: "%" as const,
            },
            {
              id: "time-in-range" as const,
              label: "Time in range",
              value: distribution?.inRangePercent ?? null,
              decimals: 1 as const,
              unit: "%" as const,
            },
            {
              id: "time-above-range" as const,
              label: "Time above range",
              value: distribution?.abovePercent ?? null,
              decimals: 1 as const,
              unit: "%" as const,
            },
          ];
      }
    },
  );
  const kind =
    metrics.length > 1
      ? executable.metrics.every((metric) => metric.endsWith("_episodes"))
        ? ("glucose-events" as const)
        : ("glucose-summary" as const)
      : metrics[0]?.id === "glucose.mean"
        ? ("average-glucose" as const)
        : metrics[0]?.id === "glucose.time_in_range"
          ? ("time-in-range" as const)
          : metrics[0]?.id === "glucose.low_episodes"
            ? ("low-events" as const)
            : metrics[0]?.id === "glucose.high_episodes"
              ? ("high-events" as const)
              : metrics[0]?.id === "glucose.low_readings" ||
                  metrics[0]?.id === "glucose.high_readings"
                ? ("glucose-reading-count" as const)
                : ("glucose-statistic" as const);
  const detail = metricDetail(executable);
  const firstRange = bundle.windows[0]!.range;
  const lastRange = bundle.windows.at(-1)!.range;
  return {
    kind,
    title:
      executable.metrics.length > 1
        ? "Glucose results in the requested clock window"
        : `${metricTitle(executable.metrics[0]!)} in the requested clock window`,
    detail,
    windows: [
      {
        label: `${formatTarvisNumber(bundle.result.requestedWindowCount, { maximumFractionDigits: 0 })} completed ${clockLabel(executable)} windows`,
        range: { start: firstRange.start, end: lastRange.end },
        recordCount: bundle.result.readingCount,
        coveragePercent: bundle.result.coverage.percent,
        coverageStatus: coverageStatus(bundle),
        metrics: metricPresentations,
      },
    ],
  };
}

function evidenceFor(
  executable: ExecutableLocalGlucoseIntent,
  bundle: ScopedGlucoseEvidenceBundle,
  metrics: EvidenceCalculationReference["metrics"],
  readings: GlucoseReading[],
) {
  const id = `${bundle.queryId}:evidence`;
  const firstRange = bundle.windows[0]!.range;
  const lastRange = bundle.windows.at(-1)!.range;
  const thresholdValues: EvidenceCalculationReference["thresholds"] =
    executable.thresholds.map((threshold) => ({
      operator: threshold.operator,
      role: threshold.role,
      unit: "mmol/L",
      value: threshold.value,
    }));
  const calculation: EvidenceCalculationReference = {
    kind: "tarvis-local-glucose-v1",
    queryId: bundle.queryId,
    algorithmVersion: [
      `scoped-glucose-v${bundle.schemaVersion}`,
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
        ? [`duration-gap-cap-${OBSERVATION_GAP_MINUTES}m-v1`]
        : []),
      ...(executable.metrics.some((metric) => metric.endsWith("_episodes"))
        ? [GLUCOSE_EPISODE_DEFINITION_VERSION]
        : []),
    ].join("+"),
    metrics,
    thresholds: thresholdValues,
    requestedWindowCount: bundle.result.requestedWindowCount,
    windowsWithData: bundle.result.windowsWithData,
    coveragePercent: bundle.result.coverage.percent,
    ...(executable.metrics.some((metric) => metric.endsWith("_episodes"))
      ? { episodeDefinitionVersion: GLUCOSE_EPISODE_DEFINITION_VERSION }
      : {}),
  };
  const lower = executable.thresholds.find(
    (threshold) => threshold.role === "range_lower",
  );
  const upper = executable.thresholds.find(
    (threshold) => threshold.role === "range_upper",
  );
  const chartIsSemanticallyExact =
    executable.metrics.length === 1 && executable.metrics[0] === "glucose.mean";
  const overallMeanMmolL =
    metrics.find(({ id: metric }) => metric === "glucose.mean")?.value ?? null;
  const persistedTargetRange =
    lower && upper ? { minimum: lower.value, maximum: upper.value } : undefined;
  const persistedScale = buildEvidenceClockWindowScale(
    [
      ...bundle.chart.windows.flatMap((window) =>
        window.points.map(({ mmolL }) => mmolL),
      ),
      ...bundle.chart.aggregatePoints.map(({ mmolL }) => mmolL),
      ...(overallMeanMmolL === null ? [] : [overallMeanMmolL]),
    ],
    persistedTargetRange,
  );
  const evidence: EvidenceReference = {
    id,
    label: `Readings used for ${clockLabel(executable)} ${executable.metrics.map(metricTitle).join(" and ")}`,
    description: `${formatTarvisNumber(bundle.result.readingCount, { maximumFractionDigits: 0 })} readings from ${formatTarvisNumber(bundle.result.requestedWindowCount, { maximumFractionDigits: 0 })} completed local-time window${bundle.result.requestedWindowCount === 1 ? "" : "s"}. Missing time is not counted as zero.${clockTransitionSummary(bundle) ? ` ${clockTransitionSummary(bundle)}` : ""}`,
    range: { start: firstRange.start, end: lastRange.end },
    recordIds: [...bundle.evidence.recordIds],
    examples: representativeReadings(readings).map((reading) => ({
      id: reading.id,
      kind: "glucose",
      timestamp: reading.timestamp,
      primary: regionalGlucose(reading.mmolL),
      secondary: `${reading.quality} · saved reading`,
      sourceId: reading.sourceId,
    })),
    calculation,
    ...(chartIsSemanticallyExact
      ? {
          visualization: {
            ...bundle.chart,
            timezone: getRuntimeRegionalDefaults().timeZone,
            title: `Glucose from ${clockLabel(executable)}`,
            subtitle: `${formatTarvisNumber(bundle.result.requestedWindowCount, { maximumFractionDigits: 0 })} completed time windows. Each thin line shows one window, the thicker line shows their overall pattern, and the dashed line marks the average.`,
            coverageSummary: `${formatTarvisNumber(bundle.result.windowsWithData, { maximumFractionDigits: 0 })} of ${formatTarvisNumber(bundle.result.requestedWindowCount, { maximumFractionDigits: 0 })} requested windows contain readings · ${formatTarvisFixedNumber(bundle.result.coverage.percent, 1)}% observed coverage${clockTransitionSummary(bundle) ? ` · ${clockTransitionSummary(bundle)}` : ""}`,
            overallMeanMmolL,
            traceSemantics: {
              aggregate: "equal-occurrence-profile-average" as const,
              binMinutes: CHART_BIN_MINUTES,
              occurrence: "clock-bin-average" as const,
            },
            valueDomain: {
              minimum: persistedScale.minimum,
              maximum: persistedScale.maximum,
            },
            targetRangePolicy: "persisted-only" as const,
            missingOccurrenceLabels: bundle.evidence.missingWindows.map(
              (window) => window.label,
            ),
            ...(persistedTargetRange
              ? {
                  targetRange: persistedTargetRange,
                  targetRangeProvenance: "query-thresholds" as const,
                }
              : {}),
          },
        }
      : {}),
  };
  return evidence;
}

function localQueryId(executable: ExecutableLocalGlucoseIntent, asOf: number) {
  const thresholds = [...executable.thresholds]
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
  return `${LOCAL_ANSWER_VERSION}:${JSON.stringify({
    schemaVersion: 1,
    timezone: getRuntimeRegionalDefaults().timeZone,
    asOf,
    metrics: executable.metrics,
    windowCount: executable.windowCount,
    clockWindow: executable.clockWindow,
    thresholds,
    binMinutes: CHART_BIN_MINUTES,
    maximumObservedGapMinutes: OBSERVATION_GAP_MINUTES,
    episodeBoundaryContextMilliseconds: executable.metrics.some((metric) =>
      metric.endsWith("_episodes"),
    )
      ? EPISODE_BOUNDARY_CONTEXT_MS
      : null,
    recurringMeanChartSemantics:
      executable.metrics.length === 1 &&
      executable.metrics[0] === "glucose.mean"
        ? "clock-bin-profile-plus-exact-overall-mean-persisted-domain-v2"
        : null,
    metricAlgorithmVersions: executable.metrics.map((metric) => ({
      metric,
      version: metricAlgorithmVersion(metric),
    })),
    minimumAggregateContributors: Math.min(2, executable.windowCount),
  })}`;
}

/**
 * Executes a ready recurring-clock glucose intent without model calculation or
 * prose generation. Unsupported ready shapes throw instead of falling back to
 * a nearby report.
 */
export function buildLocalGlucoseAnswer({
  asOf,
  intent,
  readings,
}: BuildLocalGlucoseAnswerInput): LocalGlucoseAnswerResult {
  const executable = validateIntent(intent);
  // Resolve once before execution so invalid asOf/scope values fail before any
  // result object can be partially assembled.
  resolvedWindows(executable, asOf);
  const bundle = executeScopedGlucoseQuery(
    {
      asOf,
      binMinutes: CHART_BIN_MINUTES,
      clockWindow: executable.clockWindow,
      maximumObservedGapMinutes: OBSERVATION_GAP_MINUTES,
      minimumAggregateContributors: Math.min(2, executable.windowCount),
      queryId: localQueryId(executable, asOf),
      timezone: getRuntimeRegionalDefaults().timeZone,
      windowCount: executable.windowCount,
    },
    readings,
  );
  const exactReadings = scopedReadings(readings, bundle);
  const distribution = executable.metrics.includes("glucose.time_in_range")
    ? durationDistribution(bundle, executable.thresholds)
    : null;
  const metrics = metricResults(
    executable,
    bundle,
    exactReadings,
    distribution,
    readings,
    asOf,
  );
  const evidence = evidenceFor(executable, bundle, metrics, exactReadings);
  const readingById = new Map(
    exactReadings.map((reading) => [reading.id, reading]),
  );
  const answerWindowIds = bundle.windows.map(({ id }) => id);
  const answerBundle = createGlucoseAnswerBundleV2({
    executor: "recurring-clock",
    originalIntent: intent,
    normalizedThresholds: executable.thresholds,
    timezone: getRuntimeRegionalDefaults().timeZone,
    asOf,
    windows: bundle.windows.map((window) => {
      const needsEpisodeContext = executable.metrics.some((metric) =>
        metric.endsWith("_episodes"),
      );
      const evidenceContextRange = needsEpisodeContext
        ? recurringEpisodeContextRange(window.range, asOf)
        : window.range;
      return {
        id: window.id,
        label: window.label,
        role: "occurrence",
        calculationRange: window.range,
        evidenceContextRange,
        calculationReadings: window.recordIds.map((id) => {
          const reading = readingById.get(id);
          if (!reading) {
            return unsupported(
              `Scoped calculation record ${id} was not retained.`,
            );
          }
          return reading;
        }),
        contextReadings: needsEpisodeContext
          ? readings.filter(
              ({ timestamp }) =>
                timestamp >= evidenceContextRange.start &&
                timestamp < evidenceContextRange.end &&
                (timestamp < window.range.start ||
                  timestamp >= window.range.end),
            )
          : [],
        observationIntervals: window.observationIntervals,
      };
    }),
    algorithms: {
      answerVersion: LOCAL_ANSWER_VERSION,
      coverageVersion: "forward-observation-capped-at-gap-v1",
      maximumObservedGapMilliseconds: OBSERVATION_GAP_MINUTES * 60_000,
      observationValuePrecisionDecimals: 2,
      metricVersions: executable.metrics.map((metric) => ({
        metric,
        version: metricAlgorithmVersion(metric),
      })),
      episodeDefinitionVersion: executable.metrics.some((metric) =>
        metric.endsWith("_episodes"),
      )
        ? GLUCOSE_EPISODE_DEFINITION_VERSION
        : null,
      chartVersions: evidence.visualization
        ? [evidence.visualization.kind]
        : [],
    },
    claims: metrics.map((metric) => ({
      id: `${evidence.id}:claim:${metric.id}`,
      metric: metric.id as SupportedMetric,
      value: metric.value,
      unit: metric.unit,
      windowIds: answerWindowIds,
    })),
    charts: evidence.visualization
      ? [
          {
            id: `${evidence.id}:chart`,
            kind: evidence.visualization.kind,
            sourceReferenceId: evidence.id,
            windowIds: answerWindowIds,
            recordIds: exactReadings.map(({ id }) => id),
          },
        ]
      : [],
  });
  return {
    answer: answerFor(
      executable,
      bundle,
      metrics,
      distribution,
      evidence.id,
      exactReadings,
    ),
    answerBundle,
    bundle,
    evidence,
    presentation: presentationFor(executable, bundle, metrics, distribution),
  };
}
