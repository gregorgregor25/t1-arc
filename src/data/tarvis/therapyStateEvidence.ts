import type { EvidenceReference, InsightFinding } from "@/domain/insights";
import {
  TARGET_HIGH_MMOL_L,
  TARGET_LOW_MMOL_L,
  type TimeRange,
  type TimelineData,
} from "@/domain/models";
import { formatGlucose } from "@/domain/regionalFormat";
import { getRuntimeRegionalDefaults } from "@/domain/regionalProfileRuntime";
import { calculateGlucoseStats } from "@/domain/stats";
import {
  describeTherapyState,
  formatTherapyStateSpan,
  notableTherapyStates,
  therapyStateLabel,
  therapyStateRecordIds,
  therapyStateSourceNote,
  therapyStateTitle,
} from "@/domain/therapyStatePresentation";
import type {
  TemporaryTargetReason,
  TherapyStateInterval,
} from "@/domain/therapyStates";
import {
  addDays,
  getZonedDateTimeParts,
  multiDayRange,
  toDateKey,
  zonedDateTimeToTimestamp,
  type DateKey,
} from "@/domain/time";

import { formatTarvisNumber } from "./regionalNumberPresentation";
import { formatShortDate, formatTime } from "@/domain/time";
import {
  rangeForRetrospectiveEventQuestion,
  retrospectiveTemporalIssue,
} from "./retrospectiveEventReview";
import { formatTarvisCompactPeriod } from "./timePresentation";
import type { TarvisAnswer } from "./types";

/**
 * Tarv1s evidence for AAPS therapy states: temporary targets, profile
 * switches, loop running modes and pump suspensions.
 *
 * It reports what AAPS recorded, what glucose did while a state was active,
 * and what glucose did at the same clock times on days without it. It never
 * interprets a state as working or not, and never suggests one.
 */

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
/** Comparison windows are drawn from at least this many days before the period end. */
const COMPARISON_POOL_DAYS = 30;
/** Matched windows per state, nearest days first. */
const MAX_MATCHED_DAYS_PER_STATE = 14;
/** Longer states have no meaningful same-clock-time comparison. */
const MAX_MATCHABLE_STATE_MS = 12 * HOUR_MS;
const MIN_MATCHABLE_STATE_MS = 10 * MINUTE_MS;
/** Glucose must cover this share of a window for its numbers to be used. */
const MIN_WINDOW_COVERAGE_PERCENT = 70;
const MIN_MATCHED_WINDOWS = 3;
const MIN_OBSERVED_MINUTES = 30;
const MAX_LISTED_STATES = 6;
/** List mode shows this many records, then "and N more". */
const MAX_LIST_MODE_STATES = 20;

// Each sentence is phrased as a description of records, so the answer
// passes the same treatment-directive check as model-written answers.
const OBSERVATION_CAVEAT =
  "This is an observation from recorded data. Food, activity, insulin and other conditions also differed between these periods. It does not show that the recorded setting made the difference.";

export type TherapyStateQuery = (
  | { family: "temporary-target"; reason?: TemporaryTargetReason }
  | { family: "profile-switch"; percentage?: number }
  | {
      family: "loop-mode";
      group: "suspended" | "disconnected" | "open-loop" | "disabled" | "super-bolus" | "low-glucose-suspend" | "not-closed";
    }
) & {
  /**
   * "list": the question asks whether or when a state was recorded, with no
   * glucose wording. The answer lists the records and compares nothing.
   */
  mode?: "list";
  /**
   * The question names one state, "my last temporary target": the answer
   * describes only the most recent matching record in the period.
   */
  latest?: true;
};

const GLUCOSE_OUTCOME =
  /\b(?:glucose|bg|blood sugars?|sugars?|levels?|readings?|numbers|time in range|tir|lows?|highs?|hypos?|average|in range|how did (?:i|it|things|my \w+) (?:do|go|look)|how (?:was|were|did) (?:i|my|it|things))\b/i;
const STATE_LIST_REQUEST =
  /\b(?:when|how often|how many|list|show|which)\b[\s\S]{0,40}\b(?:temp(?:orary)? targets?|profile switch(?:es)?|profiles?|suspen(?:ded|sions?)|loop)\b/i;
// "Any temp targets yesterday?", "Did I use a profile switch?", "Was my pump
// suspended?" ask whether a state was recorded, not how glucose went.
const RECORD_PRESENCE_REQUEST =
  /\b(?:any|were there|did i (?:use|have|set|run|start|turn on|activate|switch|change)|did (?:the|my) (?:loop|pump|pod) (?:suspend|stop|disconnect)|(?:was|were) (?:my|the) (?:loop|pump|pod)|have i (?:used|had|set|run|started|switched))\b/i;
// "my last temp target", "the most recent loop suspension", "when did I last
// use a temp target": the most recent state. The plural reads the same way,
// because phone keyboards autocorrect "my last temporary target" to
// "targets". A count ("my last 3 temp targets") and periods ("last week",
// "the last 3 days") do not match.
const LATEST_SINGLE_STATE =
  /\b(?:(?:my|the)\s+(?:very\s+)?(?:last|latest|most\s+recent)\s+(?:(?:activity|exercise|eating[\s-]+soon|hypo|\d{2,3}\s*%)\s+)?(?:temp(?:orary)?[\s-]+targets?|tts?|activity[\s-]+modes?|eating[\s-]+soon(?:[\s-]+modes?)?|hypo[\s-]+modes?|profile\s+switch(?:es)?|loop\s+suspensions?)(?![\w-])|did\s+i\s+last\s+(?:use|set|have|run|start|turn\s+on|activate|switch)\b|(?:the\s+)?last\s+time\s+(?:i|my\s+(?:loop|pump|pod))\b)/i;
const ASKS_FOR_SEVERAL = /\b(?:all|each|every|both|compar\w*)\b/i;
const SETTING_ADVICE_REQUEST =
  /\b(?:should|shall|recommend\w*|suggest\w*|advis\w*|what (?:percentage|percent|target|profile) (?:should|to|do)|which (?:percentage|percent|target|profile) (?:should|to|is best)|too (?:low|high|much|little|aggressive))\b/i;

const TEMP_TARGET =
  /\b(?:temp(?:orary)?[\s-]+targets?|tts?|activity[\s-]+(?:mode|target|tt)|eating[\s-]+soon(?:[\s-]+(?:mode|target|tt))?|hypo[\s-]+(?:mode|target|tt))\b/i;
const PROFILE_PERCENT =
  /\b(\d{2,3})\s*%\s*(?:profile|profile switch)\b|\bprofile(?:\s+(?:switch(?:ed)?|set|at|of|was|to|on))*\s+(?:to\s+|at\s+|of\s+)?(\d{2,3})\s*%/i;
const PROFILE_ANY =
  /\b(?:profile switch(?:es)?|switched profiles?|(?:a |the |my )?(?:reduced|lowered|increased|raised|temporary|temp) profile|profile percentages?)\b/i;
const LOOP_STATE =
  /\b(?:loop (?:was |is )?(?:suspended|paused|disabled|off|open)|suspended loop|loop suspen(?:sion|sions|ded)|(?:pump|pod) (?:was )?(?:suspended|disconnected)|disconnected (?:pump|pod)|suspen(?:ded|sion|sions) (?:of|by) (?:the )?(?:pump|loop|pod)|open[\s-]loop|closed[\s-]loop (?:lgs|low[\s-]glucose suspend)|low[\s-]glucose suspend|lgs mode|super[\s-]?bolus(?: mode)?|loop disabled|disabled loop)\b/i;

/**
 * Recognises a question about recorded AAPS therapy states, such as "How did
 * my glucose go during my Activity temp target yesterday?" Requests for a
 * setting are left to the safety and scope rules.
 */
export function parseTherapyStateQuestion(question: string): TherapyStateQuery | undefined {
  if (SETTING_ADVICE_REQUEST.test(question)) return undefined;
  const glucoseOutcome = GLUCOSE_OUTCOME.test(question);
  const listRequest =
    !glucoseOutcome &&
    (STATE_LIST_REQUEST.test(question) || RECORD_PRESENCE_REQUEST.test(question));
  if (!glucoseOutcome && !listRequest) return undefined;
  const query = therapyStateFamily(question.toLowerCase());
  if (!query) return undefined;
  const named = LATEST_SINGLE_STATE.exec(question)?.[0];
  // "all my last temp targets", "compare my last temp targets": the plural
  // there asks for several, not the most recent one.
  const latest =
    named && !(/s$/i.test(named) && ASKS_FOR_SEVERAL.test(question)) ? { latest: true as const } : {};
  return listRequest ? { ...query, mode: "list", ...latest } : { ...query, ...latest };
}

function therapyStateFamily(text: string): TherapyStateQuery | undefined {
  if (TEMP_TARGET.test(text)) {
    const reason: TemporaryTargetReason | undefined = /\bactivity\b|\bexercise\b/.test(text)
      ? "activity"
      : /eating[\s-]+soon/.test(text)
        ? "eating-soon"
        : /\bhypo[\s-]+(?:mode|target|tt|temp)/.test(text)
          ? "hypo"
          : undefined;
    return { family: "temporary-target", reason };
  }
  const percent = PROFILE_PERCENT.exec(text);
  if (percent) {
    const value = Number(percent[1] ?? percent[2]);
    if (Number.isFinite(value) && value > 0 && value <= 300) {
      return { family: "profile-switch", percentage: value };
    }
  }
  if (PROFILE_ANY.test(text)) return { family: "profile-switch" };
  const loop = LOOP_STATE.exec(text)?.[0];
  if (loop) {
    if (/super[\s-]?bolus/.test(loop)) return { family: "loop-mode", group: "super-bolus" };
    if (/lgs|low[\s-]glucose suspend/.test(loop)) return { family: "loop-mode", group: "low-glucose-suspend" };
    if (/disconnected/.test(loop)) return { family: "loop-mode", group: "disconnected" };
    if (/open/.test(loop)) return { family: "loop-mode", group: "open-loop" };
    if (/disabled|\boff\b/.test(loop)) return { family: "loop-mode", group: "disabled" };
    return { family: "loop-mode", group: "suspended" };
  }
  return undefined;
}

function matchesQuery(state: TherapyStateInterval, query: TherapyStateQuery) {
  if (state.baseline) return false;
  switch (query.family) {
    case "temporary-target":
      return (
        state.kind === "temporary-target" &&
        (query.reason === undefined || state.targetReason === query.reason)
      );
    case "profile-switch":
      return (
        state.kind === "profile-switch" &&
        (query.percentage === undefined || state.percentage === query.percentage)
      );
    case "loop-mode": {
      if (query.group === "suspended") {
        return (
          state.kind === "pump-suspend" ||
          (state.kind === "loop-mode" && Boolean(state.loopMode?.startsWith("suspended")))
        );
      }
      if (state.kind !== "loop-mode") return false;
      switch (query.group) {
        case "disconnected":
          return state.loopMode === "disconnected-pump";
        case "open-loop":
          return state.loopMode === "open-loop";
        case "disabled":
          return state.loopMode === "disabled-loop";
        case "super-bolus":
          return state.loopMode === "super-bolus";
        case "low-glucose-suspend":
          return state.loopMode === "closed-loop-lgs";
        default:
          return true;
      }
    }
  }
}

/** States of the same family; comparison windows must avoid all of them. */
function sameFamily(state: TherapyStateInterval, query: TherapyStateQuery) {
  if (state.baseline) return false;
  if (query.family === "loop-mode") {
    return state.kind === "loop-mode" || state.kind === "pump-suspend";
  }
  return state.kind === query.family;
}

export function therapyStateQueryLabel(query: TherapyStateQuery) {
  switch (query.family) {
    case "temporary-target":
      return query.reason === "activity"
        ? "Activity temporary targets"
        : query.reason === "eating-soon"
          ? "Eating soon temporary targets"
          : query.reason === "hypo"
            ? "Hypo temporary targets"
            : "temporary targets";
    case "profile-switch":
      return query.percentage !== undefined
        ? `profile switches at ${formatTarvisNumber(query.percentage, { maximumFractionDigits: 0 })}%`
        : "profile switches other than an ongoing 100% profile";
    case "loop-mode":
      return {
        suspended: "loop or pump suspensions",
        disconnected: "pump disconnections",
        "open-loop": "open-loop periods",
        disabled: "periods with the loop disabled",
        "super-bolus": "superbolus periods",
        "low-glucose-suspend": "low-glucose-suspend periods",
        "not-closed": "periods outside closed loop",
      }[query.group];
  }
}

function withoutLabel(query: TherapyStateQuery) {
  switch (query.family) {
    case "temporary-target":
      return "no temporary target";
    case "profile-switch":
      return "no profile switch other than 100%";
    default:
      return "closed loop and no suspension";
  }
}

const TIME_WORDS =
  /\b(?:yesterday|today|tonight|last|this|past|previous|ago|days?|weeks?|fortnight|months?|morning|afternoon|evening|night|monday|tuesday|wednesday|thursday|friday|saturday|sunday|\d{1,2}(?:st|nd|rd|th)?\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*\s+\d{1,2})\b|\d{4}-\d{2}-\d{2}/i;

/**
 * The period to describe. Without a time in the question, the last 30 days:
 * states are occasional, so a week usually holds too few to describe.
 */
export function rangeForTherapyStateQuestion(
  question: string,
  asOf: number,
): { range: TimeRange } | { issue: string } {
  const issue = retrospectiveTemporalIssue(question, asOf);
  if (issue) return { issue };
  // "my last temp target" names a record, not a period: "last" is no time word.
  const periodText = question.replace(new RegExp(LATEST_SINGLE_STATE.source, "gi"), " ");
  if (!TIME_WORDS.test(periodText)) {
    return { range: multiDayRange(toDateKey(asOf), COMPARISON_POOL_DAYS, asOf) };
  }
  return { range: rangeForRetrospectiveEventQuestion(question, asOf) };
}

/** The range to load: the period plus enough earlier days to find comparison windows. */
export function therapyStateLoadRange(range: TimeRange): TimeRange {
  return {
    start: Math.min(range.start, range.end - COMPARISON_POOL_DAYS * DAY_MS),
    end: range.end,
  };
}

interface WindowStats {
  range: TimeRange;
  recordIds: string[];
  observedMinutes: number;
  coveragePercent: number;
  averageMmolL: number | null;
  timeBelowPercent: number;
  timeInRangePercent: number;
  timeAbovePercent: number;
}

function windowStats(timeline: TimelineData, range: TimeRange): WindowStats {
  const readings = timeline.glucose.filter(
    ({ timestamp }) => timestamp >= range.start && timestamp < range.end,
  );
  const stats = calculateGlucoseStats(readings, range);
  return {
    range,
    recordIds: readings.map(({ id }) => id),
    observedMinutes: stats.observedMinutes,
    coveragePercent: stats.coveragePercent,
    averageMmolL: stats.averageMmolL,
    timeBelowPercent: stats.timeBelowPercent,
    timeInRangePercent: stats.timeInRangePercent,
    timeAbovePercent: stats.timeAbovePercent,
  };
}

interface PooledStats {
  windows: number;
  totalMinutes: number;
  observedMinutes: number;
  coveragePercent: number;
  averageMmolL?: number;
  timeBelowPercent: number;
  timeInRangePercent: number;
  timeAbovePercent: number;
}

/** Observed-time-weighted, so a long window counts more than a short one. */
function pool(windows: readonly WindowStats[]): PooledStats {
  const totalMinutes = windows.reduce(
    (sum, { range }) => sum + (range.end - range.start) / MINUTE_MS,
    0,
  );
  const observed = windows.reduce((sum, item) => sum + item.observedMinutes, 0);
  const weighted = (pick: (item: WindowStats) => number) =>
    observed > 0
      ? windows.reduce((sum, item) => sum + pick(item) * item.observedMinutes, 0) / observed
      : 0;
  const withAverage = windows.filter((item) => item.averageMmolL !== null && item.observedMinutes > 0);
  const averageWeight = withAverage.reduce((sum, item) => sum + item.observedMinutes, 0);
  return {
    windows: windows.length,
    totalMinutes,
    observedMinutes: observed,
    coveragePercent: totalMinutes > 0 ? Math.min(100, (observed / totalMinutes) * 100) : 0,
    averageMmolL:
      averageWeight > 0
        ? withAverage.reduce((sum, item) => sum + (item.averageMmolL as number) * item.observedMinutes, 0) /
          averageWeight
        : undefined,
    timeBelowPercent: weighted((item) => item.timeBelowPercent),
    timeInRangePercent: weighted((item) => item.timeInRangePercent),
    timeAbovePercent: weighted((item) => item.timeAbovePercent),
  };
}

function overlaps(left: TimeRange, right: TimeRange) {
  return left.start < right.end && right.start < left.end;
}

/** One continuous active period can be described by several source records. */
function activeWindows(ranges: readonly TimeRange[]): TimeRange[] {
  const merged: TimeRange[] = [];
  for (const range of [...ranges].sort((left, right) => left.start - right.start)) {
    const previous = merged[merged.length - 1];
    if (previous && range.start <= previous.end) {
      previous.end = Math.max(previous.end, range.end);
    } else {
      merged.push({ ...range });
    }
  }
  return merged;
}

/**
 * The same local clock time and length on other days with none of the
 * family's states active. Wall-clock times that do not exist on a
 * clock-change day are skipped rather than shifted.
 */
function matchedWindows(
  states: readonly TimeRange[],
  familyStates: readonly TherapyStateInterval[],
  pool: TimeRange,
  asOf: number,
): TimeRange[] {
  const timeZone = getRuntimeRegionalDefaults().timeZone;
  const stateDays = new Set(states.map(({ start }) => toDateKey(start, timeZone)));
  const firstDay = toDateKey(pool.start, timeZone);
  const lastDay = toDateKey(Math.min(pool.end, asOf) - 1, timeZone);
  const chosen = new Map<number, TimeRange>();
  for (const state of states) {
    const length = state.end - state.start;
    if (length < MIN_MATCHABLE_STATE_MS || length > MAX_MATCHABLE_STATE_MS) continue;
    const parts = getZonedDateTimeParts(state.start, timeZone);
    const candidates: { range: TimeRange; distance: number }[] = [];
    for (let day: DateKey = firstDay, guard = 0; day <= lastDay && guard < 120; day = addDays(day, 1), guard += 1) {
      if (stateDays.has(day)) continue;
      let start: number;
      try {
        start = zonedDateTimeToTimestamp(day, parts.hour, parts.minute, parts.second, timeZone);
      } catch {
        continue;
      }
      const startParts = getZonedDateTimeParts(start, timeZone);
      if (startParts.hour !== parts.hour || startParts.minute !== parts.minute) continue;
      const window = { start, end: start + length };
      if (window.start < pool.start || window.end > Math.min(pool.end, asOf)) continue;
      if (familyStates.some((other) => overlaps(other, window))) continue;
      candidates.push({ range: window, distance: Math.abs(window.start - state.start) });
    }
    candidates
      .sort((left, right) => left.distance - right.distance)
      .slice(0, MAX_MATCHED_DAYS_PER_STATE)
      .forEach(({ range }) => {
        if (![...chosen.values()].some((existing) => overlaps(existing, range))) {
          chosen.set(range.start, range);
        }
      });
  }
  return [...chosen.values()].sort((left, right) => left.start - right.start);
}

function percent(value: number) {
  return `${formatTarvisNumber(Math.round(value), { maximumFractionDigits: 0 })}%`;
}

function glucose(value: number) {
  return formatGlucose(value, getRuntimeRegionalDefaults());
}

function duration(minutes: number) {
  const rounded = Math.round(minutes);
  const hours = Math.floor(rounded / 60);
  const rest = rounded % 60;
  if (!hours) return `${formatTarvisNumber(rest, { maximumFractionDigits: 0 })} min`;
  return rest
    ? `${formatTarvisNumber(hours, { maximumFractionDigits: 0 })} h ${formatTarvisNumber(rest, { maximumFractionDigits: 0 })} min`
    : `${formatTarvisNumber(hours, { maximumFractionDigits: 0 })} h`;
}

function rangeText() {
  const regional = getRuntimeRegionalDefaults();
  return `${formatGlucose(TARGET_LOW_MMOL_L, regional, { withUnit: false })}–${formatGlucose(TARGET_HIGH_MMOL_L, regional)}`;
}

function statsSentence(stats: PooledStats) {
  const regional = getRuntimeRegionalDefaults();
  const low = formatGlucose(TARGET_LOW_MMOL_L, regional, { withUnit: false });
  const high = formatGlucose(TARGET_HIGH_MMOL_L, regional, { withUnit: false });
  return `glucose averaged ${stats.averageMmolL !== undefined ? glucose(stats.averageMmolL) : "an unavailable value"}; ${percent(stats.timeInRangePercent)} of the observed time was ${rangeText()}, ${percent(stats.timeBelowPercent)} below ${low} and ${percent(stats.timeAbovePercent)} above ${high}`;
}

function sourceSummary(states: readonly TherapyStateInterval[]) {
  const names = new Set(states.map(therapyStateSourceNote));
  return [...names].join("; ");
}

function stateRecordRange(states: readonly TherapyStateInterval[], range: TimeRange): TimeRange {
  return {
    start: states.reduce((earliest, state) => Math.min(earliest, state.start), range.start),
    end: range.end,
  };
}

export interface TherapyStateAnswerResult {
  answer: TarvisAnswer;
  evidence: EvidenceReference[];
}

function elapsed(ms: number) {
  if (ms < MINUTE_MS) {
    const seconds = Math.max(1, Math.round(ms / 1000));
    return `under 1 minute (about ${formatTarvisNumber(seconds, { maximumFractionDigits: 0 })} second${seconds === 1 ? "" : "s"})`;
  }
  return duration(ms / MINUTE_MS);
}

function localStart(timestamp: number) {
  return `${formatShortDate(toDateKey(timestamp))} ${formatTime(timestamp)}`;
}

/** How long a listed state lasted, or that it is still running. */
function listedLength(state: TherapyStateInterval, asOf: number) {
  const permanentProfile =
    state.kind === "profile-switch" && state.programmedDurationMs === undefined;
  if (state.end > asOf) {
    if (permanentProfile) return "until changed; still active";
    return state.programmedDurationMs !== undefined
      ? `programmed for ${elapsed(state.programmedDurationMs)}; still active`
      : "still active";
  }
  const length = elapsed(state.end - state.start);
  if (permanentProfile) return `until changed, after ${length}`;
  switch (state.endBasis) {
    case "programmed":
      return `${length}, ran for its programmed time`;
    case "cancelled":
      return `${length}, ended early by a later record`;
    case "next-record":
      return `${length}, replaced by the next record`;
    default:
      return `${length}, no end was recorded`;
  }
}

/**
 * List mode: the matching records in the asked period, one line each, with
 * no glucose comparison. Every line describes a stored record.
 */
function buildTherapyStateList({
  query,
  range,
  timeline,
  asOf,
}: {
  query: TherapyStateQuery;
  range: TimeRange;
  timeline: TimelineData;
  asOf: number;
}): TherapyStateAnswerResult {
  const label = therapyStateQueryLabel(query);
  const periodText = formatTarvisCompactPeriod(range);
  const effectiveEnd = Math.min(range.end, asOf);
  const allStates = timeline.therapyStates ?? [];
  const inPeriod = allStates
    .filter((state) => matchesQuery(state, query))
    .filter((state) => state.start < effectiveEnd && state.end > range.start)
    .sort((left, right) => left.start - right.start);
  const states = query.latest ? inPeriod.slice(-1) : inPeriod;
  const limitations = [
    "Therapy states come from AAPS records T1 Arc has stored. Nightscout uploads can arrive late or be missing while AAPS is offline.",
  ];
  const headline = `${label.charAt(0).toUpperCase()}${label.slice(1)}, ${periodText}`;

  if (!states.length) {
    const earliest = allStates.reduce<number | undefined>(
      (first, state) => (first === undefined || state.start < first ? state.start : first),
      undefined,
    );
    const lines = [`No ${label} are recorded for ${periodText} in the AAPS records T1 Arc has stored.`];
    if (earliest === undefined) {
      lines.push("No AAPS setting records are stored for this period at all, so T1 Arc has no record either way.");
    } else if (earliest > range.start) {
      lines.push(`The stored AAPS setting records read for this answer start on ${localStart(earliest)}.`);
    }
    return {
      answer: { headline, answer: lines.join("\n"), confidence: "limited", evidenceIds: [], limitations },
      evidence: [],
    };
  }

  const shown = states.slice(0, MAX_LIST_MODE_STATES);
  // Time within the period, with overlapping records counted once. A profile
  // stays in force until changed, so a total would not answer anything useful.
  const total =
    query.family === "profile-switch"
      ? ""
      : `, ${elapsed(
          activeWindows(
            states.map((state) => ({
              start: Math.max(state.start, range.start),
              end: Math.min(state.end, effectiveEnd),
            })),
          ).reduce((sum, window) => sum + (window.end - window.start), 0),
        )} in total`;
  const lines = [
    query.latest && inPeriod.length > 1
      ? `The most recent of ${formatTarvisNumber(inPeriod.length, { maximumFractionDigits: 0 })} recorded in ${periodText}:`
      : `${formatTarvisNumber(states.length, { maximumFractionDigits: 0 })} recorded in ${periodText}${total}:`,
    ...shown.map((state) => {
      const before = state.start < range.start ? " (started before this period)" : "";
      return `• ${localStart(state.start)}: ${therapyStateLabel(state)} recorded, ${listedLength(state, asOf)}${before}`;
    }),
  ];
  if (states.length > shown.length) {
    lines.push(`• and ${formatTarvisNumber(states.length - shown.length, { maximumFractionDigits: 0 })} more, listed in the evidence.`);
  }
  if (total && states.some((state) => state.endBasis === "open")) {
    lines.push(
      `${states.length === 1 ? "It" : "At least one"} had no recorded end, so its length was measured up to the end of the records read.`,
    );
  }
  if (
    query.family === "profile-switch" &&
    allStates.some(
      (state) =>
        state.baseline &&
        state.kind === "profile-switch" &&
        state.start < effectiveEnd &&
        state.end > range.start,
    )
  ) {
    lines.push("Outside these, your usual 100% profile was recorded as active.");
  }
  const evidence: EvidenceReference = {
    id: "therapy-state-intervals",
    label: `Recorded ${label}`,
    description: `${formatTarvisNumber(states.length, { maximumFractionDigits: 0 })} recorded interval${states.length === 1 ? "" : "s"} from ${sourceSummary(states)}.`,
    range: stateRecordRange(states, range),
    recordIds: [...new Set(states.flatMap(therapyStateRecordIds))],
    examples: states.slice(0, 5).map((state) => ({
      id: state.source.rawRecordId,
      kind: "source-record",
      timestamp: state.start,
      primary: therapyStateLabel(state),
      secondary: `${formatTherapyStateSpan(state, true)} · ${therapyStateSourceNote(state)}`,
      sourceId: state.source.sourceId,
    })),
  };
  return {
    answer: {
      headline,
      answer: lines.join("\n"),
      confidence: "limited",
      evidenceIds: [evidence.id],
      limitations,
    },
    evidence: [evidence],
  };
}

/**
 * Builds the local answer from a timeline loaded over
 * {@link therapyStateLoadRange}. `range` is the period the user asked about.
 */
export function buildTherapyStateAnswer({
  query,
  range,
  timeline,
  asOf,
}: {
  query: TherapyStateQuery;
  range: TimeRange;
  timeline: TimelineData;
  asOf: number;
}): TherapyStateAnswerResult {
  if (query.mode === "list") return buildTherapyStateList({ query, range, timeline, asOf });
  const label = therapyStateQueryLabel(query);
  const period = `the requested period (${formatTarvisCompactPeriod(range)})`;
  const effectiveEnd = Math.min(range.end, asOf);
  const allStates = timeline.therapyStates ?? [];
  const inPeriod = allStates
    .filter((state) => matchesQuery(state, query))
    .filter((state) => state.start < effectiveEnd && state.end > range.start)
    .map((state) => ({
      state,
      clipped: { start: Math.max(state.start, range.start), end: Math.min(state.end, effectiveEnd) },
    }))
    .filter(({ clipped }) => clipped.end > clipped.start);
  const matching =
    query.latest && inPeriod.length
      ? [inPeriod.reduce((latest, item) => (item.state.start >= latest.state.start ? item : latest))]
      : inPeriod;
  const anyRecords = allStates.some(
    (state) => state.start < effectiveEnd && state.end > range.start,
  );
  const limitations = [
    "Therapy states come from AAPS records T1 Arc has stored. Nightscout uploads can arrive late or be missing while AAPS is offline. AAPS broadcasts received on this phone are also read when that option is on; Android usually does not confirm their sender. The phone broadcast has no running-mode or temporary-basal records.",
  ];

  if (!matching.length) {
    const answer = anyRecords
      ? `No ${label} were recorded in ${period} in the AAPS records T1 Arc has stored. Other AAPS settings were recorded in that period, so records were arriving; this does not prove none were used if a record was not uploaded.`
      : `No AAPS temporary targets, profile switches or loop modes were stored for ${period}, so T1 Arc has no record either way of ${label} in that period. These records come from your Nightscout site or the AAPS treatment broadcast on this phone.`;
    return {
      answer: {
        headline: `No ${label} recorded`,
        answer,
        confidence: "limited",
        evidenceIds: [],
        limitations,
      },
      evidence: [],
    };
  }

  const states = matching.map(({ state }) => state);
  const stateEvidence: EvidenceReference = {
    id: "therapy-state-intervals",
    label: `Recorded ${label}`,
    description: `${formatTarvisNumber(states.length, { maximumFractionDigits: 0 })} recorded interval${states.length === 1 ? "" : "s"} from ${sourceSummary(states)}.`,
    range: stateRecordRange(states, range),
    recordIds: [...new Set(states.flatMap(therapyStateRecordIds))],
    examples: states.slice(0, 5).map((state) => ({
      id: state.source.rawRecordId,
      kind: "source-record",
      timestamp: state.start,
      primary: therapyStateLabel(state),
      secondary: `${describeTherapyState(state, true)} · ${therapyStateSourceNote(state)}`,
      sourceId: state.source.sourceId,
    })),
  };

  const intervals = activeWindows(matching.map(({ clipped }) => clipped));
  const stateWindows = intervals.map((window) => windowStats(timeline, window));
  const during = pool(stateWindows);
  const familyStates = allStates.filter((state) => sameFamily(state, query));
  const loadRange = timeline.range;
  const comparisonCandidates = matchedWindows(
    intervals,
    familyStates,
    loadRange,
    asOf,
  ).map((window) => windowStats(timeline, window));
  const usableComparison = comparisonCandidates.filter(
    (window) => window.coveragePercent >= MIN_WINDOW_COVERAGE_PERCENT,
  );
  const comparisonDays = new Set(
    usableComparison.map(({ range: window }) => toDateKey(window.start)),
  ).size;
  const without = pool(usableComparison);

  // One record: the glucose result leads, so the short-answer card shows it
  // first, and the card label names the record.
  const single = states.length === 1 ? states[0] : undefined;
  const lines: string[] = [];
  if (!single) {
    lines.push(
      `AAPS recorded ${formatTarvisNumber(states.length, { maximumFractionDigits: 0 })} ${label} in ${period}, ${duration(during.totalMinutes)} in total:`,
      ...states.slice(-MAX_LISTED_STATES).map((state) => `• ${describeTherapyState(state, true)}`),
    );
    if (states.length > MAX_LISTED_STATES) {
      lines.push(`• and ${formatTarvisNumber(states.length - MAX_LISTED_STATES, { maximumFractionDigits: 0 })} earlier, listed in the evidence.`);
    }
    if (states.some((state) => state.endBasis === "open")) {
      lines.push("At least one had no recorded end, so its length was measured up to the end of the records read.");
    }
  }

  const duringUsable =
    during.observedMinutes >= MIN_OBSERVED_MINUTES &&
    during.coveragePercent >= MIN_WINDOW_COVERAGE_PERCENT;
  let confidence: TarvisAnswer["confidence"] = "limited";
  const evidence: EvidenceReference[] = [stateEvidence];
  const glucoseLines: string[] = [];
  if (!duringUsable) {
    glucoseLines.push(
      `Glucose readings covered ${percent(during.coveragePercent)} of that time, so T1 Arc is not summarising glucose during ${single ? "it" : "these periods"}.`,
    );
  } else {
    glucoseLines.push(
      `While ${single ? "it was" : "they were"} active, ${statsSentence(during)}. Glucose coverage: ${percent(during.coveragePercent)} of ${duration(during.totalMinutes)}.`,
    );
    evidence.push({
      id: "therapy-state-glucose-during",
      label: `Glucose while ${label} were active`,
      description: `Readings inside the recorded intervals; coverage ${percent(during.coveragePercent)}. Mean and time in range are weighted by observed time across the intervals.`,
      range,
      recordIds: [...new Set(stateWindows.flatMap(({ recordIds }) => recordIds))],
      examples: [],
    });
    if (usableComparison.length >= MIN_MATCHED_WINDOWS) {
      glucoseLines.push(
        `At the same clock times on ${formatTarvisNumber(comparisonDays, { maximumFractionDigits: 0 })} other day${comparisonDays === 1 ? "" : "s"} with ${withoutLabel(query)} recorded, ${statsSentence(without)}. Glucose coverage in those windows: ${percent(without.coveragePercent)}.`,
      );
      confidence =
        during.coveragePercent >= 90 && without.coveragePercent >= 90 && usableComparison.length >= 5
          ? "moderate"
          : "limited";
      evidence.push({
        id: "therapy-state-glucose-matched",
        label: "Glucose at matched times without the setting",
        description: `${formatTarvisNumber(usableComparison.length, { maximumFractionDigits: 0 })} same-clock-time windows on other days in the ${formatTarvisNumber(COMPARISON_POOL_DAYS, { maximumFractionDigits: 0 })} days to the end of the period, each with at least ${percent(MIN_WINDOW_COVERAGE_PERCENT)} glucose coverage and none of these settings recorded. Mean and time in range are weighted by observed time.`,
        range: loadRange,
        recordIds: [...new Set(usableComparison.flatMap(({ recordIds }) => recordIds))],
        examples: [],
      });
    } else {
      glucoseLines.push(
        `Only ${formatTarvisNumber(usableComparison.length, { maximumFractionDigits: 0 })} same-clock-time window${usableComparison.length === 1 ? "" : "s"} on other days had none of these settings recorded and enough glucose readings, so T1 Arc is not comparing them.`,
      );
    }
  }
  if (single) {
    const [result, ...comparison] = glucoseLines;
    const record = describeTherapyState(single, true);
    lines.push(
      ...(result ? [result] : []),
      query.latest && inPeriod.length > 1
        ? `The most recent of ${formatTarvisNumber(inPeriod.length, { maximumFractionDigits: 0 })} ${label} AAPS recorded in ${period}: ${record}.`
        : `AAPS recorded only this one in ${period}: ${record}.`,
      ...(single.endBasis === "open"
        ? ["It had no recorded end, so its length was measured up to the end of the records read."]
        : []),
      ...comparison,
    );
  } else {
    lines.push(...glucoseLines);
  }
  lines.push(OBSERVATION_CAVEAT);
  if (states.some((state) => state.source.sourceId !== "nightscout" && !/sender confirmed/i.test(state.source.sourceFile))) {
    limitations.push("Some intervals came only from the AAPS broadcast on this phone, and Android did not confirm the sender.");
  }
  return {
    answer: {
      headline: single
        ? `Glucose during ${therapyStateLabel(single)}, ${formatTherapyStateSpan(single, true)}`
        : `Glucose during ${label}`,
      answer: lines.join("\n"),
      confidence,
      evidenceIds: evidence.map(({ id }) => id),
      limitations,
    },
    evidence,
  };
}

export async function loadTherapyStateAnswer({
  query,
  range,
  asOf,
  loadTimelineData,
}: {
  query: TherapyStateQuery;
  range: TimeRange;
  asOf: number;
  loadTimelineData: (range: TimeRange) => Promise<TimelineData>;
}) {
  const timeline = await loadTimelineData(therapyStateLoadRange(range));
  return buildTherapyStateAnswer({ query, range, timeline, asOf });
}

function relation(state: TherapyStateInterval, episode: TimeRange) {
  if (state.start <= episode.start && state.end >= episode.end) return "active throughout the episode";
  if (overlaps(state, episode)) return "active during part of the episode";
  if (state.end <= episode.start) {
    return `ended ${duration((episode.start - state.end) / MINUTE_MS)} before the episode began`;
  }
  return `started ${duration((state.start - episode.end) / MINUTE_MS)} after the episode ended`;
}

/**
 * Names the AAPS settings recorded as active in a glucose episode's context
 * window, with their exact times and source. Returns `undefined` when none
 * other than the ordinary closed loop and 100% profile were recorded.
 */
export function therapyStateEpisodeFinding(
  eventKind: "high" | "low",
  timeline: TimelineData,
  episode: TimeRange,
): InsightFinding | undefined {
  const states = notableTherapyStates(timeline.therapyStates).filter((state) =>
    overlaps(state, timeline.range),
  );
  if (!states.length) return undefined;
  const caveat = `Timing is context, not proof that the recorded setting caused the ${eventKind}.`;
  const described = states
    .slice(0, 4)
    .map((state) => `${describeTherapyState(state)}, ${relation(state, episode)} (${therapyStateSourceNote(state)})`);
  const more = states.length > 4 ? `; and ${formatTarvisNumber(states.length - 4, { maximumFractionDigits: 0 })} more` : "";
  const title = states.some((state) => overlaps(state, episode))
    ? "AAPS settings recorded as active during the episode"
    : "AAPS settings recorded near the episode";
  return {
    id: `planned-${eventKind}-therapy-states`,
    kind: "context-clue",
    category: "insulin",
    title,
    summary: `${described.join("; ")}${more}. ${caveat}`,
    caveat,
    evidence: [
      {
        id: `planned-${eventKind}-therapy-state-records`,
        label: "Recorded AAPS therapy states",
        description: `${formatTarvisNumber(states.length, { maximumFractionDigits: 0 })} recorded state${states.length === 1 ? "" : "s"} (${states.map(therapyStateTitle).filter((value, index, all) => all.indexOf(value) === index).join(", ")}) overlapping the bounded incident window. ${caveat}`,
        range: timeline.range,
        recordIds: [...new Set(states.flatMap(therapyStateRecordIds))],
        examples: states.slice(0, 5).map((state) => ({
          id: state.source.rawRecordId,
          kind: "source-record",
          timestamp: state.start,
          primary: therapyStateLabel(state),
          secondary: `${describeTherapyState(state)} · ${therapyStateSourceNote(state)}`,
          sourceId: state.source.sourceId,
        })),
      },
    ],
  };
}
