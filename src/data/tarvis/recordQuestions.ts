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
  /\b(?:smbs?|super\s+micro[\s-]?bolus(?:es)?|automatic\s+(?:smbs?|bolus(?:es)?)|auto[\s-]?bolus(?:es)?|entered\s+by\s+me|i\s+entered|entered\s+(?:them\s+|it\s+)?myself|did\s+i\s+enter|i\s+gave\s+myself|split\s+(?:in)?to\s+basal\s+and\s+bolus(?:es)?|basal\s*(?:\/|vs\.?|versus|and|or|to)\s*bolus(?:es)?|bolus(?:es)?\s*(?:\/|vs\.?|versus|and)\s*basal)\b/i;
// The question asks for amounts or counts, not about glucose or an explanation.
const BREAKDOWN_AMOUNT =
  /\b(?:how\s+(?:many|much)|totals?|split|units?|count|compare|comparison|versus|vs\.?|break\s*down|breakdown|ratio)\b/i;
// "What is an SMB?" is education; "What is my basal to bolus ratio" is a record request.
const GLUCOSE_OUTCOME =
  /\b(?:glucose|bg|blood\s+sugar|sugars?|lows?|highs?|hypos?|hypers?|time\s+in\s+range|tir|spike\w*|drop\w*|why|explain|mean|means|what\s+is\s+(?!my\b)|what\s+are\s+(?!my\b)|what's\s+an?)\b/i;

/*
 * Allow-only grammar for the insulin and carb record cards.
 *
 * A prompt is answered locally only when every sentence is fully explained by
 * this record grammar: breakdown parts, amount words, a supported period and a
 * small fixed set of polite words. Any leftover content word ("do I", "want",
 * "go for", "a basal rate", "down", "cut", "more", "set basal 1.2", "units for
 * pizza", "3 days ago", "at 3") means the prompt is not a pure record request,
 * so it falls through to the normal pipeline, where the safety preflight and
 * the model route apply. Phrase blocklists kept leaking; this rule does not
 * depend on predicting every way of asking for a dose.
 */
const RECORD_POLITE_PHRASES = [
  String.raw`\b(?:please\s+)?(?:could|can|would|will)\s+you\s+(?:please\s+)?(?:show|tell|list)(?:\s+me)?\b`,
  String.raw`\b(?:please\s+)?(?:could|can|may)\s+i\s+(?:please\s+)?see\b`,
  String.raw`\bi\s+would\s+like(?:\s+to\s+see)?\b|\bi'd\s+like(?:\s+to\s+see)?\b`,
  String.raw`\b(?:show|tell|list)(?:\s+me)?\b|\blet\s+me\s+see\b`,
  String.raw`\bwhat(?:\s+is|'s|\s+was|\s+were|\s+are)\s+(?=my\b|the\b)`,
  String.raw`\b(?:please|thanks|thank\s+you|cheers|hi|hello|hey|ok(?:ay)?|tarv[1i]s)\b`,
];
/**
 * Supported periods only; anything else stays as leftover and is rejected.
 * "For" is allowed only directly in front of a supported period ("for
 * today", "for the last 7 days"). Anywhere else it can name what insulin is
 * for ("insulin for the carbs I entered", "insulin for today's carbs",
 * "carbs a day for me"), so it is left over and the prompt falls through to
 * the safety preflight.
 */
const RECORD_PERIOD_PHRASES = [
  // "yesterday to today so far", "today with yesterday": a two-day comparison.
  String.raw`\byesterday\s+(?:to|with|and|vs|versus)\s+(?:so\s+far\s+)?today(?:\s+so\s+far)?\b|\btoday(?:\s+so\s+far)?\s+(?:to|with|and|vs|versus)\s+yesterday\b`,
  String.raw`\b(?:(?:for|over|in|during)\s+)?(?:the\s+)?(?:last|past|previous)\s+(?:\d{1,3}|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|twenty|thirty)\s+days\b`,
  String.raw`\b(?:(?:for|over|in|during)\s+)?(?:the\s+)?(?:past|this|last|previous)\s+week\b(?!')`,
  String.raw`\b(?:the\s+)?(?:past|this|last|previous)\s+week(?:'s)?\b`,
  String.raw`\bfor\s+(?:so\s+far\s+)?today(?:\s+so\s+far)?\b(?!')|\bfor\s+yesterday\b(?!')`,
  String.raw`\b(?:so\s+far\s+)?today(?:'s)?(?:\s+so\s+far)?\b|\bso\s+far\b`,
  String.raw`\byesterday(?:'s)?\b`,
];
const RECORD_INSULIN_PHRASES = [
  String.raw`\bratio\s+of\s+(?:basal\s+to\s+bolus(?:es)?|bolus(?:es)?\s+to\s+basal|smbs?\s+to\s+(?:entered\s+|other\s+|manual\s+)?bolus(?:es)?)\b`,
  String.raw`\b(?:basal|bolus(?:es)?)\s*(?:\/|vs|versus|to|and)\s*(?:basal|bolus(?:es)?)(?:\s+(?:split|ratio|totals?|breakdown))?\b`,
  String.raw`\bsplit\s+(?:in)?to\b|\bsplit\s+between\b|\bbroken\s+down\b|\bbreak\s*down\b|\bbreakdown\b|\bsplit\b`,
  String.raw`\bsuper\s+micro[\s-]?bolus(?:es)?\b|\bauto[\s-]?bolus(?:es)?\b|\bautomatic(?:ally)?\b|\bsmbs?\b`,
  String.raw`\b(?:meal|manual|other)\s+bolus(?:es)?\b|\bbolus(?:es)?\b|\bbasal(?:\s+insulin)?\b|\binsulin\b`,
  String.raw`\b(?:did\s+)?(?:aaps|the\s+loop|my\s+loop|my\s+pump|the\s+pump)\s+(?:give|gave|deliver|delivered)(?:\s+me)?\b`,
  String.raw`\bentered\s+by\s+me\b|\b(?:did\s+)?i\s+(?:enter|entered)(?:\s+(?:them\s+|it\s+)?myself)?\b|\bentered(?:\s+(?:them\s+|it\s+)?myself)?\b|\bi\s+gave\s+myself\b|\bmanually\b`,
  String.raw`\b(?:was|were)\s+(?:delivered|given)\b|\bdelivered\b|\bgiven\b|\bgave\b`,
];
const RECORD_CARB_PHRASES = [
  String.raw`\b(?:grams?|g)\s+of\s+(?:carbs?|carbohydrates?)\b|\bcarb(?:ohydrate)?\s+entries\b|\bcarbs?\b|\bcarbohydrates?\b`,
  String.raw`\b(?:did\s+)?i\s+(?:eat|ate|eaten|enter|entered|log|logged|record|recorded|had)\b|\b(?:entered|logged|recorded|eaten|stored)\b`,
];
const RECORD_PER_DAY_PHRASES = [
  String.raw`\beach\s+of\s+the\b`,
  String.raw`\beach\s+day\b|\bevery\s+day\b|\bper\s+day\b|\bby\s+day\b|\bday\s+by\s+day\b|\bdaily\b|\ba\s+day\b`,
];
const RECORD_AMOUNT_PHRASES = [
  String.raw`\bhow\s+(?:many|much)\b|\b(?:the\s+)?(?:number|amount|count)\s+of\b|\btotals?\b|\bcount\b`,
  String.raw`\bin\s+(?:units?|u|grams?|g)\b|\bunits?\s+of\b|\bunits?\b|\bgrams?\b`,
  String.raw`\bcompared?\s+(?:with|to)\b|\bcompare\b|\bcomparison\b|\bversus\b|\bvs\b`,
];
/** Words that may be left over: articles, the user's pronouns and past-tense helpers. */
const RECORD_FUNCTION_WORDS = new Set([
  "i", "me", "my", "the", "a", "an", "of", "in", "on", "and", "or", "with", "over", "during",
  "across", "were", "was", "is", "are", "did", "have", "had", "has", "get", "got", "receive", "received",
  "there", "each", "all", "both", "aaps", "loop", "pump", "also",
]);
/**
 * Belt and braces for the grammar: a request to judge, plan or change
 * anything is never a record question, even if a phrase above matched it.
 */
const RECORD_DENY =
  /\b(?:dose|doses|dosing|inject\w*|take|taking|want\w*|need\w*|should|shall|must|ought|enough|safe|correct\w*|isf|sensitivity|factor|targets?|profile|settings?|rates?|more|less|fewer|extra|up|down|off|higher|lower\w*|rais\w*|increas\w*|decreas\w*|reduc\w*|chang\w*|adjust\w*|tweak\w*|cut|halve|double|set|aim|goal|plan\w*|next|now|tomorrow|tonight|cover\w*|advi[cs]e|recommend\w*|suggest\w*|better|best|ideal|right|normal|too|if|would(?!\s+(?:like|you)\b)|could(?!\s+(?:you|i)\b)|will(?!\s+you\b)|calculat\w*|work\s+out|fix|tune|go|do|does|am|left|remain\w*|due|short|missing)\b/i;

function compileGrammar(phrases: string[]) {
  return new RegExp(phrases.join("|"), "gi");
}
const BREAKDOWN_GRAMMAR = compileGrammar([
  ...RECORD_POLITE_PHRASES,
  ...RECORD_PERIOD_PHRASES,
  ...RECORD_INSULIN_PHRASES,
  ...RECORD_CARB_PHRASES,
  ...RECORD_AMOUNT_PHRASES,
]);
const CARBS_PER_DAY_GRAMMAR = compileGrammar([
  ...RECORD_POLITE_PHRASES,
  ...RECORD_PER_DAY_PHRASES,
  ...RECORD_PERIOD_PHRASES,
  ...RECORD_CARB_PHRASES,
  ...RECORD_AMOUNT_PHRASES,
]);

function recordSentences(text: string) {
  return text
    .toLowerCase()
    .replace(/\bvs\./g, "vs")
    .split(/[.?!;\n]+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

/** True only when every sentence is fully explained by the grammar, with no leftover words. */
function fullyExplainedBy(text: string, grammar: RegExp) {
  const sentences = recordSentences(text);
  if (!sentences.length) return false;
  return sentences.every((sentence) => {
    if (RECORD_DENY.test(sentence)) return false;
    const leftover = sentence.replace(grammar, " ").match(/[a-z0-9]+(?:'[a-z]+)?/g) ?? [];
    return leftover.every((word) => RECORD_FUNCTION_WORDS.has(word));
  });
}

/**
 * Insulin set against carbs or meals ("units of insulin against the carbs I
 * entered", "insulin vs the carbs", "grams of carbs for each unit") reads as
 * a ratio or a dose for food, not a record list.
 */
const INSULIN_AGAINST_CARBS =
  /\b(?:insulin|units?|bolus(?:es)?|basal|smbs?|doses?)\b[^.?!;\n]{0,40}?\b(?:vs|versus|against|per|for|to\s+cover|to\s+match)\s+(?:(?:the|my|each|every|a|an|one|1|today's|yesterday's|those|these)\s+)?(?:\w+\s+){0,2}?(?:carbs?|carbohydrates?|grams?|g|meals?|food)\b|\b(?:carbs?|carbohydrates?|grams?|g)\b[^.?!;\n]{0,40}?\b(?:vs|versus|against|per|for)\s+(?:(?:the|my|each|every|a|an|one|1)\s+)?(?:units?|insulin|bolus(?:es)?|doses?)\b/i;

function parseInsulinBreakdown(text: string): InsulinBreakdownQuestion | undefined {
  if (!BREAKDOWN_PART.test(text) || !BREAKDOWN_AMOUNT.test(text) || GLUCOSE_OUTCOME.test(text)) return undefined;
  if (INSULIN_AGAINST_CARBS.test(text)) return undefined;
  if (!fullyExplainedBy(text, BREAKDOWN_GRAMMAR)) return undefined;
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
  if (!fullyExplainedBy(text, CARBS_PER_DAY_GRAMMAR)) return undefined;
  const days = lastDays(text);
  if (days === undefined || days < 1 || days > RECORD_PERIOD_MAX_DAYS) return undefined;
  if (TODAY.test(text) || YESTERDAY.test(text)) return undefined;
  return { kind: "carbs-per-day", days };
}

// Anything in an insulin-on-board question that asks what to do with it.
const IOB_DENY =
  /\b(?:dose|doses|dosing|inject\w*|take|taking|give|bolus\w*|correct\w*|units?\s+(?:for|to)|want|need\w*|enough|safe|more|less|extra|carbs?|eat|basal|smbs?|targets?|profile|settings?)\b/i;

function parseIobQuestion(text: string): RecordQuestion | undefined {
  if (FORWARD.test(text) || IOB_DENY.test(text)) return undefined;
  if (!IOB.test(text) || !IOB_CURRENT.test(text)) return undefined;
  if (IOB_PAST_OR_PERIOD.test(text) || IOB_EXPLAIN.test(text)) return undefined;
  return { kind: "insulin-on-board" };
}

/** Longest question read here; the same as the Tarv1s composer limit. */
const RECORD_QUESTION_MAX_LENGTH = 1_500;

export function parseRecordQuestion(question: string): RecordQuestion | undefined {
  if (question.length > RECORD_QUESTION_MAX_LENGTH) return undefined;
  const text = question
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/…/g, "...");
  // Only plain ASCII text is answered here. An emoji, arrow, symbol or a
  // letter from another alphabet ("💉", "↑ basal", "сколько") may carry the
  // real request, and this grammar cannot read it, so the normal pipeline
  // and its safety checks decide instead.
  if (/[^\x20-\x7e\t\n\r]/.test(text)) return undefined;
  return parseNormalisedRecordQuestion(normaliseRecordWording(text));
}

/** Spelling and voice-typing variants of the same record words. */
function normaliseRecordWording(text: string) {
  return text
    .replace(/\bsmb's\b/gi, "SMBs")
    .replace(/\bs\s+m\s+b('?s)?\b/gi, (_match, plural: string | undefined) => (plural ? "SMBs" : "SMB"))
    .replace(/\bsplit\s+in\s+to\b/gi, "split into")
    .replace(/\bgrammes?\b/gi, (word: string) => (/s$/i.test(word) ? "grams" : "gram"))
    .replace(/\b(?:aps|a\s+a\s+p\s+s)\b/gi, "AAPS");
}

function parseNormalisedRecordQuestion(text: string): RecordQuestion | undefined {
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

// A sentence beside a device-change question that asks about insulin, food,
// settings or what to do is not answered by the device card.
const DEVICE_OTHER_SENTENCE_DENY =
  /\b(?:units?|bolus\w*|basal|dose\w*|dosing|inject\w*|insulin|smbs?|carbs?|ratio|isf|sensitivity|correct\w*|targets?|profile|settings?|take|give|treat\w*|should|shall|ought|need\w*|due|overdue|how\s+often|recommend\w*|advi[sc]e|suggest\w*|remind\w*)\b/i;
// Inside the device sentence itself, any dose or setting word.
const DEVICE_SENTENCE_DENY =
  /\b(?:units?|bolus\w*|basal|dose\w*|dosing|inject\w*|smbs?|carbs?|ratio|isf|correct\w*|targets?|profile|settings?|take|give)\b/i;

function parseDeviceChange(text: string): DeviceChangeQuestion | undefined {
  // Each sentence is read on its own, so "When did I last change my sensor?
  // My readings look off" or "...my site? Could it be failing?" still answers
  // the change it asks about. A sentence about doses, settings or what to do
  // sends the whole prompt to the normal pipeline instead.
  const sentences = text.split(/[.?!;\n]+/).map((sentence) => sentence.trim()).filter(Boolean);
  const found = new Set<RecordedChangeKind>();
  for (const sentence of sentences) {
    const changes = CHANGE.test(sentence) && WHEN.test(sentence) ? deviceChanges(sentence) : [];
    if (!changes.length) {
      if (DEVICE_OTHER_SENTENCE_DENY.test(sentence)) return undefined;
      continue;
    }
    if (FORWARD.test(sentence) || DEVICE_SENTENCE_DENY.test(sentence)) return undefined;
    // A change used as an anchor for a glucose or therapy question ("my last
    // low after I changed my sensor") belongs to the history pipeline.
    if (DEVICE_CHANGE_OTHER_SUBJECT.test(sentence)) return undefined;
    for (const change of changes) found.add(change);
  }
  const changes = CHANGE_ORDER.filter((change) => found.has(change));
  return changes.length ? { kind: "device-change", changes } : undefined;
}
