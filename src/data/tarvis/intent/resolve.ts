import { getRuntimeAnalysisTimeZone } from "@/domain/regionalProfileRuntime";
import { extractTarvisLiterals } from "./literals";
import { insideRecentWeekPhrase } from "@/data/tarvis/recentWeekPhrase";
import {
  detectTarvisTimeInRangeFocus,
  inferTarvisThresholdUnit,
  TARVIS_PERSONAL_RANGE_PROFILE_ID,
  TARVIS_RANGE_FOCUS_METRIC_PATTERNS,
  TARVIS_STANDARD_RANGE_PROFILE,
  TARVIS_TIGHT_RANGE_PROFILE,
  TARVIS_TIME_ABOVE_SOURCE_ID,
  TARVIS_TIME_BELOW_SOURCE_ID,
  tarvisConsensusThresholdIn,
  type TarvisTimeInRangeFocus,
} from "./rangeFocus";
import { validateTarvisIntentV1 } from "./schema";
import {
  IncompleteTarvisIntentResolution,
  ReadyTarvisIntentResolution,
  ResolveTarvisIntentOptions,
  TARVIS_INTENT_SCHEMA_VERSION,
  TarvisCapabilityOutcome,
  TarvisComparison,
  TarvisDomain,
  TarvisDurationLiteral,
  TarvisGlucoseTargetProfile,
  TarvisGlucoseThreshold,
  TarvisIntentDraftV1,
  TarvisIntentField,
  TarvisIntentHistoryEntry,
  TarvisIntentResolution,
  TarvisIntentV1,
  TarvisMetric,
  TarvisNumberLiteral,
  TarvisOperation,
  TarvisOvernightProfile,
  TarvisRecurringClockWindow,
  TarvisSourceSpan,
  TarvisTemporalScope,
} from "./types";

const DEFAULT_TARGET_PROFILE: TarvisGlucoseTargetProfile =
  TARVIS_STANDARD_RANGE_PROFILE;

const DEFAULT_OVERNIGHT_PROFILE: TarvisOvernightProfile = {
  id: "t1-arc-default-overnight",
  start: { hour: 0, minute: 0 },
  end: { hour: 7, minute: 0 },
};
const NAMED_OVERNIGHT_PATTERN = /\b(?:overnights?|last (?:night|overnight))\b/;
const OTHER_NAMED_DAYPART_PATTERN =
  /\b(?:mornings?|afternoons?|evenings?|daytime|nighttime|midday|midnight|noon|dawn|dusk|bedtime|waking hours?|breakfast|lunchtime|lunch|dinnertime|dinner|mealtimes?|working hours?|workday)\b/;
const NAMED_WEEKDAY_PATTERN =
  /\b(?:mondays?|tuesdays?|wednesdays?|thursdays?|fridays?|saturdays?|sundays?|weekdays?|weekends?|weeknights?|business days?)\b/;
const APPROXIMATE_OR_ONE_SIDED_CLOCK_PATTERN =
  /\b(?:(?:at|before|after|until|by|since)\s+|(?:around|about|approximately|approx\.?|roughly|near|circa|close\s+to)\s+(?:(?:between|from)\s+)?)(?:midnight|noon|(?:[01]?\d|2[0-4])(?::[0-5]\d)?(?:\s*(?:a\.?\s*m\.?|p\.?\s*m\.?))?|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty(?:[- ](?:one|two|three|four))?)\b|\b(?:[01]?\d|2[0-4])(?::[0-5]\d)?[- ]?ish\b/;
const UNREPRESENTED_EXCLUSION_PATTERN =
  /\b(?:exclude|excluding|except(?:\s+for)?|without|but\s+not|not\s+including|omit|omitting|ignore|ignoring|leave\s+out|leaving\s+out|filter(?:ing)?\s+out|drop|dropping|remove|removing|apart\s+from|other\s+than|save\s+for)\b/;
// A request not to infer causation does not exclude records from the period.
// Remove only these explicit reasoning caveats; any second, real exclusion
// must still fail closed instead of silently widening the calculation.
const NON_FILTER_CAUSAL_CAVEAT =
  /\bwithout\s+assuming\s+(?:(?:that\s+)?one\s+(?:caused?|causes?)\s+the\s+other|causation|a\s+causal\s+(?:link|relationship))\b/gi;

function hasUnrepresentedExclusion(question: string) {
  return UNREPRESENTED_EXCLUSION_PATTERN.test(
    question.replace(NON_FILTER_CAUSAL_CAVEAT, ""),
  );
}
const UNREPRESENTED_RECORD_FILTER_PATTERN =
  /\b(?:(?:only|just|solely)\s+(?:(?:use|using|include|including)\s+)?(?:the\s+)?(?:calibration|calibrated|uncalibrated|manual|meter|finger(?:stick|[- ]prick)|sensor|cgm|measured|estimated|imported|live|dexcom|libre|glooko|nightscout|pump|device|source)\b|(?:using|from)\s+(?:only\s+)?(?:my\s+)?(?:dexcom|libre|glooko|nightscout|pump|meter|finger(?:stick|[- ]prick)|sensor|cgm|device|source)\b)/;
const EVENT_RELATIVE_FILTER_PATTERN =
  /\b(?:(?:before|after|around|following|since|upon|during|from|on|at|between)\s+(?:(?:i|my|a|an|the)\s+){0,2}(?:wak(?:e|es|ing)|woke|getting\s+(?:up|out\s+of\s+bed)|bedtime|going\s+to\s+bed|sleep(?:ing)?|meals?|eating|fast(?:ing)?|breakfast|lunch|dinner|exercise|exercising|activity|active|workouts?|training|correction(?:\s+bolus)?|bolus|insulin\s+dose|medication|dose|commut(?:e|ing)|work|shifts?|stress|illness|drinking|alcohol|lows?|highs?|hypos?|hypers?|spikes?)|(?:while|when)\s+(?:(?:i(?:'m|\s+am)?|my)\s+)?(?:[a-z]+ing|asleep|awake|active)|within\s+(?:\w+[ -]?){0,4}(?:of|before|after)\s+(?:(?:a|an|the|my)\s+)?(?:wak(?:e|ing)|meals?|eating|breakfast|lunch|dinner|exercise|workouts?|bolus|dose)|(?:pre|post)[ -]?(?:meal|breakfast|lunch|dinner|exercise|workout|bolus))\b/;

function hasEventRelativeFilter(question: string) {
  // An episode can be a requested count or a condition on another metric.
  // Do not broaden "average during periods of low sugar" to a whole day.
  if (
    /\b(?:during|within|in|after|before)\s+(?:(?:my|the|those)\s+)?(?:periods?|episodes?|spells?|bouts?)\s+(?:of|with)\s+(?:low|high|hypoglyc(?:aemia|emia)|hyperglyc(?:aemia|emia))\b/.test(question)
  ) return true;
  for (const match of question.matchAll(
    new RegExp(EVENT_RELATIVE_FILTER_PATTERN.source, "g"),
  )) {
    // "Look at my meals" selects evidence, not a mealtime clock filter.
    // Examine every match so a later "after exercise" still constrains time.
    if (
      /^at\b/.test(match[0]) &&
      /\blook(?:ing)?\s+$/.test(question.slice(0, match.index))
    ) {
      continue;
    }
    return true;
  }
  return false;
}

const SUPPORTED_METRICS = new Set<TarvisMetric>([
  "glucose.current",
  "glucose.mean",
  "glucose.median",
  "glucose.minimum",
  "glucose.maximum",
  "glucose.standard_deviation",
  "glucose.coefficient_of_variation",
  "glucose.gmi",
  "glucose.low_episodes",
  "glucose.high_episodes",
  "glucose.low_readings",
  "glucose.high_readings",
  "glucose.time_in_range",
  "insulin.delivered_total",
  "insulin.basal_total",
  "insulin.bolus_total",
  "food.carbohydrate_total",
  "activity.duration",
  "sleep.duration",
  "data_quality.coverage",
  "data_quality.gaps",
]);

const TYPO_REPLACEMENTS: [RegExp, string][] = [
  [/\b(?:avarage|averge|averege)\b/g, "average"],
  [/\b(?:glocose|glucoes|glucoce)\b/g, "glucose"],
  [/\b(?:readngs|readins)\b/g, "readings"],
  [/\b(?:episoeds|episdoes|episods)\b/g, "episodes"],
  [/\b(?:hihgs|higs)\b/g, "highs"],
  [/\b(?:lwo|lwoes)\b/g, "lows"],
  [/\btim[ -]in[ -]range\b/g, "time in range"],
  // Speech-to-text forms of "time in range": "timing range", "time and
  // range", "time in rage" and the hyphenated "time-in-range". The spoken
  // forms are mapped only where they clearly name the metric ("my timing
  // range", "what's my time and range"), never in "what time and range were
  // my highs" or "my bolus timing range".
  [/\btime-in-range\b/g, "time in range"],
  [
    /(^|\b(?:my|your|the|what's|whats|what is|was|is)\s+)(?:timing[ -]range|time[ -](?:and|in)[ -]rage|time[ -]and[ -]range)\b(?!\s+(?:of|were|was|for|did)\b)/g,
    "$1time in range",
  ],
  [/\byday\b/g, "yesterday"],
];

interface MetricCandidate {
  metric: TarvisMetric;
  operation: TarvisOperation;
  span: TarvisSourceSpan;
}

interface ScopeResolution {
  scope?: TarvisIntentField<TarvisTemporalScope>;
  problem?:
    | "ambiguous_time_scope"
    | "unsupported_time_scope"
    | "ambiguous_clock_time"
    | "invalid_clock_window";
  message?: string;
}

function normalizeQuestion(question: string) {
  let normalized = question
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
  for (const [pattern, replacement] of TYPO_REPLACEMENTS) {
    normalized = normalized.replace(pattern, replacement);
  }
  return normalized;
}

function hasUnrepresentedRecordFilterNormalized(normalizedQuestion: string) {
  return hasUnrepresentedExclusion(normalizedQuestion) ||
    UNREPRESENTED_RECORD_FILTER_PATTERN.test(normalizedQuestion);
}

/** Shares the resolver's fail-closed record-filter check with request routing. */
export function hasTarvisUnrepresentedRecordFilter(question: string) {
  return hasUnrepresentedRecordFilterNormalized(normalizeQuestion(question));
}

function explicitField<T>(
  value: T,
  source: TarvisSourceSpan,
  note?: string,
): TarvisIntentField<T> {
  return {
    value,
    provenance: {
      kind: "explicit",
      sourceText: source.raw,
      sourceStart: source.start,
      sourceEnd: source.end,
      turnId: null,
      note: note ?? null,
    },
  };
}

function suppliedField<T>(
  value: T,
  source: TarvisSourceSpan,
  kind: "profile" | "default",
  note: string,
): TarvisIntentField<T> {
  return {
    value,
    provenance: {
      kind,
      sourceText: source.raw,
      sourceStart: source.start,
      sourceEnd: source.end,
      turnId: null,
      note,
    },
  };
}

function matchedSpan(
  originalQuestion: string,
  normalizedQuestion: string,
  match: RegExpExecArray,
): TarvisSourceSpan {
  const start = match.index;
  const length = match[0].length;
  return {
    raw:
      originalQuestion.slice(start, start + length) ||
      normalizedQuestion.slice(start, start + length),
    start,
    end: start + length,
  };
}

function firstMatch(
  expression: RegExp,
  normalizedQuestion: string,
): RegExpExecArray | null {
  expression.lastIndex = 0;
  return expression.exec(normalizedQuestion);
}

function patternOutsideSpans(
  question: string,
  expression: RegExp,
  spans: readonly TarvisSourceSpan[],
) {
  let outside = question.toLocaleLowerCase("en-GB");
  for (const span of [...spans].sort(
    (left, right) => right.start - left.start,
  )) {
    outside = `${outside.slice(0, span.start)}${" ".repeat(span.end - span.start)}${outside.slice(span.end)}`;
  }
  expression.lastIndex = 0;
  return expression.test(outside);
}

interface ProductOvernightResolution {
  count?: number;
  countSource?: TarvisSourceSpan;
  window?: TarvisIntentField<TarvisRecurringClockWindow>;
  note?: string;
  problem?: string;
  problemCode?: "ambiguous_time_scope" | "invalid_clock_window";
}

function formatClockTime(time: { hour: number; minute: number }) {
  return `${String(time.hour).padStart(2, "0")}:${String(time.minute).padStart(2, "0")}`;
}

function isValidClockTime(
  time: { hour: number; minute: number } | null | undefined,
) {
  return (
    time !== null &&
    time !== undefined &&
    Number.isInteger(time.hour) &&
    time.hour >= 0 &&
    time.hour <= 23 &&
    Number.isInteger(time.minute) &&
    time.minute >= 0 &&
    time.minute <= 59
  );
}

function recentNightCounts(
  question: string,
  numbers: readonly TarvisNumberLiteral[],
) {
  const matches: { count: number; source: TarvisSourceSpan }[] = [];
  for (const number of numbers) {
    const contextStart = Math.max(0, number.start - 32);
    const before = question.slice(contextStart, number.start);
    const prefix = /\b(?:last|past)\s+(?:the\s+)?$/i.exec(before);
    const suffix = /^\s*(?:nights?|overnights?)\b/i.exec(
      question.slice(number.end),
    );
    if (!prefix || !suffix) continue;
    const start = contextStart + prefix.index;
    const end = number.end + suffix[0].length;
    matches.push({
      count: number.value,
      source: {
        raw: question.slice(start, end),
        start,
        end,
      },
    });
  }
  return matches;
}

function productOvernightResolution(
  question: string,
  normalizedQuestion: string,
  numbers: readonly TarvisNumberLiteral[],
  profile: TarvisOvernightProfile,
  timezone: string,
  profileWasSupplied: boolean,
): ProductOvernightResolution | undefined {
  const counts = recentNightCounts(question, numbers);
  const count = counts[0];
  const namedMatch = firstMatch(NAMED_OVERNIGHT_PATTERN, normalizedQuestion);
  const namedSource = namedMatch
    ? matchedSpan(question, normalizedQuestion, namedMatch)
    : count?.source;
  if (!namedSource) return undefined;
  if (counts.length > 1) {
    return {
      problem:
        "You asked for more than one number of nights. Please give one, for example 'the last 7 nights'.",
      problemCode: "ambiguous_time_scope",
    };
  }
  const lastNightMatch = firstMatch(
    /\blast (?:night|overnight)\b/,
    normalizedQuestion,
  );
  const lastNightSource = lastNightMatch
    ? matchedSpan(question, normalizedQuestion, lastNightMatch)
    : undefined;
  const lastNight = lastNightSource !== undefined;
  const requestedCount = count?.count ?? (lastNight ? 1 : undefined);
  const countSource = count?.source ?? lastNightSource;
  if (
    typeof profile.id !== "string" ||
    !profile.id.trim() ||
    !isValidClockTime(profile.start) ||
    !isValidClockTime(profile.end) ||
    (profile.start.hour === profile.end.hour &&
      profile.start.minute === profile.end.minute)
  ) {
    return {
      count: requestedCount,
      countSource,
      problem:
        "Your overnight hours need two different times. Please give the hours you mean, for example 'between 23:00 and 07:00'.",
      problemCode: "invalid_clock_window",
    };
  }
  const startMinute = profile.start.hour * 60 + profile.start.minute;
  const endMinute = profile.end.hour * 60 + profile.end.minute;
  const note = `Overnight profile ${profile.id} defines overnight as ${formatClockTime(profile.start)}–${formatClockTime(profile.end)} in ${timezone}.`;
  return {
    count: requestedCount,
    countSource,
    note,
    window: suppliedField(
      {
        start: { ...profile.start },
        end: { ...profile.end },
        crossesMidnight: endMinute < startMinute,
        occurrenceAnchor: "start_date",
      },
      namedSource,
      profileWasSupplied ? "profile" : "default",
      note,
    ),
  };
}

function pushCandidate(
  candidates: MetricCandidate[],
  candidate: MetricCandidate | null,
) {
  if (!candidate) return;
  if (!candidates.some((existing) => existing.metric === candidate.metric)) {
    candidates.push(candidate);
  }
}

function candidateFromPattern(
  originalQuestion: string,
  normalizedQuestion: string,
  metric: TarvisMetric,
  operation: TarvisOperation,
  expression: RegExp,
): MetricCandidate | null {
  const match = firstMatch(expression, normalizedQuestion);
  if (!match) return null;
  return {
    metric,
    operation,
    span: matchedSpan(originalQuestion, normalizedQuestion, match),
  };
}

function isCorrectionExcluded(
  normalizedQuestion: string,
  candidate: MetricCandidate,
) {
  const before = normalizedQuestion.slice(
    Math.max(0, candidate.span.start - 24),
    candidate.span.start,
  );
  const after = normalizedQuestion.slice(
    candidate.span.end,
    candidate.span.end + 36,
  );
  return (
    /(?:\bnot\b|\binstead of\b|\brather than\b)\s*(?:the\s*)?$/.test(before) &&
    /^(?:\s+(?:but|i mean|use|show)|\s*[,;]\s*(?:but|i mean|use|show|lows?|hypos?|dips?|crashes?|highs?|hypers?|spikes?))/.test(
      after,
    )
  );
}

function hasAmbiguousMetricNegation(
  normalizedQuestion: string,
  candidates: MetricCandidate[],
) {
  return candidates.some((candidate) => {
    const before = normalizedQuestion.slice(
      Math.max(0, candidate.span.start - 18),
      candidate.span.start,
    );
    return (
      /\b(?:not|without|except|exclude|excluding)\s*(?:the\s*)?$/.test(
        before,
      ) && !isCorrectionExcluded(normalizedQuestion, candidate)
    );
  });
}

function extractMetricCandidates(
  originalQuestion: string,
  normalizedQuestion: string,
): MetricCandidate[] {
  const candidates: MetricCandidate[] = [];
  const glucoseObject =
    "(?:glucose|blood[- ]?sugar|sugars?|bg|cgm|sensor|readings?|levels?|numbers?)";
  const meanModifier =
    "(?:(?:recorded|recent|daily|weekly|last|past|previous|overnight|night|nighttime|morning|afternoon|evening)\\s+)*";
  const trailingMeanModifier =
    "(?:(?:recorded|recent|daily|weekly|overnight|night|nighttime|morning|afternoon|evening)\\s+)*";
  const meanPattern = new RegExp(
    `\\b(?:(?:average|avg|mean)(?:\\s+(?:of|for))?(?:\\s+(?:all\\s+)?(?:my|the))?\\s+${meanModifier}${glucoseObject}|${glucoseObject}[\\s,]+(?:(?:were|was|are|is|have\\s+been)[\\s,]+)?${trailingMeanModifier}(?:(?:on\\s+)?average|averaged|mean))\\b`,
  );
  pushCandidate(
    candidates,
    candidateFromPattern(
      originalQuestion,
      normalizedQuestion,
      "glucose.mean",
      "aggregate",
      meanPattern,
    ),
  );
  // Natural chat often leaves the glucose object implicit when the time
  // phrase makes the personal metric clear ("average overnight", "my
  // average today"). Keep this narrow so "average insulin" is never recast
  // as glucose.
  if (
    !/\b(?:insulin|basal|bolus|carbs?|carbohydrates?|sleep|activity|exercise)\b/.test(
      normalizedQuestion,
    )
  ) {
    pushCandidate(
      candidates,
      candidateFromPattern(
        originalQuestion,
        normalizedQuestion,
        "glucose.mean",
        "aggregate",
        /\b(?:my\s+)?(?:average|avg|(?<!i )mean)\b(?=[\s\S]{0,100}\b(?:today|yesterday|overnight|nights?|days?|weeks?|months?|hours?|between|from|midnight)\b)/,
      ),
    );
  }
  pushCandidate(
    candidates,
    candidateFromPattern(
      originalQuestion,
      normalizedQuestion,
      "glucose.mean",
      "aggregate",
      new RegExp(`\\bon average\\b[\\s\\S]{0,120}\\b${glucoseObject}\\b`),
    ),
  );
  // A final shared object applies to every preceding statistic in requests
  // such as "mean, median and CV glucose". Retain each explicit cue.
  pushCandidate(
    candidates,
    candidateFromPattern(
      originalQuestion,
      normalizedQuestion,
      "glucose.mean",
      "aggregate",
      new RegExp(
        `\\b(?:average|avg|mean)\\b(?=[\\s\\S]{0,120}\\b${glucoseObject}\\b)`,
      ),
    ),
  );

  pushCandidate(
    candidates,
    candidateFromPattern(
      originalQuestion,
      normalizedQuestion,
      "glucose.time_in_range",
      "range_distribution",
      /\b(?:time[- ]in[- ]range|tir|percentage\s+(?:of\s+time\s+)?(?:was\s+)?in\s+(?:my\s+)?(?:target\s+)?range|percent\s+(?:of\s+time\s+)?(?:was\s+)?in\s+(?:my\s+)?(?:target\s+)?range|(?:what\s+)?(?:percentage|percent)\s+(?:of\s+(?:my\s+)?(?:glucose\s+)?readings?\s+)?(?:(?:was|were|am|is)\s+(?:i\s+)?)?between)\b/,
    ),
  );

  for (const expression of TARVIS_RANGE_FOCUS_METRIC_PATTERNS) {
    pushCandidate(
      candidates,
      candidateFromPattern(
        originalQuestion,
        normalizedQuestion,
        "glucose.time_in_range",
        "range_distribution",
        expression,
      ),
    );
  }

  const lowReadings = candidateFromPattern(
    originalQuestion,
    normalizedQuestion,
    "glucose.low_readings",
    "count_readings",
    /\b(?:(?:how many|number of|count(?: of)?)\s+(?:(?:glucose|cgm|sensor)\s+)?readings?\s+(?:were\s+)?(?:low|below|under)|(?:how many|number of|count(?: of)?)\s+(?:(?:low(?:[- ]glucose)?|below[- ]threshold|under[- ]threshold)\s+)(?:(?:glucose|cgm|sensor)\s+)?readings?|(?:how many|number of|count(?: of)?)\s+(?:low\s+(?:and|or)\s+high|high\s+(?:and|or)\s+low)\s+(?:glucose\s+)?readings?|(?:and|or)\s+(?:low(?:[- ]glucose)?\s+)(?:(?:glucose|cgm|sensor)\s+)?readings?|low[- ]reading count)\b/,
  );
  const highReadings = candidateFromPattern(
    originalQuestion,
    normalizedQuestion,
    "glucose.high_readings",
    "count_readings",
    /\b(?:(?:how many|number of|count(?: of)?)\s+(?:(?:glucose|cgm|sensor)\s+)?readings?\s+(?:were\s+)?(?:high|above|over)|(?:how many|number of|count(?: of)?)\s+(?:(?:high(?:[- ]glucose)?|above[- ]threshold|over[- ]threshold)\s+)(?:(?:glucose|cgm|sensor)\s+)?readings?|(?:how many|number of|count(?: of)?)\s+(?:low\s+(?:and|or)\s+high|high\s+(?:and|or)\s+low)\s+(?:glucose\s+)?readings?|(?:and|or)\s+(?:high(?:[- ]glucose)?\s+)(?:(?:glucose|cgm|sensor)\s+)?readings?|high[- ]reading count)\b/,
  );
  pushCandidate(candidates, lowReadings);
  pushCandidate(candidates, highReadings);

  if (!lowReadings) {
    pushCandidate(
      candidates,
      candidateFromPattern(
        originalQuestion,
        normalizedQuestion,
        "glucose.low_episodes",
        "count_episodes",
        /\b(?:(?:how many|number of|count(?: of)?|frequency of)\s+(?:sustained\s+)?(?:hypos?|lows?|dips?|crashes?)|(?:low(?:[- ](?:blood[- ])?(?:glucose|sugar))?|hypoglyc(?:aemia|emia|aemic|emic)|hypo)\s+(?:events?|episodes?|periods?|spells?|bouts?)|(?:events?|episodes?|periods?|spells?|bouts?)\s+(?:of|with)\s+(?:low(?:[- ](?:blood[- ])?(?:glucose|sugar))?|hypoglyc(?:aemia|emia|aemic|emic)|hypos?)|(?:lows|hypos|dips|crashes)\s+(?:have|did|during|over|in)\b|(?:lows|hypos|dips|crashes)\b(?=\s*(?:[,;]|\band\b|\bor\b|\bnot\b)))\b/,
      ),
    );
  }
  if (!highReadings) {
    pushCandidate(
      candidates,
      candidateFromPattern(
        originalQuestion,
        normalizedQuestion,
        "glucose.high_episodes",
        "count_episodes",
        /\b(?:(?:how many|number of|count(?: of)?|frequency of)\s+(?:sustained\s+)?(?:hypers?|highs?|spikes?)|(?:high(?:[- ](?:blood[- ])?(?:glucose|sugar))?|hyperglyc(?:aemia|emia|aemic|emic)|hyper)\s+(?:events?|episodes?|periods?|spells?|bouts?)|(?:events?|episodes?|periods?|spells?|bouts?)\s+(?:of|with)\s+(?:high(?:[- ](?:blood[- ])?(?:glucose|sugar))?|hyperglyc(?:aemia|emia|aemic|emic)|hypers?)|(?:highs|hypers|spikes)\s+(?:have|did|during|over|in)\b|(?:highs|hypers|spikes)\b(?=\s*(?:[,;]|\band\b|\bor\b|\bnot\b)))\b/,
      ),
    );
  }
  if (
    !lowReadings &&
    !highReadings &&
    /\b(?:lows?|hypos?)\s+(?:and|or)\s+(?:highs?|hypers?|spikes?)\b|\b(?:highs?|hypers?|spikes?)\s+(?:and|or)\s+(?:lows?|hypos?)\b/.test(
      normalizedQuestion,
    )
  ) {
    pushCandidate(
      candidates,
      candidateFromPattern(
        originalQuestion,
        normalizedQuestion,
        "glucose.low_episodes",
        "count_episodes",
        /\b(?:lows?|hypos?)\b/,
      ),
    );
    pushCandidate(
      candidates,
      candidateFromPattern(
        originalQuestion,
        normalizedQuestion,
        "glucose.high_episodes",
        "count_episodes",
        /\b(?:highs?|hypers?|spikes?)\b/,
      ),
    );
  }

  const unsupportedPatterns: [TarvisMetric, TarvisOperation, RegExp][] = [
    [
      "glucose.current",
      "current",
      /\b(?:(?:current|latest|right now)\s+(?:glucose|reading|blood sugar|sugar|bg)|(?:glucose|reading|blood sugar|sugar|bg)\s+(?:now|right now)|what(?:'s| is)\s+(?:my\s+)?(?:glucose|reading|blood sugar|sugar|bg)\s*(?:now|right now)?|am i\s+(?:going|trending|moving)\s+(?:up|down)|(?:am i|is my (?:glucose|sugar|bg))\s+(?:rising|falling|steady))\b/,
    ],
    [
      "glucose.median",
      "aggregate",
      new RegExp(
        `\\bmedian\\b(?=[\\s\\S]{0,120}\\b${glucoseObject}\\b)|\\b${glucoseObject}\\b[\\s\\S]{0,60}\\bmedian\\b`,
      ),
    ],
    [
      "glucose.minimum",
      "aggregate",
      new RegExp(
        `\\b(?:minimum|lowest)\\b(?=[\\s\\S]{0,120}\\b${glucoseObject}\\b)|\\b${glucoseObject}\\b[\\s\\S]{0,60}\\b(?:minimum|lowest)\\b`,
      ),
    ],
    [
      "glucose.maximum",
      "aggregate",
      new RegExp(
        `\\b(?:maximum|highest)\\b(?=[\\s\\S]{0,120}\\b${glucoseObject}\\b)|\\b${glucoseObject}\\b[\\s\\S]{0,60}\\b(?:maximum|highest)\\b`,
      ),
    ],
    [
      "glucose.standard_deviation",
      "aggregate",
      /\b(?:standard deviation|sd)\b/,
    ],
    [
      "glucose.coefficient_of_variation",
      "aggregate",
      /\b(?:coefficient of variation|glucose variability|variability|how variable|cv)\b/,
    ],
    [
      "glucose.gmi",
      "aggregate",
      /\b(?:(?:estimated\s+)?gmi|glucose management indicator)\b/,
    ],
    [
      "insulin.delivered_total",
      "aggregate",
      /\b(?:(?:total|how much)\s+(?:delivered\s+)?insulin|how much insulin\s+(?:did i\s+)?(?:use|have|take)|insulin\s+(?:did i\s+)?(?:use|have|take))\b/,
    ],
    [
      "insulin.basal_total",
      "aggregate",
      /\b(?:(?:total|how much)\s+basal(?: insulin)?|basal(?: insulin)?\s+total)\b/,
    ],
    [
      "insulin.bolus_total",
      "aggregate",
      /\b(?:(?:total|how much)\s+bolus(?: insulin)?|bolus(?: insulin)?\s+total)\b/,
    ],
    [
      "food.carbohydrate_total",
      "aggregate",
      /\b(?:(?:total|how many|how much)\s+(?:carbs?|carbohydrates?)|(?:carbs?|carbohydrates?)\s+(?:total|did i (?:eat|have|log|record)))\b/,
    ],
    [
      "activity.duration",
      "aggregate",
      /\b(?:(?:exercise|activity|workout)\s+(?:time|duration|minutes?)|how (?:long|much time)\s+(?:did i\s+)?(?:exercise|work ?out|train)|how many minutes\s+(?:did i\s+)?(?:exercise|work ?out|train))\b/,
    ],
    [
      "sleep.duration",
      "aggregate",
      /\b(?:(?:sleep|asleep)\s+(?:time|duration|hours?)|how (?:long|many hours|much time)\s+(?:did i\s+)?sleep|how much sleep did i\s+(?:record|log|get|have))\b/,
    ],
    [
      "data_quality.coverage",
      "inspect_data_quality",
      /\b(?:sensor|cgm|glucose)?\s*coverage\b/,
    ],
    [
      "data_quality.gaps",
      "inspect_data_quality",
      /\b(?:(?:data|sensor|cgm)?\s*(?:gaps?|missing data)|any\s+(?:data\s+|sensor\s+|cgm\s+)?gaps?)\b/,
    ],
  ];
  for (const [metric, operation, expression] of unsupportedPatterns) {
    pushCandidate(
      candidates,
      candidateFromPattern(
        originalQuestion,
        normalizedQuestion,
        metric,
        operation,
        expression,
      ),
    );
  }

  const specificInsulinCandidates = candidates.filter(
    ({ metric }) =>
      metric === "insulin.basal_total" || metric === "insulin.bolus_total",
  );
  return candidates
    .filter((candidate) => {
      if (isCorrectionExcluded(normalizedQuestion, candidate)) return false;
      if (candidate.metric !== "insulin.delivered_total") return true;
      // "How much bolus insulin did I take?" contains the generic phrase
      // "insulin did I take" inside the more specific bolus request. It is
      // one metric, not a compound total-insulin + bolus question. Preserve
      // genuinely separate compound requests by removing only overlapping
      // generic matches.
      return !specificInsulinCandidates.some(
        (specific) =>
          candidate.span.start < specific.span.end &&
          specific.span.start < candidate.span.end,
      );
    })
    .sort((left, right) => left.span.start - right.span.start);
}

function unconsumedCompoundMetricCue(
  normalizedQuestion: string,
  candidates: readonly MetricCandidate[],
) {
  if (!candidates.some(({ metric }) => metric.startsWith("glucose."))) {
    return null;
  }
  const requested = new Set(candidates.map(({ metric }) => metric));
  const compoundCues: [TarvisMetric, RegExp][] = [
    [
      "glucose.mean",
      /\b(?:average|avg|mean)\b\s*(?=,|\band\b|\bor\b)|(?:,|\band\b|\bor\b)\s*(?:average|avg|mean)\b/,
    ],
    [
      "glucose.median",
      /\bmedian\b\s*(?=,|\band\b|\bor\b)|(?:,|\band\b|\bor\b)\s*median\b/,
    ],
    [
      "glucose.minimum",
      /\b(?:minimum|lowest)\b\s*(?=,|\band\b|\bor\b)|(?:,|\band\b|\bor\b)\s*(?:minimum|lowest)\b/,
    ],
    [
      "glucose.maximum",
      /\b(?:maximum|highest)\b\s*(?=,|\band\b|\bor\b)|(?:,|\band\b|\bor\b)\s*(?:maximum|highest)\b/,
    ],
    [
      "glucose.standard_deviation",
      /\b(?:standard deviation|sd)\b\s*(?=,|\band\b|\bor\b)|(?:,|\band\b|\bor\b)\s*(?:standard deviation|sd)\b/,
    ],
    [
      "glucose.coefficient_of_variation",
      /\b(?:coefficient of variation|variability|cv)\b\s*(?=,|\band\b|\bor\b)|(?:,|\band\b|\bor\b)\s*(?:coefficient of variation|variability|cv)\b/,
    ],
    [
      "glucose.gmi",
      /\b(?:gmi|glucose management indicator)\b\s*(?=,|\band\b|\bor\b)|(?:,|\band\b|\bor\b)\s*(?:gmi|glucose management indicator)\b/,
    ],
  ];
  return (
    compoundCues.find(
      ([metric, cue]) => cue.test(normalizedQuestion) && !requested.has(metric),
    )?.[0] ?? null
  );
}

function inferDomains(
  normalizedQuestion: string,
  candidates: MetricCandidate[],
): TarvisDomain[] {
  const domains = new Set<TarvisDomain>();
  const metricDomains = new Set(
    candidates.map((candidate) => candidate.metric.split(".")[0]),
  );
  const unrepresentedFilter =
    metricDomains.size > 0 &&
    (hasEventRelativeFilter(normalizedQuestion) ||
      hasUnrepresentedRecordFilterNormalized(normalizedQuestion));
  const canInferMentionedDomain = (domain: TarvisDomain) =>
    !unrepresentedFilter || metricDomains.has(domain);
  const isExplicitDataQualityRequest =
    candidates.length > 0 &&
    candidates.every((candidate) =>
      candidate.metric.startsWith("data_quality."),
    );
  if (
    candidates.some((candidate) => candidate.metric.startsWith("glucose.")) ||
    (!isExplicitDataQualityRequest &&
      /\b(?:glucose|blood sugar|bg|cgm|sensor readings?|glucose readings?)\b/.test(
        normalizedQuestion,
      ))
  ) {
    domains.add("glucose");
  }
  if (
    candidates.some((candidate) => candidate.metric.startsWith("insulin.")) ||
    (canInferMentionedDomain("insulin") &&
      /\b(?:insulin|basal|bolus|pump)\b/.test(normalizedQuestion))
  ) {
    domains.add("insulin");
  }
  if (
    candidates.some((candidate) => candidate.metric.startsWith("food.")) ||
    (canInferMentionedDomain("food") &&
      /\b(?:food|meal|carbs?|carbohydrates?)\b/.test(normalizedQuestion))
  ) {
    domains.add("food");
  }
  if (
    candidates.some((candidate) => candidate.metric.startsWith("activity.")) ||
    (canInferMentionedDomain("activity") &&
      /\b(?:exercise|activity|workout|steps?)\b/.test(normalizedQuestion))
  ) {
    domains.add("activity");
  }
  if (
    candidates.some((candidate) => candidate.metric.startsWith("sleep.")) ||
    (canInferMentionedDomain("sleep") &&
      /\b(?:sleep|asleep)\b/.test(normalizedQuestion))
  ) {
    domains.add("sleep");
  }
  if (
    candidates.some((candidate) => candidate.metric.startsWith("data_quality."))
  ) {
    domains.add("data_quality");
  }
  return [...domains];
}

function spanForText(question: string, normalized: string, text: string) {
  const start = normalized.indexOf(text);
  return {
    raw: start >= 0 ? question.slice(start, start + text.length) : text,
    start: Math.max(0, start),
    end: Math.max(0, start) + text.length,
  };
}

function durationContext(
  normalizedQuestion: string,
  duration: TarvisDurationLiteral,
) {
  return normalizedQuestion.slice(
    Math.max(0, duration.start - 30),
    duration.start,
  );
}

function isScopeDuration(
  normalizedQuestion: string,
  duration: TarvisDurationLiteral,
) {
  if (duration.recentLocalWeek) return true;
  const before = durationContext(normalizedQuestion, duration);
  return /(?:\b(?:last|past|previous|during|for|over|in)\s+(?:the\s+)?|\bwithin\s+(?:the\s+)?)$/.test(
    before,
  );
}

function scopeFromDuration(
  normalizedQuestion: string,
  duration: TarvisDurationLiteral,
  hasClockWindow: boolean,
): ScopeResolution {
  if (!Number.isInteger(duration.value) || duration.value <= 0) {
    return {
      problem: "ambiguous_time_scope",
      message:
        "Please give the number of days as a whole number, for example 'the last 3 days'.",
    };
  }
  if (duration.unit === "month") {
    return {
      problem: "unsupported_time_scope",
      message:
        "I can't use a number of months yet, because months have different lengths. Please give dates instead, for example 'from 1 March to 30 April'.",
    };
  }
  if (duration.recentLocalWeek) {
    return {
      scope: explicitField(
        {
          kind: "recent_local_days",
          count: duration.value,
          include: hasClockWindow
            ? "most_recent_completed_windows"
            : "through_now",
        },
        duration,
        "The past week means the last 7 local days, including today so far.",
      ),
    };
  }
  const before = durationContext(normalizedQuestion, duration);
  const completedDays = /\bcompleted\b/i.test(duration.raw) || /\bcompleted\s+$/.test(before);
  if (completedDays && duration.unit === "week") {
    return {
      problem: "unsupported_time_scope",
      message:
        "I can't count whole calendar weeks yet. Please give dates instead, for example 'from 1 March to 14 March'.",
    };
  }
  const isRolling =
    duration.unit === "minute" ||
    duration.unit === "hour" ||
    (!completedDays && /\bpast\s+(?:the\s+)?$/.test(before));
  if (isRolling) {
    return {
      scope: explicitField(
        {
          kind: "rolling",
          amount: duration.value,
          unit: duration.unit,
          anchor: "now",
        },
        duration,
      ),
    };
  }
  const count = duration.unit === "week" ? duration.value * 7 : duration.value;
  return {
    scope: explicitField(
      {
        kind: "recent_local_days",
        count,
        include: hasClockWindow
          ? "most_recent_completed_windows"
          : completedDays
            ? "completed_days"
            : "through_now",
      },
      duration,
      duration.unit === "week"
        ? "Normalized to local calendar days."
        : undefined,
    ),
  };
}

function temporalScopesEqual(
  left: TarvisTemporalScope | undefined,
  right: TarvisTemporalScope | undefined,
) {
  return (
    left !== undefined &&
    right !== undefined &&
    JSON.stringify(left) === JSON.stringify(right)
  );
}

function resolveTemporalScope(
  question: string,
  normalizedQuestion: string,
  literals: ReturnType<typeof extractTarvisLiterals>,
  productOvernight?: ProductOvernightResolution,
): ScopeResolution {
  if (literals.clockWindows.length > 1) {
    return {
      problem: "ambiguous_clock_time",
      message:
        "You gave more than one time window. I can look at one at a time, for example 'between 06:00 and 07:30'.",
    };
  }
  const clockWindow = literals.clockWindows[0];
  if (clockWindow?.ambiguity) {
    return {
      problem:
        clockWindow.startTime.minuteOfDay !== null &&
        clockWindow.endTime.minuteOfDay !== null &&
        clockWindow.startTime.minuteOfDay === clockWindow.endTime.minuteOfDay
          ? "invalid_clock_window"
          : "ambiguous_clock_time",
      message: clockWindow.ambiguity,
    };
  }
  if (
    productOvernight?.problem &&
    !(
      productOvernight.problemCode === "invalid_clock_window" &&
      clockWindow?.window
    )
  ) {
    return {
      problem: productOvernight.problemCode ?? "invalid_clock_window",
      message: productOvernight.problem,
    };
  }
  if (
    !clockWindow &&
    !(
      metricThresholdLiterals(literals).some(
        (threshold) => threshold.operator === "gte",
      ) &&
      metricThresholdLiterals(literals).some(
        (threshold) => threshold.operator === "lte",
      )
    ) &&
    /\b(?:between|from)\s+(?:midnight|noon|\d{1,2}(?::\d{1,2}|\s*(?:a\.?\s*m\.?|p\.?\s*m\.?)|\s+(?:and|to|until|till)))\b/.test(
      normalizedQuestion,
    )
  ) {
    return {
      problem: "ambiguous_clock_time",
      message:
        "I couldn't tell which times you mean. Please give a start and an end, for example 'between 06:00 and 07:30'.",
    };
  }
  if (
    literals.times.some(
      (time) =>
        !literals.clockWindows.some(
          (window) => time.start >= window.start && time.end <= window.end,
        ),
    )
  ) {
    return {
      problem: "ambiguous_clock_time",
      message:
        "I can look at a time window if you give me a start and an end, for example 'between 06:00 and 07:30 today'.",
    };
  }

  if (
    patternOutsideSpans(
      question,
      APPROXIMATE_OR_ONE_SIDED_CLOCK_PATTERN,
      literals.clockWindows,
    )
  ) {
    return {
      problem: "ambiguous_clock_time",
      message:
        "I need exact times rather than an approximate or open-ended time. Please give a start and an end, for example 'between 06:00 and 07:30'.",
    };
  }

  if (
    NAMED_WEEKDAY_PATTERN.test(normalizedQuestion) &&
    !literals.dates.some((date) => date.kind === "absolute")
  ) {
    return {
      problem: "unsupported_time_scope",
      message:
        "I can't pick out particular weekdays or weekends yet. I can answer for a whole period, for example 'this week' or 'the last 14 days'.",
    };
  }
  if (hasEventRelativeFilter(normalizedQuestion)) {
    return {
      problem: "ambiguous_time_scope",
      message:
        "I can't measure from an event such as a meal or a workout yet. Please give clock times instead, for example 'between 12:00 and 14:00 today'.",
    };
  }
  if (hasUnrepresentedRecordFilterNormalized(normalizedQuestion)) {
    return {
      problem: "ambiguous_time_scope",
      message:
        "I can't separate or leave out particular records in this calculation yet. I can answer for all records in a period. Which period do you want?",
    };
  }
  if (
    OTHER_NAMED_DAYPART_PATTERN.test(normalizedQuestion) &&
    !clockWindow?.window
  ) {
    return {
      problem: "ambiguous_time_scope",
      message:
        "Please tell me the hours you mean, for example 'between 18:00 and 22:00 yesterday'. I won't guess them or use the whole day.",
    };
  }
  if (
    /\bnight\b/.test(normalizedQuestion) &&
    !productOvernight &&
    !clockWindow?.window
  ) {
    return {
      problem: "ambiguous_time_scope",
      message:
        "Please tell me the hours you mean by night, for example 'between 23:00 and 07:00', or ask about 'last night'.",
    };
  }
  const namedPeriods: [RegExp, TarvisTemporalScope & { kind: "calendar_period" }][] = [
    [/\btoday\b/, { kind: "calendar_period", period: "today" }],
    [/\byesterday\b/, { kind: "calendar_period", period: "yesterday" }],
    [/\bthis week\b/, { kind: "calendar_period", period: "this_week" }],
    [/\blast week\b/, { kind: "calendar_period", period: "last_week" }],
    [/\bthis month\b/, { kind: "calendar_period", period: "this_month" }],
    [/\blast month\b/, { kind: "calendar_period", period: "last_month" }],
  ];
  const matchedNamed = namedPeriods
    .map(([pattern, value]) => ({
      match: firstMatch(pattern, normalizedQuestion),
      value,
    }))
    .filter(
      (
        entry,
      ): entry is {
        match: RegExpExecArray;
        value: TarvisTemporalScope & { kind: "calendar_period" };
      } => entry.match !== null,
    )
    // "in the last week" is the recent 7-day window, not the previous
    // calendar week; that phrase is resolved as a duration instead.
    .filter(
      (entry) =>
        !insideRecentWeekPhrase(
          normalizedQuestion,
          entry.match.index,
          entry.match.index + entry.match[0].length,
        ),
    );
  // Literal offsets refer to the original question. Metric typo correction can
  // change normalized-string length, so duration context uses an offset-stable
  // lower-case copy rather than the corrected text.
  const offsetStableQuestion = question.toLocaleLowerCase("en-GB");
  let durations = literals.durations.filter((duration) =>
    isScopeDuration(offsetStableQuestion, duration),
  );
  let absoluteDates = literals.dates.filter((date) => date.kind === "absolute");
  if (
    absoluteDates.length > 1 &&
    absoluteDates.every((date) => date.date === absoluteDates[0]?.date)
  ) {
    absoluteDates = [absoluteDates[0]!];
  }
  if (matchedNamed.length > 1) {
    return {
      problem: "ambiguous_time_scope",
      message:
        "You mentioned more than one period. I can answer for one period, or compare a period with the one just before it. Which do you want?",
    };
  }
  const comparisonToPrevious =
    literals.comparisons.length > 0 &&
    /\bprevious\b|\bbefore\s+that\b/.test(normalizedQuestion);
  if (durations.length > 1 && !comparisonToPrevious) {
    const resolvedDurations = durations.map(
      (duration) =>
        scopeFromDuration(
          offsetStableQuestion,
          duration,
          Boolean(clockWindow?.window || productOvernight?.window),
        ).scope?.value,
    );
    if (
      resolvedDurations[0] &&
      resolvedDurations.every((scope) =>
        temporalScopesEqual(scope, resolvedDurations[0]),
      )
    ) {
      durations = [durations[0]!];
    } else {
      return {
        problem: "ambiguous_time_scope",
        message:
          "You mentioned more than one period. I can answer for one period, or compare a period with the one just before it. Which do you want?",
      };
    }
  }

  if (durations.length > 1 && comparisonToPrevious) {
    const currentDurations = durations.filter((duration) =>
      !/\bprevious\s+(?:the\s+)?$/.test(durationContext(offsetStableQuestion, duration)),
    );
    const first = currentDurations[0];
    const firstScope = first && scopeFromDuration(
      offsetStableQuestion, first, Boolean(clockWindow?.window || productOvernight?.window),
    ).scope?.value;
    if (
      !first || !firstScope ||
      !durations.every((duration) => duration.value === first.value && duration.unit === first.unit) ||
      !currentDurations.every((duration) => temporalScopesEqual(
        scopeFromDuration(offsetStableQuestion, duration, Boolean(clockWindow?.window || productOvernight?.window)).scope?.value,
        firstScope,
      ))
    ) {
      return {
        problem: "ambiguous_time_scope",
        message:
          "You mentioned more than one period. I can answer for one period, or compare a period with the one just before it. Which do you want?",
      };
    }
    // Validate every repeated period before a named-date equivalence can
    // return early. "Past 7 days" must not absorb another metric's local
    // "last 7 days", nor can a third unequal duration be silently omitted.
    durations = [first];
  }

  const named = matchedNamed[0];
  const categoryCount =
    (named ? 1 : 0) +
    (absoluteDates.length > 0 ? 1 : 0) +
    (productOvernight?.count !== undefined ? 1 : 0) +
    (durations.length > 0 ? 1 : 0);
  if (categoryCount > 1) {
    const durationScope = durations[0]
      ? scopeFromDuration(
          offsetStableQuestion,
          durations[0],
          Boolean(clockWindow?.window || productOvernight?.window),
        ).scope?.value
      : undefined;
    const relativeDate = named
      ? literals.dates.find(
          (date) =>
            date.kind === "relative" &&
            date.raw.toLowerCase() === named.value.period,
        )
      : undefined;
    const equivalentNamedDate =
      categoryCount === 2 &&
      named !== undefined &&
      absoluteDates.length === 1 &&
      durations.length === 0 &&
      productOvernight?.count === undefined &&
      relativeDate?.date === absoluteDates[0]?.date;
    const equivalentTodayDuration =
      categoryCount === 2 &&
      named?.value.period === "today" &&
      absoluteDates.length === 0 &&
      productOvernight?.count === undefined &&
      durationScope?.kind === "recent_local_days" &&
      durationScope.count === 1 &&
      durationScope.include === "through_now";
    const equivalentNightDuration =
      categoryCount === 2 &&
      named === undefined &&
      absoluteDates.length === 0 &&
      productOvernight?.count !== undefined &&
      durationScope?.kind === "recent_local_days" &&
      durationScope.count === productOvernight.count &&
      durationScope.include === "most_recent_completed_windows";
    if (
      !equivalentNamedDate &&
      !equivalentTodayDuration &&
      !equivalentNightDuration
    ) {
      return {
        problem: "ambiguous_time_scope",
        message:
          "You mentioned more than one period. I can answer for one period, or compare a period with the one just before it. Which do you want?",
      };
    }
  }
  if (named) {
    return {
      scope: explicitField(
        named.value,
        matchedSpan(question, normalizedQuestion, named.match),
      ),
    };
  }

  if (absoluteDates.length >= 2) {
    const rangeCue =
      /\b(?:from|between)\b[\s\S]+\b(?:to|and|through|until)\b/.test(
        normalizedQuestion,
      );
    if (!rangeCue || absoluteDates.length > 2) {
      return {
        problem: "ambiguous_time_scope",
        message:
          "I couldn't tell which dates you mean. Please give one date, or a start and an end, for example 'from 1 March to 14 March'.",
      };
    }
    const first = absoluteDates[0]!;
    const second = absoluteDates[1]!;
    if (first.date > second.date) {
      return {
        problem: "ambiguous_time_scope",
        message:
          "The end date is before the start date. Please give the earlier date first, for example 'from 1 March to 14 March'.",
      };
    }
    return {
      scope: explicitField(
        {
          kind: "calendar_date_range",
          startDate: first.date,
          endDate: second.date,
          inclusiveEndDate: true,
        },
        {
          raw: question.slice(first.start, second.end),
          start: first.start,
          end: second.end,
        },
      ),
    };
  }
  if (absoluteDates.length === 1) {
    const date = absoluteDates[0]!;
    return {
      scope: explicitField(
        { kind: "calendar_date", date: date.date },
        date,
        date.yearWasInferred
          ? "The year was inferred from the current local year."
          : undefined,
      ),
    };
  }

  if (productOvernight?.count !== undefined) {
    if (
      !Number.isInteger(productOvernight.count) ||
      productOvernight.count <= 0
    ) {
      return {
        problem: "ambiguous_time_scope",
        message:
          "Please give the number of nights as a whole number, for example 'the last 7 nights'.",
      };
    }
    if (productOvernight.count > 366) {
      return {
        problem: "unsupported_time_scope",
        message: "I can look at up to 366 nights at a time. Please ask for fewer nights.",
      };
    }
    return {
      scope: explicitField(
        {
          kind: "recent_local_days",
          count: productOvernight.count,
          include: "most_recent_completed_windows",
        },
        productOvernight.countSource!,
        clockWindow?.window
          ? "The completed occurrences use the explicitly stated clock bounds."
          : productOvernight.note,
      ),
    };
  }

  if (durations[0]) {
    return scopeFromDuration(
      offsetStableQuestion,
      durations[0],
      Boolean(clockWindow?.window || productOvernight?.window),
    );
  }
  return {};
}

function isExplicitFollowUp(normalizedQuestion: string) {
  return (
    /^(?:(?:and\s+)?(?:what|how)\s+about\b|(?:same|do the same)\b|(?:can you\s+)?compare\s+(?:that|it)\b)/.test(
      normalizedQuestion,
    ) ||
    /^(?:(?:but|and)\s+)?(?:when|what\s+(?:date|day|time))\s+(?:was|were|did)\s+(?:that|this|it|the)\s+(?:reading|value|result|maximum|minimum|highest|lowest|high|low)\b/.test(
      normalizedQuestion,
    )
  );
}

function latestHistory(
  history: readonly TarvisIntentHistoryEntry[] | undefined,
) {
  return history && history.length > 0
    ? history[history.length - 1]
    : undefined;
}

function inheritedField<T>(
  field: TarvisIntentField<T>,
  history: TarvisIntentHistoryEntry,
): TarvisIntentField<T> {
  return {
    value: field.value,
    provenance: {
      kind: "conversation",
      turnId: history.turnId,
      sourceText: history.question,
      sourceStart: null,
      sourceEnd: null,
      note: "Inherited only because the new question used an explicit follow-up form.",
    },
  };
}

function comparisonField(
  question: string,
  normalizedQuestion: string,
  literals: ReturnType<typeof extractTarvisLiterals>,
  candidates: readonly MetricCandidate[],
  scope: TarvisTemporalScope | undefined,
  domains: readonly TarvisDomain[],
): TarvisIntentField<TarvisComparison> | undefined {
  if (literals.comparisons.length === 0) return undefined;
  const source = literals.comparisons[0]!;
  if (/\bprevious\b|\bbefore\s+that\b/.test(normalizedQuestion)) {
    return explicitField({ kind: "previous_equal_period" }, source);
  }
  // With one stated period and several health-data subjects, "compare them"
  // refers to those subjects, not to an unstated second time period.
  if (
    scope &&
    domains.length > 1 &&
    literals.comparisons.length === 1 &&
    source.kind === "compare" &&
    /\bcompare\s+(?:them|these|the two)\b/.test(normalizedQuestion) &&
    literals.dates.length <= 1 &&
    literals.durations.length <= 1
  ) return undefined;
  // In "compare basal totals and glucose patterns over the last seven days",
  // the two subjects share the stated period. A comparison of periods still
  // has a second comparison marker or names a previous period and fails closed.
  if (scope && domains.length > 1 && literals.comparisons.length === 1 &&
      source.kind === "compare" && !/\b(?:previous|prior|before that)\b/.test(normalizedQuestion)) {
    const firstPeriodStart = Math.min(
      ...literals.dates.map(({ start }) => start),
      ...literals.durations.map(({ start }) => start),
      normalizedQuestion.length,
    );
    // Literal offsets come from the original text. Typo correction may
    // change normalized length, so slice an offset-stable lower-case copy.
    const subjects = question.toLocaleLowerCase("en-GB").slice(source.end, firstPeriodStart);
    const cues: Record<TarvisDomain, RegExp> = {
      glucose: /\b(?:glucose|blood sugar|bg|cgm)\b/,
      insulin: /\b(?:insulin|basal|bolus|pump)\b/,
      food: /\b(?:food|meal|carbs?|carbohydrates?)\b/,
      activity: /\b(?:activity|exercise|workout|steps?)\b/,
      sleep: /\b(?:sleep|asleep)\b/,
      health: /\b(?:health|weight|blood pressure|heart rate)\b/,
      data_quality: /\b(?:coverage|gaps?|missing data)\b/,
    };
    const mentions = domains.map((domain) => {
      const match = cues[domain].exec(subjects);
      return match && { start: match.index, end: match.index + match[0].length };
    });
    if (mentions.every(Boolean)) {
      const ordered = mentions.filter((mention): mention is { start: number; end: number } => Boolean(mention))
        .sort((left, right) => left.start - right.start);
      if (ordered.length === 2 &&
          /\b(?:and|with|to|against)\b/.test(subjects.slice(ordered[0]!.end, ordered[1]!.start))) {
        return undefined;
      }
    }
  }
  // "Carbs yesterday versus bolus insulin" compares two quantities within
  // one scope, not yesterday with an unstated second period. Every comparison
  // marker must connect explicit metrics; a trailing "versus 2 weeks ago"
  // must still fail closed, even if an earlier "compare" connected metrics.
  if (
    scope &&
    candidates.length > 1 &&
    literals.comparisons.every((comparison) => {
      if (comparison.kind !== "compare" && comparison.kind !== "versus") {
        return false;
      }
      const before = candidates.filter(({ span }) => span.end <= comparison.start);
      const after = candidates.filter(({ span }) => span.start >= comparison.end);
      if (before.length > 0 && after.length > 0) return true;
      if (comparison.kind !== "compare" || before.length > 0 || after.length < 2) {
        return false;
      }
      return /\b(?:and|with|to|against)\b/.test(
        question.slice(after[0]!.span.end, after[1]!.span.start).toLowerCase(),
      );
    })
  ) return undefined;
  if (
    /\b(?:today|yesterday|this week|last week|this month|last month)\b[\s\S]*\b(?:versus|vs\.?|compar)/.test(
      normalizedQuestion,
    ) ||
    literals.dates.length >= 2
  ) {
    return explicitField({ kind: "explicit_periods" }, source);
  }
  return explicitField(
    { kind: "explicit_periods" },
    spanForText(question, normalizedQuestion, source.raw.toLowerCase()),
  );
}

interface TargetThresholdContext {
  focus?: TarvisTimeInRangeFocus | null;
  personalProfile?: TarvisGlucoseTargetProfile;
}

function profileRangeThresholds(
  profile: TarvisGlucoseTargetProfile,
  note: string,
): TarvisIntentField<TarvisGlucoseThreshold>[] {
  const provenance = {
    kind: "profile" as const,
    sourceText: profile.id,
    sourceStart: null,
    sourceEnd: null,
    turnId: null,
    note,
  };
  return [
    {
      value: {
        operator: "gte",
        value: profile.lowBelow,
        unit: profile.unit,
        role: "range_lower",
      },
      provenance,
    },
    {
      value: {
        operator: "lte",
        value: profile.highAbove,
        unit: profile.unit,
        role: "range_upper",
      },
      provenance,
    },
  ];
}

/**
 * Thresholds for a named range ("tight", "my range") or a one-sided time share
 * ("time below 3"). A one-sided share is calculated as a range whose other
 * bound is the standard range limit, so the requested share is the part below
 * the lower bound or above the upper bound. Returns null when the question
 * cannot be represented exactly; the ordinary rules then apply.
 */
function focusedRangeThresholds(
  focus: TarvisTimeInRangeFocus,
  explicitThresholds: ReturnType<typeof metricThresholdLiterals>,
  personalProfile: TarvisGlucoseTargetProfile | undefined,
): TarvisIntentField<TarvisGlucoseThreshold>[] | null {
  if (focus.kind === "tight") {
    if (explicitThresholds.length > 0) return null;
    return profileRangeThresholds(
      TARVIS_TIGHT_RANGE_PROFILE,
      "Tight range 3.9–7.8 mmol/L (70–140 mg/dL) named in the question.",
    );
  }
  if (focus.kind === "personal") {
    if (explicitThresholds.length > 0 || !personalProfile) return null;
    return profileRangeThresholds(
      { ...personalProfile, id: TARVIS_PERSONAL_RANGE_PROFILE_ID },
      "Your range: the In range band from glucose display settings.",
    );
  }
  if (explicitThresholds.length > 1) return null;
  const literal = explicitThresholds[0];
  const below = focus.kind === "below";
  let bound: TarvisIntentField<TarvisGlucoseThreshold>;
  let unit: TarvisGlucoseThreshold["unit"];
  if (literal) {
    const directionMatches = below
      ? literal.operator === "lt" || literal.operator === "lte"
      : literal.operator === "gt" || literal.operator === "gte";
    if (!directionMatches) return null;
    unit = inferTarvisThresholdUnit(literal.value, literal.unit);
    const operator: TarvisGlucoseThreshold["operator"] = below
      ? literal.operator === "lt"
        ? "gte"
        : "gt"
      : literal.operator === "gt"
        ? "lte"
        : "lt";
    bound = explicitField(
      {
        operator,
        value: literal.value,
        unit,
        role: below ? "range_lower" : "range_upper",
      },
      literal,
      literal.unit
        ? undefined
        : `Unit inferred as ${unit} from the size of the number.`,
    );
  } else if (focus.presetMmolL !== null) {
    unit = "mmol/L";
    bound = {
      value: {
        operator: below ? "gte" : "lte",
        value: focus.presetMmolL,
        unit,
        role: below ? "range_lower" : "range_upper",
      },
      provenance: {
        kind: "profile",
        sourceText: TARVIS_STANDARD_RANGE_PROFILE.id,
        sourceStart: null,
        sourceEnd: null,
        turnId: null,
        note: "Consensus threshold named in the question.",
      },
    };
  } else {
    return null;
  }
  const complement: TarvisIntentField<TarvisGlucoseThreshold> = {
    value: {
      operator: below ? "lte" : "gte",
      value: tarvisConsensusThresholdIn(
        below
          ? TARVIS_STANDARD_RANGE_PROFILE.highAbove
          : TARVIS_STANDARD_RANGE_PROFILE.lowBelow,
        unit,
      ),
      unit,
      role: below ? "range_upper" : "range_lower",
    },
    provenance: {
      kind: "derived",
      sourceText: below
        ? TARVIS_TIME_BELOW_SOURCE_ID
        : TARVIS_TIME_ABOVE_SOURCE_ID,
      sourceStart: null,
      sourceEnd: null,
      turnId: null,
      note: below
        ? "Upper bound from the standard range; the answer reports the share below the lower bound."
        : "Lower bound from the standard range; the answer reports the share above the upper bound.",
    },
  };
  const [lower, upper] = below ? [bound, complement] : [complement, bound];
  return lower.value.value < upper.value.value ? [lower, upper] : null;
}

function targetThresholds(
  metrics: TarvisIntentField<TarvisMetric>[],
  literals: ReturnType<typeof extractTarvisLiterals>,
  profile: TarvisGlucoseTargetProfile,
  context: TargetThresholdContext = {},
): TarvisIntentField<TarvisGlucoseThreshold>[] {
  const metricValues = new Set(metrics.map((metric) => metric.value));
  const explicitThresholds = metricThresholdLiterals(literals);
  if (
    context.focus &&
    metrics.length === 1 &&
    metrics[0]!.value === "glucose.time_in_range"
  ) {
    const focused = focusedRangeThresholds(
      context.focus,
      explicitThresholds,
      context.personalProfile,
    );
    if (focused) return focused;
  }
  if (explicitThresholds.length > 0 && metrics.length === 1) {
    const metric = metrics[0]!.value;
    return explicitThresholds.map((literal) => {
      const role: TarvisGlucoseThreshold["role"] =
        metric === "glucose.low_episodes" || metric === "glucose.low_readings"
          ? "low"
          : metric === "glucose.high_episodes" ||
              metric === "glucose.high_readings"
            ? "high"
            : literal.operator === "lt" || literal.operator === "lte"
              ? "range_upper"
              : "range_lower";
      return explicitField(
        {
          operator: literal.operator,
          value: literal.value,
          unit: literal.unit ?? profile.unit,
          role,
        },
        literal,
        literal.unit
          ? undefined
          : `Unit inherited from target profile ${profile.id}.`,
      );
    });
  }

  const provenance = {
    kind:
      profile === DEFAULT_TARGET_PROFILE
        ? ("default" as const)
        : ("profile" as const),
    sourceText: profile.id,
    sourceStart: null,
    sourceEnd: null,
    turnId: null,
    note: `Threshold supplied by target profile ${profile.id}.`,
  };
  const thresholds: TarvisIntentField<TarvisGlucoseThreshold>[] = [];
  if (
    metricValues.has("glucose.low_episodes") ||
    metricValues.has("glucose.low_readings") ||
    metricValues.has("glucose.time_in_range")
  ) {
    thresholds.push({
      value: {
        operator: metricValues.has("glucose.time_in_range") ? "gte" : "lt",
        value: profile.lowBelow,
        unit: profile.unit,
        role: metricValues.has("glucose.time_in_range") ? "range_lower" : "low",
      },
      provenance,
    });
  }
  if (
    metricValues.has("glucose.high_episodes") ||
    metricValues.has("glucose.high_readings") ||
    metricValues.has("glucose.time_in_range")
  ) {
    thresholds.push({
      value: {
        operator: metricValues.has("glucose.time_in_range") ? "lte" : "gt",
        value: profile.highAbove,
        unit: profile.unit,
        role: metricValues.has("glucose.time_in_range")
          ? "range_upper"
          : "high",
      },
      provenance,
    });
  }
  return thresholds;
}

function metricThresholdLiterals(
  literals: ReturnType<typeof extractTarvisLiterals>,
) {
  return literals.thresholds.filter(
    (threshold) =>
      !literals.durations.some(
        (duration) =>
          threshold.number.start === duration.number.start &&
          threshold.number.end === duration.number.end,
      ),
  );
}

function thresholdValidationProblem(
  metrics: readonly TarvisIntentField<TarvisMetric>[],
  thresholds: readonly TarvisIntentField<TarvisGlucoseThreshold>[],
) {
  const expectedRoles = new Set<TarvisGlucoseThreshold["role"]>();
  for (const { value: metric } of metrics) {
    if (
      metric === "glucose.low_episodes" ||
      metric === "glucose.low_readings"
    ) {
      expectedRoles.add("low");
    } else if (
      metric === "glucose.high_episodes" ||
      metric === "glucose.high_readings"
    ) {
      expectedRoles.add("high");
    } else if (metric === "glucose.time_in_range") {
      expectedRoles.add("range_lower");
      expectedRoles.add("range_upper");
    }
  }

  const roles = thresholds.map(({ value }) => value.role);
  if (
    thresholds.length !== expectedRoles.size ||
    new Set(roles).size !== roles.length ||
    roles.some((role) => !expectedRoles.has(role))
  ) {
    return "The threshold count or role does not exactly match the requested metric.";
  }
  if (
    thresholds.some(
      ({ value }) => !Number.isFinite(value.value) || value.value <= 0,
    )
  ) {
    return "Glucose thresholds must be finite positive values.";
  }

  const low = thresholds.find(({ value }) => value.role === "low")?.value;
  const high = thresholds.find(({ value }) => value.role === "high")?.value;
  if (low && low.operator !== "lt") {
    return "Low calculations require one strict below threshold.";
  }
  if (high && high.operator !== "gt") {
    return "High calculations require one strict above threshold.";
  }

  const lower = thresholds.find(
    ({ value }) => value.role === "range_lower",
  )?.value;
  const upper = thresholds.find(
    ({ value }) => value.role === "range_upper",
  )?.value;
  if (
    (lower && lower.operator !== "gt" && lower.operator !== "gte") ||
    (upper && upper.operator !== "lt" && upper.operator !== "lte")
  ) {
    return "Time in range requires a lower above-bound and an upper below-bound.";
  }
  if (lower && upper) {
    if (lower.unit !== upper.unit) {
      return "Time-in-range bounds must use the same glucose unit.";
    }
    if (lower.value >= upper.value) {
      return "The time-in-range lower threshold must be below the upper threshold.";
    }
  }
  return null;
}

/** "glucose.standard_deviation" -> "standard deviation", for replies. */
function plainMetricName(metric: string) {
  const name = (metric.split(".").at(-1) ?? metric).replace(/_/g, " ");
  return name === "gmi" ? "GMI" : name;
}

function clarification(
  code: Extract<
    TarvisCapabilityOutcome,
    { status: "needs_clarification" }
  >["code"],
  message: string,
  clarificationText: string,
): Extract<TarvisCapabilityOutcome, { status: "needs_clarification" }> {
  return {
    status: "needs_clarification",
    code,
    message,
    clarification: clarificationText,
  };
}

function unsupported(
  code: Extract<TarvisCapabilityOutcome, { status: "unsupported" }>["code"],
  message: string,
): Extract<TarvisCapabilityOutcome, { status: "unsupported" }> {
  return { status: "unsupported", code, message };
}

function incomplete(
  intent: TarvisIntentDraftV1,
  literals: ReturnType<typeof extractTarvisLiterals>,
  outcome: IncompleteTarvisIntentResolution["outcome"],
): IncompleteTarvisIntentResolution {
  return {
    schemaVersion: TARVIS_INTENT_SCHEMA_VERSION,
    intent,
    literals,
    outcome,
  };
}

export function resolveTarvisIntent(
  question: string,
  options: ResolveTarvisIntentOptions = {},
): TarvisIntentResolution {
  const normalizedQuestion = normalizeQuestion(question);
  const literals = extractTarvisLiterals(question, {
    now: options.now,
    timezone: options.timezone,
  });
  const productOvernight = productOvernightResolution(
    question,
    normalizedQuestion,
    literals.numbers,
    options.overnightProfile ?? DEFAULT_OVERNIGHT_PROFILE,
    options.timezone ?? getRuntimeAnalysisTimeZone(),
    options.overnightProfile != null,
  );
  const draft: TarvisIntentDraftV1 = {
    schemaVersion: TARVIS_INTENT_SCHEMA_VERSION,
    question,
    normalizedQuestion,
    metrics: [],
    thresholds: [],
  };
  if (!normalizedQuestion) {
    return incomplete(
      draft,
      literals,
      clarification(
        "empty_question",
        "There was no question.",
        "What would you like to know about your glucose data?",
      ),
    );
  }

  const explicitCandidates = extractMetricCandidates(
    question,
    normalizedQuestion,
  );
  if (hasAmbiguousMetricNegation(normalizedQuestion, explicitCandidates)) {
    return incomplete(
      draft,
      literals,
      clarification(
        "ambiguous_negation",
        "I couldn't tell which number you want.",
        "Which number do you want, for example average glucose or time in range?",
      ),
    );
  }
  const history = latestHistory(options.history);
  const explicitFollowUp = isExplicitFollowUp(normalizedQuestion);
  if (explicitCandidates.length > 0) {
    draft.metrics = explicitCandidates.map((candidate) =>
      explicitField(candidate.metric, candidate.span),
    );
  } else if (explicitFollowUp && history) {
    draft.metrics = history.intent.metrics.map((metric) =>
      inheritedField(metric, history),
    );
  }
  const unconsumedMetric = unconsumedCompoundMetricCue(
    normalizedQuestion,
    explicitCandidates,
  );
  // A compound calculation can be unavailable while its time and comparison
  // are perfectly clear. Preserve those independent constraints for evidence
  // synthesis instead of returning a draft with the requested dates missing.
  let compoundProblem:
    | Extract<TarvisCapabilityOutcome, { status: "unsupported" }>
    | undefined;
  if (explicitCandidates.length >= 2 && hasUnrepresentedCompoundRequest(
    normalizedQuestion,
    extractMetricCandidates(normalizedQuestion, normalizedQuestion),
  )) {
    // This is an explicitly unavailable calculation, not open-ended evidence
    // synthesis. The existing unsupported_metric route fails closed instead
    // of sending a partial set of requested statistics to a model.
    compoundProblem = unsupported(
      "unsupported_metric",
      "Part of that question asks for a nutrient or for how long episodes lasted, which I can't calculate here yet. Please ask for each number on its own.",
    );
  }
  if (unconsumedMetric) {
    compoundProblem ??= unsupported(
      "unsupported_compound_question",
      `You also asked about ${plainMetricName(unconsumedMetric)}, and I couldn't tell how it fits with the rest. Please ask about it on its own.`,
    );
  }

  const domains = inferDomains(normalizedQuestion, explicitCandidates);
  if (explicitCandidates.length === 0 && explicitFollowUp && history) {
    draft.domain = inheritedField(history.intent.domain, history);
  } else if (domains.length === 1) {
    const domain = domains[0]!;
    const domainMetric = explicitCandidates.find((candidate) =>
      candidate.metric.startsWith(`${domain}.`),
    );
    draft.domain = explicitField(
      domain,
      domainMetric?.span ?? spanForText(question, normalizedQuestion, domain),
    );
  } else if (domains.length > 1) {
    compoundProblem ??= unsupported(
      "unsupported_compound_question",
      "That needs several kinds of record at once, which I can't combine in one calculation yet. Try one at a time, for example 'insulin today' or 'carbs today'.",
    );
  }

  const operations = new Set(
    explicitCandidates.map((candidate) => candidate.operation),
  );
  if (explicitCandidates.length === 0 && explicitFollowUp && history) {
    draft.operation = inheritedField(history.intent.operation, history);
  } else if (operations.size === 1) {
    const operation = [...operations][0]!;
    draft.operation = explicitField(operation, explicitCandidates[0]!.span);
  } else if (operations.size > 1) {
    compoundProblem ??= unsupported(
      "unsupported_compound_question",
      "Those numbers need different calculations, which I can't combine in one answer yet. Please ask for one at a time, for example 'average glucose today'.",
    );
  }

  const scopeResolution = resolveTemporalScope(
    question,
    normalizedQuestion,
    literals,
    productOvernight,
  );
  if (scopeResolution.problem) {
    if (scopeResolution.problem === "unsupported_time_scope") {
      return incomplete(
        draft,
        literals,
        unsupported(
          "unsupported_time_scope",
          scopeResolution.message ??
            "I can't use that time period yet. Please give dates, for example 'from 1 March to 14 March'.",
        ),
      );
    }
    return incomplete(
      draft,
      literals,
      clarification(
        scopeResolution.problem,
        scopeResolution.message ?? "I couldn't tell which period you mean.",
        scopeResolution.problem === "ambiguous_clock_time"
          ? "Please give both times with a.m./p.m. or in 24-hour time."
          : "Which period do you want, for example 'today' or 'the last 7 days'?",
      ),
    );
  }
  if (scopeResolution.scope) {
    draft.temporalScope = scopeResolution.scope;
  } else if (explicitFollowUp && history) {
    draft.temporalScope = inheritedField(history.intent.temporalScope, history);
  }

  const clockWindowLiteral = literals.clockWindows[0];
  if (clockWindowLiteral?.window) {
    const note = [
      clockWindowLiteral.startTime.inference,
      clockWindowLiteral.endTime.inference,
    ]
      .filter(Boolean)
      .join(" ");
    draft.clockWindow = explicitField(
      clockWindowLiteral.window,
      clockWindowLiteral,
      note || undefined,
    );
  } else if (productOvernight?.window) {
    draft.clockWindow = productOvernight.window;
  } else if (explicitFollowUp && history?.intent.clockWindow) {
    draft.clockWindow = inheritedField(history.intent.clockWindow, history);
  }

  draft.comparison = comparisonField(
    question, normalizedQuestion, literals, explicitCandidates, draft.temporalScope?.value, domains,
  );
  if (!draft.comparison && explicitFollowUp && history?.intent.comparison) {
    draft.comparison = inheritedField(history.intent.comparison, history);
  }

  const profile = options.targetProfile ?? DEFAULT_TARGET_PROFILE;
  const thresholdContext: TargetThresholdContext = {
    focus: detectTarvisTimeInRangeFocus(normalizedQuestion),
    personalProfile: options.personalTargetProfile,
  };
  const explicitMetricThresholds = metricThresholdLiterals(literals);
  if (compoundProblem) {
    if (explicitMetricThresholds.length === 0) {
      draft.thresholds = targetThresholds(
        draft.metrics,
        literals,
        profile,
        thresholdContext,
      );
    }
    return incomplete(draft, literals, compoundProblem);
  }
  if (explicitMetricThresholds.length > 0 && draft.metrics.length > 1) {
    return incomplete(
      draft,
      literals,
      unsupported(
        "unsupported_compound_question",
        "I can't apply your own limits to several numbers in one question yet. Please ask for one number at a time.",
      ),
    );
  }
  const singleThresholdMetric = draft.metrics[0]?.value;
  if (
    explicitMetricThresholds.length > 1 &&
    draft.metrics.length === 1 &&
    (singleThresholdMetric === "glucose.low_episodes" ||
      singleThresholdMetric === "glucose.high_episodes" ||
      singleThresholdMetric === "glucose.low_readings" ||
      singleThresholdMetric === "glucose.high_readings")
  ) {
    return incomplete(
      draft,
      literals,
      clarification(
        "ambiguous_metric",
        "You gave more than one limit for lows or highs.",
        "Which one limit should I use?",
      ),
    );
  }
  draft.thresholds = targetThresholds(
    draft.metrics,
    literals,
    profile,
    thresholdContext,
  );

  if (draft.metrics.length === 0) {
    return incomplete(
      draft,
      literals,
      clarification(
        "missing_metric",
        "Which number do you want? For example average glucose, time in range, lows, highs, insulin or carbs.",
        "Which number do you want?",
      ),
    );
  }
  if (!draft.domain) {
    return incomplete(
      draft,
      literals,
      clarification(
        "ambiguous_metric",
        "I couldn't tell which kind of record you mean.",
        "Which kind do you mean, for example glucose, insulin or carbs?",
      ),
    );
  }
  const unsupportedMetric = draft.metrics.find(
    (metric) => !SUPPORTED_METRICS.has(metric.value),
  );
  if (unsupportedMetric) {
    return incomplete(
      draft,
      literals,
      unsupported(
        "unsupported_metric",
        `I understood that you want ${plainMetricName(unsupportedMetric.value)}, but I can't calculate it on the phone yet.`,
      ),
    );
  }
  const invalidThreshold = thresholdValidationProblem(
    draft.metrics,
    draft.thresholds,
  );
  if (invalidThreshold) {
    return incomplete(
      draft,
      literals,
      clarification(
        "invalid_threshold",
        invalidThreshold,
        "Please give a valid limit for that number.",
      ),
    );
  }
  if (!draft.operation) {
    return incomplete(
      draft,
      literals,
      clarification(
        "ambiguous_metric",
        "I couldn't tell what to work out.",
        "Do you want an average, a count or a total?",
      ),
    );
  }
  if (
    !draft.temporalScope &&
    draft.metrics.length === 1 &&
    draft.metrics[0]?.value === "glucose.current"
  ) {
    draft.temporalScope = {
      value: { kind: "rolling", amount: 24, unit: "hour", anchor: "now" },
      provenance: {
        kind: "default",
        sourceText: draft.metrics[0].provenance.sourceText,
        sourceStart: draft.metrics[0].provenance.sourceStart,
        sourceEnd: draft.metrics[0].provenance.sourceEnd,
        turnId: null,
        note: "A 24-hour lookup window is used only to find the latest recorded reading; freshness is evaluated separately.",
      },
    };
  }
  if (!draft.temporalScope) {
    return incomplete(
      draft,
      literals,
      clarification(
        "missing_time_scope",
        "Which period do you want? For example today, yesterday or the last 7 days.",
        "Which period do you want?",
      ),
    );
  }
  if (draft.comparison?.value.kind === "explicit_periods") {
    return incomplete(
      draft,
      literals,
      unsupported(
        "unsupported_comparison",
        "I can only compare a period with the one just before it, for example this week with last week.",
      ),
    );
  }

  const intent: TarvisIntentV1 = {
    schemaVersion: TARVIS_INTENT_SCHEMA_VERSION,
    question,
    normalizedQuestion,
    domain: draft.domain,
    metrics: draft.metrics,
    operation: draft.operation,
    temporalScope: draft.temporalScope,
    clockWindow: draft.clockWindow ?? null,
    comparison: draft.comparison ?? null,
    thresholds: draft.thresholds,
  };
  const ready: ReadyTarvisIntentResolution = {
    schemaVersion: TARVIS_INTENT_SCHEMA_VERSION,
    intent,
    literals,
    outcome: { status: "ready", code: "ready" },
  };
  return ready;
}

export function isReadyTarvisIntent(
  resolution: TarvisIntentResolution,
): resolution is ReadyTarvisIntentResolution {
  return resolution.outcome.status === "ready";
}

function hasUnrepresentedCompoundRequest(
  question: string,
  candidates: readonly MetricCandidate[],
) {
  // Recognize requested quantities/list items, not every mention of a nutrient.
  // "My meals contained protein. Show carbs and bolus" is descriptive context;
  // "Show carbs, bolus and protein" requests a third, unsupported calculation.
  const requestPrefix = /(?:^|[,;.!?]\s*|\b(?:show|calculate|compare|report|list|give|tell|include|including|also|and|plus|versus|vs|what(?:\s+(?:was|were|is|are))?|how\s+(?:much|many)))\s*(?:(?:me|my|the|their|its|recorded|logged|total|average|mean|daily|dietary|amount|intake|grams|milligrams|of)\s+)*$/;
  const requestedAt = (start: number) => {
    const before = question.slice(0, start);
    if (!requestPrefix.test(before)) return false;
    const boundary = [...before.matchAll(/[!?;]|\.(?=\s|$)/g)].at(-1);
    const clauseStart = boundary ? boundary.index + boundary[0].length : 0;
    const clause = before.slice(clauseStart);
    return /^\s*(?:(?:my|the|total|average|mean|dietary|recorded|logged)\s+)*$/.test(clause) ||
      /\b(?:show|calculate|compare|report|list|give|tell|include|including|plus|what|how)\b/.test(clause) ||
      candidates.some(({ span }) => span.start >= clauseStart && span.end <= start);
  };
  const nutrients = /\b(?:calories?|kilocalories?|kilojoules?|kcal|kj|energy|proteins?|fats?|fib(?:er|re)|sodium|salt|sugars?|cholesterol|potassium|vitamins?|minerals?)\b/g;
  for (const match of question.matchAll(nutrients)) {
    const before = question.slice(0, match.index);
    // Blood sugar is a supported glucose noun, not dietary sugar intake.
    if (/\b(?:blood|low|high)\s*$/.test(before)) continue;
    // Food/product descriptions are not requests for their nutrient total.
    const after = question.slice(match.index + match[0].length);
    if (/^(?:[- ](?:rich|free|reduced)|\s+(?:shake|bar|powder|supplement|drink|meal|snack)\b)/.test(after)) continue;
    // A noun-led statement such as "Protein is important" is not a list item.
    if (/(?:^|[.!?;])\s*(?:(?:my|the|dietary)\s+)*$/.test(before) &&
      /^\s+(?:is|are|was|were|matters?|helps?|supports?|can|may|has|have|contains?|plays?)\b/.test(after)) continue;
    if (requestedAt(match.index)) return true;
  }

  // These describe event duration or an event extremum, not the count of
  // events or the minimum/maximum glucose value supported by schema v1.
  if (!candidates.some(({ metric }) => metric.endsWith("_episodes"))) return false;
  const event = "(?:(?:(?:low|high|glucose|blood|sugar|hypoglycaemic|hypoglycemic|hyperglycaemic|hyperglycemic)\\s+)*(?:episodes?|events?|periods?|lows?|highs?|hypos?|hypers?))";
  const eventStatistics = new RegExp(
    `\\b(?:(?:longest|shortest)\\s+${event}|(?:(?:total|average|mean|median|maximum|minimum|longest|shortest)\\s+)?(?:duration|length|minutes?|hours?)\\s+(?:of\\s+|in\\s+)?(?:(?:my|the|a|an|each)\\s+)?${event}|${event}\\s+(?:duration|length)s?|how\\s+long\\s+(?:(?:did|was|were)\\s+)?(?:(?:my|the|a|an|each|they|it)\\s+)?(?:${event}\\s+)?(?:last(?:ed)?|persist(?:ed)?)|time\\s+spent\\s+(?:low|high|below|above)|durations?|lengths?)\\b`,
    "g",
  );
  for (const match of question.matchAll(eventStatistics)) {
    if (requestedAt(match.index) || /\bwith\s+(?:(?:their|the|its)\s+)?$/.test(question.slice(0, match.index))) {
      return true;
    }
  }
  return false;
}

/**
 * A compound draft is not itself executable under intent schema v1. Split
 * only explicit, fully represented calculations sharing one whole-period
 * scope into independently valid v1 intents. Callers must use all results,
 * not fall back to the first metric if any execution fails.
 *
 * Use the same options (especially targetProfile) as resolveTarvisIntent.
 * Clock-window compounds, current readings, narrative/causal questions and
 * per-metric conditions remain outside this deliberately bounded adapter.
 */
export function resolveTarvisCompoundIntents(
  resolution: TarvisIntentResolution,
  options: ResolveTarvisIntentOptions = {},
): TarvisIntentV1[] | null {
  if (resolution.outcome.code !== "unsupported_compound_question") return null;
  // Re-resolve rather than trusting a partially populated or externally
  // modified draft. This reuses all existing date, clock and exclusion guards.
  const checked = resolveTarvisIntent(resolution.intent.question, options);
  const draft = checked.intent;
  if (
    checked.outcome.code !== "unsupported_compound_question" ||
    !draft.temporalScope || draft.clockWindow ||
    draft.comparison?.value.kind === "explicit_periods" ||
    draft.metrics.length < 2 || draft.metrics.length > 8
  ) return null;

  const normalized = draft.normalizedQuestion;
  // This adapter presents the selected values side by side. A requested
  // difference, percentage change, ratio or rate is another calculation,
  // not a synonym for paired values. Leave ordinary "compare" wording and
  // percentage-valued metrics such as time in range available. This guard
  // applies only to compound drafts, never ready single-metric comparisons.
  if (
    /\b(?:deltas?|ratios?|rates?|differences?)\b|(?:\bpercent(?:age)?|%)\s*[- ]?\s*(?:points?\s+)?(?:changes?|differences?|increases?|decreases?)\b|\b(?:changes?|increases?|decreases?)\s+(?:in|as|by)\s+(?:a\s+)?(?:percent(?:age)?\b|%)|\bby\s+(?:what|which)\s+percent(?:age)?\b|\b(?:absolute|relative|numeric|numerical)\s+changes?\b|\b(?:amount|size|magnitude)\s+of\s+(?:the\s+)?(?:change|increase|decrease)\b|\bhow\s+much\b[\s\S]{0,160}\b(?:change|increase|decrease|rise|fall|drop|higher|lower|more|less|fewer)\b/.test(normalized)
  ) return null;
  // These requests need contextual evidence or a different output (for
  // example the timestamp of a minimum); a list of totals would omit it.
  if (
    /\b(?:why|explain|caus(?:e|ed|es)|because|patterns?|correlat(?:e|ed|ion)|relationship|associated|related\s+to|when|whenever|while|where|if|only|just|per|daily|weekly|each\s+(?:day|week)|by\s+(?:day|week)|which\s+(?:day|date|time)|what\s+(?:day|date|time)|at\s+what\s+time)\b|\b(?:low|high)\s+periods?\s+of\b/.test(normalized)
  ) return null;

  // Work on one offset-stable string for positional bindings. The returned
  // metric fields still retain their original-question provenance.
  const candidates = extractMetricCandidates(normalized, normalized);
  const literals = extractTarvisLiterals(normalized, options);
  const metricValues = new Set(draft.metrics.map(({ value }) => value));
  if (
    candidates.length !== metricValues.size ||
    candidates.some(({ metric }) =>
      !metricValues.has(metric) || !SUPPORTED_METRICS.has(metric) ||
      metric === "glucose.current",
    ) ||
    unconsumedCompoundMetricCue(normalized, candidates) ||
    inferDomains(normalized, candidates).some((domain) =>
      !candidates.some(({ metric }) => metric.startsWith(`${domain}.`)),
    ) ||
    literals.durations.some((duration) => !isScopeDuration(normalized, duration))
  ) return null;

  // A comparison following the first metric's complete scope must not be
  // spread over another independently scoped clause which did not request
  // that comparison. A shared trailing comparison ("mean and lows last week
  // versus the previous period") has no earlier per-metric scope to conflict.
  if (draft.comparison) {
    const hasComparisonByClause = candidates.map((candidate, index) => {
      const end = candidates[index + 1]?.span.start ?? normalized.length;
      const hasScope = literals.durations.some((duration) =>
        duration.start >= candidate.span.end && duration.end <= end &&
        isScopeDuration(normalized, duration),
      ) || literals.dates.some((date) =>
        date.start >= candidate.span.end && date.end <= end,
      );
      if (!hasScope) return null;
      return /\bprevious\b|\bbefore\s+that\b/.test(
        normalized.slice(candidate.span.end, end),
      ) || literals.comparisons.some((comparison) =>
        comparison.start >= candidate.span.end && comparison.end <= end,
      );
    }).filter((value) => value !== null);
    if (hasComparisonByClause.includes(true) && hasComparisonByClause.includes(false)) {
      return null;
    }
  }

  const explicitThresholds = metricThresholdLiterals(literals);
  const thresholdsByMetric = new Map<TarvisMetric, typeof explicitThresholds>();
  const originalThresholds = metricThresholdLiterals(checked.literals);
  for (const [index, threshold] of explicitThresholds.entries()) {
    const preceding = candidates.filter(({ span }) => span.start < threshold.start);
    const owner = preceding[preceding.length - 1];
    if (!owner) return null;
    // Binding requires the threshold to directly follow its selected metric,
    // allowing the usual question words but not a different clause/filter.
    if (/[;?!]|\b(?:and|also|but|where|while|during|for)\b/.test(
      normalized.slice(owner.span.end, threshold.start),
    )) return null;
    const bound = thresholdsByMetric.get(owner.metric) ?? [];
    if (!originalThresholds[index]) return null;
    bound.push(originalThresholds[index]);
    thresholdsByMetric.set(owner.metric, bound);
  }

  const intents: TarvisIntentV1[] = [];
  for (const candidate of candidates) {
    const metric = draft.metrics.find(({ value }) => value === candidate.metric)!;
    const boundThresholds = thresholdsByMetric.get(candidate.metric) ?? [];
    let thresholds = targetThresholds([metric], {
      ...literals, durations: [], thresholds: boundThresholds,
    }, options.targetProfile ?? DEFAULT_TARGET_PROFILE, {
      focus: detectTarvisTimeInRangeFocus(checked.intent.normalizedQuestion),
      personalProfile: options.personalTargetProfile,
    });
    if (!options.targetProfile && boundThresholds.length === 0) {
      thresholds = thresholds.map((threshold) => {
        const family = threshold.value.role === "low" || threshold.value.role === "range_lower"
          ? ["low", "range_lower"] : ["high", "range_upper"];
        const original = resolution.intent.thresholds.find(({ value, provenance }) =>
          family.includes(value.role) && (provenance.kind === "profile" || provenance.kind === "default"),
        );
        return original ? {
          value: { ...threshold.value, value: original.value.value, unit: original.value.unit },
          provenance: original.provenance,
        } : threshold;
      });
    }
    if (thresholdValidationProblem([metric], thresholds)) return null;
    const intent: TarvisIntentV1 = {
      schemaVersion: TARVIS_INTENT_SCHEMA_VERSION,
      question: draft.question,
      normalizedQuestion: normalized,
      domain: {
        value: candidate.metric.split(".")[0] as TarvisDomain,
        provenance: metric.provenance,
      },
      metrics: [metric],
      operation: { value: candidate.operation, provenance: metric.provenance },
      temporalScope: draft.temporalScope,
      clockWindow: null,
      comparison: draft.comparison ?? null,
      thresholds,
    };
    if (!validateTarvisIntentV1(intent).valid) return null;
    intents.push(intent);
  }
  return intents;
}
