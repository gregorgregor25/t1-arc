import {
  openT1ArcDatabase,
  withT1ArcTransaction,
} from "@/data/persistence/t1arcDatabase";
import { compactTarvisEvidence } from "@/data/tarvis/evidenceCompaction";
import {
  type GlucoseAnswerBundleV2,
  isGlucoseAnswerBundleV2,
  parseGlucoseAnswerBundleV2,
} from "@/data/tarvis/glucoseAnswerBundleV2";
import { isTarvisIntentV1, type TarvisIntentV1 } from "@/data/tarvis/intent";
import { isTarvisDirectAnswerPresentation } from "@/data/tarvis/directAnswerPresentation";
import {
  isTarvisEvidencePresentation,
  type TarvisEvidencePresentation,
} from "@/data/tarvis/evidencePresentation";
import type {
  TarvisAnswer,
  TarvisGuidanceReference,
  TarvisRequestMetrics,
} from "@/data/tarvis/types";
import {
  acquireLocalDataWriteLease,
  assertLocalDataWriteLeaseInTransaction,
  type LocalDataWriteLease,
} from "@/data/privacy/localDataWriteEpoch";
import { isEvidenceClockWindowVisualizationReference } from "@/domain/evidenceClockWindowValidation";
import {
  evidenceQueryChartPointRecordIds,
  isEvidenceQueryVisualizationReference,
  MAX_EVIDENCE_QUERY_CHART_POINTS,
  type EvidenceQueryVisualizationReference,
} from "@/domain/evidenceQueryChart";
import type { EvidenceReference } from "@/domain/insights";

export const TARVIS_CONVERSATION_STORAGE_KEY = "tarvis-conversation-v1";
const STORAGE_KEY = TARVIS_CONVERSATION_STORAGE_KEY;
export const MAX_STORED_TARVIS_EXCHANGES = 30;
/** Hard upper bound for the single metadata row after chart compaction. */
export const MAX_STORED_TARVIS_CONVERSATION_BYTES = 24 * 1024 * 1024;

export type TarvisConversationScope =
  | {
      kind: "live";
      identity: string;
      dataMode: string;
      ownerIdentity: string;
      accountId?: string;
    }
  | {
      kind: "review";
      identity: string;
      dataMode: string;
      ownerIdentity: string;
      currentRange: { start: number; end: number };
      previousRange: { start: number; end: number };
      accountId?: string;
    }
  | {
      /** Migrated conversations stay readable but never enter a new scope. */
      kind: "legacy-unknown";
      identity: "legacy-unknown";
    };

const METRIC_UNITS = new Map<string, string>([
  ["glucose.mean", "mmol/L"],
  ["glucose.median", "mmol/L"],
  ["glucose.minimum", "mmol/L"],
  ["glucose.maximum", "mmol/L"],
  ["glucose.standard_deviation", "mmol/L"],
  ["glucose.coefficient_of_variation", "%"],
  ["glucose.gmi", "%"],
  ["glucose.time_in_range", "%"],
  ["glucose.low_episodes", "events"],
  ["glucose.high_episodes", "events"],
  ["glucose.low_readings", "readings"],
  ["glucose.high_readings", "readings"],
]);

const CHART_KINDS = new Set([
  "recurring-clock-overlay-v1",
  "range-trace-v1",
  "period-comparison-v1",
  "range-distribution-v1",
  "event-timeline-v1",
]);

export interface StoredTarvisExchange {
  id: string;
  /** Groups exchanges into a user-visible conversation thread. */
  threadId?: string;
  question: string;
  answer: TarvisAnswer;
  evidence: EvidenceReference[];
  clarificationQuestion?: string;
  intent?: TarvisIntentV1;
  presentation?: TarvisEvidencePresentation;
  requestMetrics?: TarvisRequestMetrics;
  /** Independent of requestMetrics: a request can be sent but rejected locally. */
  modelRequestSent?: boolean;
  /** Identifies the origin of the prose shown to the user. */
  answerSource?: "hosted" | "local";
  /** Independently prevents a composite personal answer being sent later. */
  modelSharing?: "local-only";
  /** Locally selected, reviewed sources supporting displayed guidance. */
  guidanceSources?: TarvisGuidanceReference[];
  /** Present on every newly generated deterministic local glucose answer. */
  answerBundle?: GlucoseAnswerBundleV2;
  /** Allows schema-v1/v2 local answers to survive a schema-v3 resave. */
  legacyBundleUnavailable?: true;
  /** Optional only so schema-v1/v2/v3 documents can be migrated safely. */
  createdAt?: number;
  /** Optional only so pre-scope documents can be migrated fail-closed. */
  scope?: TarvisConversationScope;
}

export type LoadedStoredTarvisExchange = StoredTarvisExchange & {
  createdAt: number;
  scope: TarvisConversationScope;
  threadId: string;
};

export type TarvisConversationLoadResult =
  | { status: "missing"; exchanges: [] }
  | { status: "loaded"; exchanges: LoadedStoredTarvisExchange[] }
  | { status: "corrupt"; exchanges: []; message: string };

interface StoredTarvisConversation {
  schemaVersion: 1 | 2 | 3;
  updatedAt: number;
  exchanges: StoredTarvisExchange[];
}

export class TarvisConversationStorageLimitError extends Error {
  readonly code = "tarvis-conversation-storage-limit";

  constructor(message: string) {
    super(message);
    this.name = "TarvisConversationStorageLimitError";
  }
}

export class TarvisConversationCorruptError extends Error {
  readonly code = "tarvis-conversation-corrupt";

  constructor() {
    super(
      "The unreadable Tarv1s conversation must be removed explicitly before a new conversation can be saved.",
    );
    this.name = "TarvisConversationCorruptError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && Boolean(value.trim());
}

function validStoredRange(value: unknown) {
  return (
    isRecord(value) &&
    finite(value.start) &&
    finite(value.end) &&
    value.start >= 0 &&
    value.end > value.start
  );
}

function validConversationScope(
  value: unknown,
): value is TarvisConversationScope {
  if (
    !isRecord(value) ||
    !nonEmptyString(value.identity) ||
    (value.kind !== "legacy-unknown" &&
      (!nonEmptyString(value.dataMode) || !nonEmptyString(value.ownerIdentity)))
  ) {
    return false;
  }
  if (value.accountId !== undefined && !nonEmptyString(value.accountId)) {
    return false;
  }
  if (value.kind === "live") return value.identity !== "legacy-unknown";
  if (value.kind === "legacy-unknown") {
    return (
      value.identity === "legacy-unknown" &&
      value.accountId === undefined &&
      value.dataMode === undefined &&
      value.ownerIdentity === undefined
    );
  }
  return (
    value.kind === "review" &&
    validStoredRange(value.currentRange) &&
    validStoredRange(value.previousRange)
  );
}

function validLegacyConversationScope(value: unknown) {
  if (
    !isRecord(value) ||
    !nonEmptyString(value.identity) ||
    value.dataMode !== undefined ||
    value.ownerIdentity !== undefined ||
    (value.accountId !== undefined && !nonEmptyString(value.accountId))
  ) {
    return false;
  }
  if (value.kind === "live") return true;
  return (
    value.kind === "review" &&
    validStoredRange(value.currentRange) &&
    validStoredRange(value.previousRange)
  );
}

function migratableConversationScope(value: unknown) {
  return (
    value === undefined ||
    validConversationScope(value) ||
    validLegacyConversationScope(value)
  );
}

export function sameTarvisConversationScope(
  left: TarvisConversationScope,
  right: TarvisConversationScope,
) {
  if (left.kind === "legacy-unknown" || right.kind === "legacy-unknown") {
    return false;
  }
  if (
    left.kind === right.kind &&
    left.identity === right.identity &&
    left.dataMode === right.dataMode &&
    left.ownerIdentity === right.ownerIdentity &&
    left.accountId === right.accountId
  ) {
    if (left.kind === "live" && right.kind === "live") return true;
    if (left.kind === "review" && right.kind === "review") {
      return (
        left.currentRange.start === right.currentRange.start &&
        left.currentRange.end === right.currentRange.end &&
        left.previousRange.start === right.previousRange.start &&
        left.previousRange.end === right.previousRange.end
      );
    }
  }
  return false;
}

const UNBOUND_GLOOKO_OWNER_SUFFIX = "|glooko:none";
const VERIFIED_GLOOKO_OWNER_SUFFIX = /\|glooko:af1_[0-9a-f]{64}$/i;

/**
 * A first successful Glooko verification strengthens the identity of the
 * existing local dataset; it does not switch to a different dataset. This
 * narrowly-scoped transition may adopt the existing conversation so a
 * background verification cannot make a visible answer disappear. Any other
 * owner/source/account transition remains isolated.
 */
export function canUpgradeTarvisConversationScope(
  previous: TarvisConversationScope,
  next: TarvisConversationScope,
) {
  if (previous.kind === "legacy-unknown" || next.kind === "legacy-unknown") {
    return false;
  }
  if (
    previous.kind !== next.kind ||
    previous.dataMode !== next.dataMode ||
    previous.accountId !== next.accountId ||
    !previous.ownerIdentity.endsWith(UNBOUND_GLOOKO_OWNER_SUFFIX)
  ) {
    return false;
  }
  const ownerPrefix = previous.ownerIdentity.slice(
    0,
    -UNBOUND_GLOOKO_OWNER_SUFFIX.length,
  );
  if (
    !next.ownerIdentity.startsWith(`${ownerPrefix}|glooko:`) ||
    !VERIFIED_GLOOKO_OWNER_SUFFIX.test(next.ownerIdentity)
  ) {
    return false;
  }
  if (
    previous.identity.replace(previous.ownerIdentity, next.ownerIdentity) !==
    next.identity
  ) {
    return false;
  }
  if (previous.kind === "live" && next.kind === "live") return true;
  return (
    previous.kind === "review" &&
    next.kind === "review" &&
    previous.currentRange.start === next.currentRange.start &&
    previous.currentRange.end === next.currentRange.end &&
    previous.previousRange.start === next.previousRange.start &&
    previous.previousRange.end === next.previousRange.end
  );
}

function uniqueStrings(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.every(nonEmptyString) &&
    new Set(value).size === value.length
  );
}

function sameOrderedStrings(left: readonly string[], right: readonly string[]) {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function sameStringSet(left: readonly string[], right: readonly string[]) {
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  return (
    left.length === right.length &&
    leftSet.size === left.length &&
    rightSet.size === right.length &&
    left.every((value) => rightSet.has(value))
  );
}

function sameRange(
  left: { start: number; end: number },
  right: { start: number; end: number },
) {
  return left.start === right.start && left.end === right.end;
}

function containsRange(
  container: { start: number; end: number },
  nested: { start: number; end: number },
) {
  return container.start <= nested.start && container.end >= nested.end;
}

function validAnswer(value: unknown): value is TarvisAnswer {
  if (!isRecord(value)) return false;
  return (
    nonEmptyString(value.headline) &&
    nonEmptyString(value.answer) &&
    (value.confidence === "high" ||
      value.confidence === "moderate" ||
      value.confidence === "limited") &&
    uniqueStrings(value.evidenceIds) &&
    Array.isArray(value.limitations) &&
    value.limitations.every((item) => typeof item === "string") &&
    (value.directPresentation === undefined ||
      isTarvisDirectAnswerPresentation(value.directPresentation))
  );
}

function validGuidanceReference(
  value: unknown,
): value is TarvisGuidanceReference {
  if (!isRecord(value)) return false;
  return (
    nonEmptyString(value.knowledgeId) &&
    value.jurisdiction === "UK" &&
    nonEmptyString(value.sourceTitle) &&
    nonEmptyString(value.sourceUrl) &&
    value.sourceUrl.startsWith("https://www.nice.org.uk/") &&
    uniqueStrings(value.recommendationRefs) &&
    value.recommendationRefs.length > 0 &&
    nonEmptyString(value.reviewedAt) &&
    /^\d{4}-\d{2}-\d{2}$/.test(value.reviewedAt)
  );
}

function validGuidanceReferences(value: unknown) {
  if (!Array.isArray(value)) return false;
  const references = value.filter(validGuidanceReference);
  return (
    references.length === value.length &&
    new Set(references.map(({ knowledgeId }) => knowledgeId)).size ===
      references.length
  );
}

function validCalculation(value: unknown) {
  if (!isRecord(value)) return false;
  const metrics = Array.isArray(value.metrics) ? value.metrics : [];
  const metricIds = new Set<string>();
  const thresholds = Array.isArray(value.thresholds) ? value.thresholds : [];
  const thresholdRoles = new Set<string>();
  return (
    value.kind === "tarvis-local-glucose-v1" &&
    nonEmptyString(value.queryId) &&
    nonEmptyString(value.algorithmVersion) &&
    metrics.length > 0 &&
    metrics.every((metric) => {
      if (!isRecord(metric) || !nonEmptyString(metric.id)) return false;
      const expectedUnit = METRIC_UNITS.get(metric.id);
      if (
        !expectedUnit ||
        metricIds.has(metric.id) ||
        (metric.value !== null && !finite(metric.value)) ||
        metric.unit !== expectedUnit
      ) {
        return false;
      }
      metricIds.add(metric.id);
      return true;
    }) &&
    thresholds.every((threshold) => {
      if (
        !isRecord(threshold) ||
        !["lt", "lte", "gt", "gte"].includes(String(threshold.operator)) ||
        !["low", "high", "range_lower", "range_upper"].includes(
          String(threshold.role),
        ) ||
        thresholdRoles.has(String(threshold.role)) ||
        threshold.unit !== "mmol/L" ||
        !finite(threshold.value) ||
        threshold.value <= 0
      ) {
        return false;
      }
      thresholdRoles.add(String(threshold.role));
      return true;
    }) &&
    finite(value.requestedWindowCount) &&
    Number.isInteger(value.requestedWindowCount) &&
    value.requestedWindowCount > 0 &&
    finite(value.windowsWithData) &&
    Number.isInteger(value.windowsWithData) &&
    value.windowsWithData >= 0 &&
    value.windowsWithData <= value.requestedWindowCount &&
    finite(value.coveragePercent) &&
    value.coveragePercent >= 0 &&
    value.coveragePercent <= 100
  );
}

function validVisualizationOmission(value: unknown) {
  if (!isRecord(value)) return false;
  return (
    value.reason === "display-point-budget" &&
    typeof value.originalKind === "string" &&
    CHART_KINDS.has(value.originalKind) &&
    finite(value.sourcePointCount) &&
    Number.isInteger(value.sourcePointCount) &&
    finite(value.maximumDisplayPoints) &&
    Number.isInteger(value.maximumDisplayPoints) &&
    value.maximumDisplayPoints > 0 &&
    value.sourcePointCount > value.maximumDisplayPoints
  );
}

function validEvidenceReference(value: unknown, strictRecordLinks: boolean) {
  if (!isRecord(value)) return false;
  if (
    !nonEmptyString(value.id) ||
    !nonEmptyString(value.label) ||
    !nonEmptyString(value.description) ||
    !isRecord(value.range) ||
    !finite(value.range.start) ||
    !finite(value.range.end) ||
    value.range.end <= value.range.start ||
    !uniqueStrings(value.recordIds) ||
    !Array.isArray(value.examples)
  ) {
    return false;
  }
  const recordIds = value.recordIds as string[];
  if (
    !value.examples.every(
      (example) =>
        isRecord(example) &&
        nonEmptyString(example.id) &&
        nonEmptyString(example.kind) &&
        finite(example.timestamp) &&
        example.timestamp >= (value.range as { start: number }).start &&
        example.timestamp < (value.range as { end: number }).end &&
        nonEmptyString(example.primary) &&
        typeof example.secondary === "string" &&
        nonEmptyString(example.sourceId) &&
        recordIds.includes(example.id),
    )
  ) {
    return false;
  }
  if (value.calculation !== undefined && !validCalculation(value.calculation)) {
    return false;
  }
  if (
    value.visualization !== undefined &&
    value.visualizationOmission !== undefined
  ) {
    return false;
  }
  if (
    value.visualizationOmission !== undefined &&
    (!validVisualizationOmission(value.visualizationOmission) ||
      value.calculation === undefined)
  ) {
    return false;
  }
  if (value.visualization === undefined) return true;
  if (!isRecord(value.visualization)) return false;
  if (value.visualization.kind === "recurring-clock-overlay-v1") {
    return isEvidenceClockWindowVisualizationReference(value.visualization, {
      evidenceRecordIds: recordIds,
      requireRecordLinks: strictRecordLinks,
    });
  }
  if (!isEvidenceQueryVisualizationReference(value.visualization)) return false;
  const visualization =
    value.visualization as EvidenceQueryVisualizationReference;
  const ranges = visualization.windows.map(({ range }) => range);
  const envelope = {
    start: Math.min(...ranges.map(({ start }) => start)),
    end: Math.max(...ranges.map(({ end }) => end)),
  };
  if (!containsRange(value.range as { start: number; end: number }, envelope)) {
    return false;
  }
  const displayedIds = visualization.windows.flatMap(({ points }) =>
    points.flatMap(evidenceQueryChartPointRecordIds),
  );
  return displayedIds.every((id) => recordIds.includes(id));
}

function validRequestMetrics(value: unknown): value is TarvisRequestMetrics {
  if (!isRecord(value)) return false;
  return (
    nonEmptyString(value.model) &&
    finite(value.inputTokens) &&
    value.inputTokens >= 0 &&
    finite(value.outputTokens) &&
    value.outputTokens >= 0 &&
    finite(value.totalTokens) &&
    value.totalTokens === value.inputTokens + value.outputTokens &&
    finite(value.estimatedCostUsd) &&
    value.estimatedCostUsd >= 0 &&
    finite(value.evidenceCharacters) &&
    value.evidenceCharacters >= 0 &&
    optionalNonNegativeFinite(value.durationMs) &&
    optionalNonNegativeFinite(value.modelDurationMs) &&
    optionalNonNegativeFinite(value.localToolDurationMs) &&
    optionalNonNegativeInteger(value.modelTurns) &&
    optionalNonNegativeInteger(value.localToolCallCount)
  );
}

function optionalNonNegativeFinite(value: unknown) {
  return value === undefined || (finite(value) && value >= 0);
}

function optionalNonNegativeInteger(value: unknown) {
  return (
    value === undefined || (Number.isSafeInteger(value) && Number(value) >= 0)
  );
}

function canonicalSampleCount(
  bundle: GlucoseAnswerBundleV2,
  recordIds: readonly string[],
) {
  const selected = new Set(recordIds);
  return new Set(
    bundle.records
      .filter(({ id }) => selected.has(id))
      .map(({ timestamp }) => timestamp),
  ).size;
}

function canonicalSamplesForRecordIds(
  bundle: GlucoseAnswerBundleV2,
  recordIds: readonly string[],
) {
  const selected = new Set(recordIds);
  const samples = new Map<
    number,
    { recordIds: string[]; total: number; count: number }
  >();
  bundle.records.forEach(({ id, mmolL, timestamp }) => {
    if (!selected.has(id)) return;
    const sample = samples.get(timestamp);
    if (sample) {
      sample.recordIds.push(id);
      sample.total += mmolL;
      sample.count += 1;
    } else {
      samples.set(timestamp, { recordIds: [id], total: mmolL, count: 1 });
    }
  });
  return [...samples.entries()]
    .map(([timestamp, sample]) => ({
      timestamp,
      recordIds: sample.recordIds,
      mmolL: sample.total / sample.count,
    }))
    .sort((left, right) => left.timestamp - right.timestamp);
}

function sampleGapCount(
  samples: readonly { timestamp: number }[],
  maximumGapMilliseconds: number,
) {
  return samples.reduce(
    (count, sample, index) =>
      index > 0 &&
      sample.timestamp - samples[index - 1]!.timestamp > maximumGapMilliseconds
        ? count + 1
        : count,
    0,
  );
}

function meanForRecordIds(
  bundle: GlucoseAnswerBundleV2,
  recordIds: readonly string[],
) {
  if (!recordIds.length) return null;
  const selected = new Set(recordIds);
  const byTimestamp = new Map<number, { total: number; count: number }>();
  bundle.records
    .filter(({ id }) => selected.has(id))
    .forEach(({ mmolL, timestamp }) => {
      const sample = byTimestamp.get(timestamp);
      if (sample) {
        sample.total += mmolL;
        sample.count += 1;
      } else {
        byTimestamp.set(timestamp, { total: mmolL, count: 1 });
      }
    });
  const samples = [...byTimestamp.values()].map(
    ({ total, count }) => total / count,
  );
  return (
    Math.round(
      (samples.reduce((sum, value) => sum + value, 0) / samples.length +
        Number.EPSILON) *
        100,
    ) / 100
  );
}

function distributionForWindow(
  bundle: GlucoseAnswerBundleV2,
  windowId: string,
) {
  const window = bundle.scope.windows.find(({ id }) => id === windowId);
  const lower = bundle.thresholds.find(({ role }) => role === "range_lower");
  const upper = bundle.thresholds.find(({ role }) => role === "range_upper");
  if (!window || !lower || !upper) return null;
  const matches = (value: number, threshold: typeof lower) => {
    if (threshold.operator === "gt") return value > threshold.value;
    if (threshold.operator === "gte") return value >= threshold.value;
    if (threshold.operator === "lt") return value < threshold.value;
    return value <= threshold.value;
  };
  const durations = { below: 0, within: 0, above: 0 };
  let observed = 0;
  window.observationIntervals.forEach((interval) => {
    const duration = interval.end - interval.start;
    observed += duration;
    if (!matches(interval.mmolL, lower)) durations.below += duration;
    else if (!matches(interval.mmolL, upper)) durations.above += duration;
    else durations.within += duration;
  });
  if (!observed) return null;
  const percent = (duration: number) =>
    Math.round(((duration / observed) * 100 + Number.EPSILON) * 10) / 10;
  return {
    belowPercent: percent(durations.below),
    inRangePercent: percent(durations.within),
    abovePercent: percent(durations.above),
  };
}

function exactVisualizationMatchesBundle(
  visualization: EvidenceQueryVisualizationReference,
  chart: GlucoseAnswerBundleV2["charts"][number],
  bundle: GlucoseAnswerBundleV2,
) {
  if (
    visualization.kind !== chart.kind ||
    visualization.gapThresholdMilliseconds !==
      bundle.algorithms.maximumObservedGapMilliseconds ||
    visualization.windows.reduce(
      (sum, window) => sum + window.points.length,
      0,
    ) > MAX_EVIDENCE_QUERY_CHART_POINTS ||
    !sameOrderedStrings(
      visualization.windows.map(({ id }) => id),
      chart.windowIds,
    )
  ) {
    return false;
  }
  const chartRecordIds = new Set(chart.recordIds);
  return visualization.windows.every((window) => {
    const bundleWindow = bundle.scope.windows.find(
      ({ id }) => id === window.id,
    );
    if (
      !bundleWindow ||
      !sameRange(window.range, bundleWindow.calculationRange) ||
      window.recordCount !== bundleWindow.calculationRecordIds.length ||
      window.coveragePercent !== bundleWindow.coverage.percent ||
      window.meanMmolL !==
        meanForRecordIds(bundle, bundleWindow.calculationRecordIds)
    ) {
      return false;
    }
    const displayedIds = window.points.flatMap(
      evidenceQueryChartPointRecordIds,
    );
    const exactSamples = canonicalSamplesForRecordIds(
      bundle,
      bundleWindow.calculationRecordIds,
    );
    const sampleByTimestamp = new Map(
      exactSamples.map((sample) => [sample.timestamp, sample]),
    );
    const sampleByRecordId = new Map(
      exactSamples.flatMap((sample) =>
        sample.recordIds.map((id) => [id, sample] as const),
      ),
    );
    if (
      displayedIds.some((id) => !chartRecordIds.has(id)) ||
      window.points.some((point) => {
        const sample = sampleByTimestamp.get(point.timestamp);
        return (
          !sample ||
          !sameStringSet(
            evidenceQueryChartPointRecordIds(point),
            sample.recordIds,
          ) ||
          Math.abs(point.mmolL - sample.mmolL) > 1e-9
        );
      }) ||
      (window.sampling === undefined &&
        !sameStringSet(displayedIds, bundleWindow.calculationRecordIds))
    ) {
      return false;
    }
    if (
      window.sampling &&
      (window.sampling.sourceRecordCount !==
        bundleWindow.calculationRecordIds.length ||
        window.sampling.sourceSampleCount !==
          canonicalSampleCount(bundle, bundleWindow.calculationRecordIds) ||
        window.sampling.sourceGapCount !==
          sampleGapCount(exactSamples, visualization.gapThresholdMilliseconds))
    ) {
      return false;
    }
    if (visualization.kind === "range-distribution-v1") {
      const expected = distributionForWindow(bundle, window.id);
      if (!expected || !window.distribution) return false;
      if (
        expected.belowPercent !== window.distribution.belowPercent ||
        expected.inRangePercent !== window.distribution.inRangePercent ||
        expected.abovePercent !== window.distribution.abovePercent
      ) {
        return false;
      }
    }
    if (visualization.kind === "event-timeline-v1") {
      const claim = bundle.claims.find(
        ({ metric, windowIds }) =>
          metric === visualization.metric && windowIds.includes(window.id),
      );
      if (!claim || claim.value !== window.events.length) return false;
      const recordById = new Map(
        bundle.records.map((record) => [record.id, record]),
      );
      if (
        window.events.some((event) => {
          if (event.recordIds.some((id) => !chartRecordIds.has(id)))
            return true;
          const records = event.recordIds.map((id) => recordById.get(id));
          if (records.some((record) => !record)) return true;
          const samples = [
            ...new Set(
              event.recordIds.flatMap((id) => {
                const sample = sampleByRecordId.get(id);
                return sample ? [sample] : [];
              }),
            ),
          ].sort((left, right) => left.timestamp - right.timestamp);
          if (
            !samples.length ||
            !sameStringSet(
              event.recordIds,
              samples.flatMap(({ recordIds }) => recordIds),
            ) ||
            event.start !== samples[0]!.timestamp ||
            (event.endStatus === "observed-through" &&
              event.end !== samples.at(-1)!.timestamp) ||
            (event.endStatus === "confirmed-recovery" &&
              event.end <= samples.at(-1)!.timestamp)
          ) {
            return true;
          }
          const extreme =
            event.kind === "high"
              ? Math.max(...samples.map((sample) => sample.mmolL))
              : Math.min(...samples.map((sample) => sample.mmolL));
          return extreme !== event.extremeMmolL;
        })
      ) {
        return false;
      }
    }
    return true;
  });
}

function bundleMatchesExchange(
  bundle: GlucoseAnswerBundleV2,
  exchange: StoredTarvisExchange,
) {
  if (
    !exchange.intent ||
    JSON.stringify(exchange.intent) !== JSON.stringify(bundle.intent.original)
  ) {
    return false;
  }
  const evidenceById = new Map(
    exchange.evidence.map((reference) => [reference.id, reference]),
  );
  const localReferences = exchange.evidence.filter(({ calculation }) =>
    Boolean(calculation),
  );
  const allEvidenceRecordIds = new Set(
    localReferences.flatMap(({ recordIds }) => recordIds),
  );
  const calculationRecordIds = new Set(
    bundle.scope.windows.flatMap((window) => window.calculationRecordIds),
  );
  if (
    [...calculationRecordIds].some((id) => !allEvidenceRecordIds.has(id)) ||
    [...allEvidenceRecordIds].some((id) => !calculationRecordIds.has(id))
  ) {
    return false;
  }

  const linkedClaims = new Set<string>();
  for (const reference of localReferences) {
    const calculation = reference.calculation!;
    const claims = bundle.claims.filter(({ id }) =>
      id.startsWith(`${reference.id}:claim:`),
    );
    if (claims.length !== calculation.metrics.length) return false;
    const referenceCalculationRecordIds = [
      ...new Set(claims.flatMap((claim) => claim.calculationRecordIds)),
    ];
    if (!sameStringSet(reference.recordIds, referenceCalculationRecordIds)) {
      return false;
    }
    for (const metric of calculation.metrics) {
      const claim = claims.find((candidate) => candidate.metric === metric.id);
      if (
        !claim ||
        claim.value !== metric.value ||
        claim.unit !== metric.unit ||
        claim.coverage.percent !== calculation.coveragePercent
      ) {
        return false;
      }
      linkedClaims.add(claim.id);
    }
  }
  if (linkedClaims.size !== bundle.claims.length) return false;

  for (const chart of bundle.charts) {
    const reference = evidenceById.get(chart.sourceReferenceId);
    const referenceRecordIds = new Set(reference?.recordIds ?? []);
    if (
      !reference ||
      !containsRange(reference.range, chart.range) ||
      chart.recordIds.some((id) => !referenceRecordIds.has(id))
    ) {
      return false;
    }
    if (reference.visualizationOmission) {
      if (reference.visualizationOmission.originalKind !== chart.kind) {
        return false;
      }
      continue;
    }
    const visualization = reference.visualization;
    if (!visualization || visualization.kind !== chart.kind) return false;
    if (visualization.kind === "recurring-clock-overlay-v1") {
      if (!sameStringSet(reference.recordIds, chart.recordIds)) return false;
      if (
        !sameOrderedStrings(
          visualization.windows.map(({ id }) => id),
          chart.windowIds,
        )
      ) {
        return false;
      }
    } else if (!exactVisualizationMatchesBundle(visualization, chart, bundle)) {
      return false;
    }
  }
  return true;
}

function validStoredTarvisExchangeForSchema(
  value: unknown,
  schemaVersion: StoredTarvisConversation["schemaVersion"],
): value is StoredTarvisExchange {
  if (!isRecord(value)) return false;
  if (
    !nonEmptyString(value.id) ||
    (value.threadId !== undefined && !nonEmptyString(value.threadId)) ||
    !nonEmptyString(value.question) ||
    !validAnswer(value.answer) ||
    !Array.isArray(value.evidence) ||
    !value.evidence.every((reference) =>
      validEvidenceReference(reference, schemaVersion === 3),
    ) ||
    (value.clarificationQuestion !== undefined &&
      typeof value.clarificationQuestion !== "string") ||
    (value.intent !== undefined && !isTarvisIntentV1(value.intent)) ||
    (value.presentation !== undefined &&
      !isTarvisEvidencePresentation(value.presentation)) ||
    (value.requestMetrics !== undefined &&
      !validRequestMetrics(value.requestMetrics)) ||
    (value.modelRequestSent !== undefined &&
      typeof value.modelRequestSent !== "boolean") ||
    (value.answerSource !== undefined &&
      value.answerSource !== "hosted" &&
      value.answerSource !== "local") ||
    (value.modelSharing !== undefined && value.modelSharing !== "local-only") ||
    (value.guidanceSources !== undefined &&
      !validGuidanceReferences(value.guidanceSources)) ||
    (value.createdAt !== undefined &&
      (!finite(value.createdAt) || value.createdAt <= 0)) ||
    !migratableConversationScope(value.scope)
  ) {
    return false;
  }
  const exchange = value as unknown as StoredTarvisExchange;
  if (
    (exchange.answerSource === "hosted" &&
      (exchange.modelRequestSent !== true || !exchange.requestMetrics)) ||
    (exchange.modelRequestSent === false &&
      exchange.requestMetrics !== undefined)
  ) {
    return false;
  }
  if (
    !sameOrderedStrings(
      exchange.answer.evidenceIds,
      exchange.evidence.map(({ id }) => id),
    )
  ) {
    return false;
  }
  const localAnswer = exchange.evidence.some(({ calculation }) =>
    Boolean(calculation),
  );
  if (exchange.answerBundle !== undefined) {
    if (
      !localAnswer ||
      exchange.legacyBundleUnavailable !== undefined ||
      !isGlucoseAnswerBundleV2(exchange.answerBundle) ||
      !bundleMatchesExchange(exchange.answerBundle, exchange)
    ) {
      return false;
    }
  } else if (
    schemaVersion === 3 &&
    localAnswer &&
    exchange.legacyBundleUnavailable !== true
  ) {
    return false;
  }
  return (
    exchange.legacyBundleUnavailable === undefined ||
    (exchange.legacyBundleUnavailable === true &&
      localAnswer &&
      exchange.answerBundle === undefined)
  );
}

export function validStoredTarvisExchange(
  value: unknown,
): value is StoredTarvisExchange {
  return validStoredTarvisExchangeForSchema(value, 3);
}

function parsedExchange(
  value: unknown,
  schemaVersion: StoredTarvisConversation["schemaVersion"],
  fallbackCreatedAt = Date.now(),
): LoadedStoredTarvisExchange | null {
  if (!validStoredTarvisExchangeForSchema(value, schemaVersion)) return null;
  const exchange = value as StoredTarvisExchange;
  const answerBundle = exchange.answerBundle
    ? parseGlucoseAnswerBundleV2(exchange.answerBundle)
    : undefined;
  const evidence = compactTarvisEvidence(exchange.evidence);
  return {
    ...exchange,
    threadId:
      exchange.threadId ??
      `legacy:${validConversationScope(exchange.scope) ? exchange.scope.identity : "legacy-unknown"}`,
    answerSource: exchange.answerSource ?? "local",
    modelRequestSent:
      exchange.modelRequestSent ?? Boolean(exchange.requestMetrics),
    guidanceSources: exchange.guidanceSources ?? [],
    createdAt:
      exchange.createdAt === undefined
        ? Math.max(1, fallbackCreatedAt)
        : exchange.createdAt,
    scope: validConversationScope(exchange.scope)
      ? exchange.scope
      : {
          kind: "legacy-unknown",
          identity: "legacy-unknown",
        },
    answerBundle,
    evidence,
    intent: isTarvisIntentV1(exchange.intent) ? exchange.intent : undefined,
    presentation: isTarvisEvidencePresentation(exchange.presentation)
      ? exchange.presentation
      : undefined,
  } satisfies LoadedStoredTarvisExchange;
}

function utf8ByteLength(value: string) {
  let bytes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff) {
      bytes += 4;
      index += 1;
    } else bytes += 3;
  }
  return bytes;
}

function migratedExchange(
  exchange: StoredTarvisExchange,
  fallbackCreatedAt: number,
) {
  const evidence = compactTarvisEvidence(exchange.evidence);
  const localAnswer = evidence.some(({ calculation }) => Boolean(calculation));
  return {
    ...exchange,
    threadId:
      exchange.threadId ??
      `legacy:${validConversationScope(exchange.scope) ? exchange.scope.identity : "legacy-unknown"}`,
    answerSource: exchange.answerSource ?? "local",
    modelRequestSent:
      exchange.modelRequestSent ?? Boolean(exchange.requestMetrics),
    guidanceSources: exchange.guidanceSources ?? [],
    createdAt:
      exchange.createdAt === undefined
        ? Math.max(1, fallbackCreatedAt)
        : exchange.createdAt,
    scope: validConversationScope(exchange.scope)
      ? exchange.scope
      : {
          kind: "legacy-unknown" as const,
          identity: "legacy-unknown" as const,
        },
    evidence,
    ...(localAnswer && !exchange.answerBundle
      ? { legacyBundleUnavailable: true as const }
      : {}),
  } satisfies StoredTarvisExchange;
}

export function serializeTarvisConversation(
  exchanges: readonly StoredTarvisExchange[],
  updatedAt = Date.now(),
  maximumBytes = MAX_STORED_TARVIS_CONVERSATION_BYTES,
) {
  if (!Number.isInteger(maximumBytes) || maximumBytes < 256) {
    throw new RangeError("Tarv1s conversation byte budget is invalid.");
  }
  const candidates = exchanges
    .slice(-MAX_STORED_TARVIS_EXCHANGES)
    .map((exchange, index, selected) =>
      migratedExchange(
        exchange,
        Math.max(1, updatedAt - (selected.length - index - 1)),
      ),
    );
  candidates.forEach((exchange) => {
    if (!validStoredTarvisExchangeForSchema(exchange, 3)) {
      throw new Error(
        "A Tarv1s exchange failed the schema-v3 integrity check.",
      );
    }
  });
  const selected: StoredTarvisExchange[] = [];
  for (let index = candidates.length - 1; index >= 0; index -= 1) {
    const next = [candidates[index]!, ...selected];
    const document: StoredTarvisConversation = {
      schemaVersion: 3,
      updatedAt,
      exchanges: next,
    };
    const serialized = JSON.stringify(document);
    if (utf8ByteLength(serialized) <= maximumBytes) {
      selected.unshift(candidates[index]!);
      continue;
    }
    if (!selected.length) {
      throw new TarvisConversationStorageLimitError(
        "The newest Tarv1s answer is too large to save safely on this phone.",
      );
    }
    break;
  }
  return JSON.stringify({
    schemaVersion: 3,
    updatedAt,
    exchanges: selected,
  } satisfies StoredTarvisConversation);
}

/**
 * Validates a conversation before it crosses the encrypted-backup boundary.
 * The returned schema-v3 document contains only the conversation fields the
 * app understands; unrelated app metadata is never made portable.
 */
export function validateSerializedTarvisConversation(value: unknown) {
  if (
    typeof value !== "string" ||
    utf8ByteLength(value) > MAX_STORED_TARVIS_CONVERSATION_BYTES
  ) {
    throw new Error("The backup contains an invalid Tarv1s conversation.");
  }

  let stored: unknown;
  try {
    stored = JSON.parse(value);
  } catch {
    throw new Error("The backup contains an invalid Tarv1s conversation.");
  }
  if (!isRecord(stored)) {
    throw new Error("The backup contains an invalid Tarv1s conversation.");
  }
  const keys = Object.keys(stored);
  if (
    keys.length !== 3 ||
    !keys.every((key) =>
      ["schemaVersion", "updatedAt", "exchanges"].includes(key),
    ) ||
    (stored.schemaVersion !== 1 &&
      stored.schemaVersion !== 2 &&
      stored.schemaVersion !== 3) ||
    !finite(stored.updatedAt) ||
    stored.updatedAt <= 0 ||
    !Array.isArray(stored.exchanges) ||
    stored.exchanges.length > MAX_STORED_TARVIS_EXCHANGES
  ) {
    throw new Error("The backup contains an invalid Tarv1s conversation.");
  }

  const schemaVersion =
    stored.schemaVersion as StoredTarvisConversation["schemaVersion"];
  const updatedAt = stored.updatedAt;
  const storedExchanges = stored.exchanges;
  const exchanges = storedExchanges.map((exchange, index) =>
    parsedExchange(
      exchange,
      schemaVersion,
      updatedAt - (storedExchanges.length - index - 1),
    ),
  );
  if (exchanges.some((exchange) => exchange === null)) {
    throw new Error("The backup contains an invalid Tarv1s conversation.");
  }
  return serializeTarvisConversation(
    exchanges as StoredTarvisExchange[],
    updatedAt,
  );
}

export async function loadTarvisConversationState(): Promise<TarvisConversationLoadResult> {
  const database = await openT1ArcDatabase();
  const row = await database.getFirstAsync<{ value: string }>(
    "SELECT value FROM app_metadata WHERE key = ?",
    STORAGE_KEY,
  );
  if (!row) return { status: "missing", exchanges: [] };
  if (!row.value) {
    return {
      status: "corrupt",
      exchanges: [],
      message: "The saved Tarv1s conversation is unreadable.",
    };
  }
  try {
    const stored = JSON.parse(row.value) as Partial<StoredTarvisConversation>;
    if (
      (stored.schemaVersion !== 1 &&
        stored.schemaVersion !== 2 &&
        stored.schemaVersion !== 3) ||
      !finite(stored.updatedAt) ||
      stored.updatedAt <= 0 ||
      !Array.isArray(stored.exchanges) ||
      stored.exchanges.length > MAX_STORED_TARVIS_EXCHANGES
    ) {
      return {
        status: "corrupt",
        exchanges: [],
        message: "The saved Tarv1s conversation is unreadable.",
      };
    }
    const exchanges = stored.exchanges.map((exchange, index) =>
      parsedExchange(
        exchange,
        stored.schemaVersion!,
        stored.updatedAt! - (stored.exchanges!.length - index - 1),
      ),
    );
    if (exchanges.some((exchange) => exchange === null)) {
      return {
        status: "corrupt",
        exchanges: [],
        message: "The saved Tarv1s conversation failed its integrity check.",
      };
    }
    return {
      status: "loaded",
      exchanges: exchanges as LoadedStoredTarvisExchange[],
    };
  } catch {
    return {
      status: "corrupt",
      exchanges: [],
      message: "The saved Tarv1s conversation is unreadable.",
    };
  }
}

export async function saveTarvisConversation(
  exchanges: StoredTarvisExchange[],
  lease?: LocalDataWriteLease,
) {
  const writeLease = lease ?? (await acquireLocalDataWriteLease());
  const serialized = serializeTarvisConversation(exchanges);
  const existing = await loadTarvisConversationState();
  if (existing.status === "corrupt") {
    throw new TarvisConversationCorruptError();
  }
  await openT1ArcDatabase();
  await withT1ArcTransaction(async (transaction) => {
    await assertLocalDataWriteLeaseInTransaction(transaction, writeLease);
    await transaction.runAsync(
      `INSERT INTO app_metadata (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      STORAGE_KEY,
      serialized,
    );
  });
}

export async function clearTarvisConversation() {
  await openT1ArcDatabase();
  await withT1ArcTransaction(async (transaction) => {
    await transaction.runAsync(
      "DELETE FROM app_metadata WHERE key = ?",
      STORAGE_KEY,
    );
  });
}

export interface TarvisConversationPersistenceAdapter {
  acquireWriteLease?(): Promise<LocalDataWriteLease>;
  load?(): Promise<TarvisConversationLoadResult>;
  save(
    exchanges: StoredTarvisExchange[],
    lease?: LocalDataWriteLease,
  ): Promise<void>;
  clear(): Promise<void>;
}

export type TarvisConversationSaveResult = "saved" | "superseded";

/**
 * Serializes conversation writes. Replacements increment the generation
 * immediately, so an older queued save is skipped; an already-running save is
 * always followed by the replacement before the queue settles.
 */
export function createTarvisConversationPersistenceCoordinator(
  adapter: TarvisConversationPersistenceAdapter,
) {
  let generation = 0;
  let tail: Promise<void> = Promise.resolve();

  function enqueue<T>(work: () => Promise<T>) {
    const operation = tail.then(work, work);
    tail = operation.then(
      () => undefined,
      () => undefined,
    );
    return operation;
  }

  return {
    load(): Promise<TarvisConversationLoadResult> {
      return enqueue(async () => {
        if (!adapter.load) {
          throw new Error("Tarv1s conversation loading is unavailable.");
        }
        return adapter.load();
      });
    },

    save(
      exchanges: StoredTarvisExchange[],
      operationLease?: LocalDataWriteLease,
    ): Promise<TarvisConversationSaveResult> {
      const requestedGeneration = generation;
      const writeLease = operationLease
        ? Promise.resolve(operationLease)
        : adapter.acquireWriteLease?.();
      return enqueue(async () => {
        const lease = await writeLease;
        if (requestedGeneration !== generation) return "superseded";
        await adapter.save(exchanges, lease);
        return requestedGeneration === generation ? "saved" : "superseded";
      });
    },

    replace(
      exchanges: StoredTarvisExchange[],
      operationLease?: LocalDataWriteLease,
    ): Promise<void> {
      const replacementGeneration = ++generation;
      const writeLease = operationLease
        ? Promise.resolve(operationLease)
        : adapter.acquireWriteLease?.();
      return enqueue(async () => {
        const lease = await writeLease;
        if (replacementGeneration !== generation) return;
        if (exchanges.length) await adapter.save(exchanges, lease);
        else await adapter.clear();
      });
    },
  };
}

export function createTarvisConversationPersistenceOwner(
  adapter: TarvisConversationPersistenceAdapter,
) {
  const sharedCoordinator =
    createTarvisConversationPersistenceCoordinator(adapter);
  return {
    forMount() {
      return sharedCoordinator;
    },
  };
}

const appConversationPersistenceOwner =
  createTarvisConversationPersistenceOwner({
    acquireWriteLease: acquireLocalDataWriteLease,
    clear: clearTarvisConversation,
    load: loadTarvisConversationState,
    save: saveTarvisConversation,
  });

/** Every Tarv1s screen mount shares one process-wide write generation. */
export function getTarvisConversationPersistenceCoordinator() {
  return appConversationPersistenceOwner.forMount();
}
