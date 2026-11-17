import { formatGlucoseRangeBounds } from "@/domain/glucoseRanges";
import { formatRegionalNumber } from "@/domain/regionalFormat";
import type { T1ArcRegionalDefaults } from "@/domain/regionalProfile";
import { getZonedDateTimeParts } from "@/domain/time";

import {
  evidenceLinePeriod,
  formatTarvisEvidenceLine,
  type TarvisEvidenceLineData,
} from "./evidenceLine";
import { isTarvisGeneralEducationAnswer } from "./generalEducation";
import type { TarvisAnswer, TarvisDirectAnswerPresentation } from "./types";

/**
 * The short-answer-first card every Tarv1s answer uses:
 *
 * 1. a label and the answer itself (a number, or one short sentence);
 * 2. one context line with the range or period and compact coverage;
 * 3. an extra line only when it changes the meaning (low coverage, missing
 *    records);
 * 4. everything else under a collapsed "Details".
 *
 * Built only from the answer and the locally built evidence line, never from
 * new wording a model wrote. Safety refusals and urgent notices are never
 * moved into Details.
 */
export type TarvisShortAnswerTone = "glucose" | "target" | "neutral";

export interface TarvisShortAnswerValue {
  text: string;
  unit?: string;
  tone: TarvisShortAnswerTone;
  /** Set for glucose values, so the card can colour them by the user's range colours. */
  mmolL?: number;
}

export interface TarvisShortAnswer {
  /** Small line above the answer, e.g. "Time in range, last 7 days". */
  label: string;
  /** The number, when the answer is a single number. */
  value?: TarvisShortAnswerValue;
  /** One short sentence when there is no single number. */
  headline?: string;
  /** Range or period, plus coverage in compact form. Always visible. */
  context?: string;
  /** Shown only when it changes the meaning of the answer. */
  meaning?: string;
  /** Shown in full and never collapsed: a safety boundary or urgent advice. */
  safety?: string;
  /** List answers: every item; the card shows {@link TARVIS_SHORT_LIST_VISIBLE} then "Show all". */
  listItems: string[];
  /** The rest of the answer text, under Details. */
  detailText: string[];
  /** Exact period, counts and range, under Details. */
  exactPeriod?: string;
  /** Where the answer was worked out and what was sent, under Details. */
  source: string;
  /** "Worth keeping in mind" notes, under Details. */
  limitations: string[];
}

export const TARVIS_SHORT_LIST_VISIBLE = 3;
/** Below this, the coverage line explains that the answer may not reflect the period. */
export const TARVIS_SHORT_LOW_COVERAGE_PERCENT = 70;
/** Consensus time-in-range target, used only to pick the calm "in target" colour. */
const TIME_IN_RANGE_TARGET_PERCENT = 70;
const MAX_SENTENCE_HEADLINE = 180;
const DAY_MS = 24 * 60 * 60 * 1000;

type Settings = Pick<T1ArcRegionalDefaults, "locale" | "timeZone" | "glucoseUnit">;

export interface TarvisAnswerOrigin {
  answerSource: "hosted" | "local";
  modelRequestSent: boolean;
}

export function tarvisAnswerSourceLine({ answerSource, modelRequestSent }: TarvisAnswerOrigin) {
  if (answerSource === "hosted") {
    return "Written by your AI connection · your question and the selected records were sent";
  }
  return modelRequestSent
    ? "Worked out on this phone · your question was sent to your AI connection to pick the records"
    : "Worked out on this phone · nothing sent";
}

function capitalise(text: string) {
  return text ? `${text.charAt(0).toUpperCase()}${text.slice(1)}` : text;
}

function cleanLabel(label: string) {
  return capitalise(label.replace(/^(?:observed|your|estimated)\s+/i, "").trim());
}

function percent(value: number, settings: Settings) {
  return `${formatRegionalNumber(value, settings.locale, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}%`;
}

function localDayNumber(timestamp: number, timeZone: string) {
  const parts = getZonedDateTimeParts(timestamp, timeZone);
  return Math.round(Date.UTC(parts.year, parts.month - 1, parts.day) / DAY_MS);
}

function isLocalMidnight(timestamp: number, timeZone: string) {
  const parts = getZonedDateTimeParts(timestamp, timeZone);
  return parts.hour === 0 && parts.minute === 0 && parts.second === 0;
}

/** "last 7 days", "today so far", or the exact dates. */
export function tarvisShortPeriod(
  window: { start: number; end: number },
  asOf: number,
  settings: Settings,
) {
  const throughNow = Math.abs(window.end - asOf) <= 15 * 60 * 1000;
  if (throughNow && isLocalMidnight(window.start, settings.timeZone)) {
    const days = localDayNumber(asOf, settings.timeZone) - localDayNumber(window.start, settings.timeZone) + 1;
    if (days === 1) return "today so far";
    if (days > 1) return `last ${formatRegionalNumber(days, settings.locale, { maximumFractionDigits: 0 })} days`;
  }
  // A rolling window ending now that spans whole days, e.g. the last 7 x 24 hours.
  const rollingDays = (window.end - window.start) / DAY_MS;
  if (throughNow && rollingDays >= 1 && Math.abs(rollingDays - Math.round(rollingDays)) * DAY_MS <= 60 * 1000) {
    const days = Math.round(rollingDays);
    return days === 1
      ? "last 24 hours"
      : `last ${formatRegionalNumber(days, settings.locale, { maximumFractionDigits: 0 })} days`;
  }
  return evidenceLinePeriod(window, settings);
}

/** "3.9–10.0 mmol/L · sensor worn 88% of the time". */
function contextLine(line: TarvisEvidenceLineData | undefined, settings: Settings, withPeriod: string | undefined) {
  if (!line) return withPeriod;
  const parts: string[] = [];
  if (withPeriod) parts.push(withPeriod);
  const range = line.range;
  if (range && range.lowerMmolL !== null && range.upperMmolL !== null) {
    parts.push(formatGlucoseRangeBounds({ lowerMmolL: range.lowerMmolL, upperMmolL: range.upperMmolL }, settings));
  }
  const coverages = line.windows.map((window) => window.coveragePercent);
  if (coverages.every((value): value is number => value !== null)) {
    parts.push(`sensor worn ${coverages.map((value) => percent(value, settings)).join(" and ")} of the time`);
  } else {
    const records = line.windows.map((window) =>
      `${formatRegionalNumber(window.records, settings.locale, { maximumFractionDigits: 0 })} ${window.recordLabel ?? (window.records === 1 ? "glucose reading" : "glucose readings")}`,
    );
    parts.push(records.join(" and "));
  }
  return parts.join(" · ");
}

function meaningLine(line: TarvisEvidenceLineData | undefined, limitations: readonly string[], settings: Settings) {
  if (line) {
    const glucoseWindows = line.windows.filter((window) => window.recordLabel === undefined);
    if (glucoseWindows.some((window) => window.records === 0)) {
      return glucoseWindows.length > 1
        ? "One of the periods has no glucose readings, so it can't be compared."
        : "No glucose readings are stored for this period.";
    }
    const lowest = Math.min(
      ...line.windows.map((window) => window.coveragePercent ?? Number.POSITIVE_INFINITY),
    );
    if (Number.isFinite(lowest) && lowest < TARVIS_SHORT_LOW_COVERAGE_PERCENT) {
      return `Sensor worn only ${percent(lowest, settings)} of the time, so this may not reflect the whole period.`;
    }
  }
  return limitations.find((item) =>
    /\b(?:no glucose readings|partial snapshot|partial day|records are missing|missing records|not stored)\b/i.test(item),
  );
}

const NUMBER_VALUE = /^([-−]?\d[\d.,\s]*)\s*(%|mmol\/L|mg\/dL|U|g|events?|readings?)?$/i;

function parseHeadlineValue(headline: string) {
  const match = /^([^:]{2,70}):\s*(.{1,40})$/.exec(headline.trim());
  if (!match) return undefined;
  const value = NUMBER_VALUE.exec(match[2]!.trim());
  if (!value) return undefined;
  const unit = value[2]?.trim();
  // "82.0%" reads as "82%"; other decimals are kept exactly as calculated.
  const number = unit === "%" ? value[1]!.trim().replace(/[.,]0+$/, "") : value[1]!.trim();
  return { label: match[1]!.trim(), number, unit };
}

function parseLocaleNumber(text: string) {
  const compact = text.replace(/[\s ]/g, "").replace("−", "-");
  const normalised = compact.includes(".") ? compact.replace(/,/g, "") : compact.replace(",", ".");
  const value = Number(normalised);
  return Number.isFinite(value) ? value : undefined;
}

function toneFor(label: string, number: string, unit: string | undefined) {
  const value = parseLocaleNumber(number);
  if (value === undefined) return { tone: "neutral" as const };
  if (unit === "mmol/L") return { tone: "glucose" as const, mmolL: value };
  if (unit === "mg/dL") return { tone: "glucose" as const, mmolL: value / 18.016 };
  if (unit === "%" && /\btime in (?:the |my )?(?:standard |target )?range\b/i.test(label) && !/\b(?:below|above|tight)\b/i.test(label)) {
    return { tone: value >= TIME_IN_RANGE_TARGET_PERCENT ? "target" as const : "neutral" as const };
  }
  return { tone: "neutral" as const };
}

function sentences(text: string) {
  return text
    .split(/(?<=[.!?])\s+(?=[A-Z0-9“"(])/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function splitBullets(text: string) {
  const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);
  const bulletIndexes = lines.flatMap((line, index) => (/^[•\-*]\s+/.test(line) ? [index] : []));
  if (bulletIndexes.length < 2) return undefined;
  const first = bulletIndexes[0]!;
  const last = bulletIndexes.at(-1)!;
  return {
    lead: lines.slice(0, first),
    items: lines.slice(first, last + 1).filter((line) => /^[•\-*]\s+/.test(line)).map((line) => line.replace(/^[•\-*]\s+/, "")),
    rest: lines.slice(last + 1),
  };
}

/**
 * Splits plain answer text into a short headline and the rest.
 * A multi-line answer whose lines are each a record ("Site change: …")
 * becomes a list.
 */
function splitText(text: string) {
  const bullets = splitBullets(text);
  if (bullets) {
    const lead = bullets.lead.join(" ");
    return {
      headline: lead || undefined,
      items: bullets.items,
      rest: bullets.rest,
    };
  }
  const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);
  if (lines.length >= 2 && lines.every((line) => /^[^.:]{2,60}:\s/.test(line))) {
    return { headline: undefined, items: lines, rest: [] };
  }
  const all = sentences(lines.join(" "));
  const first = all[0];
  if (!first) return { headline: undefined, items: [], rest: [] };
  if (first.length > MAX_SENTENCE_HEADLINE) return { headline: undefined, items: [], rest: [lines.join(" ")] };
  return { headline: first, items: [], rest: all.length > 1 ? [all.slice(1).join(" ")] : [] };
}

export interface BuildTarvisShortAnswerInput extends TarvisAnswerOrigin {
  answer: TarvisAnswer;
  evidenceLine?: TarvisEvidenceLineData;
  asOf: number;
  settings: Settings;
}

/** The card for every answer that is not a rich model presentation. */
export function buildTarvisShortAnswer({
  answer,
  evidenceLine,
  asOf,
  settings,
  answerSource,
  modelRequestSent,
}: BuildTarvisShortAnswerInput): TarvisShortAnswer {
  const source = tarvisAnswerSourceLine({ answerSource, modelRequestSent });
  // Safety boundaries are shown whole, never shortened or collapsed.
  if (answer.responseKind === "safety-boundary") {
    return {
      label: answer.headline,
      safety: answer.answer,
      listItems: [],
      detailText: [],
      source,
      limitations: answer.limitations,
    };
  }
  const exactPeriod = evidenceLine ? formatTarvisEvidenceLine(evidenceLine, settings) : undefined;
  const singleWindow = evidenceLine?.windows.length === 1 ? evidenceLine.windows[0] : undefined;
  const period = singleWindow ? tarvisShortPeriod(singleWindow, asOf, settings) : undefined;
  const meaning = meaningLine(evidenceLine, answer.limitations, settings);
  const parsed = parseHeadlineValue(answer.headline);

  if (parsed) {
    const base = cleanLabel(parsed.label);
    const label = period && !base.includes(",") ? `${base}, ${period}` : base;
    return {
      label,
      value: { text: parsed.number, ...(parsed.unit ? { unit: parsed.unit } : {}), ...toneFor(parsed.label, parsed.number, parsed.unit) },
      context: contextLine(evidenceLine, settings, undefined),
      ...(meaning ? { meaning } : {}),
      listItems: [],
      detailText: answer.answer.trim() ? [answer.answer.trim()] : [],
      ...(exactPeriod ? { exactPeriod } : {}),
      source,
      limitations: answer.limitations,
    };
  }

  const general = isTarvisGeneralEducationAnswer(answer);
  const text = answer.answer.trim();
  // A reply that asks the user something stays whole, so the question is never hidden.
  const asksBack = text.includes("?") && text.length <= 400 && !splitBullets(text);
  const split = asksBack ? { headline: text, items: [], rest: [] } : splitText(text);
  const headline = split.headline ?? (split.items.length ? undefined : text);
  return {
    label: answer.headline,
    ...(headline ? { headline } : {}),
    context: general
      ? "General explanation · no personal records used"
      : contextLine(evidenceLine, settings, period),
    ...(meaning ? { meaning } : {}),
    listItems: split.items,
    detailText: split.rest,
    ...(exactPeriod ? { exactPeriod } : {}),
    source,
    limitations: answer.limitations,
  };
}

/**
 * The same structure for a rich model answer. The model's headline leads;
 * its summary and findings move under Details. A safety notice stays
 * visible.
 */
export function buildTarvisDirectShortAnswer({
  presentation,
  evidenceLine,
  settings,
  asOf,
  answerSource,
  modelRequestSent,
}: TarvisAnswerOrigin & {
  presentation: TarvisDirectAnswerPresentation;
  evidenceLine?: TarvisEvidenceLineData;
  asOf: number;
  settings: Settings;
}): TarvisShortAnswer {
  const metric = presentation.primaryMetric;
  const singleWindow = evidenceLine?.windows.length === 1 ? evidenceLine.windows[0] : undefined;
  const period = singleWindow ? tarvisShortPeriod(singleWindow, asOf, settings) : undefined;
  const meaning = meaningLine(evidenceLine, presentation.limitations, settings);
  const exactPeriod = evidenceLine ? formatTarvisEvidenceLine(evidenceLine, settings) : undefined;
  const findings = presentation.keyFindings.map((finding) => `${finding.title}: ${finding.detail}`);
  const value = metric && metric.value.trim() && NUMBER_VALUE.test(`${metric.value} ${metric.unit}`.trim())
    ? {
        text: metric.value,
        ...(metric.unit ? { unit: metric.unit } : {}),
        ...toneFor(metric.label, metric.value, metric.unit || undefined),
      }
    : undefined;
  return {
    label: value && metric ? (period ? `${cleanLabel(metric.label)}, ${period}` : cleanLabel(metric.label)) : presentation.headline,
    ...(value ? { value } : { headline: sentences(presentation.summary)[0] ?? presentation.summary }),
    context: contextLine(evidenceLine, settings, value ? undefined : period),
    ...(meaning ? { meaning } : {}),
    ...(presentation.safetyNotice ? { safety: presentation.safetyNotice } : {}),
    listItems: findings,
    detailText: [
      ...(value ? [presentation.headline, presentation.summary] : sentences(presentation.summary).slice(1)),
      ...(presentation.interpretation ? [presentation.interpretation] : []),
    ].filter((item) => item.trim().length > 0),
    ...(exactPeriod ? { exactPeriod } : {}),
    source: tarvisAnswerSourceLine({ answerSource, modelRequestSent }),
    limitations: presentation.limitations,
  };
}
