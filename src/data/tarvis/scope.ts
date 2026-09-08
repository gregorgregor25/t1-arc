import { TarvisConversationTurn } from "./types";
import { InsightPeriodDays } from "@/domain/insightRanges";

export type TarvisScope = "in_scope" | "off_topic" | "sensitive_credentials";

const DIABETES_AND_HEALTH_TERMS = [
  "active energy",
  "activity",
  "average",
  "bg",
  "basal",
  "blood glucose",
  "blood pressure",
  "blood sugar",
  "bolus",
  "breakfast",
  "carb",
  "carbohydrate",
  "carbohydrates",
  "cgm",
  "coefficient of variation",
  "comparison",
  "coverage",
  "dexcom",
  "diabetes",
  "dinner",
  "dose",
  "drop",
  "exercise",
  "elevation",
  "floors",
  "food",
  "glucose",
  "gmi",
  "health",
  "heart rate",
  "heart rate variability",
  "hrv",
  "high",
  "hypo",
  "insulin",
  "illness",
  "ketone",
  "ketones",
  "ketoacidosis",
  "dka",
  "libre",
  "low",
  "gap",
  "gaps",
  "median",
  "lunch",
  "meal",
  "medication",
  "mmol",
  "nightscout",
  "omnipod",
  "overnight",
  "last night",
  "morning",
  "dawn phenomenon",
  "pattern",
  "pump",
  "reading",
  "run",
  "running",
  "walk",
  "walking",
  "cycle",
  "cycling",
  "cadence",
  "distance",
  "speed",
  "power",
  "sensor",
  "sleep",
  "sick day",
  "sick days",
  "sickday",
  "sickdays",
  "steps",
  "hydration",
  "water",
  "sleep quality",
  "oxygen saturation",
  "spo2",
  "respiratory rate",
  "vo2 max",
  "body temperature",
  "temperature",
  "body fat",
  "body composition",
  "lean mass",
  "bone mass",
  "height",
  "calories",
  "energy",
  "protein",
  "fibre",
  "fat",
  "nutrition",
  "strava",
  "session",
  "sessions",
  "stale",
  "spike",
  "stress",
  "sugar",
  "sugars",
  "time in range",
  "type 1",
  "type1",
  "target range",
  "timing range",
  "tir",
  "trend",
  "unwell",
  "variability",
  "changed",
  "weight",
  "workout",
  "vomit",
  "vomiting",
  "xdrip",
  "yesterday",
  "yday",
];

const REVIEWED_TYPE_1_GUIDANCE_SCOPE =
  /(?=[\s\S]*\b(?:nice|guidance|guidelines?|rules?|advice)\b)(?=[\s\S]*\b(?:type\s*1|diabetes|glucose|blood sugar|insulin|sick[- ]?days?|sickdays?|ill|illness|unwell|poorly|flu|ketones?|vomit(?:ing)?|physical activity|exercise|walk(?:ed|ing)?|run|ran|running|cycle|cycled|cycling|swim|swam|swimming|workout|gym)\b)/i;

const GENERAL_SICK_DAY_SCOPE =
  /\b(?:what should (?:i|someone) do|how should i manage|what do i need to know|advice|rules?)\b[\s\S]{0,100}\b(?:if|when|while|about|with)?\s*(?:i\s+)?(?:am |get |feel |have |have got |(?:'m|'ve got)\s*)?(?:ill|unwell|poorly|sick|flu|stomach bug|tummy bug)\b|\b(?:i(?:'m| am| feel|(?:'ve| have) got)\s+(?:ill|unwell|poorly|sick)|i(?:'ve| have)(?: got)? (?:flu|a stomach bug|a tummy bug))\b[\s\S]{0,100}\b(?:what should i do|how should i manage|what do i need to know|advice|rules?)\b/i;

const CHILD_SICK_DAY_SCOPE =
  /(?=[\s\S]*\b(?:child|children|schoolchild(?:ren)?|young[- ](?:person|people)|teen(?:ager)?s?|paediatric|pediatric|under[- ]?18|(?:[0-9]|1[0-7])(?:[- ]year[- ]old| years? old))\b)(?=[\s\S]*\b(?:ill|illness|unwell|poorly|sick|flu|stomach bug|tummy bug|sick[- ]?days?)\b)(?=[\s\S]*\b(?:what should|how should|what do (?:i|we|they) need to know|advice|rules?|guidance|guidelines?)\b)/i;

const CLEARLY_OFF_TOPIC =
  /\b(capital of|geography|weather forecast|football (?:score|result|news|table|fixture)|sports? score|celebrity|stock price|share price|cryptocurrency|mortgages?|boiler|write (?:me )?(?:a )?(?:poem|essay|story|code)|translate|homework|tell (?:me )?(?:a )?joke|trivia)\b|\b(?:what(?:'?s| is)|tell me|show me)\s+(?:the\s+)?weather\b/i;

export function isClearlyOffTopicTarvisQuestion(question: string) {
  return CLEARLY_OFF_TOPIC.test(question);
}

/** Recognises a request for an explanation, not a personal record lookup.
 * Topic recognition is deliberately separate: unfamiliar health vocabulary
 * can reach education mode without exposing a personal evidence packet.
 */
export function isTarvisGeneralExplanation(question: string) {
  const prompt = question.trim();
  if (
    /\b(?:records?|readings?|history|data|today|yesterday|last|past|previous|recent|calculate|compute|count|compare|how (?:many|much|long))\b/i.test(prompt)
  ) return false;
  const mechanismQuestion = /^(?:why|how) (?:does|do|can)\b/i.test(prompt);
  if (/\b(?:my|mine|our|ours)\b/i.test(prompt) && !mechanismQuestion) {
    return false;
  }
  return mechanismQuestion ||
    /^(?:(?:can|could) you\s+)?(?:what (?:is|are|does)|what's|explain|tell me about|help me understand|define|describe)\b/i.test(prompt);
}

const CREDENTIAL_EXTRACTION =
  /\b(show|tell|reveal|display|retrieve|give|what(?:'s| is))\b[\s\S]{0,80}\b(password|passcode|api[ -]?key|secret|credential|token)\b/i;

const FOLLOW_UP = [
  /^(?:(?:can|could|would) you\s+|please\s+)?(?:explain|describe|rephrase|summarise|summarize)\s+(?:that|this|it|the previous answer)\s+(?:more simply|in (?:simpler terms|simple terms|plain English|more detail|less detail)|again|briefly)[?.! ]*$/i,
  /^(?:make (?:that|this|it) (?:simpler|shorter|clearer)|simplify (?:that|this|it)|(?:can|could) you simplify (?:that|this|it))[?.! ]*$/i,
  /^(?:why|how|how so|why is (?:that|this|it)|why does (?:that|this|it) matter|how does (?:that|this|it) work)[?.! ]*$/i,
  /^(?:(?:can|could) you\s+|please\s+)?explain(?:\s+(?:that|this|it))?[?.! ]*$/i,
  /^(?:(?:can|could) you\s+)?tell me more(?:\s+about\s+(?:that|this|it))?[?.! ]*$/i,
  /^(?:(?:can|could) you\s+|please\s+)?go deeper(?:\s+on\s+(?:that|this|it))?[?.! ]*$/i,
  /^(?:show me|(?:can|could) you\s+show me (?:the\s+)?sources?|where does (?:that|this|it) come from|where is (?:that|this|it) from|what source is (?:that|this|it) based on|what (?:guidance|evidence|sources?) supports? (?:that|this|it))[?.! ]*$/i,
  /^(?:which one|compare them|what (?:does|did) (?:that|this|it) mean|what does nice say|what about (?:that|this|it|the previous answer)|and this|is that good|is that bad|(?:what|how) about (?:the )?(?:previous|prior|earlier|recent|current) period)[?.! ]*$/i,
  /^(?:(?:but|and)\s+)?(?:when|what\s+(?:date|day|time))\s+(?:was|were|did)\s+(?:that|this|it|the)\s+(?:reading|value|result|maximum|minimum|highest|lowest|high|low)(?:\s+(?:occur|happen))?[?.! ]*$/i,
  /^you said\b[\s\S]*$/i,
  /^(?:(?:can|could) you (?:go into|give me) more detail|please expand on (?:that|this|it)|(?:can|could) you elaborate|break (?:that|this|it) down for me|(?:can|could) you explain (?:that|this|it) in more detail|tell me a bit more|what do you mean by (?:that|this|it))[?.! ]*$/i,
];

const SOURCE_FOLLOW_UP =
  /^(?:(?:can|could) you show me (?:the )?(?:source|link)|open (?:the )?(?:source|link)|which recommendations?|what are the recommendation (?:numbers?|references?)|(?:can|could) you link me to (?:it|that|this)|can i see (?:the )?(?:nice )?(?:guidance|source|recommendations?)|show me (?:the )?(?:nice )?(?:guidance|source|link|recommendations?)|where does (?:that|this|it) come from|where is (?:that|this|it) from|what source is (?:that|this|it) based on|what (?:guidance|evidence|sources?) supports? (?:that|this|it))[?.! ]*$/i;

export function isTarvisSourceFollowUp(question: string) {
  return SOURCE_FOLLOW_UP.test(question.trim());
}

export function isTarvisDependentFollowUp(question: string) {
  const prompt = question.trim();
  return (
    isTarvisSourceFollowUp(prompt) ||
    FOLLOW_UP.some((pattern) => pattern.test(prompt))
  );
}

const PERSONAL_DATA_QUESTION =
  /\b(my|mine|me|i)\b[\s\S]{0,120}\b(data|records?|history|summary|result|results|reading|readings|today|yesterday|week|fortnight|month|days?|date|average|total|highest|lowest|change|changed|compare|comparison|pattern|patterns)\b|\b(data|records?|history|summary|result|results|reading|readings|today|yesterday|week|fortnight|month|days?|date|average|total|highest|lowest|change|changed|compare|comparison|pattern|patterns)\b[\s\S]{0,120}\b(my|mine|me|i)\b/i;

const PERIOD_DAY_VALUES = new Set<InsightPeriodDays>([3, 7, 14, 30, 90]);

const PERIOD_NUMBER_WORDS: Record<string, number> = {
  three: 3,
  seven: 7,
  fourteen: 14,
  thirty: 30,
  ninety: 90,
};

/**
 * Returns a supported T1 Arc comparison period when the user explicitly asks
 * for one. Unsupported periods remain undefined rather than silently changing
 * the meaning of the question.
 */
export function requestedTarvisPeriodDays(
  question: string,
): InsightPeriodDays | undefined {
  const normalized = question
    .trim()
    .toLowerCase()
    .normalize("NFKC")
    .replace(/[’‘]/g, "'");
  const dayMatch = normalized.match(
    /\b(?:last|past|previous|over|for|during|in)\s+(?:the\s+)?(\d{1,2}|three|seven|fourteen|thirty|ninety)\s*(?:day|days|d)\b/,
  );
  if (dayMatch) {
    const rawValue = dayMatch[1]!;
    const value = PERIOD_NUMBER_WORDS[rawValue] ?? Number(rawValue);
    if (PERIOD_DAY_VALUES.has(value as InsightPeriodDays)) {
      return value as InsightPeriodDays;
    }
  }
  if (/\b(?:this|last|past|previous)\s+fortnight\b/.test(normalized)) {
    return 14;
  }
  if (/\b(?:this|last|past|previous)\s+(?:month|30d)\b/.test(normalized)) {
    return 30;
  }
  if (
    /\b(?:last|past|previous)\s+(?:three|3)\s+months?\b/.test(normalized) ||
    /\b90d\b/.test(normalized)
  ) {
    return 90;
  }
  if (/\b(?:this|last|past|previous)\s+(?:week|7d)\b/.test(normalized)) {
    return 7;
  }
  return undefined;
}

export function classifyTarvisQuestion(
  question: string,
  history: TarvisConversationTurn[] = [],
): TarvisScope {
  const normalized = question.trim().toLowerCase();
  if (CREDENTIAL_EXTRACTION.test(normalized)) {
    return "sensitive_credentials";
  }
  if (CLEARLY_OFF_TOPIC.test(normalized)) {
    return "off_topic";
  }
  if (
    REVIEWED_TYPE_1_GUIDANCE_SCOPE.test(normalized) ||
    GENERAL_SICK_DAY_SCOPE.test(normalized) ||
    CHILD_SICK_DAY_SCOPE.test(normalized)
  ) {
    return "in_scope";
  }
  if (
    DIABETES_AND_HEALTH_TERMS.some((term) => {
      const escaped = term
        .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
        .replace(/\s+/g, "\\s+");
      return new RegExp(`(?:^|[^a-z0-9])${escaped}(?:$|[^a-z0-9])`, "i").test(
        normalized,
      );
    })
  ) {
    return "in_scope";
  }
  if (PERSONAL_DATA_QUESTION.test(normalized)) {
    return "in_scope";
  }
  if (history.length > 0 && isTarvisDependentFollowUp(normalized)) {
    return "in_scope";
  }
  return "off_topic";
}
