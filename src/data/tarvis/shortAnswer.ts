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
  /** Urgent help: the safety box is shown in bold and announced as the card's one alert. */
  urgent?: boolean;
  /**
   * The label is itself the phone's own urgent safety headline ("Call 999"), so it
   * is shown large. Never set for a label an AI connection wrote.
   */
  urgentLabel?: boolean;
  /** Notes that belong to a safety boundary; shown with it, never collapsed. */
  safetyNotes?: string[];
  /** Warning list items an AI connection wrote; kept as a list inside the safety box. */
  safetyItems?: string[];
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

/** "Observed time in range" reads "Time in range"; "Estimated" is kept, as it is part of the meaning. */
function cleanLabel(label: string) {
  return capitalise(label.replace(/^(?:observed|your)\s+/i, "").trim());
}

/** Headlines of the phone's own urgent safety answers ("Get urgent diabetes advice now"). */
const URGENT_HEADLINE = /\b(?:now|urgent(?:ly)?|emergency|ambulance|immediately|999|911|112|A&E)\b/i;

/**
 * Text written by an AI connection is urgent only when it sends the person for
 * emergency or urgent help, not merely because it says "now".
 */
const URGENT_ADVICE =
  /\b(?:999|911|112|emergency|ambulance|A&E|hospital|urgent(?:ly)?|immediately|straight\s+away|right\s+away|medical\s+(?:attention|help)|unconscious|unresponsive|seizures?|glucagon|can(?:['’]|no)?t\s+keep\s+(?:any\s+)?(?:fluids?|drinks?|water|food|anything)\s+down)\b/i;

/** Sentences a reply must never fold away: warnings and urgent advice. */
const WARNING_SENTENCE =
  /\b(?:999|911|112|111|emergency|ambulance|hospital|urgent(?:ly)?|A&E|immediately|straight\s+away|right\s+away|medical\s+(?:attention|help|advice|care)|seek\s+(?:urgent\s+|medical\s+)?(?:help|advice|care)|call\s+(?:your|the|a)\s+(?:diabetes|care|medical|clinical)|ketones?|DKA|ketoacidosis|glucagon|unconscious|unresponsive|seizures?|can(?:['’]|no)?t\s+keep\s+(?:any\s+)?(?:fluids?|drinks?|water|food|anything)\s+down|do\s+not\s+drive|don['’]t\s+drive|warning|danger(?:ous)?|unsafe|severe(?:ly)?)\b/i;

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

/**
 * Both periods of a comparison, compactly: "last 7 days vs previous 7 days",
 * or each period's own name or dates when they are not back to back.
 */
export function tarvisShortComparisonPeriod(
  windows: readonly { start: number; end: number }[],
  asOf: number,
  settings: Settings,
) {
  const names = windows.map((window) => tarvisShortPeriod(window, asOf, settings));
  if (windows.length === 2) {
    const [first, second] = windows as [{ start: number; end: number }, { start: number; end: number }];
    const sameLength = Math.abs((first.end - first.start) - (second.end - second.start)) <= 60 * 60 * 1000;
    const backToBack = Math.abs(first.start - second.end) <= 60 * 1000 || Math.abs(second.start - first.end) <= 60 * 1000;
    const laterIndex = first.end >= second.end ? 0 : 1;
    const later = names[laterIndex]!;
    const days = /^last (.+) days$/.exec(later);
    if (sameLength && backToBack && days) {
      names[1 - laterIndex] = `previous ${days[1]} days`;
    }
  }
  return names.join(" vs ");
}

/** The period text for the context line: one period, or both periods of a comparison. */
function periodText(line: TarvisEvidenceLineData | undefined, asOf: number, settings: Settings) {
  if (!line?.windows.length) return undefined;
  return line.windows.length === 1
    ? tarvisShortPeriod(line.windows[0]!, asOf, settings)
    : tarvisShortComparisonPeriod(line.windows, asOf, settings);
}

/** "3.9–10.0 mmol/L · sensor worn 88% of the time", or "… · sensor 88% / 91%" for two periods. */
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
    parts.push(
      coverages.length === 1
        ? `sensor worn ${percent(coverages[0]!, settings)} of the time`
        : `sensor ${coverages.map((value) => percent(value, settings)).join(" / ")}`,
    );
  } else {
    const records = line.windows.map((window) =>
      `${formatRegionalNumber(window.records, settings.locale, { maximumFractionDigits: 0 })} ${window.recordLabel ?? (window.records === 1 ? "glucose reading" : "glucose readings")}`,
    );
    parts.push(records.join(" / "));
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
  // A space must follow the colon, so a clock time ("through 10:07") is never
  // read as "label: value" with "07" as the answer.
  const match = /^([^:]{2,70}):\s+(.{1,40})$/.exec(headline.trim());
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

/**
 * A glucose level (an average, a reading, the lowest or highest), not a spread,
 * a change, a range width, an excursion or a target setting.
 */
function isGlucoseLevelLabel(label: string) {
  if (/\b(?:standard\s+deviation|sd|deviation|variab\w*|variation|coefficient|cv|change|changes|changed|difference|delta|drop|rise|rises|fall|increase|decrease|spread|interquartile|iqr|swing|swings|gap|vs\.?|versus|compared|per\s+hour|rate|gmi|management\s+indicator|a1c|hba1c|range|ranges|width|span|amplitude|excursions?|spikes?|mage|target|targets|isf|sensitivity|factor|ratio)\b/i.test(label)) {
    return false;
  }
  return /\b(?:glucose|bg|blood\s+sugar|sugar|reading|level|average|mean|median|lowest|highest|minimum|maximum|min|max|current|latest|peak|nadir)\b/i.test(label);
}

function toneFor(label: string, number: string, unit: string | undefined) {
  const value = parseLocaleNumber(number);
  if (value === undefined) return { tone: "neutral" as const };
  // Only actual glucose levels take the range colours; a spread or a change does not.
  if ((unit === "mmol/L" || unit === "mg/dL") && value > 0 && isGlucoseLevelLabel(label)) {
    return { tone: "glucose" as const, mmolL: unit === "mmol/L" ? value : value / 18.016 };
  }
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

/** Moves warning and urgent-advice sentences out of the folded text. */
function keepWarningsVisible(paragraphs: readonly string[]) {
  const visible: string[] = [];
  const rest: string[] = [];
  for (const paragraph of paragraphs) {
    const folded: string[] = [];
    for (const sentence of sentences(paragraph)) {
      (WARNING_SENTENCE.test(sentence) ? visible : folded).push(sentence);
    }
    if (folded.length) rest.push(folded.join(" "));
  }
  return { visible, rest };
}

/**
 * List items that hold a warning or urgent advice are taken out of the list,
 * so they can never end up behind "Show all", and are shown in the safety box.
 */
function pinWarningItems(items: readonly string[]) {
  const pinned: string[] = [];
  const rest: string[] = [];
  for (const item of items) (WARNING_SENTENCE.test(item) ? pinned : rest).push(item);
  return { pinned, rest };
}

/**
 * The always-visible safety box for text an AI connection wrote, if any part
 * needs it. Two or more warning list items stay a list inside the box rather
 * than being run together into one paragraph.
 */
function modelSafety(items: readonly string[], sentences: readonly string[]) {
  const listed = items.map((item) => item.trim()).filter(Boolean);
  const prose = sentences.map((sentence) => sentence.trim()).filter(Boolean);
  if (!listed.length && !prose.length) return {};
  const urgent = [...listed, ...prose].some((part) => URGENT_ADVICE.test(part)) ? { urgent: true } : {};
  if (listed.length < 2) return { safety: [...listed, ...prose].join(" "), ...urgent };
  return { safety: prose.length ? prose.join(" ") : "Keep these points in view:", safetyItems: listed, ...urgent };
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
  // Their notes stay with them, outside Details.
  if (answer.responseKind === "safety-boundary") {
    return {
      label: answer.headline,
      safety: answer.answer,
      ...(URGENT_HEADLINE.test(answer.headline) ? { urgent: true, urgentLabel: true } : {}),
      ...(answer.limitations.length ? { safetyNotes: answer.limitations } : {}),
      listItems: [],
      detailText: [],
      source,
      limitations: [],
    };
  }
  const exactPeriod = evidenceLine ? formatTarvisEvidenceLine(evidenceLine, settings) : undefined;
  const singleWindow = evidenceLine?.windows.length === 1 ? evidenceLine.windows[0] : undefined;
  const period = singleWindow ? tarvisShortPeriod(singleWindow, asOf, settings) : undefined;
  const allPeriods = periodText(evidenceLine, asOf, settings);
  // A local record answer brings its own period, coverage and notice lines.
  const ownContext = answerSource === "local" ? answer.shortContext : undefined;
  const ownNotice = answerSource === "local" ? answer.shortNotice : undefined;
  const lowConfidence = answer.confidence === "limited" ? answer.limitations[0] : undefined;
  const meaning = ownNotice ?? meaningLine(evidenceLine, answer.limitations, settings) ?? lowConfidence;
  const parsed = parseHeadlineValue(answer.headline);

  if (parsed) {
    const base = cleanLabel(parsed.label);
    const labelHasPeriod = Boolean(period) && !base.includes(",");
    const label = labelHasPeriod ? `${base}, ${period}` : base;
    return {
      label,
      value: { text: parsed.number, ...(parsed.unit ? { unit: parsed.unit } : {}), ...toneFor(parsed.label, parsed.number, parsed.unit) },
      context: ownContext ?? contextLine(evidenceLine, settings, labelHasPeriod ? undefined : allPeriods),
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
  // A reply from an AI connection keeps any warning or urgent advice visible;
  // only ordinary explanation folds into Details.
  const hosted = answerSource === "hosted";
  const kept = hosted ? keepWarningsVisible(split.rest) : { visible: [], rest: split.rest };
  const items = hosted ? pinWarningItems(split.items) : { pinned: [], rest: split.items };
  return {
    label: answer.headline,
    ...(headline ? { headline } : {}),
    context: general
      ? "General explanation · no personal records used"
      : ownContext ?? contextLine(evidenceLine, settings, allPeriods),
    ...(meaning ? { meaning } : {}),
    ...modelSafety(items.pinned, kept.visible),
    listItems: items.rest,
    detailText: kept.rest,
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
  const allPeriods = periodText(evidenceLine, asOf, settings);
  const meaning = meaningLine(evidenceLine, presentation.limitations, settings);
  const exactPeriod = evidenceLine ? formatTarvisEvidenceLine(evidenceLine, settings) : undefined;
  const findings = presentation.keyFindings.map((finding) => `${finding.title}: ${finding.detail}`);
  // A finding with a warning or urgent advice is never left behind "Show all".
  const pinnedFindings = pinWarningItems(findings);
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
    context: contextLine(evidenceLine, settings, value && period ? undefined : allPeriods),
    ...(meaning ? { meaning } : {}),
    ...modelSafety(pinnedFindings.pinned, presentation.safetyNotice ? [presentation.safetyNotice] : []),
    listItems: pinnedFindings.rest,
    detailText: [
      ...(value ? [presentation.headline, presentation.summary] : sentences(presentation.summary).slice(1)),
      ...(presentation.interpretation ? [presentation.interpretation] : []),
    ].filter((item) => item.trim().length > 0),
    ...(exactPeriod ? { exactPeriod } : {}),
    source: tarvisAnswerSourceLine({ answerSource, modelRequestSent }),
    limitations: presentation.limitations,
  };
}
