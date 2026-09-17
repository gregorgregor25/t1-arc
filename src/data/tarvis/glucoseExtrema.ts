import { canonicalGlucoseSamples } from "./query/glucoseStatistics";
import type { GlucoseReading, TimeRange } from "@/domain/models";
import { formatDate, formatTime, toDateKey } from "@/domain/time";
import { formatTarvisNumber } from "./regionalNumberPresentation";

export interface GlucoseExtremeSummary {
  kind: "minimum" | "maximum";
  mmolL: number;
  occurrenceCount: number;
  firstTimestamp: number;
  lastTimestamp: number;
}

export function summarizeGlucoseExtreme(
  readings: readonly GlucoseReading[],
  range: TimeRange,
  kind: GlucoseExtremeSummary["kind"],
): GlucoseExtremeSummary | null {
  const samples = canonicalGlucoseSamples(readings, range);
  if (samples.length === 0) return null;
  const mmolL = samples.reduce(
    (extreme, sample) =>
      kind === "maximum"
        ? Math.max(extreme, sample.mmolL)
        : Math.min(extreme, sample.mmolL),
    samples[0]!.mmolL,
  );
  const occurrences = samples.filter((sample) => sample.mmolL === mmolL);
  return {
    kind,
    mmolL,
    occurrenceCount: occurrences.length,
    firstTimestamp: occurrences[0]!.timestamp,
    lastTimestamp: occurrences.at(-1)!.timestamp,
  };
}

function localDateTime(timestamp: number) {
  return `${formatTime(timestamp)} on ${formatDate(toDateKey(timestamp), {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  })}`;
}

export function describeGlucoseExtremeTiming(
  summary: GlucoseExtremeSummary,
) {
  const first = localDateTime(summary.firstTimestamp);
  if (summary.occurrenceCount === 1) return `at ${first}`;
  const last = localDateTime(summary.lastTimestamp);
  if (summary.occurrenceCount === 2) {
    return `first at ${first} and again at ${last}`;
  }
  return `first at ${first}; the same value was recorded ${formatTarvisNumber(summary.occurrenceCount, { maximumFractionDigits: 0 })} times, most recently at ${last}`;
}
