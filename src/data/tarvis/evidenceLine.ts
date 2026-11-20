import type { EvidenceReference } from "@/domain/insights";
import { formatClock, formatDay } from "@/domain/exportTime";
import {
  CONSENSUS_GLUCOSE_THRESHOLDS,
  formatGlucoseRangeBounds,
} from "@/domain/glucoseRanges";
import { formatGlucose, formatRegionalNumber } from "@/domain/regionalFormat";
import type { T1ArcRegionalDefaults } from "@/domain/regionalProfile";
import { getZonedDateTimeParts } from "@/domain/time";

import type { TarvisEvidencePresentation } from "./evidencePresentation";
import type { GlucoseAnswerBundleV2 } from "./glucoseAnswerBundleV2";
import { isTarvisGeneralEducationAnswer } from "./generalEducation";
import type { TarvisAnswer, TarvisEvidencePacket } from "./types";

/**
 * A fixed, locally built statement of what an answer was calculated from.
 * Every value comes from the evidence packet or on-device calculation that
 * produced the answer, never from model-written text.
 */
export interface TarvisEvidenceLineWindow {
  start: number;
  end: number;
  /** Glucose readings (or other records, see recordLabel) in the window. */
  records: number;
  /** Defaults to "glucose readings". */
  recordLabel?: string;
  /** Null when coverage was not measured for this answer. */
  coveragePercent: number | null;
}

export interface TarvisEvidenceLineData {
  version: 1;
  windows: TarvisEvidenceLineWindow[];
  /** Range or thresholds the answer used, in mmol/L. */
  range?: { lowerMmolL: number | null; upperMmolL: number | null };
}

const MAX_WINDOWS = 2;
const RANGE_QUESTION =
  /\b(?:time in range|tir|in range|out of range|below range|above range|range|lows?|highs?|hypos?|hypers?|hypoglyc(?:aemia|emia)|hyperglyc(?:aemia|emia))\b/i;
const GLUCOSE_REFERENCE = /glucose|sensor|cgm/i;
const STANDARD_RANGE = {
  lowerMmolL: CONSENSUS_GLUCOSE_THRESHOLDS.rangeLower.mmolL,
  upperMmolL: CONSENSUS_GLUCOSE_THRESHOLDS.rangeUpper.mmolL,
};

function finiteRange(range: { start: number; end: number } | undefined) {
  return Boolean(range && Number.isFinite(range.start) && Number.isFinite(range.end) && range.end > range.start);
}

function fromBundle(bundle: GlucoseAnswerBundleV2): TarvisEvidenceLineData | undefined {
  const windows = bundle.scope.windows;
  const occurrence = windows.some((window) => window.role === "occurrence");
  const lineWindows: TarvisEvidenceLineWindow[] = occurrence
    ? [{
        start: bundle.scope.calculationRange.start,
        end: bundle.scope.calculationRange.end,
        records: new Set(windows.flatMap((window) => window.calculationRecordIds)).size,
        coveragePercent: bundle.coverage.percent,
      }]
    : windows.slice(0, MAX_WINDOWS).map((window) => ({
        start: window.calculationRange.start,
        end: window.calculationRange.end,
        records: window.calculationRecordIds.length,
        coveragePercent: window.coverage.percent,
      }));
  if (!lineWindows.length) return undefined;
  const usesRange = bundle.claims.some(({ metric }) =>
    metric === "glucose.time_in_range" ||
    metric === "glucose.low_episodes" ||
    metric === "glucose.high_episodes" ||
    metric === "glucose.low_readings" ||
    metric === "glucose.high_readings",
  );
  const lower = bundle.thresholds.find(({ role }) => role === "range_lower" || role === "low")?.value ?? null;
  const upper = bundle.thresholds.find(({ role }) => role === "range_upper" || role === "high")?.value ?? null;
  return {
    version: 1,
    windows: lineWindows,
    ...(usesRange && (lower !== null || upper !== null)
      ? { range: { lowerMmolL: lower, upperMmolL: upper } }
      : {}),
  };
}

function fromPresentation(presentation: TarvisEvidencePresentation): TarvisEvidenceLineData | undefined {
  const windows = presentation.windows.slice(0, MAX_WINDOWS).map((window) => ({
    start: window.range.start,
    end: window.range.end,
    records: window.recordCount,
    ...(window.recordLabel ? { recordLabel: window.recordLabel } : {}),
    coveragePercent: window.coveragePercent ?? null,
  }));
  if (!windows.length) return undefined;
  const usesRange = presentation.windows.some((window) =>
    window.metrics.some(({ id }) =>
      id === "time-in-range" || id === "time-below-range" || id === "time-above-range" ||
      id === "low-events" || id === "high-events" || id === "low-readings" || id === "high-readings",
    ),
  );
  return { version: 1, windows, ...(usesRange ? { range: STANDARD_RANGE } : {}) };
}

function fromPacket(packet: TarvisEvidencePacket, question: string): TarvisEvidenceLineData | undefined {
  // Defensive: stored or retrospective packets may not carry a comparison.
  const comparison = packet.comparison as TarvisEvidencePacket["comparison"] | undefined;
  if (!comparison?.current || !finiteRange(comparison.currentRange)) return undefined;
  const windows: TarvisEvidenceLineWindow[] = [{
    start: comparison.currentRange.start,
    end: comparison.currentRange.end,
    records: comparison.current.glucoseReadings ?? 0,
    coveragePercent: comparison.current.coveragePercent ?? null,
  }];
  if (!comparison.currentOnly && comparison.previous && comparison.previousRange && finiteRange(comparison.previousRange)) {
    windows.push({
      start: comparison.previousRange.start,
      end: comparison.previousRange.end,
      records: comparison.previous.glucoseReadings ?? 0,
      coveragePercent: comparison.previous.coveragePercent ?? null,
    });
  }
  return { version: 1, windows, ...(RANGE_QUESTION.test(question) ? { range: STANDARD_RANGE } : {}) };
}

function fromReferences(references: readonly EvidenceReference[]): TarvisEvidenceLineData | undefined {
  const usable = references.filter((reference) => finiteRange(reference.range));
  if (!usable.length) return undefined;
  const glucose = usable.filter((reference) => GLUCOSE_REFERENCE.test(`${reference.id} ${reference.label}`));
  const selected = glucose.length ? glucose : usable;
  const records = new Set(selected.flatMap(({ recordIds }) => recordIds)).size;
  return {
    version: 1,
    windows: [{
      start: Math.min(...selected.map(({ range }) => range.start)),
      end: Math.max(...selected.map(({ range }) => range.end)),
      records,
      ...(glucose.length ? {} : { recordLabel: records === 1 ? "record" : "records" }),
      coveragePercent: null,
    }],
  };
}

/** True for answers that used personal records rather than general knowledge. */
export function answerUsesPersonalData(answer: TarvisAnswer, answerBundle?: GlucoseAnswerBundleV2) {
  if (answer.responseKind === "safety-boundary" || isTarvisGeneralEducationAnswer(answer)) return false;
  return Boolean(answerBundle) || answer.evidenceIds.length > 0;
}

/**
 * Chooses the most exact local source available: the deterministic glucose
 * bundle, then the locally built presentation, then the evidence packet,
 * then the referenced evidence records.
 */
export function buildTarvisEvidenceLineData({
  answer,
  answerBundle,
  presentation,
  packet,
  question,
  references = [],
}: {
  answer: TarvisAnswer;
  answerBundle?: GlucoseAnswerBundleV2;
  presentation?: TarvisEvidencePresentation;
  packet?: TarvisEvidencePacket;
  question: string;
  references?: readonly EvidenceReference[];
}): TarvisEvidenceLineData | undefined {
  if (!answerUsesPersonalData(answer, answerBundle)) return undefined;
  return (answerBundle ? fromBundle(answerBundle) : undefined) ??
    (presentation ? fromPresentation(presentation) : undefined) ??
    (packet ? fromPacket(packet, question) : undefined) ??
    fromReferences(references);
}

export function isTarvisEvidenceLineData(value: unknown): value is TarvisEvidenceLineData {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const data = value as Partial<TarvisEvidenceLineData>;
  const nullableFinite = (item: unknown) => item === null || (typeof item === "number" && Number.isFinite(item));
  return data.version === 1 &&
    Array.isArray(data.windows) &&
    data.windows.length > 0 &&
    data.windows.length <= MAX_WINDOWS &&
    data.windows.every((window) =>
      Boolean(window) &&
      typeof window.start === "number" && Number.isFinite(window.start) &&
      typeof window.end === "number" && Number.isFinite(window.end) &&
      window.end > window.start &&
      Number.isSafeInteger(window.records) && window.records >= 0 &&
      (window.recordLabel === undefined || (typeof window.recordLabel === "string" && window.recordLabel.length <= 60)) &&
      nullableFinite(window.coveragePercent),
    ) &&
    (data.range === undefined || (
      Boolean(data.range) && nullableFinite(data.range.lowerMmolL) && nullableFinite(data.range.upperMmolL)
    ));
}

type LineSettings = Pick<T1ArcRegionalDefaults, "locale" | "timeZone" | "glucoseUnit">;

function isLocalMidnight(timestamp: number, timeZone: string) {
  const parts = getZonedDateTimeParts(timestamp, timeZone);
  return parts.hour === 0 && parts.minute === 0 && parts.second === 0;
}

/** "10 Nov 2026 – 16 Nov 2026", or with clock times for part-day windows. */
export function evidenceLinePeriod(window: Pick<TarvisEvidenceLineWindow, "start" | "end">, settings: LineSettings) {
  const startDay = formatDay(window.start, settings);
  if (isLocalMidnight(window.start, settings.timeZone) && isLocalMidnight(window.end, settings.timeZone)) {
    const endDay = formatDay(window.end - 1, settings);
    return startDay === endDay ? startDay : `${startDay} – ${endDay}`;
  }
  const endDay = formatDay(window.end, settings);
  return startDay === endDay
    ? `${startDay}, ${formatClock(window.start, settings)}–${formatClock(window.end, settings)}`
    : `${startDay}, ${formatClock(window.start, settings)} – ${endDay}, ${formatClock(window.end, settings)}`;
}

function rangeText(range: NonNullable<TarvisEvidenceLineData["range"]>, settings: LineSettings) {
  const { lowerMmolL, upperMmolL } = range;
  if (lowerMmolL !== null && upperMmolL !== null) {
    const standard = Math.abs(lowerMmolL - STANDARD_RANGE.lowerMmolL) < 1e-6 &&
      Math.abs(upperMmolL - STANDARD_RANGE.upperMmolL) < 1e-6;
    const tight = Math.abs(lowerMmolL - CONSENSUS_GLUCOSE_THRESHOLDS.rangeLower.mmolL) < 1e-6 &&
      Math.abs(upperMmolL - CONSENSUS_GLUCOSE_THRESHOLDS.tightUpper.mmolL) < 1e-6;
    const bounds = formatGlucoseRangeBounds({ lowerMmolL, upperMmolL }, settings);
    return standard ? `Standard range ${bounds}` : tight ? `Tight range ${bounds}` : `Range used ${bounds}`;
  }
  if (lowerMmolL !== null) return `Low threshold ${formatGlucose(lowerMmolL, settings)}`;
  if (upperMmolL !== null) return `High threshold ${formatGlucose(upperMmolL, settings)}`;
  return undefined;
}

function windowText(window: TarvisEvidenceLineWindow, settings: LineSettings) {
  const records = `${formatRegionalNumber(window.records, settings.locale, { maximumFractionDigits: 0 })} ${window.recordLabel ?? (window.records === 1 ? "glucose reading" : "glucose readings")}`;
  const coverage = window.coveragePercent === null
    ? undefined
    : `${formatRegionalNumber(window.coveragePercent, settings.locale, { minimumFractionDigits: 0, maximumFractionDigits: 1 })}% sensor coverage`;
  return [evidenceLinePeriod(window, settings), records, coverage].filter(Boolean).join(" · ");
}

/**
 * "Calculated from: 10 Nov 2026 – 16 Nov 2026 · 2,016 glucose readings ·
 * 100% sensor coverage · Standard range 3.9–10.0 mmol/L".
 */
export function formatTarvisEvidenceLine(data: TarvisEvidenceLineData, settings: LineSettings) {
  const windows = data.windows.map((window) => windowText(window, settings));
  const range = data.range ? rangeText(data.range, settings) : undefined;
  return `Calculated from: ${windows.join("; compared with ")}${range ? ` · ${range}` : ""}`;
}
