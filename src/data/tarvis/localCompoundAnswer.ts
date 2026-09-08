import type { GlucoseReading, TimelineData, TimeRange } from "@/domain/models";
import type { EvidenceReference } from "@/domain/insights";
import type { TarvisIntentV1 } from "./intent";
import type { TarvisAnswer } from "./types";
import type { TarvisEvidenceMetric, TarvisEvidencePresentation } from "./evidencePresentation";
import { isLocalGlucoseScopeWithinLimit } from "./localScopeLimit";
import { buildLocalGlucoseRangeComponent, rangeForLocalGlucoseRangeIntent } from "./localGlucoseRangeAnswer";
import { buildLocalPersonalDataAnswer, rangesForLocalPersonalDataIntent } from "./localPersonalDataAnswer";
import { resolveTarvisIntentRange } from "./intentRange";
import { formatTarvisCompactPeriod, tarvisComparisonDurationNote } from "./timePresentation";
import { formatTarvisFixedNumber } from "./regionalNumberPresentation";

export interface LocalCompoundAnswerInput {
  intents: readonly TarvisIntentV1[];
  asOf: number;
  loadGlucoseReadings?: (range: TimeRange) => Promise<GlucoseReading[]>;
  loadTimelineData?: (range: TimeRange) => Promise<TimelineData>;
}

function rangeKey(range: TimeRange) {
  return `${range.start}:${range.end}`;
}

function metricSentence(metric: TarvisEvidenceMetric) {
  const label = metric.id === "carbohydrates" ? "Logged carbohydrates" : metric.label;
  return metric.value === null
    ? `${label}: unavailable from the recorded data`
    : `${label}: ${formatTarvisFixedNumber(metric.value, metric.decimals)}${metric.unit ? ` ${metric.unit}` : ""}`;
}

/**
 * Executes every part of a validated shared-period request. Each existing
 * executor retains its own calculation, missing-data rules and evidence.
 * No model request, treatment recommendation or carbs-to-insulin ratio is made.
 */
export async function loadLocalCompoundAnswer(input: LocalCompoundAnswerInput): Promise<{
  answer: TarvisAnswer;
  evidence: EvidenceReference[];
  presentation: TarvisEvidencePresentation;
}> {
  const { intents, asOf } = input;
  if (intents.length < 2 || intents.length > 8) throw new Error("A compound calculation requires two to eight metrics.");
  const ranges = intents.map((intent) => {
    if (intent.metrics.length !== 1 || intent.clockWindow !== null || !isLocalGlucoseScopeWithinLimit(intent)) {
      throw new Error("Every compound calculation must have a bounded, single-metric intent.");
    }
    const range = resolveTarvisIntentRange({ intent, asOf });
    if (range.status !== "resolved") throw new Error("The compound calculation has an unresolved period.");
    return range;
  });
  const shared = ranges[0]!;
  if (ranges.some((range) => rangeKey(range.current) !== rangeKey(shared.current) ||
    (range.previous ? rangeKey(range.previous) : null) !== (shared.previous ? rangeKey(shared.previous) : null))) {
    throw new Error("Compound metrics must refer to the same exact periods.");
  }
  if (new Set(intents.map((intent) => intent.metrics[0]!.value)).size !== intents.length) {
    throw new Error("A compound calculation contains duplicate metrics.");
  }

  const glucoseIntents = intents.filter((intent) => intent.domain.value === "glucose");
  // Load the union once, including episode boundary context. Executors still
  // filter their own half-open ranges and never add context to the mean.
  const glucoseRanges = glucoseIntents.map((intent) => rangeForLocalGlucoseRangeIntent(intent, asOf));
  const glucosePromise = glucoseRanges.length
    ? input.loadGlucoseReadings?.({
        start: Math.min(...glucoseRanges.map((range) => range.start)),
        end: Math.max(...glucoseRanges.map((range) => range.end)),
      })
    : Promise.resolve([] as GlucoseReading[]);
  if (!glucosePromise) throw new Error("Your local glucose data is not ready yet.");
  const timelines = new Map<string, Promise<TimelineData>>();
  const loadTimeline = (range: TimeRange) => {
    const key = rangeKey(range);
    let pending = timelines.get(key);
    if (!pending) {
      if (!input.loadTimelineData) throw new Error("Your local health data is not ready yet.");
      pending = input.loadTimelineData(range);
      timelines.set(key, pending);
    }
    return pending;
  };
  const components = await Promise.all(intents.map(async (intent) => {
    if (intent.domain.value === "glucose") {
      return buildLocalGlucoseRangeComponent({ intent, asOf, readings: await glucosePromise });
    }
    const required = rangesForLocalPersonalDataIntent(intent, asOf);
    const [current, previous] = await Promise.all([
      loadTimeline(required.current),
      required.previous ? loadTimeline(required.previous) : Promise.resolve(undefined),
    ]);
    return buildLocalPersonalDataAnswer({ intent, asOf, current, previous });
  }));
  const evidence = components.flatMap((component) => component.evidence);
  const periodAnswers = [shared.current, ...(shared.previous ? [shared.previous] : [])].map((range, index) => {
    const values = components.flatMap((component) => component.presentation.windows
      .filter((window) => rangeKey(window.range) === rangeKey(range))
      .flatMap((window) => window.metrics));
    return `${index === 0 ? "Requested period" : "Previous period"} (${formatTarvisCompactPeriod(range)}):\n${values.map(metricSentence).join("; ")}.`;
  });
  const durationNote = tarvisComparisonDurationNote(shared);
  const limitations = [...new Set([
    ...components.flatMap((component) => component.answer.limitations),
    ...(durationNote ? [durationNote] : []),
  ])];
  return {
    answer: {
      headline: shared.previous ? "Your recorded results compared" : "Your recorded results",
      answer: periodAnswers.join("\n\n"),
      confidence: components.some((component) => component.answer.confidence === "limited") ? "limited" : "high",
      evidenceIds: evidence.map((reference) => reference.id),
      limitations,
    },
    evidence,
    presentation: {
      kind: glucoseIntents.length === intents.length ? "glucose-summary" : "personal-data",
      title: "Calculations for each part of your question",
      detail: [...new Set(components.map((component) => component.presentation.detail))].join(" "),
      // Keep source counts separate: glucose coverage is not food-log coverage.
      windows: components.flatMap((component) => component.presentation.windows),
    },
  };
}
