import { buildDataCompletenessReport } from "@/domain/dataCompleteness";
import type { EvidenceReference, EvidenceRecordPreview } from "@/domain/insights";
import { bolusSourceRecordsSmbMarking } from "@/domain/insulinSourceReconciliation";
import type { BolusDelivery, DataSourceStatus, MealEvent, TimeRange, TimelineData } from "@/domain/models";
import { recordSourceLabel } from "@/domain/recordSourceLabels";
import { addDays, formatShortDate, formatTime, toDateKey, zonedDateTimeToTimestamp, type DateKey } from "@/domain/time";
import { sourceSupports } from "@/domain/sourceCapabilities";
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

/** Records stored up to this long before the end of a period still count as up to date. */
const FRESHNESS_TOLERANCE_MS = 15 * 60 * 1000;

export interface RecordPeriodWindow {
  period: RecordPeriod;
  range: TimeRange;
  /** "yesterday", "today so far", "the last 7 days", "last week". */
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

/** Days since the most recent local Monday (0 on a Monday). */
function daysSinceMonday(dateKey: DateKey) {
  const [year, month, day] = dateKey.split("-").map(Number) as [number, number, number];
  return (new Date(Date.UTC(year, month - 1, day)).getUTCDay() + 6) % 7;
}

function datesText(first: DateKey, last: DateKey) {
  return first === last ? formatShortDate(first) : `${formatShortDate(first)} – ${formatShortDate(last)}`;
}

/** Local calendar edges, so 23- and 25-hour DST days are handled. Weeks run Monday to Sunday. */
export function recordPeriodWindow(period: RecordPeriod, asOf: number): RecordPeriodWindow {
  const today = toDateKey(asOf);
  if (period.kind === "today") {
    return { period, range: { start: dayStart(today), end: asOf }, name: "today so far", dates: formatShortDate(today) };
  }
  if (period.kind === "yesterday") {
    const yesterday = addDays(today, -1);
    return { period, range: { start: dayStart(yesterday), end: dayStart(today) }, name: "yesterday", dates: formatShortDate(yesterday) };
  }
  if (period.kind === "this-week") {
    const monday = addDays(today, -daysSinceMonday(today));
    return { period, range: { start: dayStart(monday), end: asOf }, name: "this week so far", dates: datesText(monday, today) };
  }
  if (period.kind === "last-week") {
    const thisMonday = addDays(today, -daysSinceMonday(today));
    const monday = addDays(thisMonday, -7);
    return {
      period,
      range: { start: dayStart(monday), end: dayStart(thisMonday) },
      name: "last week",
      dates: datesText(monday, addDays(thisMonday, -1)),
    };
  }
  const first = addDays(today, -(period.days - 1));
  return {
    period,
    range: { start: dayStart(first), end: asOf },
    name: period.days === 1 ? "today so far" : `the last ${formatTarvisNumber(period.days, { maximumFractionDigits: 0 })} days`,
    dates: datesText(first, today),
  };
}

/** "today so far" -> "Today so far"; "the last 7 days" -> "Last 7 days". */
function shortName(window: RecordPeriodWindow) {
  return capitalise(window.name.replace(/^the\s+/, ""));
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

/**
 * AAPS marks its automatic boluses as SMB. A kept Glooko copy carries the
 * marking of a hidden AAPS or Nightscout copy of the same delivery.
 */
export function isSmbBolus(bolus: Pick<BolusDelivery, "deliveryType" | "smbMarking">) {
  return bolus.deliveryType?.trim().toUpperCase() === "SMB" || bolus.smbMarking?.smb === true;
}

/** Glooko exports do not say whether a bolus was automatic, unless a matched copy does. */
function sourceMarksSmb(bolus: Pick<BolusDelivery, "sourceId" | "smbMarking">) {
  return bolusSourceRecordsSmbMarking(bolus.sourceId) || bolus.smbMarking !== undefined;
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

function carbSourceIds(meals: readonly MealEvent[]) {
  return [...new Set(meals.map((meal) => meal.sourceLabel ?? recordSourceLabel(meal.sourceId)))];
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
  /** Manual long-acting injections, listed on their own line so none is hidden. */
  longActing: { count: number; units: number };
  /** True when no bolus in the period comes from a source that marks SMBs. */
  smbUnknown: boolean;
  /** Boluses from a source that does not mark SMBs, counted as other boluses. */
  unmarked: { count: number; sources: string[] };
  basal: { units: number; includesLongActing: boolean } | { coveragePercent: number };
  /** Timed basal coverage of the period, 0-100. */
  basalCoveragePercent: number;
  basalFromDailyTotals: boolean;
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

function sumUnits(records: readonly BolusDelivery[]) {
  return records.reduce((sum, bolus) => sum + bolus.units, 0);
}

function breakdownFor(window: RecordPeriodWindow, timeline: TimelineData): PeriodBreakdown {
  const { range } = window;
  // Manual basal injections count as basal, as in the shared insulin totals,
  // and are also listed on their own line.
  const inPeriod = timeline.boluses.filter((bolus) => inRange(bolus.timestamp, range));
  const longActing = inPeriod.filter(isManualBasalInjection);
  const boluses = inPeriod.filter((bolus) => !isManualBasalInjection(bolus));
  const smb = boluses.filter(isSmbBolus);
  const other = boluses.filter((bolus) => !isSmbBolus(bolus));
  const unmarked = other.filter((bolus) => !sourceMarksSmb(bolus));
  const summary = summarizeInsulinRange(timeline.basal, timeline.boluses, range, timeline.dailyInsulinTotals);
  const coverage = buildDataCompletenessReport({ ...timeline, range }).timedBasal.coveragePercent;
  const basalAvailable = summary.sourceProvidesBasalEveryDay || coverage >= BREAKDOWN_BASAL_COVERAGE_PERCENT;
  const recordBolusUnits = sumUnits(boluses);
  const meals = carbMeals(timeline, range);
  return {
    window,
    smb: { count: smb.length, units: sumUnits(smb) },
    other: { count: other.length, units: sumUnits(other) },
    longActing: { count: longActing.length, units: sumUnits(longActing) },
    smbUnknown: boluses.length > 0 && boluses.every((bolus) => !sourceMarksSmb(bolus)),
    unmarked: {
      count: unmarked.length,
      sources: [...new Set(unmarked.map(({ sourceId }) => recordSourceLabel(sourceId)))],
    },
    basal: basalAvailable
      ? {
          units: exactBasalUnits(timeline, range, summary.sourceProvidesBasalEveryDay),
          includesLongActing: !summary.sourceProvidesBasalEveryDay,
        }
      : { coveragePercent: coverage },
    basalCoveragePercent: coverage,
    basalFromDailyTotals: summary.sourceProvidesBasalEveryDay,
    carbs: summarizeCarbs(meals),
    ...(summary.sourceProvidesBolusEveryDay &&
    Math.abs(summary.stats.bolusUnits - recordBolusUnits) > SOURCE_TOTAL_TOLERANCE_UNITS
      ? { sourceMismatch: { source: summary.stats.bolusUnits, records: recordBolusUnits } }
      : {}),
    boluses: inPeriod,
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

function longActingText(part: PeriodBreakdown) {
  if (!part.longActing.count) return "none";
  const counted = "units" in part.basal && part.basal.includesLongActing ? ", counted in basal" : "";
  return `${bolusCount(part.longActing)}${counted}`;
}

function totalText(part: PeriodBreakdown) {
  if (!("units" in part.basal) || part.sourceMismatch) return undefined;
  // Long-acting injections are already in basal unless basal comes from saved daily totals.
  const longActing = part.basal.includesLongActing ? 0 : part.longActing.units;
  return unitsText(part.basal.units + part.smb.units + part.other.units + longActing);
}

type RecordKind = "insulin" | "carbs";

/**
 * The sources that hold the records this answer reads: those with records in
 * the loaded timeline, otherwise those that can provide them.
 */
function relevantSources(timeline: TimelineData, kinds: readonly RecordKind[]): DataSourceStatus[] {
  const ids = new Set<string>();
  if (kinds.includes("insulin")) {
    for (const record of timeline.boluses) ids.add(record.sourceId);
    for (const record of timeline.basal) ids.add(record.sourceId);
    for (const record of timeline.dailyInsulinTotals ?? []) ids.add(record.sourceId);
  }
  if (kinds.includes("carbs")) {
    for (const event of timeline.context) if (event.kind === "meal") ids.add(event.sourceId);
  }
  const byRecords = timeline.sources.filter((source) => ids.has(source.id));
  if (byRecords.length) return byRecords;
  return timeline.sources.filter((source) =>
    (kinds.includes("insulin") &&
      (sourceSupports(source.capabilities, "bolus-events") ||
        sourceSupports(source.capabilities, "basal-events") ||
        sourceSupports(source.capabilities, "daily-insulin-totals"))) ||
    (kinds.includes("carbs") && sourceSupports(source.capabilities, "carbohydrates")),
  );
}

/** The newest time any relevant source holds records up to; undefined when not known. */
function recordsThrough(sources: readonly DataSourceStatus[]) {
  const through = sources.map(({ dataThrough }) => dataThrough).filter((value): value is number => value !== undefined);
  return through.length ? Math.max(...through) : undefined;
}

/** The time records stop, when that is inside the period and well before its end. */
function staleThrough(window: RecordPeriodWindow, through: number | undefined) {
  return through !== undefined && through < window.range.end - FRESHNESS_TOLERANCE_MS && through >= window.range.start
    ? through
    : undefined;
}

/** Uses only the sources this answer reads, not the earliest record of any source. */
function storedStartSentence(sources: readonly DataSourceStatus[], start: number) {
  const starts = sources
    .map(({ dataFrom }) => dataFrom)
    .filter((value): value is number => value !== undefined);
  if (!starts.length) return undefined;
  const earliest = Math.min(...starts);
  return earliest > start
    ? `Stored records start on ${formatShortDate(toDateKey(earliest))}, so the start of this period is missing.`
    : undefined;
}

function staleSentence(window: RecordPeriodWindow, through: number, named: boolean) {
  const when = toDateKey(through) === toDateKey(window.range.end - 1)
    ? formatTime(through)
    : `${formatShortDate(toDateKey(through))} ${formatTime(through)}`;
  return `Records are stored only up to ${when}${named ? ` for ${window.name}` : ""}, so later ones are not included yet.`;
}

/** Sources marked stale or missing, when no record time is known. */
function behindSentence(sources: readonly DataSourceStatus[]) {
  const behind = sources.filter((source) => source.freshness === "stale" || source.freshness === "missing");
  return behind.length
    ? `${behind.map(({ label }) => label).join(" and ")} ${behind.length === 1 ? "has" : "have"} not updated recently, so recent records may be missing.`
    : undefined;
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
      description: "Every stored bolus and long-acting injection in the period, with its SMB marking.",
      range,
      recordIds: boluses.map(({ id }) => id),
      examples: boluses.slice(-MAX_EXAMPLES).map((bolus): EvidenceRecordPreview => ({
        id: bolus.id,
        kind: "bolus",
        timestamp: bolus.timestamp,
        primary: `${unitsText(bolus.units)} bolus`,
        secondary: isSmbBolus(bolus)
          ? bolus.smbMarking?.smb
            ? `SMB (marked in the ${recordSourceLabel(bolus.smbMarking.sourceId)} copy)`
            : "SMB"
          : (bolus.deliveryType ?? "not marked SMB"),
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

/** "Tue 17 Nov, until 14:30", or "..., records up to 09:00" when the sources are behind. */
function periodHeading(window: RecordPeriodWindow, asOf: number, through: number | undefined) {
  if (window.range.end !== asOf) return window.dates;
  const stale = staleThrough(window, through);
  return stale !== undefined
    ? `${window.dates}, records up to ${formatTime(stale)}`
    : `${window.dates}, until ${formatTime(window.range.end)}`;
}

function percentText(value: number) {
  return `${formatTarvisNumber(value, { maximumFractionDigits: 0 })}%`;
}

function countLabel(count: number, one: string, many: string) {
  return `${countText(count)} ${count === 1 ? one : many}`;
}

/** "Glooko" or "Glooko and Other source". */
function sourcesText(sources: readonly string[]) {
  return sources.length > 1 ? `${sources.slice(0, -1).join(", ")} and ${sources.at(-1)}` : (sources[0] ?? "");
}

/**
 * Visible notes that change the meaning: conflicting saved totals (both
 * values), boluses whose SMB marking is unknown, records that stop before the
 * period ends, and records that start after it begins.
 */
function breakdownNotices(
  parts: readonly PeriodBreakdown[],
  sources: readonly DataSourceStatus[],
  through: number | undefined,
  rangeStart: number,
) {
  const many = parts.length > 1;
  /** Already explained in full in the limitations. */
  const explained: string[] = [];
  /** Not said anywhere else. */
  const coverage: string[] = [];
  for (const part of parts) {
    if (part.sourceMismatch) {
      explained.push(
        `${many ? `${capitalise(part.window.name)}: saved` : "Saved"} daily bolus total ${unitsText(part.sourceMismatch.source)}, bolus records ${unitsText(part.sourceMismatch.records)}; both shown, neither picked.`,
      );
    }
  }
  const unknown = parts.filter((part) => part.smbUnknown);
  const unmarked = parts.filter((part) => part.unmarked.count && !part.smbUnknown);
  if (many && unknown.length === parts.length) {
    explained.push(
      `Boluses in both periods came from ${sourcesText([...new Set(unknown.flatMap((part) => part.unmarked.sources))])}, which doesn't mark automatic boluses, so SMBs can't be counted.`,
    );
  } else {
    for (const part of unknown) {
      explained.push(
        `${many ? `${capitalise(part.window.name)}: b` : "B"}oluses came from ${sourcesText(part.unmarked.sources)}, which doesn't mark automatic boluses, so SMBs can't be counted.`,
      );
    }
  }
  if (unmarked.length) {
    const names = [...new Set(unmarked.flatMap((part) => part.unmarked.sources))];
    const total = unmarked.reduce((sum, part) => sum + part.unmarked.count, 0);
    const counts = many
      ? ` (${unmarked.map((part) => `${countText(part.unmarked.count)} ${part.window.name}`).join(", ")})`
      : "";
    explained.push(
      `${countLabel(total, "bolus", "boluses")}${counts} came from ${sourcesText(names)}, which doesn't mark automatic boluses, so ${total === 1 ? "it is" : "they are"} counted as other boluses.`,
    );
  }
  let stale = false;
  for (const part of parts) {
    const stop = staleThrough(part.window, through);
    if (stop !== undefined) {
      stale = true;
      coverage.push(staleSentence(part.window, stop, many));
    }
  }
  if (!stale && through === undefined) {
    const behind = behindSentence(sources);
    if (behind) coverage.push(behind);
  }
  const started = storedStartSentence(sources, rangeStart);
  if (started) coverage.push(started);
  return { all: [...explained, ...coverage], coverage };
}

/** "Today so far · basal records 100% · 11 boluses, 2 carb entries". */
function breakdownContext(parts: readonly PeriodBreakdown[]) {
  const basal = (part: PeriodBreakdown) =>
    part.basalFromDailyTotals ? "daily totals" : percentText(part.basalCoveragePercent);
  if (parts.length === 1) {
    const [part] = parts as [PeriodBreakdown];
    const bolusCount = part.smb.count + part.other.count;
    return [
      shortName(part.window),
      `basal records ${basal(part)}`,
      `${countLabel(bolusCount, "bolus", "boluses")}, ${countLabel(part.carbs.entries, "carb entry", "carb entries")}`,
    ].join(" · ");
  }
  return [
    parts.map((part, index) => (index ? part.window.name : shortName(part.window))).join(" vs "),
    `basal records ${parts.map(basal).join(" / ")}`,
    `boluses ${parts.map((part) => countText(part.smb.count + part.other.count)).join(" / ")}`,
  ].join(" · ");
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
  const sources = relevantSources(timeline, ["insulin", "carbs"]);
  const through = recordsThrough(sources);
  const limitations = [...BREAKDOWN_LIMITATIONS];
  for (const part of parts) {
    const where = parts.length > 1 ? ` for ${part.window.name}` : "";
    if ("coveragePercent" in part.basal) {
      limitations.push(
        `Basal${where}: recorded temporary basals cover ${percentText(part.basal.coveragePercent)} of this period, so a basal total is not available.`,
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
    if (part.unmarked.count && !part.smbUnknown) {
      limitations.push(`Some bolus records${where} come from a source that does not say whether a bolus was automatic, so they are counted as other boluses.`);
    }
    if (part.longActing.count) {
      limitations.push(`Long-acting injections${where} are the ones you entered in T1 Arc, listed on their own line.`);
    }
  }
  const { all: notices, coverage } = breakdownNotices(parts, sources, through, range.start);
  for (const notice of coverage) if (!limitations.includes(notice)) limitations.push(notice);

  let lines: string[];
  let headline: string;
  if (parts.length === 1) {
    const [part] = parts as [PeriodBreakdown];
    headline = `Insulin and carbs, ${part.window.name}`;
    const total = totalText(part);
    lines = [
      `${capitalise(part.window.name)}, ${periodHeading(part.window, asOf, through)}:`,
      `• Basal delivered: ${basalText(part.basal)}`,
      ...(part.longActing.count ? [`• Long-acting injections: ${longActingText(part)}`] : []),
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
      `${parts.map((part, index) => `${index ? part.window.name : capitalise(part.window.name)} (${periodHeading(part.window, asOf, through)})`).join(" compared with ")}:`,
      `• SMBs delivered, marked SMB by AAPS: ${both(smbText)}`,
      `• Other boluses delivered, not marked SMB: ${both((part) => bolusCount(part.other))}`,
      ...(parts.some((part) => part.longActing.count) ? [`• Long-acting injections: ${both(longActingText)}`] : []),
      ...(parts.some((part) => part.sourceMismatch)
        ? [`• Saved daily bolus total: ${both((part) => (part.sourceMismatch ? unitsText(part.sourceMismatch.source) : "none saved"))}`]
        : []),
      `• Carbs entered: ${both((part) => carbText(part.carbs))}`,
      `• Basal delivered: ${both((part) => basalText(part.basal))}`,
    ];
  }
  const evidence = evidenceFor(
    parts.flatMap((part) => part.boluses),
    parts.flatMap((part) => part.meals),
    range,
  );
  const complete = parts.every((part) => "units" in part.basal && !part.sourceMismatch && !part.smbUnknown) && !notices.length;
  return {
    answer: {
      headline,
      answer: lines.join("\n"),
      confidence: complete ? "high" : "moderate",
      evidenceIds: evidence.map(({ id }) => id),
      limitations,
      shortContext: breakdownContext(parts),
      ...(notices.length ? { shortNotice: notices.join(" ") } : {}),
    },
    evidence,
  };
}

/** Carbs entered on each local day, newest first; today is marked "so far". */
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
  const window = recordPeriodWindow({ kind: "last-days", days: question.days }, asOf);
  const sources = relevantSources(timeline, ["carbs"]);
  const through = recordsThrough(sources);
  const lines: string[] = [];
  const meals: MealEvent[] = [];
  let daysWithEntries = 0;
  let multiSourceDays = 0;
  for (let offset = 0; offset < question.days; offset += 1) {
    const dateKey = addDays(today, -offset);
    const dayRange = { start: dayStart(dateKey), end: offset === 0 ? asOf : dayStart(addDays(dateKey, 1)) };
    const dayMeals = carbMeals(timeline, dayRange);
    meals.push(...dayMeals);
    const summary = summarizeCarbs(dayMeals);
    if (summary.entries) daysWithEntries += 1;
    if (summary.bySource) multiSourceDays += 1;
    lines.push(`• ${formatShortDate(dateKey)}${offset === 0 ? " (so far)" : ""}: ${carbText(summary)}`);
  }
  const days = countText(question.days);
  const evidence = evidenceFor([], meals, range);
  const carbSources = carbSourceIds(meals);
  const limitations = [
    "Only carb entries stored on this phone count. A day with no entries may mean nothing was logged, not that nothing was eaten.",
    carbSources.length
      ? `Carb entries come from ${sourcesText(carbSources)}. Where a day has entries from more than one source, grams are listed per source and not added together, because the same meal may be stored by each.`
      : "No carb entries are stored for these days.",
  ];
  const notices: string[] = [];
  const stop = staleThrough(window, through);
  if (stop !== undefined) notices.push(staleSentence(window, stop, false));
  else if (through === undefined) {
    const behind = behindSentence(sources);
    if (behind) notices.push(behind);
  }
  const started = storedStartSentence(sources, range.start);
  if (started) notices.push(started);
  if (multiSourceDays) {
    notices.push(`${countLabel(multiSourceDays, "day has", "days have")} carbs from more than one source, listed per source.`);
  }
  for (const notice of notices) if (!limitations.includes(notice)) limitations.push(notice);
  return {
    answer: {
      headline: `Carbs entered, last ${days} days`,
      answer: [
        `Carbs entered on each of the last ${days} days, newest first (${periodHeading(window, asOf, through)}):`,
        ...lines,
      ].join("\n"),
      confidence: notices.length ? "moderate" : "high",
      evidenceIds: evidence.map(({ id }) => id),
      limitations,
      shortContext: `Last ${days} days · ${countLabel(daysWithEntries, "day", "days")} with entries · ${countLabel(meals.length, "carb entry", "carb entries")}`,
      ...(notices.length ? { shortNotice: notices.join(" ") } : {}),
    },
    evidence,
  };
}
