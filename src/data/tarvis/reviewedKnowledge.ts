import type { TarvisReviewedKnowledgeItem } from "./types";
import { isTarvisDependentFollowUp } from "./scope";
import { getRuntimeRegionalDefaults } from "@/domain/regionalProfileRuntime";

export const NICE_TYPE_1_EXERCISE_KNOWLEDGE: TarvisReviewedKnowledgeItem = {
  id: "nice-ng17-type-1-physical-activity",
  jurisdiction: "UK",
  summary:
    "NICE says that, when insulin levels are adequate, physical activity is likely to lower glucose. It also says that, when someone is both hyperglycaemic and hypoinsulinaemic, physical activity can worsen hyperglycaemia and ketonaemia may occur. Its guidance treats the response as individual and asks people to consider glucose monitoring and changed insulin or nutritional needs during, immediately after, and for 24 hours after activity. A recorded insulin or notification-reported IOB value does not prove that physiological insulin levels were adequate. For a retrospective answer, these recommendations support a cautious interpretation of recorded timing, but never prove what caused one event or justify a dose recommendation. NICE describes its guidelines as recommendations for England and Wales; Scotland and Northern Ireland decide separately how they apply.",
  sourceTitle:
    "NICE NG17: Type 1 diabetes in adults — physical activity recommendations",
  sourceUrl: "https://www.nice.org.uk/guidance/ng17/chapter/recommendations",
  recommendationRefs: ["1.5.1", "1.5.2"],
  reviewedAt: "2026-08-25",
};

export const NICE_TYPE_1_SICK_DAY_KNOWLEDGE: TarvisReviewedKnowledgeItem = {
  id: "nice-ng17-type-1-sick-day-rules",
  jurisdiction: "UK",
  summary:
    "NICE says every adult with Type 1 diabetes should receive clear sick-day rules that explain how to adjust insulin when ill. It recommends considering blood or urine ketone monitoring as part of those rules and supports more frequent testing during illness for people using capillary glucose monitoring. NICE NG17 does not provide one universal insulin-adjustment algorithm for every adult, so Tarv1s must not invent doses or replace the user’s own diabetes-team plan. Separately, T1 Arc’s deterministic urgent-safety check takes priority when a question describes current severe symptoms, suspected DKA or immediate danger. NICE describes its guidelines as recommendations for England and Wales; Scotland and Northern Ireland decide separately how they apply.",
  sourceTitle:
    "NICE NG17: Type 1 diabetes in adults — sick-day rules and ketone monitoring",
  sourceUrl: "https://www.nice.org.uk/guidance/ng17/chapter/recommendations",
  recommendationRefs: ["1.6.20", "1.7.23", "1.10.1"],
  reviewedAt: "2026-08-26",
};

export const NICE_TYPE_1_CHILD_SICK_DAY_KNOWLEDGE: TarvisReviewedKnowledgeItem =
  {
    id: "nice-ng18-type-1-child-sick-day-rules",
    jurisdiction: "UK",
    summary:
      "NICE says children and young people with Type 1 diabetes and their families or carers should receive individualised oral and written sick-day rules for illness or hyperglycaemia. The rules should cover monitoring glucose, monitoring and interpreting blood ketones, adjusting the insulin regimen, food and fluid intake, and when and where to get further advice or help, and should be revisited at least annually. NICE also says to offer blood ketone testing strips and a meter and to test for ketonaemia during illness or hyperglycaemia; children and young people using capillary glucose monitoring often need more frequent testing during illness. These recommendations describe what the child or young person’s individualised sick-day plan should cover, not a universal insulin-adjustment formula. Separately, T1 Arc’s deterministic urgent-safety check takes priority when a question describes current severe symptoms, suspected DKA or immediate danger. NICE describes its guidelines as recommendations for England and Wales; Scotland and Northern Ireland decide separately how they apply.",
    sourceTitle:
      "NICE NG18: Diabetes in children and young people — Type 1 sick-day rules and blood ketone monitoring",
    sourceUrl: "https://www.nice.org.uk/guidance/ng18/chapter/Recommendations",
    recommendationRefs: ["1.2.72", "1.2.82", "1.2.83"],
    reviewedAt: "2026-08-26",
  };

const SICK_DAY_LANGUAGE =
  /\b(?:sick[- ]?days?|sick|illness|ill\b|unwell|poorly|flu|stomach bug|tummy bug|diarrh(?:oe|e)a|ketones?|dka|diabetic ketoacidosis|vomiting|being sick)\b/i;
const EXERCISE_LANGUAGE =
  /\b(?:physical activity|exercise|walk(?:ed|ing)?|hik(?:e|ed|ing)|run|ran|running|jog(?:ged|ging)?|cycle|cycled|cycling|swim|swam|swimming|strength training|weight training|workout|gym|sport)\b/i;
const CHILD_OR_YOUNG_PERSON_LANGUAGE =
  /\b(?:child|children|kids?|schoolchild(?:ren)?|school[- ]age(?:d)?(?:\s+(?:child|patient|person))?|bab(?:y|ies)|infants?|toddlers?|pre[- ]?schoolers?|newborns?|little\s+(?:girl|boy|one)|wee\s+one|young[- ](?:person|people)|young\s+(?:son|daughter|niece|nephew)|adolescents?|minors|minor(?!\s+(?:illness|condition|injury|symptom|problem))|youths?|teen(?:ager)?s?|teenage|(?:my|our)\s+(?:girl|boy)|paediatric|pediatric|under[- ]?(?:[0-9]|1[0-8])s?|(?:under|younger\s+than)\s+(?:(?:the\s+)?age\s+of\s+)?(?:18|eighteen)|below\s+(?:(?:the\s+)?age\s+of\s+)?(?:18|eighteen)|(?:[0-9]|1[0-7])\s*(?:yo|y\/o|[- ]year[- ]old| years? old)|aged?\s+(?:[0-9]|1[0-7]))\b/i;
const EXPLICIT_ADULT_PERSON_LANGUAGE =
  /\b(?:(?:adult|grown[- ]up|grown)\s+child|child\s+(?:over|older\s+than|at\s+least)\s+18)\b/i;
const AMBIGUOUS_RELATIONSHIP_LANGUAGE =
  /\b(?:my|our)\s+(?:(?:younger|youngest|eldest|elder|older|oldest)\s+)?(?:son|daughter|stepson|stepdaughter|niece|nephew|grandson|granddaughter|grandchild)\b/i;
const AGE_WORD_VALUES: Readonly<Record<string, number>> = {
  zero: 0,
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
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
};
const EXPLICIT_REVIEWED_KNOWLEDGE_LANGUAGE =
  /\b(?:nice|guidance|guidelines?|sick[- ]?days?(?:\s+rules?)?|(?:rules?|advice)\s+(?:for|when)\s+(?:i am |i'm )?(?:ill|unwell|poorly))\b/i;
const GENERAL_EDUCATION_LANGUAGE =
  /^(?:why\b|what (?:are|is|happens?|should\b|do i need to know)\b|how (?:do|does|can|should)\b|tell me (?:about|how)\b|help me understand\b|i (?:would|'d) like to (?:know|understand)\b|advice\b|(?:(?:can|could) you\s+)?explain\b)/i;
const DIRECT_SICK_DAY_ADVICE =
  /(?=[\s\S]*\b(?:ill|illness|unwell|poorly|sick|flu|stomach bug|tummy bug)\b)(?=[\s\S]*\b(?:what should i do|how should i manage|what do i need to know|advice|sick[- ]?day rules?)\b)/i;
const PERSONAL_EVENT_LANGUAGE =
  /\b(?:mine|yesterday|today|tonight|this (?:morning|afternoon|evening|week|month)|last (?:night|week|month|monday|tuesday|wednesday|thursday|friday|saturday|sunday)|earlier|ago|i (?:had|was|did|went|walked|ran|cycled|swam|exercised|worked out|ate|took|used|have been|am currently)|my (?:glucose|blood sugar|sugar|readings?|low|high|meal|exercise|walk|workout|data|records?|insulin|bolus|basal|sensor) (?:was|were|went|fell|dropped|rose|spiked|changed)|(?:compare|review|analyse|analyze) my (?:glucose|blood sugar|sugar|readings?|data|records?))\b/i;

function normaliseQuestion(question: string) {
  return question
    .normalize("NFKC")
    .replace(/[’‘]/g, "'")
    .replace(/[‐‑‒–—]/g, "-");
}

function ageFromWords(raw: string) {
  const parts = raw
    .toLowerCase()
    .split(/[\s-]+/)
    .filter(Boolean);
  if (parts.length === 0 || parts.length > 2) return undefined;
  const [firstPart, secondPart] = parts;
  if (!firstPart) return undefined;
  const first = AGE_WORD_VALUES[firstPart];
  if (first === undefined) return undefined;
  if (parts.length === 1) return first;
  if (!secondPart) return undefined;
  const second = AGE_WORD_VALUES[secondPart];
  if (second === undefined || first < 20 || second >= 10) return undefined;
  return first + second;
}

function explicitAge(question: string) {
  const numericHalfYears = question.match(
    /\b(\d{1,2})[- ]and[- ]a[- ]half[- ]years?[- ]old\b/i,
  )?.[1];
  if (numericHalfYears !== undefined) return Number(numericHalfYears) + 0.5;

  const numericMonths = question.match(/\b(\d{1,3})[- ]months?[- ]old\b/i)?.[1];
  if (numericMonths !== undefined) return Number(numericMonths) / 12;

  const spokenMonths = question.match(
    /\b(zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty)[- ]months?[- ]old\b/i,
  )?.[1];
  if (spokenMonths !== undefined) {
    const months = ageFromWords(spokenMonths);
    if (months !== undefined) return months / 12;
  }

  const spokenHalfYears = question.match(
    /\b(zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen)[- ]and[- ]a[- ]half[- ]years?[- ]old\b/i,
  )?.[1];
  if (spokenHalfYears !== undefined) {
    const years = ageFromWords(spokenHalfYears);
    if (years !== undefined) return years + 0.5;
  }

  const numericYearsOfAge = question.match(
    /\b(\d{1,2})\s+years?\s+of\s+age\b/i,
  )?.[1];
  if (numericYearsOfAge !== undefined) return Number(numericYearsOfAge);

  const spokenYearsOfAge = question.match(
    /\b(zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty)\s+years?\s+of\s+age\b/i,
  )?.[1];
  if (spokenYearsOfAge !== undefined) {
    return ageFromWords(spokenYearsOfAge);
  }

  const numeric = question.match(
    /\b(?:(?:aged?|age|who is|who's|i am|i'm|(?:my|our)\s+(?:(?:younger|youngest|eldest|elder|older|oldest)\s+)?(?:child|son|daughter|stepson|stepdaughter|niece|nephew|grandson|granddaughter|grandchild)\s+(?:is|was))\s+(\d{1,2})|(\d{1,2})\s*(?:yo|y\/o|[- ]*(?:yrs?\.?|years?)[- ]*old))\b/i,
  );
  const numericValue = numeric?.slice(1).find((value) => value !== undefined);
  if (numericValue !== undefined) return Number(numericValue);

  const numberWords =
    "(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty(?:[- ](?:one|two|three|four|five|six|seven|eight|nine))?|thirty(?:[- ](?:one|two|three|four|five|six|seven|eight|nine))?|forty(?:[- ](?:one|two|three|four|five|six|seven|eight|nine))?|fifty(?:[- ](?:one|two|three|four|five|six|seven|eight|nine))?|sixty(?:[- ](?:one|two|three|four|five|six|seven|eight|nine))?|seventy(?:[- ](?:one|two|three|four|five|six|seven|eight|nine))?|eighty(?:[- ](?:one|two|three|four|five|six|seven|eight|nine))?|ninety(?:[- ](?:one|two|three|four|five|six|seven|eight|nine))?)";
  const spoken = question.match(
    new RegExp(
      `\\b(?:(?:aged?|age|who is|who's|i am|i'm|(?:my|our)\\s+(?:(?:younger|youngest|eldest|elder|older|oldest)\\s+)?(?:child|son|daughter|stepson|stepdaughter|niece|nephew|grandson|granddaughter|grandchild)\\s+(?:is|was))\\s+(${numberWords})|(${numberWords})\\s*(?:yo|y\\/o|[- ]*(?:yrs?\\.?|years?)[- ]*old))\\b`,
      "i",
    ),
  );
  const spokenValue = spoken?.slice(1).find((value) => value !== undefined);
  return spokenValue === undefined ? undefined : ageFromWords(spokenValue);
}

const REVIEWED_KNOWLEDGE = [
  NICE_TYPE_1_CHILD_SICK_DAY_KNOWLEDGE,
  NICE_TYPE_1_SICK_DAY_KNOWLEDGE,
  NICE_TYPE_1_EXERCISE_KNOWLEDGE,
] as const;

export function tarvisReviewedKnowledgeByIds(
  knowledgeIds: readonly string[],
): TarvisReviewedKnowledgeItem[] {
  const selected = new Set(knowledgeIds);
  const childSickDaySelected = selected.has(
    NICE_TYPE_1_CHILD_SICK_DAY_KNOWLEDGE.id,
  );
  return REVIEWED_KNOWLEDGE.filter(
    ({ id }) =>
      selected.has(id) &&
      (!childSickDaySelected ||
        (id !== NICE_TYPE_1_SICK_DAY_KNOWLEDGE.id &&
          id !== NICE_TYPE_1_EXERCISE_KNOWLEDGE.id)),
  ).map((item) => ({
    ...item,
    recommendationRefs: [...item.recommendationRefs],
  }));
}

export function isTarvisReviewedKnowledgeQuestion(question: string) {
  const normalised = normaliseQuestion(question).trim();
  if (DIRECT_SICK_DAY_ADVICE.test(normalised)) return true;
  if (PERSONAL_EVENT_LANGUAGE.test(normalised)) return false;
  if (EXPLICIT_REVIEWED_KNOWLEDGE_LANGUAGE.test(normalised)) return true;
  return (
    GENERAL_EDUCATION_LANGUAGE.test(normalised) &&
    (SICK_DAY_LANGUAGE.test(normalised) || EXERCISE_LANGUAGE.test(normalised))
  );
}

export function isTarvisExplicitReviewedKnowledgeRequest(question: string) {
  return EXPLICIT_REVIEWED_KNOWLEDGE_LANGUAGE.test(
    normaliseQuestion(question).trim(),
  );
}

export function selectTarvisReviewedKnowledge(
  question: string,
): TarvisReviewedKnowledgeItem[] {
  const normalised = normaliseQuestion(question);
  const jurisdiction = getRuntimeRegionalDefaults().clinicalJurisdiction;
  if (jurisdiction !== "GB" && !/\bnice\b/i.test(normalised)) {
    return [];
  }
  const age = explicitAge(normalised);
  if (age !== undefined && age < 18) {
    return SICK_DAY_LANGUAGE.test(normalised)
      ? [NICE_TYPE_1_CHILD_SICK_DAY_KNOWLEDGE]
      : [];
  }
  if (
    (age !== undefined && age >= 18) ||
    EXPLICIT_ADULT_PERSON_LANGUAGE.test(normalised)
  ) {
    const adult: TarvisReviewedKnowledgeItem[] = [];
    if (SICK_DAY_LANGUAGE.test(normalised)) {
      adult.push(NICE_TYPE_1_SICK_DAY_KNOWLEDGE);
    }
    if (EXERCISE_LANGUAGE.test(normalised)) {
      adult.push(NICE_TYPE_1_EXERCISE_KNOWLEDGE);
    }
    return adult;
  }
  if (CHILD_OR_YOUNG_PERSON_LANGUAGE.test(normalised)) {
    return SICK_DAY_LANGUAGE.test(normalised)
      ? [NICE_TYPE_1_CHILD_SICK_DAY_KNOWLEDGE]
      : [];
  }
  if (AMBIGUOUS_RELATIONSHIP_LANGUAGE.test(normalised)) {
    return [];
  }
  const selected: TarvisReviewedKnowledgeItem[] = [];
  if (SICK_DAY_LANGUAGE.test(normalised)) {
    selected.push(NICE_TYPE_1_SICK_DAY_KNOWLEDGE);
  }
  if (EXERCISE_LANGUAGE.test(normalised)) {
    selected.push(NICE_TYPE_1_EXERCISE_KNOWLEDGE);
  }
  return selected;
}

export function resolveTarvisReviewedKnowledgeForTurn({
  educationRoute,
  previousKnowledgeIds,
  question,
}: {
  educationRoute: boolean;
  previousKnowledgeIds?: readonly string[];
  previousQuestion?: string;
  question: string;
}) {
  const direct =
    educationRoute || isTarvisReviewedKnowledgeQuestion(question)
      ? selectTarvisReviewedKnowledge(question)
      : [];
  if (direct.length > 0 || !isTarvisDependentFollowUp(question)) return direct;
  return previousKnowledgeIds
    ? tarvisReviewedKnowledgeByIds(previousKnowledgeIds)
    : ([] satisfies TarvisReviewedKnowledgeItem[]);
}
