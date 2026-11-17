import { buildDataCompletenessReport } from "@/domain/dataCompleteness";
import type { EvidenceReference, EvidenceRecordPreview } from "@/domain/insights";
import type { BolusDelivery, MealEvent, TimeRange, TimelineData } from "@/domain/models";
import { recordSourceLabel } from "@/domain/recordSourceLabels";
import { addDays, formatShortDate, formatTime, toDateKey, zonedDateTimeToTimestamp, type DateKey } from "@/domain/time";
import { summarizeInsulinByDay, summarizeInsulinRange } from "@/domain/timelineInsulinSummary";
import { isManualBasalInjection } from "@/data/manualInsulin";

import type {
  CarbsPerDayQuestion,
  InsulinBreakdownQuestion,
  RecordPeriod,
} from "./recordQuestions";
import { formatTarvisFixedNumber, formatTarvisNumber } from "./regionalNumberPresentation";
import type { TarvisAnswer } from "./types";

/**
 * Local answers for "how many boluses were SMBs", "split into basal and
 * boluses", "yesterday vs today so far" and "carbs on each of the last N
 * days". Counts and sums come straight from the stored, already reconciled
 * records; nothing is estimated and nothing is sent.
 */

/** Same gate as the insulin totals: timed basal must cover nearly the whole period. */
export const BREAKDOWN_BASAL_COVERAGE_PERCENT = 95;
/** A saved daily total and the individual records may differ by rounding only. */
const SOURCE_TOTAL_TOLERANCE_UNITS = 0.1;
const MAX_EXAMPLES = 12;

export interface RecordPeriodWindow {
  period: RecordPeriod;
  range: TimeRange;
  /** "yesterday", "today so far", "the last 7 days". */
  name: string;
  /** "Mon 16 Nov" or "Wed 11 Nov – Tue 17 Nov". */
  dates: string;
}

export interface BreakdownResult {
  answer: TarvisAnswer;
  evidence: EvidenceReference[];
}

function dayStart(dateKey: DateKey) {
  return zonedDateTimeToTimestamp(dateKey);
}

/** Local calendar edges, so 23- and 25-hour DST days are handled. */
export function recordPeriodWindow(period: RecordPeriod, asOf: number): RecordPeriodWindow {
  const today = toDateKey(asOf);
  if (period.kind === "today") {
    return { period, range: { start: dayStart(today), end: asOf }, name: "today so far", dates: formatShortDate(today) };
  }
  if (period.kind === "yesterday") {
    const yesterday = addDays(today, -1);
    return { period, range: { start: dayStart(yesterday), end: dayStart(today) }, name: "yesterday", dates: formatShortDate(yesterday) };
  }
  const first = addDays(today, -(period.days - 1));
  return {
    period,
    range: { start: dayStart(first), end: asOf },
    name: period.days === 1 ? "today so far" : `the last ${formatTarvisNumber(period.days, { maximumFractionDigits: 0 })} days`,
    dates: period.days === 1 ? formatShortDate(today) : `${formatShortDate(first)} – ${formatShortDate(today)} (so far)`,
  };
}

/** The range to load for a record question about periods. */
export function recordPeriodsRange(periods: readonly RecordPeriod[], asOf: number): TimeRange {
  const windows = periods.map((period) => recordPeriodWindow(period, asOf).range);
  return {
    start: Math.min(...windows.map(({ start }) => start)),
    end: Math.max(...windows.map(({ end }) => end)),
  };
}

export function carbsPerDayRange(question: CarbsPerDayQuestion, asOf: number): TimeRange {
  return recordPeriodWindow({ kind: "last-days", days: question.days }, asOf).range;
}

function unitsText(value: number) {
  return `${formatTarvisFixedNumber(value, 2)} U`;
}

function countText(value: number) {
  return formatTarvisNumber(value, { maximumFractionDigits: 0 });
}

function gramsText(value: number) {
  return `${formatTarvisNumber(value, { maximumFractionDigits: 1 })} g`;
}

function capitalise(text: string) {
  return text ? `${text.charAt(0).toUpperCase()}${text.slice(1)}` : text;
}

/** AAPS marks its automatic boluses as SMB. */
export function isSmbBolus(bolus: Pick<BolusDelivery, "deliveryType">) {
  return bolus.deliveryType?.trim().toUpperCase() === "SMB";
}

/** Glooko exports do not say whether a bolus was automatic. */
function sourceMarksSmb(bolus: Pick<BolusDelivery, "sourceId">) {
  return !/glooko/i.test(bolus.sourceId);
}

function inRange(timestamp: number, range: TimeRange) {
  // A record exactly at midnight belongs to the day that starts then.
  return timestamp >= range.start && timestamp < range.end;
}

function carbMeals(timeline: Pick<TimelineData, "context">, range: TimeRange) {
  return timeline.context.filter(
    (event): event is MealEvent & { carbsGrams: number } =>
      event.kind === "meal" &&
      !event.excludedFoodSource &&
      event.carbsGrams !== undefined &&
      Number.isFinite(event.carbsGrams) &&
      inRange(event.start, range),
  );
}

interface CarbSummary {
  entries: number;
  grams: number;
  /** Grams per source label when more than one source remains after reconciliation. */
  bySource?: { label: string; grams: number }[];
}

function summarizeCarbs(meals: readonly (MealEvent & { carbsGrams: number })[]): CarbSummary {
  const bySource = new Map<string, number>();
  for (const meal of meals) {
    const label = meal.sourceLabel ?? recordSourceLabel(meal.sourceId);
    bySource.set(label, (bySource.get(label) ?? 0) + meal.carbsGrams);
  }
  return {
    entries: meals.length,
    grams: meals.reduce((sum, meal) => sum + meal.carbsGrams, 0),
    ...(bySource.size > 1
      ? { bySource: [...bySource].map(([label, grams]) => ({ label, grams })).sort((a, b) => a.label.localeCompare(b.label)) }
      : {}),
  };
}

function carbText(summary: CarbSummary) {
  if (!summary.entries) return "no carb entries stored";
  const entries = `${countText(summary.entries)} ${summary.entries === 1 ? "entry" : "entries"}`;
  if (summary.bySource) {
    return `${summary.bySource.map(({ label, grams }) => `${label} ${gramsText(grams)}`).join(" · ")} (${entries}, per source)`;
  }
  return `${gramsText(summary.grams)} (${entries})`;
}

interface PeriodBreakdown {
  window: RecordPeriodWindow;
  smb: { count: number; units: number };
  other: { count: number; units: number };
  /** True when no bolus in the period comes from a source that marks SMBs. */
  smbUnknown: boolean;
  /** Some, but not all, boluses come from a source that does not mark SMBs. */
  someSmbUnknown: boolean;
  basal: { units: number } | { coveragePercent: number };
  carbs: CarbSummary;
  sourceMismatch?: { source: number; records: number };
  boluses: BolusDelivery[];
  meals: MealEvent[];
}

/**
 * Basal units without the 0.1 U display rounding of the shared totals: the
 * saved daily basal totals when every day has one, otherwise timed basal
 * clipped to the period (as the shared totals do) plus manual basal injections.
 */
function exactBasalUnits(timeline: TimelineData, range: TimeRange, sourceProvidesBasal: boolean) {
  if (sourceProvidesBasal) {
    return summarizeInsulinByDay(timeline.basal, timeline.boluses, range, timeline.dailyInsulinTotals)
      .reduce((sum, day) => sum + day.basalUnits, 0);
  }
  const timed = timeline.basal.reduce((total, delivery) => {
    const start = Math.max(delivery.start, range.start);
    const end = Math.min(delivery.end, range.end);
    if (end <= start || delivery.end <= delivery.start) return total;
    return total + delivery.units * ((end - start) / (delivery.end - delivery.start));
  }, 0);
  const injected = timeline.boluses
    .filter((bolus) => isManualBasalInjection(bolus) && inRange(bolus.timestamp, range))
    .reduce((sum, bolus) => sum + bolus.units, 0);
  return timed + injected;
}

function breakdownFor(window: RecordPeriodWindow, timeline: TimelineData): PeriodBreakdown {
  const { range } = window;
  // Manual basal injections count as basal, as in the shared insulin totals.
  const boluses = timeline.boluses.filter((bolus) => inRange(bolus.timestamp, range) && !isManualBasalInjection(bolus));
  const smb = boluses.filter(isSmbBolus);
  const other = boluses.filter((bolus) => !isSmbBolus(bolus));
  const unmarked = other.filter((bolus) => !sourceMarksSmb(bolus));
  const summary = summarizeInsulinRange(timeline.basal, timeline.boluses, range, timeline.dailyInsulinTotals);
  const coverage = buildDataCompletenessReport({ ...timeline, range }).timedBasal.coveragePercent;
  const basalAvailable = summary.sourceProvidesBasalEveryDay || coverage >= BREAKDOWN_BASAL_COVERAGE_PERCENT;
  const recordBolusUnits = boluses.reduce((sum, bolus) => sum + bolus.units, 0);
  const meals = carbMeals(timeline, range);
  return {
    window,
    smb: { count: smb.length, units: smb.reduce((sum, bolus) => sum + bolus.units, 0) },
    other: { count: other.length, units: other.reduce((sum, bolus) => sum + bolus.units, 0) },
    smbUnknown: boluses.length > 0 && boluses.every((bolus) => !sourceMarksSmb(bolus)),
    someSmbUnknown: unmarked.length > 0 && unmarked.length < boluses.length,
    basal: basalAvailable
      ? { units: exactBasalUnits(timeline, range, summary.sourceProvidesBasalEveryDay) }
      : { coveragePercent: coverage },
    carbs: summarizeCarbs(meals),
    ...(summary.sourceProvidesBolusEveryDay &&
    Math.abs(summary.stats.bolusUnits - recordBolusUnits) > SOURCE_TOTAL_TOLERANCE_UNITS
      ? { sourceMismatch: { source: summary.stats.bolusUnits, records: recordBolusUnits } }
      : {}),
    boluses,
    meals,
  };
}

function bolusCount(part: { count: number; units: number }) {
  return part.count ? `${countText(part.count)} (${unitsText(part.units)})` : "none";
}

function basalText(part: PeriodBreakdown["basal"]) {
  return "units" in part
    ? unitsText(part.units)
    : `not totalled (timed basal records span ${formatTarvisNumber(part.coveragePercent, { maximumFractionDigits: 0 })}% of this period)`;
}

function smbText(part: PeriodBreakdown) {
  return part.smbUnknown ? "not marked in these records" : bolusCount(part.smb);
}

function totalText(part: PeriodBreakdown) {
  if (!("units" in part.basal) || part.sourceMismatch) return undefined;
  return unitsText(part.basal.units + part.smb.units + part.other.units);
}

function storedStartSentence(timeline: Pick<TimelineData, "sources">, start: number) {
  const starts = timeline.sources
    .map(({ dataFrom }) => dataFrom)
    .filter((value): value is number => value !== undefined);
  if (!starts.length) return undefined;
  const earliest = Math.min(...starts);
  return earliest > start ? `Stored records start on ${formatShortDate(toDateKey(earliest))}.` : undefined;
}

function evidenceFor(
  bolusRecords: readonly BolusDelivery[],
  mealRecords: readonly MealEvent[],
  range: TimeRange,
): EvidenceReference[] {
  const boluses = [...new Map(bolusRecords.map((bolus) => [bolus.id, bolus])).values()]
    .sort((a, b) => a.timestamp - b.timestamp);
  const meals = [...new Map(mealRecords.map((meal) => [meal.id, meal])).values()]
    .sort((a, b) => a.start - b.start);
  const evidence: EvidenceReference[] = [];
  if (boluses.length) {
    evidence.push({
      id: "breakdown-boluses",
      label: "Bolus records",
      description: "Every stored bolus in the period, with its SMB marking.",
      range,
      recordIds: boluses.map(({ id }) => id),
      examples: boluses.slice(-MAX_EXAMPLES).map((bolus): EvidenceRecordPreview => ({
        id: bolus.id,
        kind: "bolus",
        timestamp: bolus.timestamp,
        primary: `${unitsText(bolus.units)} bolus`,
        secondary: isSmbBolus(bolus) ? "SMB" : (bolus.deliveryType ?? "not marked SMB"),
        sourceId: bolus.sourceId,
      })),
    });
  }
  if (meals.length) {
    evidence.push({
      id: "breakdown-carbs",
      label: "Carb entries",
      description: "Every stored carb entry in the period.",
      range,
      recordIds: meals.map(({ id }) => id),
      examples: meals.slice(-MAX_EXAMPLES).map((meal): EvidenceRecordPreview => ({
        id: meal.id,
        kind: "context",
        timestamp: meal.start,
        primary: gramsText(meal.carbsGrams ?? 0),
        secondary: meal.sourceLabel ?? recordSourceLabel(meal.sourceId),
        sourceId: meal.sourceId,
      })),
    });
  }
  return evidence;
}

const BREAKDOWN_LIMITATIONS = [
  "SMBs are boluses AAPS marked as SMB. Other boluses include the ones you entered; they are not called meal boluses unless the record says so.",
  "These are stored records, not advice about doses.",
];

function periodHeading(window: RecordPeriodWindow) {
  return window.period.kind === "today" ? `${window.dates}, until ${formatTime(window.range.end)}` : window.dates;
}

/**
 * One period: a short lead line, then one line per part. Two periods: one
 * line per part with both values, so the card list keeps them side by side.
 */
export function buildInsulinBreakdownAnswer({
  question,
  timeline,
  asOf,
}: {
  question: InsulinBreakdownQuestion;
  timeline: TimelineData;
  asOf: number;
}): BreakdownResult {
  const windows = question.periods.map((period) => recordPeriodWindow(period, asOf));
  const parts = windows.map((window) => breakdownFor(window, timeline));
  const range = recordPeriodsRange(question.periods, asOf);
  const limitations = [...BREAKDOWN_LIMITATIONS];
  for (const part of parts) {
    const where = parts.length > 1 ? ` for ${part.window.name}` : "";
    if ("coveragePercent" in part.basal) {
      limitations.push(
        `Basal${where}: recorded temporary basals cover ${formatTarvisNumber(part.basal.coveragePercent, { maximumFractionDigits: 0 })}% of this period, so a basal total is not available.`,
      );
    }
    if (part.sourceMismatch) {
      limitations.push(
        `The saved daily total${where} says ${unitsText(part.sourceMismatch.source)} of bolus insulin, but the individual bolus records add up to ${unitsText(part.sourceMismatch.records)}. Both are shown as stored; neither is picked.`,
      );
    }
    if (part.smbUnknown) {
      limitations.push(`These records${where} do not say whether a bolus was automatic.`);
    }
    if (part.carbs.bySource) {
      limitations.push(`Carbs${where} come from more than one source, so grams are listed per source, not added together.`);
    }
    if (part.someSmbUnknown) {
      limitations.push(`Some bolus records${where} come from a source that does not say whether a bolus was automatic, so they are counted as other boluses.`);
    }
  }
  const started = storedStartSentence(timeline, range.start);
  if (started) limitations.push(started);

  let lines: string[];
  let headline: string;
  if (parts.length === 1) {
    const [part] = parts as [PeriodBreakdown];
    headline = `Insulin and carbs, ${part.window.name}`;
    const total = totalText(part);
    lines = [
      `${capitalise(part.window.name)}, ${periodHeading(part.window)}:`,
      `• Basal delivered: ${basalText(part.basal)}`,
      `• SMBs delivered, marked SMB by AAPS: ${smbText(part)}`,
      `• Other boluses delivered, not marked SMB: ${bolusCount(part.other)}`,
      ...(part.sourceMismatch ? [`• Saved daily bolus total: ${unitsText(part.sourceMismatch.source)}`] : []),
      ...(total ? [`• Total delivered: ${total}`] : []),
      `• Carbs entered: ${carbText(part.carbs)}`,
    ];
  } else {
    headline = `${capitalise(parts.map((part) => part.window.name).join(" vs "))}`;
    const both = (text: (part: PeriodBreakdown) => string) =>
      parts.map((part) => `${part.window.name} ${text(part)}`).join(" · ");
    lines = [
      `${parts.map((part, index) => `${index ? part.window.name : capitalise(part.window.name)} (${periodHeading(part.window)})`).join(" compared with ")}:`,
      `• SMBs delivered, marked SMB by AAPS: ${both(smbText)}`,
      `• Other boluses delivered, not marked SMB: ${both((part) => bolusCount(part.other))}`,
      `• Carbs entered: ${both((part) => carbText(part.carbs))}`,
      `• Basal delivered: ${both((part) => basalText(part.basal))}`,
    ];
  }
  const evidence = evidenceFor(
    parts.flatMap((part) => part.boluses),
    parts.flatMap((part) => part.meals),
    range,
  );
  const complete = parts.every((part) => "units" in part.basal && !part.sourceMismatch && !part.smbUnknown);
  return {
    answer: {
      headline,
      answer: lines.join("\n"),
      confidence: complete ? "high" : "moderate",
      evidenceIds: evidence.map(({ id }) => id),
      limitations,
    },
    evidence,
  };
}

/** Carbs entered on each local day, oldest first; today is marked "so far". */
export function buildCarbsPerDayAnswer({
  question,
  timeline,
  asOf,
}: {
  question: CarbsPerDayQuestion;
  timeline: TimelineData;
  asOf: number;
}): BreakdownResult {
  const today = toDateKey(asOf);
  const range = carbsPerDayRange(question, asOf);
  const lines: string[] = [];
  const meals: MealEvent[] = [];
  for (let offset = question.days - 1; offset >= 0; offset -= 1) {
    const dateKey = addDays(today, -offset);
    const dayRange = { start: dayStart(dateKey), end: offset === 0 ? asOf : dayStart(addDays(dateKey, 1)) };
    const dayMeals = carbMeals(timeline, dayRange);
    meals.push(...dayMeals);
    lines.push(`• ${formatShortDate(dateKey)}${offset === 0 ? " (so far)" : ""}: ${carbText(summarizeCarbs(dayMeals))}`);
  }
  const days = countText(question.days);
  const evidence = evidenceFor([], meals, range);
  const limitations = [
    "Only carb entries stored on this phone count. A day with no entries may mean nothing was logged, not that nothing was eaten.",
  ];
  const started = storedStartSentence(timeline, range.start);
  if (started) limitations.push(started);
  return {
    answer: {
      headline: `Carbs entered, last ${days} days`,
      answer: [`Carbs entered on each of the last ${days} days, oldest first:`, ...lines].join("\n"),
      confidence: "high",
      evidenceIds: evidence.map(({ id }) => id),
      limitations,
    },
    evidence,
  };
}
