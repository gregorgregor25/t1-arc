/**
 * Record questions Tarv1s answers on the phone from stored records, with no
 * AI request. The parser is conservative: when it is not sure, it returns
 * `undefined` and the existing pipeline runs.
 */

export type RecordedChangeKind = "site" | "sensor" | "insulin";

export type DeviceChangeQuestion = {
  kind: "device-change";
  /** The changes asked about, in a fixed order. */
  changes: RecordedChangeKind[];
};

/** A local-calendar period named in a record question. */
export type RecordPeriod =
  | { kind: "today" }
  | { kind: "yesterday" }
  /** The last N local days, today included and marked "so far". */
  | { kind: "last-days"; days: number }
  /** This calendar week, Monday to now, local time. */
  | { kind: "this-week" }
  /** Last calendar week, Monday to Sunday, local time. */
  | { kind: "last-week" };

export type InsulinBreakdownQuestion = {
  /** Basal, SMB and other boluses, and carbs entered, for one or two periods. */
  kind: "insulin-breakdown";
  periods: RecordPeriod[];
};

export type CarbsPerDayQuestion = {
  /** Grams of carbs entered on each of the last N local days. */
  kind: "carbs-per-day";
  days: number;
};

export type RecordQuestion =
  | DeviceChangeQuestion
  | InsulinBreakdownQuestion
  | CarbsPerDayQuestion
  | {
      /** The latest insulin-on-board estimate AAPS or Nightscout reported. */
      kind: "insulin-on-board";
    };

/** Longest period these record lists answer; longer questions use the history pipeline. */
export const RECORD_PERIOD_MAX_DAYS = 31;

// A bare "set" counts only as a noun ("my set", "set change"), never the verb in "set a temp basal".
const SITE =
  /\b(?:sites?|pods?|cannulas?|infusion\s+sets?)\b|\b(?:my|the|pump|new|last)\s+sets?\b(?!\s+(?:a|an|the|my|new|temp|target|profile|basal|rate)\b)|\bchang(?:e|ed|ing)\s+(?:of\s+)?sets?\b(?!\s+(?:a|an|the|my|new|temp|target|profile|basal|rate)\b)|\bsets?\s+chang(?:e|es|ed)\b/i;
const SENSOR = /\b(?:sensors?|cgms?|libre|dexcom)\b/i;
const INSULIN =
  /\b(?:insulin\s+(?:cartridges?|reservoirs?|change)|cartridges?|reservoirs?|refill(?:ed)?\s+(?:the\s+|my\s+)?(?:pump|insulin)|changed?\s+(?:the\s+|my\s+)?insulin)\b/i;
const CHANGE =
  /\b(?:chang(?:e|ed|es|ing)|replac(?:e|ed|ing)|swap(?:ped)?|start(?:ed)?|new|refill(?:ed)?|put\s+(?:in|on))\b/i;
const WHEN =
  /\b(?:when|last|how\s+old|age|how\s+long\s+(?:ago|since)|how\s+many\s+(?:days|hours))\b/i;
// Questions about the future, about what to do, or asking to judge or change
// a dose or setting are not record questions.
const FORWARD =
  /\b(?:should|shall|ought|need\s+to|do\s+i\s+need|due|next|overdue|how\s+often|recommend\w*|remind|would|could|suggest\w*|advi[sc]e|best|ideal|optimal|better|fits?|suits?|cover|enough|lower(?:ing)?|rais(?:e|ing)|increas(?:e|ing)|decreas(?:e|ing)|reduc(?:e|ing)|adjust\w*|tweak\w*|so\s+(?:that\s+)?i\s+can|right\s+for\s+me|(?:units?|insulin)\s+to\s+(?:bolus|take|give|inject|use)|ratio|isf|sensitivity|correction\s+factor|tomorrow|tonight)\b/i;

const DEVICE_CHANGE_OTHER_SUBJECT =
  /\b(?:glucose|bg|blood\s+sugar|sugars?|lows?|highs?|hypos?|hypers?|readings?|average|mean|time\s+in\s+range|tir|temp(?:orary)?\s+(?:basals?|targets?)|basal\s+rates?|profile|bolus(?:es)?|smbs?|carbs?|iob|cob)\b/i;

const IOB = /\b(?:iob|insulin\s+on\s+board|active\s+insulin)\b/i;
// "Now" or a personal form; "What is IOB?" is a general question.
const IOB_CURRENT =
  /\b(?:my|do\s+i\s+have|have\s+i\s+got|i've\s+got|i\s+have|now|current(?:ly)?|right\s+now|at\s+the\s+moment|at\s+present)\b/i;
// A past time, a period or a summary belongs to the history pipeline.
const IOB_PAST_OR_PERIOD =
  /\b(?:was|were|had|ago|yesterday|today|tonight|overnight|night|morning|afternoon|evening|week|month|day|days|hours?|during|before|after|since|between|when|while|at\s+\d|average|mean|peak|highest|lowest|max(?:imum)?|min(?:imum)?|trend|chart|graph)\b/i;
const IOB_EXPLAIN = /\b(?:explain|mean|means|meaning|how\s+does|how\s+is|why|calculated?|work)\b/i;

const NUMBER_WORDS: Record<string, number> = {
  two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, twenty: 20, thirty: 30,
};
const LAST_DAYS =
  /\b(?:last|past|previous)\s+(\d{1,3}|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|twenty|thirty)\s+days?\b/i;
// "Past week" reads as the last 7 days; "last week" and "this week" are calendar weeks.
const PAST_WEEK = /\bpast\s+week\b/i;
const THIS_WEEK = /\bthis\s+week\b/i;
const LAST_CALENDAR_WEEK = /\b(?:last|previous)\s+week\b/i;
const TODAY = /\btoday\b|\bso\s+far\s+today\b/i;
const YESTERDAY = /\byesterday\b/i;
const MONTH_NAME =
  "jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?";
/**
 * Anything that names a different or narrower period than these record lists
 * answer: a specific date, weekday, part of a day, a clock time, a meal time,
 * hours, the day before yesterday, a weekend or a month. These are left to
 * the history pipeline so the local answer never covers a different period.
 */
const OTHER_PERIOD = new RegExp(
  [
    String.raw`\b\d{1,2}(?::|\.)\d{2}\b`,
    String.raw`\b\d{1,2}\s*(?:am|pm)\b`,
    String.raw`\b\d{1,2}(?:st|nd|rd|th)?\s+(?:of\s+)?(?:${MONTH_NAME})\b`,
    String.raw`\b(?:${MONTH_NAME})\s+\d{1,2}(?:st|nd|rd|th)?\b`,
    String.raw`\b\d{1,2}(?:st|nd|rd|th)\b`,
    String.raw`\b\d{1,4}[/-]\d{1,2}(?:[/-]\d{1,4})?\b`,
    String.raw`\b(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|weekend|fortnight|month|months)\b`,
    String.raw`\b(?:morning|afternoon|evening|night|overnight|tonight|tomorrow|lunch(?:time)?|breakfast|dinner|tea\s*time|supper|bedtime|noon|midday|midnight)\b`,
    String.raw`\b(?:hours?|hrs?|between|since|before\s+yesterday|day\s+before)\b`,
  ].join("|"),
  "i",
);

function lastDays(text: string): number | undefined {
  const match = LAST_DAYS.exec(text);
  if (match) {
    const raw = match[1]!.toLowerCase();
    return /^\d+$/.test(raw) ? Number(raw) : NUMBER_WORDS[raw];
  }
  return PAST_WEEK.test(text) ? 7 : undefined;
}

/** One or two periods; undefined when none, or when the question names something else. */
function recordPeriods(text: string): RecordPeriod[] | undefined {
  if (OTHER_PERIOD.test(text)) return undefined;
  const today = TODAY.test(text);
  const yesterday = YESTERDAY.test(text);
  const thisWeek = THIS_WEEK.test(text);
  const lastWeek = LAST_CALENDAR_WEEK.test(text);
  const days = lastDays(text);
  const named = [today || yesterday, thisWeek, lastWeek, days !== undefined].filter(Boolean).length;
  // Mixed periods ("today vs the last 7 days", "this week vs last week") are not answered here.
  if (named > 1) return undefined;
  if (days !== undefined) {
    if (days < 1 || days > RECORD_PERIOD_MAX_DAYS) return undefined;
    return [{ kind: "last-days", days }];
  }
  if (thisWeek) return [{ kind: "this-week" }];
  if (lastWeek) return [{ kind: "last-week" }];
  if (yesterday && today) return [{ kind: "yesterday" }, { kind: "today" }];
  if (yesterday) return [{ kind: "yesterday" }];
  if (today) return [{ kind: "today" }];
  return undefined;
}

// The parts of a breakdown question: SMBs, boluses the user entered, or a basal/bolus split.
const BREAKDOWN_PART =
  /\b(?:smbs?|super\s+micro[\s-]?bolus(?:es)?|automatic\s+(?:smbs?|bolus(?:es)?)|auto[\s-]?bolus(?:es)?|entered\s+by\s+me|i\s+entered|entered\s+(?:them\s+|it\s+)?myself|did\s+i\s+enter|i\s+gave\s+myself|split\s+(?:in)?to\s+basal\s+and\s+bolus(?:es)?|basal\s+(?:vs\.?|versus|and|or)\s+bolus(?:es)?|bolus(?:es)?\s+(?:vs\.?|versus|and)\s+basal)\b/i;
// The question asks for amounts or counts, not about glucose or an explanation.
const BREAKDOWN_AMOUNT =
  /\b(?:how\s+(?:many|much)|totals?|split|units?|count|compare|comparison|versus|vs\.?|break\s*down|breakdown)\b/i;
const GLUCOSE_OUTCOME =
  /\b(?:glucose|bg|blood\s+sugar|sugars?|lows?|highs?|hypos?|hypers?|time\s+in\s+range|tir|spike\w*|drop\w*|why|explain|mean|means|what\s+is|what\s+are|what's\s+an?)\b/i;

function parseInsulinBreakdown(text: string): InsulinBreakdownQuestion | undefined {
  if (!BREAKDOWN_PART.test(text) || !BREAKDOWN_AMOUNT.test(text) || GLUCOSE_OUTCOME.test(text)) return undefined;
  const periods = recordPeriods(text);
  return periods ? { kind: "insulin-breakdown", periods } : undefined;
}

const CARBS = /\b(?:carbs?|carbohydrates?)\b/i;
const PER_DAY =
  /\b(?:each\s+(?:of\s+the\s+)?(?:last|past)\s+\S+\s+days?|each\s+day|every\s+day|per\s+day|by\s+day|day\s+by\s+day|daily|a\s+day)\b/i;
const PERSONAL_RECORD =
  /\b(?:i|my|me|did|entered|logged|recorded|stored|ate|eaten|had)\b/i;

function parseCarbsPerDay(text: string): CarbsPerDayQuestion | undefined {
  if (!CARBS.test(text) || !PER_DAY.test(text) || !PERSONAL_RECORD.test(text)) return undefined;
  if (GLUCOSE_OUTCOME.test(text) || /\b(?:insulin|bolus(?:es)?|smbs?|basal)\b/i.test(text)) return undefined;
  // Only "the last N days" (or "the past week"); a calendar week or other period is not answered here.
  if (OTHER_PERIOD.test(text) || THIS_WEEK.test(text) || LAST_CALENDAR_WEEK.test(text)) return undefined;
  const days = lastDays(text);
  if (days === undefined || days < 1 || days > RECORD_PERIOD_MAX_DAYS) return undefined;
  if (TODAY.test(text) || YESTERDAY.test(text)) return undefined;
  return { kind: "carbs-per-day", days };
}

function parseIobQuestion(text: string): RecordQuestion | undefined {
  if (!IOB.test(text) || !IOB_CURRENT.test(text)) return undefined;
  if (IOB_PAST_OR_PERIOD.test(text) || IOB_EXPLAIN.test(text)) return undefined;
  return { kind: "insulin-on-board" };
}

export function parseRecordQuestion(question: string): RecordQuestion | undefined {
  const text = question.replace(/[‘’]/g, "'");
  if (FORWARD.test(text)) return undefined;
  const iob = parseIobQuestion(text);
  if (iob) return iob;
  const carbsPerDay = parseCarbsPerDay(text);
  if (carbsPerDay) return carbsPerDay;
  const breakdown = parseInsulinBreakdown(text);
  if (breakdown) return breakdown;
  return parseDeviceChange(text);
}

function deviceChanges(sentence: string): RecordedChangeKind[] {
  const changes: RecordedChangeKind[] = [];
  if (SITE.test(sentence) && !/\bsets?\s+(?:a|the|my)\s+(?:temp|target|profile)/i.test(sentence)) {
    changes.push("site");
  }
  if (SENSOR.test(sentence)) changes.push("sensor");
  if (INSULIN.test(sentence)) changes.push("insulin");
  return changes;
}

const CHANGE_ORDER: readonly RecordedChangeKind[] = ["site", "sensor", "insulin"];

function parseDeviceChange(text: string): DeviceChangeQuestion | undefined {
  // Each sentence is read on its own, so "When did I last change my sensor?
  // My readings look off" still answers the change it asks about.
  const sentences = text.split(/[.?!;\n]+/).map((sentence) => sentence.trim()).filter(Boolean);
  const found = new Set<RecordedChangeKind>();
  for (const sentence of sentences) {
    if (!CHANGE.test(sentence) || !WHEN.test(sentence)) continue;
    const changes = deviceChanges(sentence);
    if (!changes.length) continue;
    // A change used as an anchor for a glucose or therapy question ("my last
    // low after I changed my sensor") belongs to the history pipeline.
    if (DEVICE_CHANGE_OTHER_SUBJECT.test(sentence)) return undefined;
    for (const change of changes) found.add(change);
  }
  const changes = CHANGE_ORDER.filter((change) => found.has(change));
  return changes.length ? { kind: "device-change", changes } : undefined;
}
