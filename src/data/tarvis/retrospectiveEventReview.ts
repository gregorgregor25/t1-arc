import type {
  EvidenceReference,
  EvidenceRecordPreview,
} from "@/domain/insights";
import {
  contextNoteCategoryLabel,
  contextNoteDisplayTitle,
} from "@/domain/contextNotes";
import {
  ActivityEvent,
  ContextNoteEvent,
  DataSourceStatus,
  GlucoseReading,
  HealthContextEvent,
  MealEvent,
  MedicationEvent,
  SleepEvent,
  TARGET_HIGH_MMOL_L,
  TARGET_LOW_MMOL_L,
  TimelineData,
  TimeRange,
} from "@/domain/models";
import type { SourceCapabilityKind } from "@/domain/sourceCapabilities";
import { sourceSupports } from "@/domain/sourceCapabilities";
import type { TimestampedNotificationIob } from "@/data/notification/NotificationEventStore";
import { manualKetoneDraftFromEvent } from "@/data/manualContext";
import { formatManualKetoneTitle } from "@/data/manualKetones";
import {
  addDays,
  dayRange,
  DateKey,
  formatShortDate,
  formatTime,
  getZonedDateTimeParts,
  isDateKey,
  multiDayRange,
  toDateKey,
  zonedDateTimeToTimestamp,
} from "@/domain/time";

import type { TarvisAnswer } from "./types";
import { mealNutritionSummary } from "@/domain/mealNutrition";
import { extractTarvisLiterals } from "./intent/literals";
import {
  presentRetrospectivePhysiology,
  type RetrospectivePhysiology,
  type RetrospectivePhysiologyLoader,
  unavailableRetrospectivePhysiology,
} from "./retrospectivePhysiology";
import type { RetrospectiveIobLoader } from "./retrospectiveIobLoader";
import { requestedTarvisPeriodDays } from "./scope";
import { formatGlucose } from "@/domain/regionalFormat";
import { getRuntimeRegionalDefaults } from "@/domain/regionalProfileRuntime";
import { formatStrengthWorkoutSet } from "@/domain/strengthWorkoutPresentation";
import {
  formatTarvisFixedNumber,
  formatTarvisNumber,
} from "./regionalNumberPresentation";

const HOUR_MS = 60 * 60 * 1_000;
const MINUTE_MS = 60 * 1_000;
const BEFORE_ACTIVITY_MS = 4 * HOUR_MS;
const AFTER_ACTIVITY_MS = 2 * HOUR_MS;
const SLEEP_LOOKBACK_MS = 24 * HOUR_MS;

function regionalGlucose(mmolL: number) {
  return formatGlucose(mmolL, getRuntimeRegionalDefaults());
}

const RETROSPECTIVE_LANGUAGE =
  /\b(?:why|what (?:happened|was going on|made)|explain|review|how did|can you look into|any idea why)\b|\b(?:did|could|might)\b[\s\S]{0,100}\b(?:cause|caused|affect|make|made|trigger|triggered|responsible)\b|\bwas\b[\s\S]{0,100}\b(?:related to|because|responsible for|caused by|affected by|triggered by|due to)\b/i;
const GLUCOSE_EVENT_LANGUAGE =
  /\b(?:low|lows|hypo|hypos|high|highs|hyper|hypers|spike|spiked|rise|rose|rising|drop|dropped|fall|fell|falling|down|glucose|blood sugar|sugars?|bg)\b/i;
const ACTIVITY_LANGUAGE =
  /\b(?:walk(?:ed|ing)?|stroll(?:ed|ing)?|hik(?:e|ed|ing)|workout|work(?:ed|ing)? out|exercis(?:e|ed|ing)|gym|lift(?:ed|ing)?|weights?|run|ran|running|jog(?:ged|ging)?|cycl(?:e|ed|ing)|bik(?:e|ed|ing)|ride|rode|riding|swim|swam|swimming|football|sport|activity)\b/i;
const ACTIVITY_EVIDENCE_CATEGORY_REQUEST =
  /(?=[\s\S]*\b(?:activity|exercise|workouts?|walk(?:ed|ing)?|stroll(?:ed|ing)?|hik(?:e|ed|ing)|gym|lift(?:ed|ing)?|weights?|run|ran|running|jog(?:ged|ging)?|cycl(?:e|ed|ing)|bik(?:e|ed|ing)|ride|rode|riding|swim|swam|swimming|football|sport)\b)(?=[\s\S]*\b(?:food|meals?|carbs?|carbohydrates?|breakfast|lunch|dinner|insulin|bolus|basal|sleep|data|sensor|gaps?|records?|notes?|context|ketones?)\b)/i;
const MULTI_FACTOR_ACTIVITY_CAUSAL_LIST =
  /(?:\b(?:activity|exercise|workouts?|walk(?:ed|ing)?|stroll(?:ed|ing)?|hik(?:e|ed|ing)|gym|lift(?:ed|ing)?|weights?|run|ran|running|jog(?:ged|ging)?|cycl(?:e|ed|ing)|bik(?:e|ed|ing)|ride|rode|riding|swim|swam|swimming|football|sport)\b[^.!?;\r\n]{0,50}(?:,|\band\b|\bor\b)[^.!?;\r\n]{0,50}\b(?:food|meals?|carbs?|carbohydrates?|breakfast|lunch|dinner|insulin|bolus|basal|sleep|data|sensor|gaps?|records?|notes?|context|ketones?)\b[^.!?;\r\n]{0,80}\b(?:caus(?:e|ed|ing)|affect(?:s|ed|ing)?|mak(?:e|es|ing)|made|trigger(?:s|ed|ing)?|responsible\s+for|relat(?:e|es|ed|ing)\s+to|lead(?:s|ing)?\s+to|led\s+to|explain(?:s|ed|ing)?)\b|\b(?:food|meals?|carbs?|carbohydrates?|breakfast|lunch|dinner|insulin|bolus|basal|sleep|data|sensor|gaps?|records?|notes?|context|ketones?)\b[^.!?;\r\n]{0,70}(?:,|\band\b|\bor\b)[^.!?;\r\n]{0,50}\b(?:activity|exercise|workouts?|walk(?:ed|ing)?|stroll(?:ed|ing)?|hik(?:e|ed|ing)|gym|lift(?:ed|ing)?|weights?|run|ran|running|jog(?:ged|ging)?|cycl(?:e|ed|ing)|bik(?:e|ed|ing)|ride|rode|riding|swim|swam|swimming|football|sport)\b[^.!?;\r\n]{0,80}\b(?:caus(?:e|ed|ing)|affect(?:s|ed|ing)?|mak(?:e|es|ing)|made|trigger(?:s|ed|ing)?|responsible\s+for|relat(?:e|es|ed|ing)\s+to|lead(?:s|ing)?\s+to|led\s+to|explain(?:s|ed|ing)?)\b|\b(?:caused\s+by|because\s+of|due\s+to|related\s+to|triggered\s+by|affected\s+by)\b[^.!?;\r\n]{0,70}(?:\b(?:activity|exercise|workouts?|walk(?:ed|ing)?|stroll(?:ed|ing)?|hik(?:e|ed|ing)|gym|lift(?:ed|ing)?|weights?|run|ran|running|jog(?:ged|ging)?|cycl(?:e|ed|ing)|bik(?:e|ed|ing)|ride|rode|riding|swim|swam|swimming|football|sport)\b[^.!?;\r\n]{0,50}(?:,|\band\b|\bor\b)[^.!?;\r\n]{0,50}\b(?:food|meals?|carbs?|carbohydrates?|breakfast|lunch|dinner|insulin|bolus|basal|sleep|data|sensor|gaps?|records?|notes?|context|ketones?)\b|\b(?:food|meals?|carbs?|carbohydrates?|breakfast|lunch|dinner|insulin|bolus|basal|sleep|data|sensor|gaps?|records?|notes?|context|ketones?)\b[^.!?;\r\n]{0,70}(?:,|\band\b|\bor\b)[^.!?;\r\n]{0,50}\b(?:activity|exercise|workouts?|walk(?:ed|ing)?|stroll(?:ed|ing)?|hik(?:e|ed|ing)|gym|lift(?:ed|ing)?|weights?|run|ran|running|jog(?:ged|ging)?|cycl(?:e|ed|ing)|bik(?:e|ed|ing)|ride|rode|riding|swim|swam|swimming|football|sport)\b))/i;
const MULTI_FACTOR_CONNECTOR =
  /\b(?:plus|together\s+with|alongside|as\s+well\s+as)\b/gi;
const SPECIFIC_NAMED_ACTIVITY_INCIDENT =
  /\bmy\s+(?:walk|run|ride|workout|gym\s+session|hike|swim|football)\b/i;
const TEMPORAL_ACTIVITY_INCIDENT =
  /\b(?:during|after|before|while|whilst|when|on)\s+(?:(?:i|we)\s+(?:(?:was|were)\s+)?|(?:my|the|that|a|an)\s+)?(?:out\s+)?(?:walk(?:ed|ing)?|stroll(?:ed|ing)?|hik(?:e|ed|ing)|workout|work(?:ed|ing)?\s+out|exercis(?:e|ed|ing)|gym|lift(?:ed|ing)?|run|ran|running|jog(?:ged|ging)?|cycl(?:e|ed|ing)|bik(?:e|ed|ing)|ride|rode|riding|swim|swam|swimming|football|sport|activity)\b/i;
const PERSONAL_ACTIVITY_ACTION =
  /\b(?:i|we)\s+(?:walked|strolled|hiked|ran|jogged|cycled|biked|rode|swam|exercised|lifted|worked\s+out)\b/i;
const ACTIVITY_CAUSAL_FORWARD =
  /\b(?:walk(?:ed|ing)?|stroll(?:ed|ing)?|hik(?:e|ed|ing)|workouts?|work(?:ed|ing)?\s+out|exercis(?:e|ed|ing)|gym|lift(?:ed|ing)?|run|ran|running|jog(?:ged|ging)?|cycl(?:e|ed|ing)|bik(?:e|ed|ing)|ride|rode|riding|swim|swam|swimming|football|sport|activity)\b[^.!?;\r\n]{0,80}\b(?:caus(?:e|ed|ing)|affect(?:s|ed|ing)?|mak(?:e|es|ing)|made|trigger(?:s|ed|ing)?|responsible\s+for|relat(?:e|es|ed|ing)\s+to)\b/i;
const ACTIVITY_CAUSAL_REVERSE =
  /\b(?:low|hypo|high|hyper|spike|rise|drop|fall|glucose|blood\s+sugar|sugars?|bg)\b[^.!?;\r\n]{0,80}\b(?:related\s+to|because\s+of|caused\s+by|affected\s+by|triggered\s+by|due\s+to)\s+(?:(?:my|the|that|a|an)\s+)?(?:walk(?:ed|ing)?|stroll(?:ed|ing)?|hik(?:e|ed|ing)|workouts?|work(?:ed|ing)?\s+out|exercis(?:e|ed|ing)|gym|lift(?:ed|ing)?|run|ran|running|jog(?:ged|ging)?|cycl(?:e|ed|ing)|bik(?:e|ed|ing)|ride|rode|riding|swim|swam|swimming|football|sport|activity)\b/i;
const CONCRETE_EVENT_LANGUAGE =
  /\b(?:yesterday|today|tonight|this (?:morning|afternoon|evening)|last (?:night|week|month|monday|tuesday|wednesday|thursday|friday|saturday|sunday)|(?:in|over|during|for)?\s*(?:the\s+)?(?:last|past|previous)\s+(?:\d+|three|seven|fourteen|thirty|ninety)\s+(?:days?|weeks?|months?)|earlier|\d+\s+(?:minutes?|hours?|days?|weeks?)\s+ago|on (?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)|did i|did my|was my|(?:make|made) me (?:low|hypo|high)|i (?:got|went|was|had|walked|strolled|hiked|ran|jogged|cycled|biked|rode|swam|exercised|worked out|lifted)|my (?:walk|workout|hike|run|ride|low|hypo|high)|my (?:glucose|blood sugar|sugar|readings?) (?:went|was|were|fell|dropped|rose|spiked|changed))\b|\b\d{1,2}(?:st|nd|rd|th)?\s+(?:january|february|march|april|may|june|july|august|september|october|november|december)(?:\s+\d{4})?\b/i;

const TYPE_PATTERNS: {
  pattern: RegExp;
  type: ActivityEvent["activityType"];
}[] = [
  {
    pattern: /\b(?:walk(?:ed|ing)?|stroll(?:ed|ing)?|hik(?:e|ed|ing))\b/i,
    type: "walk",
  },
  { pattern: /\b(?:run|ran|running|jog(?:ged|ging)?)\b/i, type: "run" },
  {
    pattern: /\b(?:cycl(?:e|ed|ing)|bik(?:e|ed|ing)|ride|rode|riding)\b/i,
    type: "cycle",
  },
  {
    pattern:
      /\b(?:gym|lift(?:ed|ing)?|weights?|strength|workout|work(?:ed|ing)? out)\b/i,
    type: "strength",
  },
  { pattern: /\b(?:swim|swam|swimming|sport)\b/i, type: "other" },
];

const TITLE_STOP_WORDS = new Set([
  "about",
  "activity",
  "after",
  "before",
  "blood",
  "during",
  "dinner",
  "exercise",
  "fell",
  "from",
  "glucose",
  "happened",
  "last",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
  "night",
  "review",
  "sugar",
  "sugars",
  "that",
  "this",
  "today",
  "walk",
  "walked",
  "walking",
  "when",
  "went",
  "workout",
  "yesterday",
]);

export interface RetrospectiveEventReview {
  outcome: "ready" | "clarification" | "insufficient";
  answer: TarvisAnswer;
  evidence: EvidenceReference[];
  event?: {
    kind: RetrospectiveGlucoseEventKind;
    observed: boolean;
    activityContributionSupported: boolean;
  };
}

export type RetrospectiveIobContext =
  | {
      status: "loaded";
      records: TimestampedNotificationIob[];
      truncated: boolean;
    }
  | {
      status: "unavailable";
      records: [];
      truncated: false;
    };

export type RetrospectiveGlucoseEventKind = "low" | "high" | "drop" | "neutral";

export interface RetrospectiveGlucoseCoverage {
  expectedMinutes: number;
  observedMinutes: number;
  coveragePercent: number;
  longestGapMinutes: number;
  readingCount: number;
}

export function isRetrospectiveEventQuestion(question: string) {
  return (
    RETROSPECTIVE_LANGUAGE.test(question) &&
    GLUCOSE_EVENT_LANGUAGE.test(question) &&
    ACTIVITY_LANGUAGE.test(question) &&
    (!isActivityEvidenceCategoryRequest(question) ||
      hasExplicitActivityIncident(question)) &&
    hasConcreteTarvisEventMarker(question)
  );
}

export function isActivityEvidenceCategoryRequest(question: string) {
  return ACTIVITY_EVIDENCE_CATEGORY_REQUEST.test(question);
}

function hasExplicitActivityIncident(question: string) {
  if (
    SPECIFIC_NAMED_ACTIVITY_INCIDENT.test(question) ||
    TEMPORAL_ACTIVITY_INCIDENT.test(question) ||
    PERSONAL_ACTIVITY_ACTION.test(question)
  ) {
    return true;
  }
  if (
    MULTI_FACTOR_ACTIVITY_CAUSAL_LIST.test(
      question.replace(MULTI_FACTOR_CONNECTOR, "and"),
    )
  ) {
    return false;
  }
  return (
    ACTIVITY_CAUSAL_FORWARD.test(question) ||
    ACTIVITY_CAUSAL_REVERSE.test(question)
  );
}

export function hasConcreteTarvisEventMarker(question: string) {
  return (
    CONCRETE_EVENT_LANGUAGE.test(question) ||
    requestedTarvisPeriodDays(question) !== undefined
  );
}

const EXPLICIT_TRAILING_PERIOD =
  /\b(?:in|over|during|for)?\s*(?:the\s+)?(?:last|past|previous)\s+(\d{1,3}|one|two|three|four|five|six|seven|eight|nine|ten|fourteen|thirty|sixty|ninety)\s+(days?|weeks?|months?)\b/i;

export function unsupportedRetrospectivePeriodReason(question: string) {
  const match = EXPLICIT_TRAILING_PERIOD.exec(question);
  if (
    !match ||
    /\bago\b/i.test(
      question.slice(
        match.index + match[0].length,
        match.index + match[0].length + 8,
      ),
    )
  ) {
    return undefined;
  }
  if (requestedTarvisPeriodDays(question) !== undefined) return undefined;
  return `That retrospective period (${match[1]} ${match[2]}) is not supported exactly yet.`;
}

const UNRESOLVED_RETROSPECTIVE_TIME =
  /\b(?:last|this) weekend\b|\blast year\b|\bthe other day\b|\b(?:in|during)\s+(?:january|february|march|april|may|june|july|august|september|october|november|december)\b|\b(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+(?:mondays?|tuesdays?|wednesdays?|thursdays?|fridays?|saturdays?|sundays?)\s+ago\b/i;
const FUTURE_RETROSPECTIVE_TIME =
  /\btomorrow\b|\bnext\s+(?:week|month|year|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i;

export function retrospectiveTemporalIssue(question: string, asOf: number) {
  const unsupportedPeriod = unsupportedRetrospectivePeriodReason(question);
  if (unsupportedPeriod) return unsupportedPeriod;
  if (FUTURE_RETROSPECTIVE_TIME.test(question)) {
    return "A retrospective review cannot search a future date.";
  }
  const today = toDateKey(asOf);
  const futureLiteral = extractTarvisLiterals(question, {
    now: asOf,
    timezone: getRuntimeRegionalDefaults().timeZone,
  }).dates.find(({ date }) => isDateKey(date) && date > today);
  if (futureLiteral) {
    return "A retrospective review cannot search a future date.";
  }
  if (UNRESOLVED_RETROSPECTIVE_TIME.test(question)) {
    return "That retrospective time description is not precise enough to search without guessing.";
  }
  return undefined;
}

export function retrospectiveGlucoseEventKind(
  question: string,
): RetrospectiveGlucoseEventKind {
  if (/\b(?:low|lows|hypo|hypos|below range)\b/i.test(question)) return "low";
  if (
    /\b(?:high|highs|hyper|hypers|spike|spiked|rise|rose|rising|went up)\b/i.test(
      question,
    )
  ) {
    return "high";
  }
  if (/\b(?:drop|dropped|fall|fell|falling|went down)\b/i.test(question)) {
    return "drop";
  }
  return "neutral";
}

const WEEKDAY_INDEX: Record<string, number> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};

function weekdayDateKey(question: string, today: DateKey): DateKey | undefined {
  const match =
    /\b(last\s+)?(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i.exec(
      question,
    );
  if (!match?.[2]) return undefined;
  const [year, month, day] = today.split("-").map(Number);
  const todayWeekday = new Date(Date.UTC(year!, month! - 1, day!)).getUTCDay();
  const requestedWeekday = WEEKDAY_INDEX[match[2].toLowerCase()];
  if (requestedWeekday === undefined) return undefined;
  let daysAgo = (todayWeekday - requestedWeekday + 7) % 7;
  if (match[1] && daysAgo === 0) daysAgo = 7;
  return addDays(today, -daysAgo);
}

export function rangeForRetrospectiveEventQuestion(
  question: string,
  asOf: number,
): TimeRange {
  const temporalIssue = retrospectiveTemporalIssue(question, asOf);
  if (temporalIssue) throw new Error(temporalIssue);
  const today = toDateKey(asOf);
  if (/\blast night\b/i.test(question)) {
    const previousDay = addDays(today, -1);
    return {
      start: zonedDateTimeToTimestamp(previousDay, 16),
      end: Math.min(asOf, zonedDateTimeToTimestamp(today, 12)),
    };
  }
  const literalDate = extractTarvisLiterals(question, {
    now: asOf,
    timezone: getRuntimeRegionalDefaults().timeZone,
  }).dates[0]?.date;
  if (isDateKey(literalDate)) {
    return rangeForRetrospectiveDate(literalDate, question, asOf);
  }
  const relativeDate = relativeAgoDateKey(question, today, asOf);
  if (relativeDate) {
    return dayRange(relativeDate, asOf);
  }
  const requestedWeekday = weekdayDateKey(question, today);
  if (requestedWeekday) {
    return rangeForRetrospectiveDate(requestedWeekday, question, asOf);
  }
  const calendarPeriod = retrospectiveCalendarPeriodRange(
    question,
    today,
    asOf,
  );
  if (calendarPeriod) return calendarPeriod;
  if (
    /\b(?:tonight|this morning|this afternoon|this evening)\b/i.test(question)
  ) {
    return dayRange(today, asOf);
  }
  return multiDayRange(today, requestedTarvisPeriodDays(question) ?? 7, asOf);
}

function relativeAgoDateKey(question: string, today: DateKey, asOf: number) {
  const match =
    /\b(\d{1,6}|a|one|two|three|four|five|six|seven|eight|nine|ten|fourteen|thirty)\s+(minutes?|hours?|days?|weeks?|fortnights?)\s+ago\b/i.exec(
      question,
    );
  if (!match?.[1] || !match[2]) return undefined;
  const numberWords: Record<string, number> = {
    a: 1,
    one: 1,
    two: 2,
    three: 3,
    four: 4,
    five: 5,
    six: 6,
    seven: 7,
    eight: 8,
    nine: 9,
    ten: 10,
    fourteen: 14,
    thirty: 30,
  };
  const amount = numberWords[match[1].toLowerCase()] ?? Number(match[1]);
  if (!Number.isSafeInteger(amount) || amount < 0) return undefined;
  const unit = match[2].toLowerCase();
  if (unit.startsWith("minute")) {
    return toDateKey(Math.max(0, asOf - amount * MINUTE_MS));
  }
  if (unit.startsWith("hour")) {
    return toDateKey(Math.max(0, asOf - amount * HOUR_MS));
  }
  if (unit.startsWith("fortnight")) return addDays(today, -(amount * 14));
  return addDays(today, -(unit.startsWith("week") ? amount * 7 : amount));
}

function monthStart(date: DateKey): DateKey {
  const [year, month] = date.split("-");
  return `${year}-${month}-01` as DateKey;
}

function shiftMonthStart(date: DateKey, amount: number): DateKey {
  const [year, month] = date.split("-").map(Number);
  const shifted = new Date(Date.UTC(year!, month! - 1 + amount, 1));
  return [
    shifted.getUTCFullYear(),
    String(shifted.getUTCMonth() + 1).padStart(2, "0"),
    "01",
  ].join("-") as DateKey;
}

function weekStart(date: DateKey) {
  const [year, month, day] = date.split("-").map(Number);
  const weekday = new Date(Date.UTC(year!, month! - 1, day!)).getUTCDay();
  const firstDay = getRuntimeRegionalDefaults().firstDayOfWeek;
  return addDays(date, -((weekday - firstDay + 7) % 7));
}

function retrospectiveCalendarPeriodRange(
  question: string,
  today: DateKey,
  asOf: number,
): TimeRange | undefined {
  if (/\bthis week\b/i.test(question)) {
    return { start: zonedDateTimeToTimestamp(weekStart(today)), end: asOf };
  }
  if (/\b(?:last|previous) week\b/i.test(question)) {
    const currentWeekStart = weekStart(today);
    return {
      start: zonedDateTimeToTimestamp(addDays(currentWeekStart, -7)),
      end: zonedDateTimeToTimestamp(currentWeekStart),
    };
  }
  if (/\bthis month\b/i.test(question)) {
    return { start: zonedDateTimeToTimestamp(monthStart(today)), end: asOf };
  }
  if (/\b(?:last|previous) month\b/i.test(question)) {
    const currentMonthStart = monthStart(today);
    return {
      start: zonedDateTimeToTimestamp(shiftMonthStart(currentMonthStart, -1)),
      end: zonedDateTimeToTimestamp(currentMonthStart),
    };
  }
  return undefined;
}

function rangeForRetrospectiveDate(
  date: DateKey,
  question: string,
  asOf: number,
): TimeRange {
  const range = dayRange(date, asOf);
  if (!/\bnight\b/i.test(question)) return range;
  return {
    start: range.start,
    end: Math.min(asOf, zonedDateTimeToTimestamp(addDays(date, 1), 6)),
  };
}

function activityEnd(activity: ActivityEvent) {
  return activity.end ?? activity.start + activity.durationMinutes * MINUTE_MS;
}

export function rangeForRetrospectiveActivity(
  activity: ActivityEvent,
): TimeRange {
  return {
    start: Math.max(0, activity.start - BEFORE_ACTIVITY_MS),
    end: activityEnd(activity) + AFTER_ACTIVITY_MS,
  };
}

function rangeForRetrospectiveReviewData(activity: ActivityEvent): TimeRange {
  const incidentRange = rangeForRetrospectiveActivity(activity);
  return {
    start: Math.max(0, activity.start - SLEEP_LOOKBACK_MS),
    end: incidentRange.end,
  };
}

function requestedActivityType(question: string) {
  return TYPE_PATTERNS.find(({ pattern }) => pattern.test(question))?.type;
}

function requestedClockMinutes(question: string) {
  const match = /\b(?:at\s+)?(\d{1,2})(?::|\.)(\d{2})\b/i.exec(question);
  if (!match) return undefined;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return undefined;
  return hour * 60 + minute;
}

function activityClockMinutes(activity: ActivityEvent) {
  const regional = getRuntimeRegionalDefaults();
  const parts = getZonedDateTimeParts(activity.start, regional.timeZone);
  return parts.hour * 60 + parts.minute;
}

function requestedTimeOfDay(question: string) {
  if (/\bmorning\b/i.test(question)) return "morning" as const;
  if (/\bafternoon\b/i.test(question)) return "afternoon" as const;
  if (/\bevening\b/i.test(question)) return "evening" as const;
  if (/\bnight\b/i.test(question)) return "night" as const;
  return undefined;
}

function matchesTimeOfDay(
  activity: ActivityEvent,
  period: ReturnType<typeof requestedTimeOfDay>,
) {
  if (!period) return true;
  const minutes = activityClockMinutes(activity);
  switch (period) {
    case "morning":
      return minutes >= 5 * 60 && minutes < 12 * 60;
    case "afternoon":
      return minutes >= 12 * 60 && minutes < 18 * 60;
    case "evening":
      return minutes >= 17 * 60 && minutes < 23 * 60;
    case "night":
      return minutes >= 18 * 60 || minutes < 6 * 60;
  }
}

function titleTerms(question: string) {
  return question
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .split(/\s+/)
    .filter((term) => term.length >= 3 && !TITLE_STOP_WORDS.has(term));
}

function chooseActivities(question: string, context: HealthContextEvent[]) {
  const requestedType = requestedActivityType(question);
  const clockMinutes = requestedClockMinutes(question);
  const timeOfDay = requestedTimeOfDay(question);
  const terms = titleTerms(question);
  const candidates = context
    .filter((event): event is ActivityEvent => event.kind === "activity")
    .filter(
      (activity) =>
        !requestedType ||
        activity.activityType === requestedType ||
        activity.title.toLowerCase().includes(requestedType),
    )
    .filter((activity) => matchesTimeOfDay(activity, timeOfDay))
    .map((activity) => {
      const normalizedTitle = activity.title.toLowerCase();
      const titleScore = terms.filter((term) =>
        normalizedTitle.includes(term),
      ).length;
      const clockDistance =
        clockMinutes === undefined
          ? undefined
          : Math.abs(activityClockMinutes(activity) - clockMinutes);
      return { activity, titleScore, clockDistance };
    })
    .filter(
      ({ clockDistance }) =>
        clockDistance === undefined ||
        Math.min(clockDistance, 1440 - clockDistance) <= 45,
    )
    .sort(
      (left, right) =>
        right.titleScore - left.titleScore ||
        (left.clockDistance ?? Number.MAX_SAFE_INTEGER) -
          (right.clockDistance ?? Number.MAX_SAFE_INTEGER) ||
        right.activity.start - left.activity.start,
    );

  if (candidates.length <= 1) return candidates.map(({ activity }) => activity);
  const [first, second] = candidates;
  if (
    first &&
    second &&
    (first.titleScore > second.titleScore ||
      (first.clockDistance !== undefined &&
        (second.clockDistance === undefined ||
          first.clockDistance < second.clockDistance)))
  ) {
    return [first.activity];
  }
  return candidates.map(({ activity }) => activity);
}

export function selectRetrospectiveActivities(
  question: string,
  timeline: TimelineData,
) {
  return chooseActivities(question, timeline.context);
}

function preview(
  record: Pick<
    EvidenceRecordPreview,
    "id" | "kind" | "timestamp" | "primary" | "secondary" | "sourceId"
  >,
) {
  return record;
}

function evidenceReference(
  id: string,
  label: string,
  description: string,
  range: TimeRange,
  examples: EvidenceRecordPreview[],
  recordIds = examples.map((example) => example.id),
): EvidenceReference {
  return {
    id,
    label,
    description,
    range,
    recordIds: [...new Set(recordIds)],
    examples: examples.slice(0, 5),
  };
}

function activityEvidence(activity: ActivityEvent): EvidenceReference {
  const end = activityEnd(activity);
  return evidenceReference(
    `tarvis-event-activity:${activity.id}`,
    "Recorded activity",
    `${activity.title}, ${formatTarvisFixedNumber(activity.durationMinutes, 0)} minutes, from ${activity.sourceId}.`,
    { start: activity.start, end },
    [
      preview({
        id: activity.id,
        kind: "context",
        timestamp: activity.start,
        primary: activity.title,
        secondary:
          activity.intensity === "unspecified"
            ? `${formatTarvisFixedNumber(activity.durationMinutes, 0)} min`
            : `${formatTarvisFixedNumber(activity.durationMinutes, 0)} min · ${activity.intensity} intensity`,
        sourceId: activity.sourceId,
      }),
    ],
  );
}

function noActivityReview(range: TimeRange): RetrospectiveEventReview {
  return {
    outcome: "insufficient",
    answer: {
      headline: "I could not find that recorded activity",
      answer:
        "There is no matching walk or workout in the selected period, so I cannot line it up with glucose, meals or insulin without guessing. If the activity was recorded by a watch or fitness app, check that it reached Health Connect and that its activity category is enabled in T1 Arc.",
      confidence: "limited",
      evidenceIds: [],
      limitations: [
        `The search covered ${formatShortDate(toDateKey(range.start))} to ${formatShortDate(toDateKey(range.end - 1))}.`,
        "A route or destination cannot be inferred unless it appears in the recorded activity title or a note.",
      ],
    },
    evidence: [],
  };
}

function clarificationReview(
  activities: ActivityEvent[],
  range: TimeRange,
): RetrospectiveEventReview {
  const visible = activities.slice(0, 4);
  const evidence = visible.map(activityEvidence);
  const choices = visible
    .map(
      (activity) =>
        `${formatShortDate(toDateKey(activity.start))} at ${formatTime(activity.start)} — ${activity.title} (${formatTarvisFixedNumber(activity.durationMinutes, 0)} min)`,
    )
    .join("; ");
  return {
    outcome: "clarification",
    answer: {
      headline: "Which activity did you mean?",
      answer: `I found ${formatTarvisNumber(activities.length, { maximumFractionDigits: 0 })} matching activities: ${choices}. Ask again with the start time, for example “why did I go low during the walk at 19:30?”, and I’ll review that exact event.`,
      confidence: "limited",
      evidenceIds: evidence.map(({ id }) => id),
      limitations: [
        "No activity was selected automatically because the records did not identify one unambiguously.",
      ],
    },
    evidence,
  };
}

function glucosePreview(reading: GlucoseReading): EvidenceRecordPreview {
  return preview({
    id: reading.id,
    kind: "glucose",
    timestamp: reading.timestamp,
    primary: regionalGlucose(reading.mmolL),
    secondary:
      reading.trend === "unknown"
        ? "Recorded glucose"
        : `Trend ${reading.trend}`,
    sourceId: reading.sourceId,
  });
}

function describeStrengthSet(
  set: NonNullable<
    ActivityEvent["strengthWorkout"]
  >["exercises"][number]["sets"][number],
) {
  return formatStrengthWorkoutSet(set);
}

const MAX_GLUCOSE_INTERVAL_MS = 15 * MINUTE_MS;

export function retrospectiveGlucoseCoverage(
  readings: readonly GlucoseReading[],
  range: TimeRange,
): RetrospectiveGlucoseCoverage {
  const expectedMs = Math.max(0, range.end - range.start);
  const intervals = readings
    .filter(
      (reading) =>
        reading.timestamp >= range.start && reading.timestamp < range.end,
    )
    .map((reading) => ({
      start: reading.timestamp,
      end: Math.min(range.end, reading.timestamp + MAX_GLUCOSE_INTERVAL_MS),
    }))
    .filter((interval) => interval.end > interval.start)
    .sort((left, right) => left.start - right.start);

  const merged: { start: number; end: number }[] = [];
  for (const interval of intervals) {
    const previous = merged[merged.length - 1];
    if (previous && interval.start <= previous.end) {
      previous.end = Math.max(previous.end, interval.end);
    } else {
      merged.push({ ...interval });
    }
  }

  const observedMs = merged.reduce(
    (total, interval) => total + interval.end - interval.start,
    0,
  );
  let cursor = range.start;
  let longestGapMs = 0;
  for (const interval of merged) {
    longestGapMs = Math.max(longestGapMs, interval.start - cursor);
    cursor = Math.max(cursor, interval.end);
  }
  longestGapMs = Math.max(longestGapMs, range.end - cursor);

  return {
    expectedMinutes: expectedMs / MINUTE_MS,
    observedMinutes: observedMs / MINUTE_MS,
    coveragePercent:
      expectedMs > 0 ? Math.min(100, (observedMs / expectedMs) * 100) : 0,
    longestGapMinutes: longestGapMs / MINUTE_MS,
    readingCount: intervals.length,
  };
}

function minReading(readings: readonly GlucoseReading[]) {
  return readings.reduce<GlucoseReading | undefined>(
    (current, reading) =>
      !current || reading.mmolL < current.mmolL ? reading : current,
    undefined,
  );
}

function maxReading(readings: readonly GlucoseReading[]) {
  return readings.reduce<GlucoseReading | undefined>(
    (current, reading) =>
      !current || reading.mmolL > current.mmolL ? reading : current,
    undefined,
  );
}

function describeGlucose(
  activity: ActivityEvent,
  glucose: GlucoseReading[],
  eventKind: RetrospectiveGlucoseEventKind,
) {
  const end = activityEnd(activity);
  const outcomeRange = { start: activity.start, end: end + AFTER_ACTIVITY_MS };
  const beforeStart = glucose.filter(
    (reading) =>
      reading.timestamp <= activity.start &&
      reading.timestamp >= activity.start - 30 * MINUTE_MS,
  );
  const nearStart =
    beforeStart[beforeStart.length - 1] ??
    [...glucose]
      .filter(
        (reading) =>
          reading.timestamp > activity.start &&
          reading.timestamp <= activity.start + 30 * MINUTE_MS,
      )
      .sort((left, right) => left.timestamp - right.timestamp)[0];
  const relevant = glucose.filter(
    (reading) =>
      reading.timestamp >= outcomeRange.start &&
      reading.timestamp <= outcomeRange.end,
  );
  const lows = relevant.filter((reading) => reading.mmolL < TARGET_LOW_MMOL_L);
  const lowAtOrBeforeStart =
    nearStart &&
    nearStart.timestamp <= activity.start &&
    nearStart.mmolL < TARGET_LOW_MMOL_L
      ? nearStart
      : undefined;
  const highs = relevant.filter(
    (reading) => reading.mmolL > TARGET_HIGH_MMOL_L,
  );
  const firstLow = lows[0];
  const lowest = minReading(lows);
  const firstHigh = highs[0];
  const highest = maxReading(highs);
  const lowestRelevant = minReading(relevant);
  const highestRelevant = maxReading(relevant);
  const after = relevant.find((reading) => reading.timestamp > end);
  const lowestAfterStart = nearStart
    ? minReading(
        relevant.filter((reading) => reading.timestamp > nearStart.timestamp),
      )
    : undefined;
  const dropAmount =
    nearStart && lowestAfterStart && lowestAfterStart.mmolL < nearStart.mmolL
      ? nearStart.mmolL - lowestAfterStart.mmolL
      : undefined;

  const sentences: string[] = [];
  if (nearStart) {
    sentences.push(
      `Glucose was ${regionalGlucose(nearStart.mmolL)} near the start at ${formatTime(nearStart.timestamp)}.`,
    );
    if (
      nearStart.trend === "doubleDown" ||
      nearStart.trend === "down" ||
      nearStart.trend === "slightDown"
    ) {
      sentences.push(
        "The source-recorded trend was already falling at that point.",
      );
    }
  }
  if (eventKind === "low") {
    if (lowAtOrBeforeStart) {
      sentences.push(
        `Glucose was already below ${regionalGlucose(TARGET_LOW_MMOL_L)} before the activity began, so the activity cannot explain the start of the low on its own.`,
      );
      if (lowest && lowest.id !== lowAtOrBeforeStart.id) {
        sentences.push(
          `The lowest recorded value during the activity or following two hours was ${regionalGlucose(lowest.mmolL)} at ${formatTime(lowest.timestamp)}.`,
        );
      }
    } else if (firstLow && lowest) {
      sentences.push(
        `The first recorded value below ${regionalGlucose(TARGET_LOW_MMOL_L)} was ${regionalGlucose(firstLow.mmolL)} at ${formatTime(firstLow.timestamp)}, and the lowest was ${regionalGlucose(lowest.mmolL)} at ${formatTime(lowest.timestamp)}.`,
      );
      if (nearStart && firstLow.timestamp > nearStart.timestamp) {
        const fall = nearStart.mmolL - firstLow.mmolL;
        const elapsedMinutes = Math.round(
          (firstLow.timestamp - nearStart.timestamp) / MINUTE_MS,
        );
        if (fall > 0) {
          const timing =
            firstLow.timestamp <= end
              ? "during the activity"
              : `${formatTarvisNumber(Math.round((firstLow.timestamp - end) / MINUTE_MS), { maximumFractionDigits: 0 })} minutes after it ended`;
          sentences.push(
            `That was a recorded fall of ${regionalGlucose(fall)} over ${formatTarvisNumber(elapsedMinutes, { maximumFractionDigits: 0 })} minutes, reaching the first low ${timing}.`,
          );
        }
      }
    } else {
      sentences.push(
        `No recorded glucose value fell below ${regionalGlucose(TARGET_LOW_MMOL_L)} during the activity or the following two hours.`,
      );
    }
  } else if (eventKind === "high") {
    if (firstHigh && highest) {
      sentences.push(
        `The first recorded value above ${regionalGlucose(TARGET_HIGH_MMOL_L)} was ${regionalGlucose(firstHigh.mmolL)} at ${formatTime(firstHigh.timestamp)}, and the highest was ${regionalGlucose(highest.mmolL)} at ${formatTime(highest.timestamp)}.`,
      );
    } else {
      sentences.push(
        `No recorded glucose value rose above ${regionalGlucose(TARGET_HIGH_MMOL_L)} during the activity or the following two hours.`,
      );
    }
  } else if (eventKind === "drop") {
    if (nearStart && lowestAfterStart && dropAmount !== undefined) {
      sentences.push(
        `It later reached ${regionalGlucose(lowestAfterStart.mmolL)} at ${formatTime(lowestAfterStart.timestamp)}, a recorded fall of ${regionalGlucose(dropAmount)} from the near-start reading.`,
      );
    } else if (nearStart) {
      sentences.push(
        "The available readings did not show a fall from the near-start value during the activity or the following two hours.",
      );
    } else {
      sentences.push(
        "There was no reading close enough to the activity start to measure the described drop without guessing.",
      );
    }
  } else if (lowestRelevant && highestRelevant) {
    sentences.push(
      `During the activity and following two hours, recorded glucose ranged from ${regionalGlucose(lowestRelevant.mmolL)} to ${regionalGlucose(highestRelevant.mmolL)}.`,
    );
  } else {
    sentences.push(
      "No glucose readings were available during the activity or the following two hours.",
    );
  }
  if (after) {
    sentences.push(
      `The first reading after the activity was ${regionalGlucose(after.mmolL)} at ${formatTime(after.timestamp)}.`,
    );
  }

  const eventObserved =
    eventKind === "low"
      ? Boolean(lowAtOrBeforeStart || firstLow)
      : eventKind === "high"
        ? Boolean(firstHigh)
        : eventKind === "drop"
          ? dropAmount !== undefined
          : relevant.length > 0;
  const activityContributionSupported =
    eventKind === "low"
      ? lowAtOrBeforeStart
        ? dropAmount !== undefined
        : Boolean(firstLow)
      : eventKind === "drop"
        ? dropAmount !== undefined
        : false;
  const representatives = [
    nearStart,
    eventKind === "low"
      ? firstLow
      : eventKind === "high"
        ? firstHigh
        : undefined,
    eventKind === "low"
      ? lowest
      : eventKind === "high"
        ? highest
        : lowestAfterStart,
    after,
  ]
    .filter((reading): reading is GlucoseReading => Boolean(reading))
    .filter(
      (reading, index, values) =>
        values.findIndex((candidate) => candidate.id === reading.id) === index,
    );

  return {
    sentences,
    eventObserved,
    activityContributionSupported,
    nearStart,
    relevant,
    representatives,
    outcomeRange,
  };
}

function formatWindowTimestamp(timestamp: number, anchor: number) {
  return toDateKey(timestamp) === toDateKey(anchor)
    ? formatTime(timestamp)
    : `${formatShortDate(toDateKey(timestamp))} at ${formatTime(timestamp)}`;
}

function timingRelativeToActivity(timestamp: number, activity: ActivityEvent) {
  if (timestamp < activity.start) return "before the activity";
  if (timestamp <= activityEnd(activity)) return "during the activity";
  return "after the activity";
}

function distanceFromActivityStart(timestamp: number, activity: ActivityEvent) {
  const minutes = Math.round(Math.abs(activity.start - timestamp) / MINUTE_MS);
  if (timestamp < activity.start) {
    return `${durationText(minutes)} before the activity started`;
  }
  if (timestamp === activity.start) return "at the activity start";
  return `${durationText(minutes)} after the activity started`;
}

function formatIobUnits(value: number) {
  return formatTarvisNumber(value, { maximumFractionDigits: 2 });
}

function validIobRecords(
  context: RetrospectiveIobContext | undefined,
  range: TimeRange,
) {
  if (context?.status !== "loaded" || context.truncated) return [];
  return context.records
    .filter(
      (record) =>
        typeof record.id === "string" &&
        record.id.length > 0 &&
        typeof record.sourceId === "string" &&
        record.sourceId.length > 0 &&
        typeof record.packageName === "string" &&
        record.packageName.length > 0 &&
        typeof record.sourceLabel === "string" &&
        record.sourceLabel.length > 0 &&
        Number.isSafeInteger(record.capturedAt) &&
        record.capturedAt >= range.start &&
        record.capturedAt < range.end &&
        Number.isFinite(record.iobUnits) &&
        record.iobUnits >= 0 &&
        record.iobUnits <= 100,
    )
    .sort(
      (left, right) =>
        left.capturedAt - right.capturedAt || left.id.localeCompare(right.id),
    );
}

function representativeIobBySource(
  records: readonly TimestampedNotificationIob[],
  activity: ActivityEvent,
) {
  const groups = new Map<string, TimestampedNotificationIob[]>();
  for (const record of records) {
    const sourceRecords = groups.get(record.sourceId) ?? [];
    sourceRecords.push(record);
    groups.set(record.sourceId, sourceRecords);
  }
  return [...groups.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([sourceId, sourceRecords]) => {
      const beforeOrAt = sourceRecords.filter(
        (record) => record.capturedAt <= activity.start,
      );
      const record = beforeOrAt.at(-1) ?? sourceRecords[0]!;
      return {
        sourceId,
        record,
        firstAvailableAfterStart: beforeOrAt.length === 0,
      };
    });
}

function iobContextPresentation(
  context: RetrospectiveIobContext | undefined,
  activity: ActivityEvent,
  range: TimeRange,
) {
  if (context?.status === "loaded" && context.truncated) {
    return {
      sentences: [] as string[],
      limitations: [
        "The bounded notification IOB query was truncated, so T1 Arc did not select or report an incomplete nearest observation and does not estimate historical IOB.",
      ],
      records: [] as TimestampedNotificationIob[],
    };
  }
  if (!context || context.status === "unavailable") {
    return {
      sentences: [] as string[],
      limitations: [
        "T1 Arc could not check timestamped notification IOB for this event, so it does not estimate historical IOB.",
      ],
      records: [] as TimestampedNotificationIob[],
    };
  }
  const records = validIobRecords(context, range);
  if (!records.length) {
    return {
      sentences: [] as string[],
      limitations: [
        "No revalidated timestamped IOB record was available in the review window. This absence is not proof that no notification was captured, and it is not proof that no active insulin was present; T1 Arc does not estimate IOB from bolus or basal records.",
      ],
      records,
    };
  }
  const representatives = representativeIobBySource(records, activity);
  const sentences = representatives.map(
    ({ record, firstAvailableAfterStart }) => {
      if (record.origin === "restored") {
        return firstAvailableAfterStart
          ? `The first available restored ${record.sourceLabel} notification record after the activity started had an original capture time of ${formatWindowTimestamp(record.capturedAt, activity.start)} and reported ${formatIobUnits(record.iobUnits)} U IOB.`
          : `A restored ${record.sourceLabel} notification record with an original capture time of ${formatWindowTimestamp(record.capturedAt, activity.start)} reported ${formatIobUnits(record.iobUnits)} U IOB (${timingRelativeToActivity(record.capturedAt, activity)}).`;
      }
      if (record.origin === "unknown") {
        return firstAvailableAfterStart
          ? `The first available legacy ${record.sourceLabel} notification record after the activity started had a recorded capture time of ${formatWindowTimestamp(record.capturedAt, activity.start)}, reported ${formatIobUnits(record.iobUnits)} U IOB, and its origin could not be verified.`
          : `A legacy ${record.sourceLabel} notification record with a recorded capture time of ${formatWindowTimestamp(record.capturedAt, activity.start)} reported ${formatIobUnits(record.iobUnits)} U IOB (${timingRelativeToActivity(record.capturedAt, activity)}); its origin could not be verified.`;
      }
      return firstAvailableAfterStart
        ? `The first available ${record.sourceLabel} notification after the activity started was captured at ${formatWindowTimestamp(record.capturedAt, activity.start)} and reported ${formatIobUnits(record.iobUnits)} U IOB.`
        : `At ${formatWindowTimestamp(record.capturedAt, activity.start)}, T1 Arc captured a ${record.sourceLabel} notification reporting ${formatIobUnits(record.iobUnits)} U IOB (${timingRelativeToActivity(record.capturedAt, activity)}).`;
    },
  );
  if (representatives.length > 1) {
    sentences.push(
      "Those values came from separate sources; T1 Arc keeps them source-distinct and does not merge or choose between their reported IOB values.",
    );
  }
  return {
    sentences,
    limitations: [
      "These IOB values were reported by notifications retained as evidence; restored and legacy records with unknown origin are labelled separately. T1 Arc does not calculate or interpolate IOB, and it cannot verify the values as pump measurements.",
    ],
    records,
  };
}

function sourceStatusesFor(
  sources: readonly DataSourceStatus[],
  capabilities: readonly SourceCapabilityKind[],
  labelPattern: RegExp,
) {
  return sources.filter(
    (source) =>
      capabilities.some((kind) => sourceSupports(source.capabilities, kind)) ||
      labelPattern.test(source.label) ||
      labelPattern.test(source.id),
  );
}

function noRecordsSentence(
  recordLabel: string,
  statuses: readonly DataSourceStatus[],
) {
  if (!statuses.length) {
    return `No ${recordLabel} record was loaded in the review window. Its source sync status was unavailable, so that is not proof that no ${recordLabel} occurred.`;
  }
  const degraded = statuses.filter((source) => source.freshness !== "current");
  if (degraded.length) {
    return `No ${recordLabel} record was loaded in the review window. ${degraded
      .map((source) => `${source.label} was ${source.freshness}`)
      .join(
        " and ",
      )}, so an absent record may mean the source was not fully synced.`;
  }
  return `No ${recordLabel} record was loaded in the review window. The connected source reports current, but an empty result is not proof that no ${recordLabel} occurred.`;
}

function sourceCoverageLimitations(sources: readonly DataSourceStatus[]) {
  if (!sources.length) {
    return [
      "Source sync status was unavailable for this review, so empty categories cannot be treated as confirmed absence.",
    ];
  }
  return sources
    .filter((source) => source.freshness !== "current")
    .map((source) => {
      const through =
        source.dataThrough === undefined
          ? ""
          : `; its latest recorded data was ${formatShortDate(toDateKey(source.dataThrough))} at ${formatTime(source.dataThrough)}`;
      return `${source.label} reported ${source.freshness} source coverage${through}.`;
    });
}

function closestBasalRecords(
  basal: TimelineData["basal"],
  activity: ActivityEvent,
) {
  return [...basal]
    .sort((left, right) => {
      const leftDistance = Math.min(
        Math.abs(left.start - activity.start),
        Math.abs(left.end - activity.start),
      );
      const rightDistance = Math.min(
        Math.abs(right.start - activity.start),
        Math.abs(right.end - activity.start),
      );
      return leftDistance - rightDistance || left.start - right.start;
    })
    .slice(0, 3)
    .sort((left, right) => left.start - right.start);
}

type RankedReviewContextEvent = SleepEvent | MedicationEvent | ContextNoteEvent;

function manualKetoneReadingFromReviewEvent(event: RankedReviewContextEvent) {
  const draft = manualKetoneDraftFromEvent(event);
  if (!draft) return undefined;
  return draft.ketoneType === "blood"
    ? { ketoneType: "blood" as const, value: draft.value }
    : { ketoneType: "urine" as const, value: draft.value };
}

const REVIEW_NOTE_CATEGORIES = new Set<ContextNoteEvent["category"]>([
  "illness",
  "stress",
  "hormones",
]);

function isManualKetoneReviewEvent(event: RankedReviewContextEvent) {
  return (
    event.kind === "note" &&
    manualKetoneReadingFromReviewEvent(event) !== undefined
  );
}

const REVIEW_CONTEXT_COVERAGE = [
  {
    recordLabel: "sleep",
    sourcePattern: /sleep|health context|context notes?|health connect/i,
    matches: (event: RankedReviewContextEvent) => event.kind === "sleep",
  },
  {
    recordLabel: "medication",
    sourcePattern: /medication|medicine|health context|context notes?/i,
    matches: (event: RankedReviewContextEvent) => event.kind === "medication",
  },
  {
    recordLabel: "illness note",
    sourcePattern: /illness|health context|context notes?/i,
    matches: (event: RankedReviewContextEvent) =>
      event.kind === "note" && event.category === "illness",
  },
  {
    recordLabel: "stress note",
    sourcePattern: /stress|health context|context notes?/i,
    matches: (event: RankedReviewContextEvent) =>
      event.kind === "note" && event.category === "stress",
  },
  {
    recordLabel: "hormone note",
    sourcePattern:
      /hormones?|cycle|health context|context notes?|health connect/i,
    matches: (event: RankedReviewContextEvent) =>
      event.kind === "note" && event.category === "hormones",
  },
  {
    recordLabel: "manually logged ketone",
    sourcePattern: /manual|health context|context notes?|t1 arc/i,
    matches: (event: RankedReviewContextEvent) =>
      isManualKetoneReviewEvent(event),
  },
] as const;

function intervalDistance(
  leftStart: number,
  leftEnd: number,
  rightStart: number,
  rightEnd: number,
) {
  if (leftEnd < rightStart) return rightStart - leftEnd;
  if (leftStart > rightEnd) return leftStart - rightEnd;
  return 0;
}

function reviewContextEvidenceCompleteness(event: RankedReviewContextEvent) {
  const common =
    Number(Boolean(event.sourceLabel?.trim())) +
    Number(event.recordedAt !== undefined);
  if (event.kind === "sleep") {
    return common + 1 + Number(event.qualityPercent !== undefined);
  }
  if (event.kind === "medication") {
    return (
      common +
      Number(event.amount !== undefined) +
      Number(Boolean(event.unit?.trim())) +
      Number(Boolean(event.medicationType?.trim()))
    );
  }
  if (isManualKetoneReviewEvent(event)) {
    return common + 2;
  }
  return common + Number(Boolean(event.detail?.trim()));
}

function rankedReviewContext(
  context: readonly HealthContextEvent[],
  activity: ActivityEvent,
  incidentRange: TimeRange,
) {
  const previousDay = activity.start - SLEEP_LOOKBACK_MS;
  const activityFinish = activityEnd(activity);
  return context
    .filter((event): event is RankedReviewContextEvent => {
      if (event.kind === "sleep") {
        return event.end >= previousDay && event.start <= incidentRange.end;
      }
      if (event.kind === "medication") {
        return (
          event.start >= incidentRange.start && event.start <= incidentRange.end
        );
      }
      return (
        event.kind === "note" &&
        (REVIEW_NOTE_CATEGORIES.has(event.category) ||
          manualKetoneReadingFromReviewEvent(event) !== undefined) &&
        event.start >= incidentRange.start &&
        event.start <= incidentRange.end
      );
    })
    .sort((left, right) => {
      const leftEnd = left.end ?? left.start;
      const rightEnd = right.end ?? right.start;
      const leftDistance = intervalDistance(
        left.start,
        leftEnd,
        activity.start,
        activityFinish,
      );
      const rightDistance = intervalDistance(
        right.start,
        rightEnd,
        activity.start,
        activityFinish,
      );
      return (
        leftDistance - rightDistance ||
        reviewContextEvidenceCompleteness(right) -
          reviewContextEvidenceCompleteness(left) ||
        (left.id === right.id ? 0 : left.id < right.id ? -1 : 1)
      );
    });
}

function durationText(minutes: number) {
  const wholeMinutes = Math.max(0, Math.round(minutes));
  const hours = Math.floor(wholeMinutes / 60);
  const remainder = wholeMinutes % 60;
  if (!hours) {
    return `${formatTarvisNumber(remainder, { maximumFractionDigits: 0 })}m`;
  }
  return `${formatTarvisNumber(hours, { maximumFractionDigits: 0 })}h${
    remainder
      ? ` ${formatTarvisNumber(remainder, { maximumFractionDigits: 0 })}m`
      : ""
  }`;
}

function rankedContextDetail(event: RankedReviewContextEvent) {
  if (event.kind === "sleep") {
    return `${durationText(event.durationMinutes)}${
      event.qualityPercent === undefined
        ? "; quality not recorded"
        : `; ${formatTarvisFixedNumber(event.qualityPercent, 0)}% recorded quality`
    }`;
  }
  if (event.kind === "medication") {
    const amount =
      event.amount === undefined
        ? "amount not recorded"
        : `${formatTarvisNumber(event.amount, { maximumFractionDigits: 2 })}${event.unit ? ` ${event.unit}` : ""}`;
    return `${amount}${event.medicationType ? ` · ${event.medicationType}` : ""}`;
  }
  const ketone = manualKetoneReadingFromReviewEvent(event);
  if (ketone) {
    return `${formatManualKetoneTitle(ketone)} · manually entered`;
  }
  return `${contextNoteCategoryLabel(event.category)} · ${
    event.detail ?? "no additional detail recorded"
  }`;
}

function rankedContextSentence(
  event: RankedReviewContextEvent,
  activity: ActivityEvent,
) {
  const title =
    event.kind === "note"
      ? contextNoteDisplayTitle(event, getRuntimeRegionalDefaults())
      : event.title;
  if (event.kind === "sleep") {
    return `${title} (${rankedContextDetail(event)}) was recorded from ${formatWindowTimestamp(event.start, activity.start)} to ${formatWindowTimestamp(event.end, activity.start)}`;
  }
  const ketone = manualKetoneReadingFromReviewEvent(event);
  if (ketone) {
    return `${formatManualKetoneTitle(ketone)} was manually recorded at ${formatWindowTimestamp(event.start, activity.start)} (${timingRelativeToActivity(event.start, activity)})`;
  }
  return `${title} (${rankedContextDetail(event)}) was recorded at ${formatWindowTimestamp(event.start, activity.start)} (${timingRelativeToActivity(event.start, activity)})`;
}

function rankedContextPreview(event: RankedReviewContextEvent) {
  const ketone = manualKetoneReadingFromReviewEvent(event);
  return preview({
    id: event.id,
    kind: "context",
    timestamp: event.start,
    primary: ketone
      ? formatManualKetoneTitle(ketone)
      : event.kind === "note"
        ? contextNoteDisplayTitle(event, getRuntimeRegionalDefaults())
        : event.title,
    secondary: ketone
      ? `${ketone.ketoneType === "blood" ? "Blood ketone meter value" : "Urine ketone strip result"} · manually entered at the saved event time`
      : rankedContextDetail(event),
    sourceId: event.sourceId,
  });
}

export function buildRetrospectiveEventReview({
  question,
  timeline,
  selectedActivityId,
  physiology,
  iob,
}: {
  question: string;
  timeline: TimelineData;
  selectedActivityId?: string;
  physiology?: RetrospectivePhysiology;
  iob?: RetrospectiveIobContext;
}): RetrospectiveEventReview {
  const activities = selectedActivityId
    ? timeline.context.filter(
        (event): event is ActivityEvent =>
          event.kind === "activity" && event.id === selectedActivityId,
      )
    : chooseActivities(question, timeline.context);
  if (!activities.length) return noActivityReview(timeline.range);
  if (activities.length > 1)
    return clarificationReview(activities, timeline.range);

  const activity = activities[0]!;
  const end = activityEnd(activity);
  const incidentRange = rangeForRetrospectiveActivity(activity);
  const eventKind = retrospectiveGlucoseEventKind(question);
  const glucose = timeline.glucose
    .filter(
      (reading) =>
        reading.timestamp >= incidentRange.start &&
        reading.timestamp <= incidentRange.end,
    )
    .sort((left, right) => left.timestamp - right.timestamp);
  const glucoseDescription = describeGlucose(activity, glucose, eventKind);
  const coverage = retrospectiveGlucoseCoverage(
    glucose,
    glucoseDescription.outcomeRange,
  );
  const meals = timeline.context
    .filter(
      (event): event is MealEvent =>
        event.kind === "meal" &&
        event.start >= incidentRange.start &&
        event.start < activity.start,
    )
    .sort((left, right) => left.start - right.start);
  const boluses = timeline.boluses
    .filter(
      (bolus) =>
        bolus.timestamp >= incidentRange.start &&
        bolus.timestamp <= incidentRange.end,
    )
    .sort((left, right) => left.timestamp - right.timestamp);
  const basal = timeline.basal
    .filter(
      (delivery) =>
        delivery.start < incidentRange.end &&
        delivery.end > incidentRange.start,
    )
    .sort((left, right) => left.start - right.start);
  const pumpStates = (timeline.pumpStates ?? [])
    .filter(
      (state) =>
        state.start < incidentRange.end && state.end > incidentRange.start,
    )
    .sort((left, right) => left.start - right.start);
  const reviewContext = rankedReviewContext(
    timeline.context,
    activity,
    incidentRange,
  );
  const ketoneContext = reviewContext
    .filter(isManualKetoneReviewEvent)
    .sort(
      (left, right) =>
        left.start - right.start || left.id.localeCompare(right.id),
    );
  const otherReviewContext = reviewContext.filter(
    (event) => !isManualKetoneReviewEvent(event),
  );
  const reviewPhysiology =
    physiology?.activityId === activity.id
      ? physiology
      : physiology
        ? unavailableRetrospectivePhysiology(activity, incidentRange)
        : undefined;
  const physiologyPresentation = reviewPhysiology
    ? presentRetrospectivePhysiology(reviewPhysiology, activity)
    : undefined;
  const iobPresentation = iobContextPresentation(iob, activity, incidentRange);

  const evidence: EvidenceReference[] = [activityEvidence(activity)];
  if (glucose.length) {
    evidence.push(
      evidenceReference(
        `tarvis-event-glucose:${activity.id}`,
        "Glucose around the activity",
        `Recorded glucose from four hours before to two hours after ${activity.title}; event coverage is calculated from the activity start through the full two-hour follow-up.`,
        incidentRange,
        glucoseDescription.representatives.map(glucosePreview),
        glucose.map((reading) => reading.id),
      ),
    );
  }
  if (meals.length) {
    const mealPreviews = meals.map((meal) =>
      preview({
        id: meal.id,
        kind: "context",
        timestamp: meal.start,
        primary: meal.title,
        secondary: mealNutritionSummary(meal, { includeItems: true }),
        sourceId: meal.sourceId,
      }),
    );
    evidence.push(
      evidenceReference(
        `tarvis-event-meals:${activity.id}`,
        "Meals before the activity",
        "Meal records strictly before the activity in the four-hour review window.",
        { start: incidentRange.start, end: activity.start },
        mealPreviews,
        meals.map((meal) => meal.id),
      ),
    );
  }
  if (otherReviewContext.length) {
    evidence.push(
      evidenceReference(
        `tarvis-event-context:${activity.id}`,
        "Other recorded review context",
        "Sleep, medication, illness, stress and hormone records ranked first by temporal proximity between each record interval and the activity, then by evidence completeness and stable record ID. This ordering does not establish cause.",
        {
          start: Math.min(
            incidentRange.start,
            ...otherReviewContext.map((event) => event.start),
          ),
          end: Math.max(
            incidentRange.end,
            ...otherReviewContext.map((event) => event.end ?? event.start),
          ),
        },
        otherReviewContext.map(rankedContextPreview),
        otherReviewContext.map((event) => event.id),
      ),
    );
  }
  if (ketoneContext.length) {
    evidence.push(
      evidenceReference(
        `tarvis-event-ketones:${activity.id}`,
        "Manually logged ketone readings",
        "Blood and urine ketone readings manually saved in the review window. Each evidence row retains its typed value, modality and saved event time; timing does not establish cause or a current ketone level.",
        {
          start: Math.min(...ketoneContext.map((event) => event.start)),
          end: Math.max(
            ...ketoneContext.map((event) => (event.end ?? event.start) + 1),
          ),
        },
        ketoneContext.map(rankedContextPreview),
        ketoneContext.map((event) => event.id),
      ),
    );
  }
  if (activity.strengthWorkout) {
    const detail = activity.strengthWorkout;
    const exercisePreviews = detail.exercises.map((exercise) =>
      preview({
        id: `hevy:${detail.workoutId}:exercise:${exercise.index}`,
        kind: "source-record",
        timestamp: activity.start,
        primary: exercise.title,
        secondary: `${formatTarvisNumber(exercise.sets.length, { maximumFractionDigits: 0 })} set${exercise.sets.length === 1 ? "" : "s"} · ${exercise.sets
          .slice(0, 3)
          .map(describeStrengthSet)
          .join("; ")}`,
        sourceId: "hevy",
      }),
    );
    evidence.push(
      evidenceReference(
        `tarvis-event-hevy:${detail.workoutId}`,
        "Hevy workout detail",
        "Exact exercises and sets recorded by Hevy for this workout.",
        { start: activity.start, end },
        exercisePreviews,
        exercisePreviews.map((exercise) => exercise.id),
      ),
    );
  }
  if (reviewPhysiology?.records.length && physiologyPresentation) {
    evidence.push(
      evidenceReference(
        `tarvis-event-physiology:${activity.id}`,
        "Physiology recorded around the activity",
        physiologyPresentation.evidenceDescription,
        { start: activity.start, end },
        physiologyPresentation.previews,
        reviewPhysiology.records.map((record) => record.id),
      ),
    );
  }
  if (boluses.length || basal.length || pumpStates.length) {
    const insulinPreviews = [
      ...boluses.map((bolus) =>
        preview({
          id: bolus.id,
          kind: "bolus",
          timestamp: bolus.timestamp,
          primary: `${formatTarvisFixedNumber(bolus.units, 1)} U bolus`,
          secondary: bolus.deliveryType ?? "Delivered insulin",
          sourceId: bolus.sourceId,
        }),
      ),
      ...basal.map((delivery) =>
        preview({
          id: delivery.id,
          kind: "basal",
          timestamp: delivery.start,
          primary: `${formatTarvisFixedNumber(delivery.rateUnitsPerHour, 2)} U/hr basal`,
          secondary: `${formatWindowTimestamp(delivery.start, activity.start)}–${formatWindowTimestamp(delivery.end, activity.start)}`,
          sourceId: delivery.sourceId,
        }),
      ),
      ...pumpStates.map((state) =>
        preview({
          id: state.id,
          kind: "source-record",
          timestamp: state.start,
          primary:
            state.kind === "activity-mode"
              ? "Activity mode recorded"
              : "Automated pause recorded",
          secondary: `${formatWindowTimestamp(state.start, activity.start)}–${formatWindowTimestamp(state.end, activity.start)}`,
          sourceId: state.sourceId,
        }),
      ),
    ];
    evidence.push(
      evidenceReference(
        `tarvis-event-insulin:${activity.id}`,
        "Insulin and pump records",
        "Delivered insulin, basal intervals and pump-state records in the complete review window.",
        incidentRange,
        insulinPreviews,
        [
          ...boluses.map((bolus) => bolus.id),
          ...basal.map((delivery) => delivery.id),
          ...pumpStates.map((state) => state.id),
        ],
      ),
    );
  }
  if (iobPresentation.records.length) {
    evidence.push(
      evidenceReference(
        `tarvis-event-notification-iob:${activity.id}`,
        "Notification-reported IOB",
        "IOB values revalidated against the current supported-app parser and timestamped at the recorded notification capture time. Restored and legacy records with unknown origin are labelled separately. The values are not calculated, interpolated or returned with raw notification text.",
        incidentRange,
        iobPresentation.records.map((record) =>
          preview({
            id: record.id,
            kind: "source-record",
            timestamp: record.capturedAt,
            primary: `${formatIobUnits(record.iobUnits)} U IOB`,
            secondary:
              record.origin === "restored"
                ? `${record.sourceLabel} notification · restored · original capture time`
                : record.origin === "unknown"
                  ? `${record.sourceLabel} notification · legacy origin unknown · recorded capture time`
                  : `${record.sourceLabel} notification · this-phone capture time`,
            sourceId: record.sourceId,
          }),
        ),
        iobPresentation.records.map((record) => record.id),
      ),
    );
  }

  const glucoseStatuses = sourceStatusesFor(
    timeline.sources,
    ["glucose"],
    /glucose|cgm|libre|dexcom|nightscout|xdrip/i,
  );
  const contextStatuses = sourceStatusesFor(
    timeline.sources,
    ["carbohydrates", "health-context"],
    /health context|context|health connect|hevy/i,
  );
  const insulinStatuses = sourceStatusesFor(
    timeline.sources,
    ["basal-events", "bolus-events", "pump-state-events"],
    /insulin|pump|glooko/i,
  );

  const contextSentences: string[] = [];
  if (activity.strengthWorkout) {
    const exercises = activity.strengthWorkout.exercises;
    const setCount = exercises.reduce(
      (total, exercise) => total + exercise.sets.length,
      0,
    );
    contextSentences.push(
      `Hevy recorded ${formatTarvisNumber(exercises.length, { maximumFractionDigits: 0 })} exercise${exercises.length === 1 ? "" : "s"} and ${formatTarvisNumber(setCount, { maximumFractionDigits: 0 })} set${setCount === 1 ? "" : "s"}${
        exercises.length
          ? `, including ${exercises
              .slice(0, 3)
              .map(
                (exercise) =>
                  `${exercise.title} (${formatTarvisNumber(exercise.sets.length, { maximumFractionDigits: 0 })} set${exercise.sets.length === 1 ? "" : "s"})`,
              )
              .join(", ")}`
          : ""
      }.`,
    );
  }
  if (physiologyPresentation) {
    contextSentences.push(...physiologyPresentation.sentences);
  }
  if (meals.length) {
    contextSentences.push(
      `In the preceding four hours, ${meals
        .map(
          (meal) =>
            `${meal.title} (${mealNutritionSummary(meal, {
              includeItems: true,
            })}) was recorded at ${formatWindowTimestamp(meal.start, activity.start)}, ${distanceFromActivityStart(meal.start, activity)}`,
        )
        .join(" and ")}.`,
    );
  } else {
    contextSentences.push(noRecordsSentence("meal", contextStatuses));
  }
  if (ketoneContext.length) {
    contextSentences.push(
      `Manually logged ketone readings included ${ketoneContext
        .map((event) => rankedContextSentence(event, activity))
        .join(
          "; ",
        )}. These are saved historical observations, not proof of what caused the glucose pattern or of the current ketone level.`,
    );
  }
  if (otherReviewContext.length) {
    contextSentences.push(
      `Other recorded context, ordered by interval proximity to the activity and then evidence completeness, included ${otherReviewContext
        .map((event) => rankedContextSentence(event, activity))
        .join("; ")}. This ordering is not a ranking of likely causes.`,
    );
  }
  for (const category of REVIEW_CONTEXT_COVERAGE) {
    if (reviewContext.some(category.matches)) continue;
    contextSentences.push(
      noRecordsSentence(
        category.recordLabel,
        sourceStatusesFor(
          timeline.sources,
          ["health-context"],
          category.sourcePattern,
        ),
      ),
    );
  }
  if (boluses.length) {
    contextSentences.push(
      `${boluses
        .map(
          (bolus) =>
            `${formatTarvisFixedNumber(bolus.units, 1)} U of bolus insulin at ${formatWindowTimestamp(bolus.timestamp, activity.start)} (${timingRelativeToActivity(bolus.timestamp, activity)}), ${distanceFromActivityStart(bolus.timestamp, activity)}`,
        )
        .join(" and ")} was recorded in the review window.`,
    );
  }
  if (basal.length) {
    const shownBasal = closestBasalRecords(basal, activity);
    contextSentences.push(
      `Basal records closest to the activity included ${shownBasal
        .map(
          (delivery) =>
            `${formatTarvisFixedNumber(delivery.rateUnitsPerHour, 2)} U/hr from ${formatWindowTimestamp(delivery.start, activity.start)} to ${formatWindowTimestamp(delivery.end, activity.start)}`,
        )
        .join(
          "; ",
        )}${basal.length > shownBasal.length ? `; ${formatTarvisNumber(basal.length - shownBasal.length, { maximumFractionDigits: 0 })} additional interval${basal.length - shownBasal.length === 1 ? "" : "s"} remains in the evidence` : ""}.`,
    );
  }
  if (pumpStates.length) {
    contextSentences.push(
      `${pumpStates
        .slice(0, 4)
        .map((state) => {
          const label =
            state.kind === "activity-mode"
              ? "Activity mode"
              : "Automated pause";
          const durationMinutes = Math.max(
            0,
            (state.end - state.start) / MINUTE_MS,
          );
          return `${label} was recorded from ${formatWindowTimestamp(state.start, activity.start)} to ${formatWindowTimestamp(state.end, activity.start)} (${formatTarvisFixedNumber(durationMinutes, 0)} minutes)`;
        })
        .join(
          ". ",
        )}${pumpStates.length > 4 ? `. ${formatTarvisNumber(pumpStates.length - 4, { maximumFractionDigits: 0 })} additional pump-state interval${pumpStates.length - 4 === 1 ? "" : "s"} remains in the evidence` : ""}.`,
    );
  }
  if (!boluses.length && !basal.length && !pumpStates.length) {
    contextSentences.push(
      noRecordsSentence("insulin or pump-state", insulinStatuses),
    );
  }
  contextSentences.push(...iobPresentation.sentences);
  if (!glucose.length) {
    contextSentences.push(noRecordsSentence("glucose", glucoseStatuses));
  }

  const activityEndText = formatWindowTimestamp(end, activity.start);
  const eventLabel =
    eventKind === "low"
      ? "low"
      : eventKind === "high"
        ? "high"
        : eventKind === "drop"
          ? "drop"
          : "glucose pattern";
  const conclusion = glucoseDescription.eventObserved
    ? `These recorded timings overlap and are useful to review together, but they do not establish what caused the ${eventLabel}.`
    : eventKind === "neutral"
      ? "These records show timing and overlap only; they do not establish cause."
      : `The available records do not show the ${eventLabel} described in the question, so I cannot connect it to this activity without guessing.`;
  const answer = [
    `${activity.title} was recorded on ${formatShortDate(toDateKey(activity.start))} from ${formatTime(activity.start)} to ${activityEndText} (${formatTarvisFixedNumber(activity.durationMinutes, 0)} minutes).`,
    ...glucoseDescription.sentences,
    ...contextSentences,
    conclusion,
  ].join(" ");

  const limitations = [
    ...sourceCoverageLimitations(timeline.sources),
    ...(physiologyPresentation?.limitations ?? []),
    ...iobPresentation.limitations,
    "A route or destination cannot be inferred unless it appears in the recorded activity title or a note.",
  ];
  if (reviewContext.some((event) => event.kind === "medication")) {
    limitations.push(
      "Medication timing reflects recorded entries only; it does not establish adherence and must not be used to infer or recommend a dose or medication change.",
    );
  }
  if (coverage.coveragePercent < 70) {
    limitations.unshift(
      `Glucose covered ${formatTarvisFixedNumber(coverage.coveragePercent, 0)}% of the activity-through-two-hour window; the longest uncovered gap was ${formatTarvisFixedNumber(coverage.longestGapMinutes, 0)} minutes, so the pattern may be incomplete.`,
    );
  }

  const headline = glucoseDescription.eventObserved
    ? eventKind === "low"
      ? `Recorded low around ${activity.title}`
      : eventKind === "high"
        ? `Recorded high around ${activity.title}`
        : eventKind === "drop"
          ? `Recorded drop around ${activity.title}`
          : `Glucose around ${activity.title}`
    : `What was recorded around ${activity.title}`;

  return {
    outcome: "ready",
    event: {
      kind: eventKind,
      observed: glucoseDescription.eventObserved,
      activityContributionSupported:
        glucoseDescription.activityContributionSupported,
    },
    answer: {
      headline,
      answer,
      confidence:
        glucoseDescription.eventObserved && coverage.coveragePercent >= 70
          ? "moderate"
          : "limited",
      evidenceIds: evidence.map(({ id }) => id),
      limitations,
    },
    evidence,
  };
}

export async function loadRetrospectiveEventReview({
  question,
  searchRange,
  loadTimelineData,
  loadPhysiologyData,
  loadTimestampedIob,
}: {
  question: string;
  searchRange: TimeRange;
  loadTimelineData(range: TimeRange): Promise<TimelineData>;
  loadPhysiologyData?: RetrospectivePhysiologyLoader;
  loadTimestampedIob?: RetrospectiveIobLoader;
}): Promise<RetrospectiveEventReview> {
  const searchTimeline = await loadTimelineData(searchRange);
  const activities = selectRetrospectiveActivities(question, searchTimeline);
  if (activities.length !== 1) {
    return buildRetrospectiveEventReview({
      question,
      timeline: searchTimeline,
    });
  }

  const activity = activities[0]!;
  const incidentRange = rangeForRetrospectiveActivity(activity);
  const reviewDataRange = rangeForRetrospectiveReviewData(activity);
  const searchContainsReviewData =
    searchTimeline.range.start <= reviewDataRange.start &&
    searchTimeline.range.end >= reviewDataRange.end;
  const [timeline, physiology, iob] = await Promise.all([
    searchContainsReviewData
      ? Promise.resolve(searchTimeline)
      : loadTimelineData(reviewDataRange),
    loadPhysiologyData
      ? loadPhysiologyData({ activity, range: incidentRange }).catch(() =>
          unavailableRetrospectivePhysiology(activity, incidentRange),
        )
      : Promise.resolve(undefined),
    loadTimestampedIob
      ? loadTimestampedIob(incidentRange)
          .then((result): RetrospectiveIobContext => ({
            status: "loaded",
            records: result.records,
            truncated: result.truncated,
          }))
          .catch((): RetrospectiveIobContext => ({
            status: "unavailable",
            records: [],
            truncated: false,
          }))
      : Promise.resolve(undefined),
  ]);
  return buildRetrospectiveEventReview({
    question,
    timeline,
    selectedActivityId: activity.id,
    physiology,
    iob,
  });
}
