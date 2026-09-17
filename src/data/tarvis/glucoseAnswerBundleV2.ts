import {
  type TarvisGlucoseThreshold,
  type TarvisIntentV1,
  type TarvisMetric,
  type TarvisOperation,
  type TarvisRecurringClockWindow,
  type TarvisTemporalScope,
  validateTarvisIntentV1,
} from "./intent";
import {
  detectGlucoseEpisodes,
  GLUCOSE_EPISODE_DEFINITION_VERSION,
} from "@/domain/insights";
import {
  calculateGlucoseStatistics,
  canonicalGlucoseSamples,
  GLUCOSE_MEAN_METRIC_VERSION,
} from "./query/glucoseStatistics";
import {
  type GlucoseReading,
  MG_DL_PER_MMOL_L,
  type TimeRange,
} from "@/domain/models";
import { isIanaTimeZone } from "@/domain/regionalProfile";

export const GLUCOSE_ANSWER_BUNDLE_SCHEMA_VERSION = 2 as const;
export const GLUCOSE_ANSWER_BUNDLE_IDENTITY_ALGORITHM =
  "t1arc-canonical-cyrb128-v1" as const;

export type GlucoseAnswerMetricV2 = Extract<
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

const GLUCOSE_ANSWER_METRICS = new Set<string>([
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

const GLUCOSE_CHART_KINDS = new Set([
  "recurring-clock-overlay-v1",
  "range-trace-v1",
  "period-comparison-v1",
  "range-distribution-v1",
  "event-timeline-v1",
]);

export interface GlucoseAnswerThresholdV2 extends Omit<
  TarvisGlucoseThreshold,
  "unit"
> {
  readonly unit: "mmol/L";
}

export interface NormalizedGlucoseIntentV2 {
  readonly schemaVersion: 1;
  readonly question: string;
  readonly normalizedQuestion: string;
  readonly domain: "glucose";
  readonly metrics: readonly GlucoseAnswerMetricV2[];
  readonly operation: TarvisOperation;
  readonly temporalScope: TarvisTemporalScope;
  readonly clockWindow: TarvisRecurringClockWindow | null;
  readonly comparison: {
    kind: "previous_equal_period" | "explicit_periods";
  } | null;
  readonly thresholds: readonly GlucoseAnswerThresholdV2[];
}

export interface GlucoseAnswerRecordV2 {
  readonly id: string;
  readonly timestamp: number;
  readonly receivedAt: number;
  readonly mmolL: number;
  readonly trend: GlucoseReading["trend"];
  readonly quality: GlucoseReading["quality"];
  readonly sourceId: string;
  readonly sourceFactoryTimestamp: string | null;
  readonly sourceLocalTimestamp: string | null;
  readonly timestampDiscrepancyMinutes: number | null;
  readonly importedAt: number | null;
  readonly sourceFile: string | null;
  readonly sourceRow: number | null;
  readonly sourceDeviceId: string | null;
}

export interface GlucoseAnswerObservationIntervalV2 {
  readonly start: number;
  readonly end: number;
  readonly mmolL: number;
  readonly recordIds: readonly string[];
}

export interface GlucoseAnswerCoverageV2 {
  readonly expectedMilliseconds: number;
  readonly observedMilliseconds: number;
  readonly percent: number;
}

export interface GlucoseAnswerWindowV2 {
  readonly id: string;
  readonly label: string;
  readonly role: "requested" | "comparison" | "occurrence";
  readonly calculationRange: TimeRange;
  readonly evidenceContextRange: TimeRange;
  readonly calculationRecordIds: readonly string[];
  /** Records outside this window used only for explicit boundary classification. */
  readonly contextRecordIds: readonly string[];
  readonly observationIntervals: readonly GlucoseAnswerObservationIntervalV2[];
  readonly coverage: GlucoseAnswerCoverageV2;
}

export interface GlucoseAnswerClaimV2 {
  readonly id: string;
  readonly metric: GlucoseAnswerMetricV2;
  readonly value: number | null;
  readonly unit: "mmol/L" | "%" | "events" | "readings";
  readonly status: "available" | "unavailable";
  readonly windowIds: readonly string[];
  readonly calculationRecordIds: readonly string[];
  readonly contextRecordIds: readonly string[];
  readonly contextPolicy: "none" | "episode-boundary-classification-only";
  readonly coverage: GlucoseAnswerCoverageV2;
}

export interface GlucoseAnswerChartReferenceV2 {
  readonly id: string;
  readonly kind: string;
  readonly sourceReferenceId: string;
  readonly windowIds: readonly string[];
  /** Always the envelope of calculation windows, never their context range. */
  readonly range: TimeRange;
  readonly recordIds: readonly string[];
}

export interface GlucoseAnswerAlgorithmsV2 {
  readonly answerVersion: string;
  readonly coverageVersion: "forward-observation-capped-at-gap-v1";
  readonly maximumObservedGapMilliseconds: number;
  /** null preserves unrounded same-instant means; recurring charts use 2. */
  readonly observationValuePrecisionDecimals: number | null;
  readonly metricVersions: readonly {
    readonly metric: GlucoseAnswerMetricV2;
    readonly version: string;
  }[];
  readonly episodeDefinitionVersion: string | null;
  readonly chartVersions: readonly string[];
}

export interface GlucoseAnswerBundleV2 {
  readonly schemaVersion: typeof GLUCOSE_ANSWER_BUNDLE_SCHEMA_VERSION;
  readonly kind: "glucose-answer-bundle";
  readonly executor: "recurring-clock" | "exact-range";
  readonly intent: {
    readonly original: TarvisIntentV1;
    readonly normalized: NormalizedGlucoseIntentV2;
  };
  readonly scope: {
    readonly timezone: string;
    readonly asOf: number;
    readonly calculationRange: TimeRange;
    readonly evidenceContextRange: TimeRange;
    readonly windows: readonly GlucoseAnswerWindowV2[];
  };
  readonly thresholds: readonly GlucoseAnswerThresholdV2[];
  readonly algorithms: GlucoseAnswerAlgorithmsV2;
  readonly coverage: GlucoseAnswerCoverageV2 & {
    readonly requestedWindowCount: number;
    readonly windowsWithData: number;
  };
  readonly records: readonly GlucoseAnswerRecordV2[];
  readonly claims: readonly GlucoseAnswerClaimV2[];
  readonly charts: readonly GlucoseAnswerChartReferenceV2[];
  readonly safeguards: {
    readonly halfOpenCalculationWindows: true;
    readonly missingData: "omitted-not-zero";
    readonly sampleNormalization: "same-timestamp-records-averaged-before-sample-statistics";
    readonly contextData: "excluded-from-aggregate-metrics-boundary-classification-only";
    readonly chartsUseCalculationScopeOnly: true;
    readonly zeroRequiresObservedData: true;
  };
  readonly identity: {
    readonly algorithm: typeof GLUCOSE_ANSWER_BUNDLE_IDENTITY_ALGORITHM;
    readonly queryId: string;
    readonly dataRevisionId: string;
    readonly integrityId: string;
  };
}

export interface GlucoseAnswerWindowV2Input {
  id: string;
  label: string;
  role: GlucoseAnswerWindowV2["role"];
  calculationRange: TimeRange;
  evidenceContextRange?: TimeRange;
  calculationReadings: readonly GlucoseReading[];
  contextReadings?: readonly GlucoseReading[];
  observationIntervals: readonly {
    start: number;
    end: number;
    mmolL: number;
    recordIds: readonly string[];
  }[];
}

export interface GlucoseAnswerClaimV2Input {
  id: string;
  metric: GlucoseAnswerMetricV2;
  value: number | null;
  unit: GlucoseAnswerClaimV2["unit"];
  windowIds: readonly string[];
}

export interface GlucoseAnswerChartReferenceV2Input {
  id: string;
  kind: string;
  sourceReferenceId: string;
  windowIds: readonly string[];
  recordIds?: readonly string[];
}

export interface CreateGlucoseAnswerBundleV2Input {
  executor: GlucoseAnswerBundleV2["executor"];
  originalIntent: TarvisIntentV1;
  normalizedThresholds: readonly GlucoseAnswerThresholdV2[];
  timezone: string;
  asOf: number;
  windows: readonly GlucoseAnswerWindowV2Input[];
  algorithms: GlucoseAnswerAlgorithmsV2;
  claims: readonly GlucoseAnswerClaimV2Input[];
  charts?: readonly GlucoseAnswerChartReferenceV2Input[];
}

export class GlucoseAnswerBundleInvariantError extends Error {
  readonly code = "invalid-glucose-answer-bundle-v2";

  constructor(message: string) {
    super(message);
    this.name = "GlucoseAnswerBundleInvariantError";
  }
}

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new GlucoseAnswerBundleInvariantError(message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function round(value: number, decimals: number) {
  const factor = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function recursiveClone<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => recursiveClone(item)) as T;
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, recursiveClone(item)]),
    ) as T;
  }
  return value;
}

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }
  Object.freeze(value);
  Object.values(value).forEach((item) => deepFreeze(item));
  return value;
}

const CANONICAL_KEY_ORDER_CACHE_LIMIT = 64;

function canonicalize(
  value: unknown,
  keyOrders: Map<string, readonly string[]>,
): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => canonicalize(item, keyOrders));
  }
  if (isRecord(value)) {
    const keys = Object.keys(value);
    // Retain the established locale-sensitive identity order exactly. A full
    // record snapshot repeats a few shapes thousands of times; sorting every
    // copy invokes Android collation millions of times on Hermes. The exact
    // input-key sequence also preserves stable-sort ties between distinct keys.
    const signature = JSON.stringify(keys);
    let orderedKeys = keyOrders.get(signature);
    if (!orderedKeys) {
      orderedKeys = keys.sort((left, right) => left.localeCompare(right));
      if (keyOrders.size >= CANONICAL_KEY_ORDER_CACHE_LIMIT) {
        const oldest = keyOrders.keys().next().value;
        if (oldest !== undefined) keyOrders.delete(oldest);
      }
      keyOrders.set(signature, orderedKeys);
    }
    return Object.fromEntries(
      orderedKeys.map((key) => [key, canonicalize(value[key], keyOrders)]),
    );
  }
  return value;
}

function canonicalString(value: unknown) {
  // Per operation, never a global cache that could outlive a locale change or
  // retain arbitrary property names from imported evidence indefinitely.
  return JSON.stringify(canonicalize(value, new Map()));
}

/** Deterministic 128-bit content identity; this is an integrity checksum, not a MAC. */
function digest(value: unknown) {
  const input = canonicalString(value);
  let h1 = 1779033703;
  let h2 = 3144134277;
  let h3 = 1013904242;
  let h4 = 2773480762;
  for (let index = 0; index < input.length; index += 1) {
    const code = input.charCodeAt(index);
    h1 = h2 ^ Math.imul(h1 ^ code, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ code, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ code, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ code, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  h1 ^= h2 ^ h3 ^ h4;
  h2 ^= h1;
  h3 ^= h1;
  h4 ^= h1;
  return [h1, h2, h3, h4]
    .map((part) => (part >>> 0).toString(16).padStart(8, "0"))
    .join("");
}

function assertRange(range: TimeRange, label: string) {
  invariant(
    Number.isFinite(range.start) &&
      Number.isFinite(range.end) &&
      range.start >= 0 &&
      range.end > range.start,
    `${label} must be a finite non-empty half-open range.`,
  );
}

function sameRange(left: TimeRange, right: TimeRange) {
  return left.start === right.start && left.end === right.end;
}

function envelope(ranges: readonly TimeRange[]): TimeRange {
  invariant(ranges.length > 0, "At least one range is required.");
  return {
    start: Math.min(...ranges.map(({ start }) => start)),
    end: Math.max(...ranges.map(({ end }) => end)),
  };
}

function coverageFor(
  ranges: readonly TimeRange[],
  intervals: readonly GlucoseAnswerObservationIntervalV2[],
): GlucoseAnswerCoverageV2 {
  const expectedMilliseconds = ranges.reduce(
    (total, range) => total + range.end - range.start,
    0,
  );
  const observedMilliseconds = intervals.reduce(
    (total, interval) => total + interval.end - interval.start,
    0,
  );
  const roundedPercent =
    expectedMilliseconds > 0
      ? round((observedMilliseconds / expectedMilliseconds) * 100, 1)
      : 0;
  return {
    expectedMilliseconds,
    observedMilliseconds,
    // Preserve the distinction between no observed time and a valid but very
    // sparse observation that would otherwise round to the same 0.0 value.
    percent:
      observedMilliseconds > 0 && roundedPercent === 0 ? 0.1 : roundedPercent,
  };
}

function snapshot(reading: GlucoseReading): GlucoseAnswerRecordV2 {
  return {
    id: reading.id,
    timestamp: reading.timestamp,
    receivedAt: reading.receivedAt,
    mmolL: reading.mmolL,
    trend: reading.trend,
    quality: reading.quality,
    sourceId: reading.sourceId,
    sourceFactoryTimestamp: reading.sourceFactoryTimestamp ?? null,
    sourceLocalTimestamp: reading.sourceLocalTimestamp ?? null,
    timestampDiscrepancyMinutes: reading.timestampDiscrepancyMinutes ?? null,
    importedAt: reading.importedAt ?? null,
    sourceFile: reading.sourceFile ?? null,
    sourceRow: reading.sourceRow ?? null,
    sourceDeviceId: reading.sourceDeviceId ?? null,
  };
}

function recordSort(
  left: Pick<GlucoseAnswerRecordV2, "timestamp" | "id">,
  right: Pick<GlucoseAnswerRecordV2, "timestamp" | "id">,
) {
  return left.timestamp - right.timestamp || left.id.localeCompare(right.id);
}

function calculationReading(record: GlucoseAnswerRecordV2): GlucoseReading {
  return {
    id: record.id,
    timestamp: record.timestamp,
    receivedAt: record.receivedAt,
    mmolL: record.mmolL,
    trend: record.trend,
    quality: record.quality,
    sourceId: record.sourceId,
  };
}

/**
 * Episode detection is sample based too. Collapse duplicate imports at one
 * instant before the state machine runs while retaining every source ID in
 * the synthetic sample identity and, permanently, in the immutable bundle.
 */
function canonicalEpisodeReadings(
  records: readonly GlucoseAnswerRecordV2[],
  range: TimeRange,
): GlucoseReading[] {
  return canonicalGlucoseSamples(records.map(calculationReading), range).map(
    (sample) => ({
      id: `canonical:${sample.timestamp}:${sample.recordIds.join("\u0000")}`,
      timestamp: sample.timestamp,
      receivedAt: sample.timestamp,
      mmolL: sample.mmolL,
      trend: "unknown",
      quality: "measured",
      sourceId: `canonical:${sample.recordIds.join("\u0000")}`,
    }),
  );
}

function canonicalThresholds(thresholds: readonly GlucoseAnswerThresholdV2[]) {
  return [...thresholds]
    .map(({ operator, role, unit, value }) => ({ operator, role, unit, value }))
    .sort(
      (left, right) =>
        left.role.localeCompare(right.role) ||
        left.operator.localeCompare(right.operator) ||
        left.value - right.value,
    );
}

function normalizeIntent(
  intent: TarvisIntentV1,
  thresholds: readonly GlucoseAnswerThresholdV2[],
): NormalizedGlucoseIntentV2 {
  return {
    schemaVersion: 1,
    question: intent.question,
    normalizedQuestion: intent.normalizedQuestion,
    domain: "glucose",
    metrics: intent.metrics.map(({ value }) => value as GlucoseAnswerMetricV2),
    operation: intent.operation.value,
    temporalScope: recursiveClone(intent.temporalScope.value),
    clockWindow: recursiveClone(intent.clockWindow?.value ?? null),
    comparison: recursiveClone(intent.comparison?.value ?? null),
    thresholds: canonicalThresholds(thresholds),
  };
}

function expectedThresholds(intent: TarvisIntentV1) {
  return canonicalThresholds(
    intent.thresholds.map(({ value: threshold }) => ({
      ...threshold,
      unit: "mmol/L" as const,
      value:
        threshold.unit === "mg/dL"
          ? threshold.value / MG_DL_PER_MMOL_L
          : threshold.value,
    })),
  );
}

function observationIntervalsFromRecords(
  records: readonly GlucoseAnswerRecordV2[],
  range: TimeRange,
  maximumGapMilliseconds: number,
  precisionDecimals: number | null,
): GlucoseAnswerObservationIntervalV2[] {
  const groups: {
    timestamp: number;
    mmolL: number;
    recordIds: string[];
  }[] = [];
  [...records].sort(recordSort).forEach((record) => {
    const previous = groups.at(-1);
    if (previous?.timestamp === record.timestamp) {
      const count = previous.recordIds.length;
      previous.mmolL = (previous.mmolL * count + record.mmolL) / (count + 1);
      previous.recordIds.push(record.id);
      return;
    }
    groups.push({
      timestamp: record.timestamp,
      mmolL: record.mmolL,
      recordIds: [record.id],
    });
  });
  return groups.flatMap((group, index) => {
    const end = Math.min(
      range.end,
      groups[index + 1]?.timestamp ?? range.end,
      group.timestamp + maximumGapMilliseconds,
    );
    if (end <= group.timestamp) return [];
    return [
      {
        start: group.timestamp,
        end,
        mmolL:
          precisionDecimals === null
            ? group.mmolL
            : round(group.mmolL, precisionDecimals),
        recordIds: [...group.recordIds],
      },
    ];
  });
}

function idsForWindows(
  windows: readonly GlucoseAnswerWindowV2[],
  windowIds: readonly string[],
  kind: "calculationRecordIds" | "contextRecordIds",
) {
  const selected = new Set(windowIds);
  return [
    ...new Set(
      windows
        .filter((window) => selected.has(window.id))
        .flatMap((window) => [...window[kind]]),
    ),
  ];
}

function orderedIds(
  ids: readonly string[],
  records: readonly GlucoseAnswerRecordV2[],
) {
  const selected = new Set(ids);
  return records.filter(({ id }) => selected.has(id)).map(({ id }) => id);
}

function claimCoverage(
  windows: readonly GlucoseAnswerWindowV2[],
  windowIds: readonly string[],
) {
  const selected = new Set(windowIds);
  const scoped = windows.filter((window) => selected.has(window.id));
  return coverageFor(
    scoped.map(({ calculationRange }) => calculationRange),
    scoped.flatMap(({ observationIntervals }) => [...observationIntervals]),
  );
}

function thresholdFor(
  thresholds: readonly GlucoseAnswerThresholdV2[],
  role: GlucoseAnswerThresholdV2["role"],
) {
  const threshold = thresholds.find((candidate) => candidate.role === role);
  invariant(threshold, `The ${role} threshold is required.`);
  return threshold;
}

function matchesThreshold(value: number, threshold: GlucoseAnswerThresholdV2) {
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

function recomputeClaim(
  bundle: GlucoseAnswerBundleV2,
  claim: GlucoseAnswerClaimV2,
) {
  const recordById = new Map(
    bundle.records.map((record) => [record.id, record]),
  );
  const calculationRecords = claim.calculationRecordIds.map((id) => {
    const record = recordById.get(id);
    invariant(record, `Claim ${claim.id} references missing record ${id}.`);
    return record;
  });
  if (!calculationRecords.length) return null;
  const selectedWindows = claim.windowIds.map((id) => {
    const window = bundle.scope.windows.find(
      (candidate) => candidate.id === id,
    );
    invariant(window, `Claim ${claim.id} references missing window ${id}.`);
    return window;
  });
  const claimRange = envelope(
    selectedWindows.map(({ calculationRange }) => calculationRange),
  );
  const statistics = calculateGlucoseStatistics({
    readings: calculationRecords.map(calculationReading),
    range: claimRange,
    observationGapCapMilliseconds:
      bundle.algorithms.maximumObservedGapMilliseconds,
  });
  switch (claim.metric) {
    case "glucose.mean":
      // Old conversations retain their original two-decimal claim and hash.
      // New claims retain calculation precision until regional presentation.
      return bundle.algorithms.metricVersions.find(({ metric }) => metric === claim.metric)?.version === GLUCOSE_MEAN_METRIC_VERSION
        ? statistics.arithmeticMeanMmolL
        : round(statistics.arithmeticMeanMmolL!, 2);
    case "glucose.median":
      return round(statistics.medianMmolL!, 2);
    case "glucose.minimum":
      return round(statistics.minimumMmolL!, 2);
    case "glucose.maximum":
      return round(statistics.maximumMmolL!, 2);
    case "glucose.standard_deviation":
      return round(statistics.populationStandardDeviationMmolL!, 2);
    case "glucose.coefficient_of_variation":
      return round(statistics.coefficientOfVariationPercent!, 2);
    case "glucose.gmi":
      return round(statistics.glucoseManagementIndicatorPercent!, 2);
    case "glucose.low_readings":
    case "glucose.high_readings": {
      const role = claim.metric === "glucose.low_readings" ? "low" : "high";
      const threshold = thresholdFor(bundle.thresholds, role);
      return canonicalGlucoseSamples(
        calculationRecords.map(calculationReading),
        claimRange,
      ).filter(({ mmolL }) => matchesThreshold(mmolL, threshold)).length;
    }
    case "glucose.time_in_range": {
      const lower = thresholdFor(bundle.thresholds, "range_lower");
      const upper = thresholdFor(bundle.thresholds, "range_upper");
      const selected = new Set(claim.windowIds);
      const intervals = bundle.scope.windows
        .filter((window) => selected.has(window.id))
        .flatMap(({ observationIntervals }) => observationIntervals);
      const observed = intervals.reduce(
        (sum, interval) => sum + interval.end - interval.start,
        0,
      );
      if (!observed) return null;
      const within = intervals.reduce(
        (sum, interval) =>
          sum +
          (matchesThreshold(interval.mmolL, lower) &&
          matchesThreshold(interval.mmolL, upper)
            ? interval.end - interval.start
            : 0),
        0,
      );
      return round((within / observed) * 100, 1);
    }
    case "glucose.low_episodes":
    case "glucose.high_episodes": {
      const kind = claim.metric === "glucose.low_episodes" ? "low" : "high";
      const role = kind === "low" ? "low" : "high";
      const threshold = thresholdFor(bundle.thresholds, role).value;
      return selectedWindows.reduce((count, window) => {
        const windowRecordIds = new Set([
          ...window.calculationRecordIds,
          ...window.contextRecordIds,
        ]);
        const windowRecords = bundle.records.filter(({ id }) =>
          windowRecordIds.has(id),
        );
        const episodes = detectGlucoseEpisodes(
          canonicalEpisodeReadings(windowRecords, window.evidenceContextRange),
          kind,
          threshold,
        );
        return (
          count +
          episodes.filter(
            (episode) =>
              episode.start >= window.calculationRange.start &&
              episode.start < window.calculationRange.end,
          ).length
        );
      }, 0);
    }
  }
}

function identityBase(bundle: Omit<GlucoseAnswerBundleV2, "identity">) {
  const queryId = `gav2-query:${digest({
    executor: bundle.executor,
    intent: bundle.intent.normalized,
    scope: {
      timezone: bundle.scope.timezone,
      asOf: bundle.scope.asOf,
      calculationRange: bundle.scope.calculationRange,
      evidenceContextRange: bundle.scope.evidenceContextRange,
      windows: bundle.scope.windows.map((window) => ({
        id: window.id,
        label: window.label,
        role: window.role,
        calculationRange: window.calculationRange,
        evidenceContextRange: window.evidenceContextRange,
      })),
    },
    thresholds: bundle.thresholds,
    algorithms: bundle.algorithms,
  })}`;
  const dataRevisionId = `gav2-data:${digest(bundle.records)}`;
  return {
    algorithm: GLUCOSE_ANSWER_BUNDLE_IDENTITY_ALGORITHM,
    queryId,
    dataRevisionId,
  } as const;
}

function integrityId(bundle: Omit<GlucoseAnswerBundleV2, "identity">) {
  const base = identityBase(bundle);
  return `gav2-integrity:${digest({ ...bundle, identity: base })}`;
}

/**
 * Constructs the only mutable boundary for V2 answers. The returned object and
 * every descendant are cloned, validated, and frozen.
 */
export function createGlucoseAnswerBundleV2(
  input: CreateGlucoseAnswerBundleV2Input,
): GlucoseAnswerBundleV2 {
  invariant(isIanaTimeZone(input.timezone), "Timezone must be a valid IANA zone.");
  invariant(Number.isFinite(input.asOf) && input.asOf >= 0, "asOf is invalid.");
  const originalValidation = validateTarvisIntentV1(input.originalIntent);
  invariant(
    originalValidation.valid,
    `The original intent is invalid: ${originalValidation.errors.join("; ")}`,
  );
  invariant(
    input.originalIntent.domain.value === "glucose",
    "Intent must be glucose.",
  );
  invariant(
    input.originalIntent.metrics.length > 0 &&
      new Set(input.originalIntent.metrics.map(({ value }) => value)).size ===
        input.originalIntent.metrics.length &&
      input.originalIntent.metrics.every(({ value }) =>
        GLUCOSE_ANSWER_METRICS.has(value),
      ),
    "Intent contains an unsupported or duplicate V2 glucose metric.",
  );
  invariant(
    input.windows.length > 0,
    "At least one calculation window is required.",
  );

  const recordMap = new Map<string, GlucoseAnswerRecordV2>();
  input.windows.forEach((window) => {
    [...window.calculationReadings, ...(window.contextReadings ?? [])].forEach(
      (reading) => {
        const candidate = snapshot(reading);
        const existing = recordMap.get(candidate.id);
        invariant(
          !existing || canonicalString(existing) === canonicalString(candidate),
          `Record ${candidate.id} has conflicting content.`,
        );
        recordMap.set(candidate.id, candidate);
      },
    );
  });
  const records = [...recordMap.values()].sort(recordSort);

  const windows: GlucoseAnswerWindowV2[] = input.windows.map((window) => {
    const calculationRange = { ...window.calculationRange };
    const evidenceContextRange = {
      ...(window.evidenceContextRange ?? window.calculationRange),
    };
    const calculationRecordIds = orderedIds(
      window.calculationReadings.map(({ id }) => id),
      records,
    );
    const calculationSet = new Set(calculationRecordIds);
    const contextRecordIds = orderedIds(
      (window.contextReadings ?? [])
        .map(({ id }) => id)
        .filter((id) => !calculationSet.has(id)),
      records,
    );
    const observationIntervals = window.observationIntervals.map(
      (interval) => ({
        start: interval.start,
        end: interval.end,
        mmolL: interval.mmolL,
        recordIds: [...interval.recordIds],
      }),
    );
    return {
      id: window.id,
      label: window.label,
      role: window.role,
      calculationRange,
      evidenceContextRange,
      calculationRecordIds,
      contextRecordIds,
      observationIntervals,
      coverage: coverageFor([calculationRange], observationIntervals),
    };
  });
  const thresholds = canonicalThresholds(input.normalizedThresholds);
  const scope = {
    timezone: input.timezone,
    asOf: input.asOf,
    calculationRange: envelope(
      windows.map(({ calculationRange }) => calculationRange),
    ),
    evidenceContextRange: envelope(
      windows.map(({ evidenceContextRange }) => evidenceContextRange),
    ),
    windows,
  } as const;
  const normalizedIntent = normalizeIntent(input.originalIntent, thresholds);
  const claims: GlucoseAnswerClaimV2[] = input.claims.map((claim) => {
    const calculationIds = orderedIds(
      idsForWindows(windows, claim.windowIds, "calculationRecordIds"),
      records,
    );
    const contextPolicy = claim.metric.endsWith("_episodes")
      ? ("episode-boundary-classification-only" as const)
      : ("none" as const);
    const contextIds =
      contextPolicy === "episode-boundary-classification-only"
        ? orderedIds(
            idsForWindows(windows, claim.windowIds, "contextRecordIds"),
            records,
          )
        : [];
    return {
      id: claim.id,
      metric: claim.metric,
      value: claim.value,
      unit: claim.unit,
      status: calculationIds.length > 0 ? "available" : "unavailable",
      windowIds: [...claim.windowIds],
      calculationRecordIds: calculationIds,
      contextRecordIds: contextIds,
      contextPolicy,
      coverage: claimCoverage(windows, claim.windowIds),
    };
  });
  const charts: GlucoseAnswerChartReferenceV2[] = (input.charts ?? []).map(
    (chart) => {
      const selected = new Set(chart.windowIds);
      const chartWindows = windows.filter((window) => selected.has(window.id));
      const availableIds = idsForWindows(
        windows,
        chart.windowIds,
        "calculationRecordIds",
      );
      return {
        id: chart.id,
        kind: chart.kind,
        sourceReferenceId: chart.sourceReferenceId,
        windowIds: [...chart.windowIds],
        range: envelope(
          chartWindows.map(({ calculationRange }) => calculationRange),
        ),
        recordIds: orderedIds(chart.recordIds ?? availableIds, records),
      };
    },
  );
  const overallCoverage = coverageFor(
    windows.map(({ calculationRange }) => calculationRange),
    windows.flatMap(({ observationIntervals }) => observationIntervals),
  );
  const withoutIdentity: Omit<GlucoseAnswerBundleV2, "identity"> = {
    schemaVersion: GLUCOSE_ANSWER_BUNDLE_SCHEMA_VERSION,
    kind: "glucose-answer-bundle",
    executor: input.executor,
    intent: {
      original: recursiveClone(input.originalIntent),
      normalized: normalizedIntent,
    },
    scope,
    thresholds,
    algorithms: recursiveClone(input.algorithms),
    coverage: {
      ...overallCoverage,
      requestedWindowCount: windows.length,
      windowsWithData: windows.filter(
        ({ calculationRecordIds }) => calculationRecordIds.length > 0,
      ).length,
    },
    records,
    claims,
    charts,
    safeguards: {
      halfOpenCalculationWindows: true,
      missingData: "omitted-not-zero",
      sampleNormalization:
        "same-timestamp-records-averaged-before-sample-statistics",
      contextData:
        "excluded-from-aggregate-metrics-boundary-classification-only",
      chartsUseCalculationScopeOnly: true,
      zeroRequiresObservedData: true,
    },
  };
  const baseIdentity = identityBase(withoutIdentity);
  const bundle: GlucoseAnswerBundleV2 = {
    ...withoutIdentity,
    identity: {
      ...baseIdentity,
      integrityId: integrityId(withoutIdentity),
    },
  };
  assertGlucoseAnswerBundleV2(bundle);
  return deepFreeze(bundle);
}

/** Runtime validation for newly constructed and deserialized bundles. */
export function assertGlucoseAnswerBundleV2(
  value: unknown,
): asserts value is GlucoseAnswerBundleV2 {
  invariant(isRecord(value), "Bundle must be an object.");
  invariant(
    value.schemaVersion === GLUCOSE_ANSWER_BUNDLE_SCHEMA_VERSION &&
      value.kind === "glucose-answer-bundle",
    "Bundle schema or kind is not V2.",
  );
  invariant(
    value.executor === "recurring-clock" || value.executor === "exact-range",
    "Bundle executor is invalid.",
  );
  invariant(isRecord(value.intent), "Bundle intent is missing.");
  invariant(isRecord(value.scope), "Bundle scope is missing.");
  invariant(Array.isArray(value.thresholds), "Bundle thresholds are missing.");
  invariant(isRecord(value.algorithms), "Bundle algorithms are missing.");
  invariant(isRecord(value.coverage), "Bundle coverage is missing.");
  invariant(Array.isArray(value.records), "Bundle records are missing.");
  invariant(Array.isArray(value.claims), "Bundle claims are missing.");
  invariant(Array.isArray(value.charts), "Bundle charts are missing.");
  invariant(isRecord(value.safeguards), "Bundle safeguards are missing.");
  invariant(isRecord(value.identity), "Bundle identity is missing.");
  const bundle = value as unknown as GlucoseAnswerBundleV2;

  const originalValidation = validateTarvisIntentV1(bundle.intent.original);
  invariant(
    originalValidation.valid,
    `Bundle original intent is invalid: ${originalValidation.errors.join("; ")}`,
  );
  invariant(
    bundle.intent.original.domain.value === "glucose",
    "Intent is not glucose.",
  );
  invariant(
    Array.isArray(bundle.intent.normalized.metrics) &&
      bundle.intent.normalized.metrics.length > 0 &&
      new Set(bundle.intent.normalized.metrics).size ===
        bundle.intent.normalized.metrics.length &&
      bundle.intent.normalized.metrics.every((metric) =>
        GLUCOSE_ANSWER_METRICS.has(metric),
      ) &&
      bundle.intent.original.metrics.every(({ value: metric }) =>
        GLUCOSE_ANSWER_METRICS.has(metric),
      ),
    "Bundle contains an unsupported or duplicate V2 glucose metric.",
  );
  invariant(
    Array.isArray(bundle.scope.windows),
    "Bundle calculation windows are missing.",
  );
  invariant(
    isIanaTimeZone(bundle.scope.timezone),
    "Bundle timezone is invalid.",
  );
  invariant(
    Number.isFinite(bundle.scope.asOf) && bundle.scope.asOf >= 0,
    "Bundle asOf is invalid.",
  );
  invariant(
    bundle.scope.windows.length > 0,
    "Bundle has no calculation windows.",
  );
  assertRange(bundle.scope.calculationRange, "Calculation range");
  assertRange(bundle.scope.evidenceContextRange, "Evidence-context range");
  invariant(
    bundle.scope.evidenceContextRange.start <=
      bundle.scope.calculationRange.start &&
      bundle.scope.evidenceContextRange.end >=
        bundle.scope.calculationRange.end,
    "The evidence-context range must contain the calculation range.",
  );
  invariant(
    canonicalString(bundle.thresholds) ===
      canonicalString(canonicalThresholds(bundle.thresholds)),
    "Thresholds are not canonical.",
  );
  invariant(
    canonicalString(bundle.thresholds) ===
      canonicalString(expectedThresholds(bundle.intent.original)),
    "Normalized thresholds do not reproduce the original intent.",
  );
  invariant(
    canonicalString(bundle.intent.normalized) ===
      canonicalString(
        normalizeIntent(bundle.intent.original, bundle.thresholds),
      ),
    "Normalized intent does not reproduce the original intent.",
  );
  invariant(
    typeof bundle.algorithms.answerVersion === "string" &&
      bundle.algorithms.answerVersion.trim() &&
      bundle.algorithms.coverageVersion ===
        "forward-observation-capped-at-gap-v1",
    "Answer or coverage algorithm version is invalid.",
  );
  invariant(
    Array.isArray(bundle.algorithms.metricVersions) &&
      Array.isArray(bundle.algorithms.chartVersions),
    "Metric or chart algorithm versions are missing.",
  );
  invariant(
    Number.isFinite(bundle.algorithms.maximumObservedGapMilliseconds) &&
      bundle.algorithms.maximumObservedGapMilliseconds > 0,
    "Maximum observation gap is invalid.",
  );
  invariant(
    bundle.algorithms.observationValuePrecisionDecimals === null ||
      (Number.isInteger(bundle.algorithms.observationValuePrecisionDecimals) &&
        bundle.algorithms.observationValuePrecisionDecimals >= 0 &&
        bundle.algorithms.observationValuePrecisionDecimals <= 6),
    "Observation precision is invalid.",
  );
  const metricVersionIds = new Set<GlucoseAnswerMetricV2>();
  invariant(
    bundle.algorithms.metricVersions.length ===
      bundle.intent.normalized.metrics.length &&
      bundle.algorithms.metricVersions.every((entry) => {
        if (
          !isRecord(entry) ||
          typeof entry.metric !== "string" ||
          typeof entry.version !== "string"
        ) {
          return false;
        }
        const metric = entry.metric as GlucoseAnswerMetricV2;
        const version = entry.version;
        if (
          !GLUCOSE_ANSWER_METRICS.has(metric) ||
          !bundle.intent.normalized.metrics.includes(metric) ||
          metricVersionIds.has(metric) ||
          !version.trim()
        ) {
          return false;
        }
        metricVersionIds.add(metric);
        return true;
      }),
    "Metric algorithm versions do not cover the normalized intent exactly.",
  );
  const needsEpisodeVersion = bundle.intent.normalized.metrics.some((metric) =>
    metric.endsWith("_episodes"),
  );
  invariant(
    needsEpisodeVersion
      ? bundle.algorithms.episodeDefinitionVersion ===
          GLUCOSE_EPISODE_DEFINITION_VERSION
      : bundle.algorithms.episodeDefinitionVersion === null,
    "Episode algorithm version does not match the requested metrics.",
  );
  invariant(
    new Set(bundle.algorithms.chartVersions).size ===
      bundle.algorithms.chartVersions.length &&
      bundle.algorithms.chartVersions.every(
        (version) =>
          typeof version === "string" &&
          version.trim() &&
          GLUCOSE_CHART_KINDS.has(version),
      ),
    "Chart algorithm versions are invalid.",
  );

  const recordIds = new Set<string>();
  let previousRecord: GlucoseAnswerRecordV2 | undefined;
  bundle.records.forEach((record) => {
    invariant(isRecord(record), "Bundle records must be objects.");
    invariant(
      typeof record.id === "string" && typeof record.sourceId === "string",
      "Bundle record identity fields are invalid.",
    );
    invariant(
      record.id.trim() && !recordIds.has(record.id),
      "Record IDs must be unique.",
    );
    invariant(
      Number.isFinite(record.timestamp) && record.timestamp >= 0,
      `Record ${record.id} has an invalid timestamp.`,
    );
    invariant(
      Number.isFinite(record.receivedAt) && record.receivedAt >= 0,
      `Record ${record.id} has an invalid received time.`,
    );
    invariant(
      Number.isFinite(record.mmolL) && record.mmolL > 0,
      `Record ${record.id} has an invalid glucose value.`,
    );
    invariant(record.sourceId.trim(), `Record ${record.id} has no source.`);
    invariant(
      [
        "doubleDown",
        "down",
        "slightDown",
        "flat",
        "slightUp",
        "up",
        "doubleUp",
        "unknown",
      ].includes(record.trend) &&
        (record.quality === "measured" || record.quality === "estimated"),
      `Record ${record.id} has invalid trend or quality metadata.`,
    );
    invariant(
      [
        record.sourceFactoryTimestamp,
        record.sourceLocalTimestamp,
        record.sourceFile,
        record.sourceDeviceId,
      ].every((item) => item === null || typeof item === "string") &&
        [
          record.timestampDiscrepancyMinutes,
          record.importedAt,
          record.sourceRow,
        ].every((item) => item === null || Number.isFinite(item)),
      `Record ${record.id} has invalid source metadata.`,
    );
    invariant(
      !previousRecord || recordSort(previousRecord, record) < 0,
      "Bundle records are not in canonical order.",
    );
    recordIds.add(record.id);
    previousRecord = record;
  });
  const recordById = new Map(
    bundle.records.map((record) => [record.id, record]),
  );

  const windowIds = new Set<string>();
  bundle.scope.windows.forEach((window) => {
    invariant(
      window !== null &&
        typeof window === "object" &&
        !Array.isArray(window) &&
        typeof window.id === "string" &&
        typeof window.label === "string" &&
        ["requested", "comparison", "occurrence"].includes(window.role) &&
        Array.isArray(window.calculationRecordIds) &&
        Array.isArray(window.contextRecordIds) &&
        Array.isArray(window.observationIntervals) &&
        window.coverage !== null &&
        typeof window.coverage === "object" &&
        !Array.isArray(window.coverage),
      "Bundle calculation window shape is invalid.",
    );
    invariant(
      window.id.trim() && !windowIds.has(window.id),
      "Window IDs must be unique.",
    );
    invariant(window.label.trim(), `Window ${window.id} has no label.`);
    const calculationRecordIds = window.calculationRecordIds as string[];
    const contextRecordIds = window.contextRecordIds as string[];
    windowIds.add(window.id);
    assertRange(
      window.calculationRange,
      `Window ${window.id} calculation range`,
    );
    assertRange(
      window.evidenceContextRange,
      `Window ${window.id} context range`,
    );
    invariant(
      window.evidenceContextRange.start <= window.calculationRange.start &&
        window.evidenceContextRange.end >= window.calculationRange.end,
      `Window ${window.id} context does not contain its calculation range.`,
    );
    invariant(
      new Set(calculationRecordIds).size === calculationRecordIds.length,
      `Window ${window.id} has duplicate calculation record IDs.`,
    );
    invariant(
      new Set(contextRecordIds).size === contextRecordIds.length,
      `Window ${window.id} has duplicate context record IDs.`,
    );
    invariant(
      canonicalString(calculationRecordIds) ===
        canonicalString(orderedIds(calculationRecordIds, bundle.records)) &&
        canonicalString(contextRecordIds) ===
          canonicalString(orderedIds(contextRecordIds, bundle.records)),
      `Window ${window.id} record IDs are not in canonical order.`,
    );
    const calculationIds = new Set(calculationRecordIds);
    calculationRecordIds.forEach((id) => {
      const record = recordById.get(id);
      invariant(
        record,
        `Window ${window.id} calculation record ${id} is missing.`,
      );
      invariant(
        record.timestamp >= window.calculationRange.start &&
          record.timestamp < window.calculationRange.end,
        `Calculation record ${id} is outside window ${window.id}.`,
      );
    });
    contextRecordIds.forEach((id) => {
      const record = recordById.get(id);
      invariant(record, `Window ${window.id} context record ${id} is missing.`);
      invariant(
        !calculationIds.has(id),
        `Window ${window.id} context overlaps calculation IDs.`,
      );
      invariant(
        record.timestamp >= window.evidenceContextRange.start &&
          record.timestamp < window.evidenceContextRange.end,
        `Context record ${id} is outside window ${window.id} evidence range.`,
      );
      invariant(
        record.timestamp < window.calculationRange.start ||
          record.timestamp >= window.calculationRange.end,
        `Context record ${id} is inside window ${window.id} calculation range.`,
      );
    });
    const scopedRecords = calculationRecordIds.map((id) => recordById.get(id)!);
    const recomputedIntervals = observationIntervalsFromRecords(
      scopedRecords,
      window.calculationRange,
      bundle.algorithms.maximumObservedGapMilliseconds,
      bundle.algorithms.observationValuePrecisionDecimals,
    );
    invariant(
      canonicalString(window.observationIntervals) ===
        canonicalString(recomputedIntervals),
      `Window ${window.id} observation intervals are not reproducible.`,
    );
    const recomputedCoverage = coverageFor(
      [window.calculationRange],
      recomputedIntervals,
    );
    invariant(
      canonicalString(window.coverage) === canonicalString(recomputedCoverage),
      `Window ${window.id} coverage is not reproducible.`,
    );
  });
  invariant(
    sameRange(
      bundle.scope.calculationRange,
      envelope(
        bundle.scope.windows.map(({ calculationRange }) => calculationRange),
      ),
    ),
    "Bundle calculation range is not the exact window envelope.",
  );
  invariant(
    sameRange(
      bundle.scope.evidenceContextRange,
      envelope(
        bundle.scope.windows.map(
          ({ evidenceContextRange }) => evidenceContextRange,
        ),
      ),
    ),
    "Bundle evidence-context range is not the exact context envelope.",
  );
  const recomputedOverallCoverage = coverageFor(
    bundle.scope.windows.map(({ calculationRange }) => calculationRange),
    bundle.scope.windows.flatMap(
      ({ observationIntervals }) => observationIntervals,
    ),
  );
  invariant(
    bundle.coverage.expectedMilliseconds ===
      recomputedOverallCoverage.expectedMilliseconds &&
      bundle.coverage.observedMilliseconds ===
        recomputedOverallCoverage.observedMilliseconds &&
      bundle.coverage.percent === recomputedOverallCoverage.percent &&
      bundle.coverage.requestedWindowCount === bundle.scope.windows.length &&
      bundle.coverage.windowsWithData ===
        bundle.scope.windows.filter(
          ({ calculationRecordIds }) => calculationRecordIds.length,
        ).length,
    "Bundle coverage is not reproducible.",
  );
  const referencedRecordIds = new Set(
    bundle.scope.windows.flatMap((window) => [
      ...window.calculationRecordIds,
      ...window.contextRecordIds,
    ]),
  );
  invariant(
    bundle.records.every(({ id }) => referencedRecordIds.has(id)),
    "Bundle contains a record that is not tied to a calculation or context window.",
  );

  const claimIds = new Set<string>();
  bundle.claims.forEach((claim) => {
    invariant(
      isRecord(claim) &&
        typeof claim.id === "string" &&
        typeof claim.metric === "string" &&
        GLUCOSE_ANSWER_METRICS.has(claim.metric) &&
        (claim.value === null || Number.isFinite(claim.value)) &&
        Array.isArray(claim.windowIds) &&
        Array.isArray(claim.calculationRecordIds) &&
        Array.isArray(claim.contextRecordIds) &&
        isRecord(claim.coverage),
      "Bundle claim shape or value is invalid.",
    );
    invariant(
      claim.id.trim() && !claimIds.has(claim.id),
      "Claim IDs must be unique.",
    );
    claimIds.add(claim.id);
    invariant(
      bundle.intent.normalized.metrics.includes(claim.metric),
      `Claim ${claim.id} is not requested by the normalized intent.`,
    );
    invariant(
      claim.windowIds.length > 0 &&
        new Set(claim.windowIds).size === claim.windowIds.length &&
        claim.windowIds.every((id) => windowIds.has(id)),
      `Claim ${claim.id} has invalid windows.`,
    );
    const expectedCalculationIds = orderedIds(
      idsForWindows(
        bundle.scope.windows,
        claim.windowIds,
        "calculationRecordIds",
      ),
      bundle.records,
    );
    invariant(
      canonicalString(claim.calculationRecordIds) ===
        canonicalString(expectedCalculationIds),
      `Claim ${claim.id} does not retain every exact calculation record ID.`,
    );
    const isEpisode = claim.metric.endsWith("_episodes");
    const expectedContextIds = isEpisode
      ? orderedIds(
          idsForWindows(
            bundle.scope.windows,
            claim.windowIds,
            "contextRecordIds",
          ),
          bundle.records,
        )
      : [];
    invariant(
      canonicalString(claim.contextRecordIds) ===
        canonicalString(expectedContextIds) &&
        claim.contextPolicy ===
          (isEpisode ? "episode-boundary-classification-only" : "none"),
      `Claim ${claim.id} has an invalid context policy.`,
    );
    const expectedUnit =
      claim.metric === "glucose.mean" ||
      claim.metric === "glucose.median" ||
      claim.metric === "glucose.minimum" ||
      claim.metric === "glucose.maximum" ||
      claim.metric === "glucose.standard_deviation"
        ? "mmol/L"
        : claim.metric === "glucose.time_in_range" ||
            claim.metric === "glucose.coefficient_of_variation" ||
            claim.metric === "glucose.gmi"
          ? "%"
          : claim.metric === "glucose.low_readings" ||
              claim.metric === "glucose.high_readings"
            ? "readings"
            : "events";
    invariant(
      claim.unit === expectedUnit,
      `Claim ${claim.id} has the wrong unit.`,
    );
    const expectedStatus = claim.calculationRecordIds.length
      ? "available"
      : "unavailable";
    invariant(
      claim.status === expectedStatus &&
        (expectedStatus === "unavailable"
          ? claim.value === null
          : claim.value !== null),
      `Claim ${claim.id} confuses zero with unavailable data.`,
    );
    invariant(
      canonicalString(claim.coverage) ===
        canonicalString(claimCoverage(bundle.scope.windows, claim.windowIds)),
      `Claim ${claim.id} coverage is not reproducible.`,
    );
    const expectedValue = recomputeClaim(bundle, claim);
    invariant(
      expectedValue === claim.value,
      `Claim ${claim.id} value is not reproducible from its exact records.`,
    );
  });
  bundle.intent.normalized.metrics.forEach((metric) => {
    bundle.scope.windows.forEach((window) => {
      invariant(
        bundle.claims.filter(
          (claim) =>
            claim.metric === metric && claim.windowIds.includes(window.id),
        ).length === 1,
        `Metric ${metric} must have exactly one claim covering window ${window.id}.`,
      );
    });
  });

  const chartIds = new Set<string>();
  bundle.charts.forEach((chart) => {
    invariant(
      isRecord(chart) &&
        typeof chart.id === "string" &&
        typeof chart.kind === "string" &&
        GLUCOSE_CHART_KINDS.has(chart.kind) &&
        typeof chart.sourceReferenceId === "string" &&
        Array.isArray(chart.windowIds) &&
        Array.isArray(chart.recordIds),
      "Bundle chart shape or kind is invalid.",
    );
    invariant(
      chart.id.trim() && !chartIds.has(chart.id),
      "Chart IDs must be unique.",
    );
    chartIds.add(chart.id);
    invariant(
      chart.kind.trim() && chart.sourceReferenceId.trim(),
      `Chart ${chart.id} is invalid.`,
    );
    invariant(
      chart.windowIds.length > 0 &&
        new Set(chart.windowIds).size === chart.windowIds.length &&
        chart.windowIds.every((id) => windowIds.has(id)),
      `Chart ${chart.id} has invalid windows.`,
    );
    const selected = new Set(chart.windowIds);
    const exactRange = envelope(
      bundle.scope.windows
        .filter((window) => selected.has(window.id))
        .map(({ calculationRange }) => calculationRange),
    );
    invariant(
      sameRange(chart.range, exactRange),
      `Chart ${chart.id} does not match its calculation scope.`,
    );
    const exactRecordIds = orderedIds(
      idsForWindows(
        bundle.scope.windows,
        chart.windowIds,
        "calculationRecordIds",
      ),
      bundle.records,
    );
    invariant(
      canonicalString(chart.recordIds) === canonicalString(exactRecordIds),
      `Chart ${chart.id} is incomplete or references context/out-of-scope records.`,
    );
  });
  invariant(
    canonicalString(
      [...new Set(bundle.charts.map(({ kind }) => kind))].sort(),
    ) === canonicalString([...bundle.algorithms.chartVersions].sort()),
    "Chart versions do not match the retained chart references.",
  );

  invariant(
    bundle.safeguards.halfOpenCalculationWindows === true &&
      bundle.safeguards.missingData === "omitted-not-zero" &&
      bundle.safeguards.sampleNormalization ===
        "same-timestamp-records-averaged-before-sample-statistics" &&
      bundle.safeguards.contextData ===
        "excluded-from-aggregate-metrics-boundary-classification-only" &&
      bundle.safeguards.chartsUseCalculationScopeOnly === true &&
      bundle.safeguards.zeroRequiresObservedData === true,
    "Bundle safeguards are incomplete.",
  );
  const { identity, ...withoutIdentity } = bundle;
  const expectedIdentity = identityBase(withoutIdentity);
  invariant(
    identity.algorithm === GLUCOSE_ANSWER_BUNDLE_IDENTITY_ALGORITHM &&
      identity.queryId === expectedIdentity.queryId &&
      identity.dataRevisionId === expectedIdentity.dataRevisionId &&
      identity.integrityId === integrityId(withoutIdentity),
    "Bundle integrity or data-revision identity does not match its content.",
  );
}

export function isGlucoseAnswerBundleV2(
  value: unknown,
): value is GlucoseAnswerBundleV2 {
  try {
    assertGlucoseAnswerBundleV2(value);
    return true;
  } catch {
    return false;
  }
}

/**
 * Deserialised JSON is mutable even when its original factory result was
 * frozen. Parse through this boundary before replay so validation and deep
 * immutability are restored together.
 */
export function parseGlucoseAnswerBundleV2(
  value: unknown,
): GlucoseAnswerBundleV2 {
  const cloned = recursiveClone(value);
  assertGlucoseAnswerBundleV2(cloned);
  return deepFreeze(cloned);
}
