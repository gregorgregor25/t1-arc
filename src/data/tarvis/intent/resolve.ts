import { getRuntimeAnalysisTimeZone } from "@/domain/regionalProfileRuntime";
import { extractTarvisLiterals } from "./literals";
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

const DEFAULT_TARGET_PROFILE: TarvisGlucoseTargetProfile = {
  id: "standard-cgm-range",
  unit: "mmol/L",
  lowBelow: 3.9,
  highAbove: 10,
};

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
const UNREPRESENTED_RECORD_FILTER_PATTERN =
  /\b(?:(?:only|just|solely)\s+(?:(?:use|using|include|including)\s+)?(?:the\s+)?(?:calibration|calibrated|uncalibrated|manual|meter|finger(?:stick|[- ]prick)|sensor|cgm|measured|estimated|imported|live|dexcom|libre|glooko|nightscout|pump|device|source)\b|(?:using|from)\s+(?:only\s+)?(?:my\s+)?(?:dexcom|libre|glooko|nightscout|pump|meter|finger(?:stick|[- ]prick)|sensor|cgm|device|source)\b)/;
const EVENT_RELATIVE_FILTER_PATTERN =
  /\b(?:(?:before|after|around|following|since|upon|during|from|on|at|between)\s+(?:(?:i|my|a|an|the)\s+){0,2}(?:wak(?:e|es|ing)|woke|getting\s+(?:up|out\s+of\s+bed)|bedtime|going\s+to\s+bed|sleep(?:ing)?|meals?|eating|fast(?:ing)?|breakfast|lunch|dinner|exercise|exercising|activity|active|workouts?|training|correction(?:\s+bolus)?|bolus|insulin\s+dose|medication|dose|commut(?:e|ing)|work|shifts?|stress|illness|drinking|alcohol|lows?|highs?|hypos?|hypers?|spikes?)|(?:while|when)\s+(?:(?:i(?:'m|\s+am)?|my)\s+)?(?:[a-z]+ing|asleep|awake|active)|within\s+(?:\w+[ -]?){0,4}(?:of|before|after)\s+(?:(?:a|an|the|my)\s+)?(?:wak(?:e|ing)|meals?|eating|breakfast|lunch|dinner|exercise|workouts?|bolus|dose)|(?:pre|post)[ -]?(?:meal|breakfast|lunch|dinner|exercise|workout|bolus))\b/;

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
      problem: "More than one completed-night count was requested.",
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
        "The overnight profile must contain a non-empty ID and two different valid local clock times.",
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
        /\b(?:(?:how many|number of|count(?: of)?|frequency of)\s+(?:sustained\s+)?(?:low[- ]glucose\s+)?(?:events?|episodes?|hypos?|lows?|dips?|crashes?)|(?:low(?:[- ]glucose)?|hypoglyc(?:aemia|emia|emic)|hypo)\s+(?:events?|episodes?)|(?:lows|hypos|dips|crashes)\s+(?:have|did|during|over|in)\b|(?:lows|hypos|dips|crashes)\b(?=\s*(?:[,;]|\band\b|\bor\b|\bnot\b)))/,
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
        /\b(?:(?:how many|number of|count(?: of)?|frequency of)\s+(?:sustained\s+)?(?:high[- ]glucose\s+)?(?:events?|episodes?|hypers?|highs?|spikes?)|(?:high(?:[- ]glucose)?|hyperglyc(?:aemia|emia|emic)|hyper)\s+(?:events?|episodes?)|(?:highs|hypers|spikes)\s+(?:have|did|during|over|in)\b|(?:highs|hypers|spikes)\b(?=\s*(?:[,;]|\band\b|\bor\b|\bnot\b)))/,
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
      /\b(?:(?:sleep|asleep)\s+(?:time|duration|hours?)|how (?:long|many hours|much time)\s+(?:did i\s+)?sleep)\b/,
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
    (EVENT_RELATIVE_FILTER_PATTERN.test(normalizedQuestion) ||
      UNREPRESENTED_EXCLUSION_PATTERN.test(normalizedQuestion) ||
      UNREPRESENTED_RECORD_FILTER_PATTERN.test(normalizedQuestion));
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
      message: "The requested duration must be a positive whole number.",
    };
  }
  if (duration.unit === "month") {
    return {
      problem: "unsupported_time_scope",
      message:
        "Numbered month windows are not yet supported because their calendar boundaries need to be explicit.",
    };
  }
  const before = durationContext(normalizedQuestion, duration);
  const isRolling =
    duration.unit === "minute" ||
    duration.unit === "hour" ||
    /\bpast\s+(?:the\s+)?$/.test(before);
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
          : /\bcompleted\s+$/.test(before)
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
      message: "More than one recurring clock window was found.",
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
      message: "The clock window could not be resolved safely.",
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
        "A standalone clock time cannot be executed as a recurring window; provide explicit start and end bounds.",
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
        "An approximate or one-sided clock filter needs explicit start and end bounds.",
    };
  }

  if (
    NAMED_WEEKDAY_PATTERN.test(normalizedQuestion) &&
    !literals.dates.some((date) => date.kind === "absolute")
  ) {
    return {
      problem: "unsupported_time_scope",
      message: "Named weekday and weekend filters are not executable yet.",
    };
  }
  if (EVENT_RELATIVE_FILTER_PATTERN.test(normalizedQuestion)) {
    return {
      problem: "ambiguous_time_scope",
      message:
        "Event-relative filters need an exact supported event timestamp and clock window; the filter was not ignored.",
    };
  }
  if (
    UNREPRESENTED_EXCLUSION_PATTERN.test(normalizedQuestion) ||
    UNREPRESENTED_RECORD_FILTER_PATTERN.test(normalizedQuestion)
  ) {
    return {
      problem: "ambiguous_time_scope",
      message:
        "This exclusion is not represented by the executable scope and was not silently discarded.",
    };
  }
  if (
    OTHER_NAMED_DAYPART_PATTERN.test(normalizedQuestion) &&
    !clockWindow?.window
  ) {
    return {
      problem: "ambiguous_time_scope",
      message:
        "That named part of the day needs explicit clock bounds; it was not widened to a whole day.",
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
        "Night needs explicit clock bounds or the named overnight definition; it was not widened to a whole day.",
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
      message: "More than one calendar period was requested.",
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
        message: "More than one non-equivalent duration was requested.",
      };
    }
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
          "The question combines non-equivalent time scopes; choose one exact period.",
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
        message: "The requested calendar dates do not form one clear range.",
      };
    }
    const first = absoluteDates[0]!;
    const second = absoluteDates[1]!;
    if (first.date > second.date) {
      return {
        problem: "ambiguous_time_scope",
        message: "The end date is earlier than the start date.",
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
          "The requested number of nights must be a positive whole number.",
      };
    }
    if (productOvernight.count > 366) {
      return {
        problem: "unsupported_time_scope",
        message: "At most 366 completed overnight windows can be calculated.",
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

  if (durations.length > 1) {
    const [first, second] = durations;
    if (
      comparisonToPrevious &&
      first &&
      second &&
      first.value === second.value &&
      first.unit === second.unit
    ) {
      return scopeFromDuration(
        offsetStableQuestion,
        first,
        Boolean(clockWindow?.window || productOvernight?.window),
      );
    }
    return {
      problem: "ambiguous_time_scope",
      message: "More than one non-equivalent duration was requested.",
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
): TarvisIntentField<TarvisComparison> | undefined {
  if (literals.comparisons.length === 0) return undefined;
  const source = literals.comparisons[0]!;
  if (/\bprevious\b|\bbefore\s+that\b/.test(normalizedQuestion)) {
    return explicitField({ kind: "previous_equal_period" }, source);
  }
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

function targetThresholds(
  metrics: TarvisIntentField<TarvisMetric>[],
  literals: ReturnType<typeof extractTarvisLiterals>,
  profile: TarvisGlucoseTargetProfile,
): TarvisIntentField<TarvisGlucoseThreshold>[] {
  const metricValues = new Set(metrics.map((metric) => metric.value));
  const explicitThresholds = metricThresholdLiterals(literals);
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
        "No question was provided.",
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
        "The metric appears to be negated rather than selected.",
        "Which metric should I calculate?",
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
  if (unconsumedMetric) {
    return incomplete(
      draft,
      literals,
      unsupported(
        "unsupported_compound_question",
        `The question also requests ${unconsumedMetric}, but its relationship to the other calculation was not unambiguous.`,
      ),
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
    return incomplete(
      draft,
      literals,
      unsupported(
        "unsupported_compound_question",
        "This foundation does not yet execute a query spanning multiple health-data domains.",
      ),
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
    return incomplete(
      draft,
      literals,
      unsupported(
        "unsupported_compound_question",
        "The question combines metrics that need different calculations.",
      ),
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
          scopeResolution.message ?? "That time scope is not supported.",
        ),
      );
    }
    return incomplete(
      draft,
      literals,
      clarification(
        scopeResolution.problem,
        scopeResolution.message ?? "The time scope is ambiguous.",
        scopeResolution.problem === "ambiguous_clock_time"
          ? "Please give both times with a.m./p.m. or in 24-hour time."
          : "Which exact period should I use?",
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

  draft.comparison = comparisonField(question, normalizedQuestion, literals);
  if (!draft.comparison && explicitFollowUp && history?.intent.comparison) {
    draft.comparison = inheritedField(history.intent.comparison, history);
  }

  const profile = options.targetProfile ?? DEFAULT_TARGET_PROFILE;
  const explicitMetricThresholds = metricThresholdLiterals(literals);
  if (explicitMetricThresholds.length > 0 && draft.metrics.length > 1) {
    return incomplete(
      draft,
      literals,
      unsupported(
        "unsupported_compound_question",
        "Explicit thresholds in a multi-metric question cannot yet be bound to each metric without ambiguity.",
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
        "More than one threshold was supplied for a single low/high calculation.",
        "Which one threshold should I use?",
      ),
    );
  }
  draft.thresholds = targetThresholds(draft.metrics, literals, profile);

  if (draft.metrics.length === 0) {
    return incomplete(
      draft,
      literals,
      clarification(
        "missing_metric",
        "No supported metric was stated or safely inherited.",
        "Should I calculate average glucose, low episodes, high episodes, or time in range?",
      ),
    );
  }
  if (!draft.domain) {
    return incomplete(
      draft,
      literals,
      clarification(
        "ambiguous_metric",
        "The requested metric has no clear health-data domain.",
        "Which reading or health-data type do you mean?",
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
        `${unsupportedMetric.value} was recognised exactly but is not locally executable yet.`,
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
        "Please provide the exact valid threshold or range for that metric.",
      ),
    );
  }
  if (!draft.operation) {
    return incomplete(
      draft,
      literals,
      clarification(
        "ambiguous_metric",
        "The requested calculation is ambiguous.",
        "What calculation should I perform?",
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
        "No time period was stated or safely inherited.",
        "Which dates or period should I use?",
      ),
    );
  }
  if (draft.comparison?.value.kind === "explicit_periods") {
    return incomplete(
      draft,
      literals,
      unsupported(
        "unsupported_comparison",
        "Only comparison with the immediately preceding equal-length period is executable in this foundation.",
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
