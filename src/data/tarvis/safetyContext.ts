import type { TarvisConversationTurn } from "./types";

type SafetyContext =
  | {
      kind: "subject";
      subject: "child" | "adult-self" | "adult-other";
      gender?: "male" | "female";
    }
  | {
      kind: "reading";
      modality: "blood-ketone" | "urine-ketone" | "ketone" | "glucose";
    };

const TYPE_1 =
  /\b(?:type\s*1(?:\s+diabetes)?|type one(?:\s+diabetes)?|t1d|t1(?!\s*arc\b)(?:\s+diabetes)?)\b/i;
const CHILD_SUBJECT =
  /\b(?:my|our)\s+(?:(?:little|young|teenage|teen)\s+)?(?:boy|girl|son|daughter|child|kid|teen|teenager|young person|niece|nephew|grandson|granddaughter|\d{1,2}(?:(?:[- ]year[- ]old|\s*yo)(?:\s+(?:boy|girl|son|daughter|child|kid))?))\b/i;
const EXPLICIT_ADULT_RELATION =
  /\b(?:my|our)\s+(?:adult\s+(?:son|daughter|child)|grown[- ]up\s+(?:son|daughter|child)|(?:1[89]|[2-9]\d)[- ]year[- ]old\s+(?:son|daughter|child)|(?:son|daughter|child)\s+(?:who\s+is|is|aged?|over)\s+(?:1[89]|[2-9]\d|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety))\b/i;
const RELATED_PERSON =
  /\b(?:my|our)\s+(?:(?:adult|grown[- ]up|grown|(?:1[89]|[2-9]\d)[- ]year[- ]old)\s+)?(son|boy|brother|dad|father|husband|boyfriend|nephew|grandson|daughter|girl|sister|mum|mom|mother|wife|girlfriend|niece|granddaughter|child|kid|teen|teenager|young person|partner|friend)\b/i;
const CHILD_TYPE_1_RELATION =
  /\b(?:(?:has|has got|lives with|was diagnosed with)\s+(?:a\s+)?(?:diagnosis\s+of\s+)?(?:type\s*1(?:\s+diabetes)?|type one(?:\s+diabetes)?|t1d|t1(?!\s*arc\b)(?:\s+diabetes)?)|with\s+(?:type\s*1(?:\s+diabetes)?|type one(?:\s+diabetes)?|t1d|t1(?!\s*arc\b)(?:\s+diabetes)?)|is\s+(?:a\s+)?(?:type\s*1(?:\s+diabetes)?|type one(?:\s+diabetes)?|t1d|t1(?!\s*arc\b)(?:\s+diabetes)?)(?:\s+diabetic)?)\b/i;
const ADULT_TYPE_1_ASSERTION =
  /\b(?:i\s+(?:have(?:\s+got)?|am living with|live with|was diagnosed with)\s+(?:a\s+)?(?:diagnosis\s+of\s+)?(?:type\s*1(?:\s+diabetes)?|type one(?:\s+diabetes)?|t1d|t1(?!\s*arc\b)(?:\s+diabetes)?)|i(?:'ve|\s+have)\s+(?:got|had)\s+(?:type\s*1(?:\s+diabetes)?|type one(?:\s+diabetes)?|t1d|t1(?!\s*arc\b)(?:\s+diabetes)?)|i(?:'m|\s+am)\s+(?:a\s+)?(?:type\s*1(?:\s+diabetes)?|type one(?:\s+diabetes)?|t1d|t1(?!\s*arc\b)(?:\s+diabetes)?)(?:\s+diabetic)?)\b/i;
const CHILD_TYPE_1_NEGATION =
  /\b(?:my|our)\s+(?:son|daughter|child|kid|teen|teenager|young person)\b[\s\S]{0,80}\b(?:does not|doesn't|has not|hasn't|is not|isn't|without)\b[\s\S]{0,30}\b(?:type\s*1|type one|t1d|t1(?!\s*arc\b))\b/i;
const ADULT_TYPE_1_NEGATION =
  /\bi\s+(?:do not|don't|have not|haven't|am not)\b[\s\S]{0,35}\b(?:type\s*1|type one|t1d|t1(?!\s*arc\b))\b/i;
const TYPE_1_UNCERTAINTY =
  /\b(?:think|suspect|wonder|(?:i(?:'m|\s+am)|we(?:'re|\s+are))\s+not sure|may|might|could|possibly|possible|probably|probable|being tested for)\b[\s\S]{0,55}\b(?:type\s*1|type one|t1d|t1(?!\s*arc\b))\b/i;
const ADULT_TYPE_1_UNCERTAINTY =
  /^\s*(?:(?:do|could|can|may|might|would)\s+i|what if i)\b|\bi\s+(?:think|suspect|wonder|am not sure|don't know|do not know)\b[\s\S]{0,45}\b(?:type\s*1|type one|t1d|t1(?!\s*arc\b))\b/i;
const RELATED_TYPE_1_NEGATION =
  /\b(?:my|our)\s+(?:son|daughter|child|kid|teen|teenager|young person|husband|wife|partner|mum|mom|mother|dad|father|friend|boyfriend|girlfriend)\b[\s\S]{0,80}\b(?:does not|doesn't|has not|hasn't|is not|isn't|without)\b[\s\S]{0,30}\b(?:type\s*1|type one|t1d|t1(?!\s*arc\b))\b/i;

const BLOOD_KETONE = /\bblood\s+ketones?\b/i;
const URINE_KETONE =
  /\burine\s+ketones?\b|\burine(?:\s+ketone)?(?:\s+test)?\s+strips?\b/i;
const KETONE = /\bketones?\b/i;
const PERSONAL_KETONE =
  /\b(?:my|our)\s+(?:(?:blood|urine)\s+)?ketone(?:s|\s+(?:test\s+)?strip)\b|\bi\s+(?:(?:just|currently)\s+)?(?:have|have got|checked|am checking|tested|measured)\b[\s\S]{0,40}\b(?:(?:blood|urine)\s+)?ketones?\b|\b(?:mine|this|that|it|these|those|they|the reading|the result)\b[\s\S]{0,25}\b(?:(?:blood|urine)\s+)?ketones?\b/i;
const GLUCOSE =
  /\b(?:glucose|blood sugar|cgm|libre|dexcom|sensor)(?:\s+(?:level|reading))?\b/i;
const PERSONAL_GLUCOSE =
  /\b(?:my|our)\s+(?:(?:current|latest)\s+)?(?:glucose|blood sugar|cgm|libre|dexcom|sensor)(?:\s+(?:level|reading))?\b|\bi(?:'m| am| was)\s+(?:very\s+)?(?:low|hypo)\b|\bi\s+(?:(?:just|currently)\s+)?(?:checked|am checking|tested|measured)\s+(?:my\s+)?(?:glucose|blood sugar|cgm|libre|dexcom|sensor)\b/i;
const PERSONAL_READING =
  /\b(?:my|mine|i(?:'m| am|'ve| have)|we(?:'re| are|'ve| have)|ours|these|those|the reading|the result|checked|checking|tested|testing|measured|measuring)\b/i;
const NON_CURRENT_READING_CONTEXT =
  /\b(?:yesterday|last\s+(?:night|week|month|year)|weeks?\s+ago|months?\s+ago|years?\s+ago|historical(?:ly)?|previously|used to|case study|hypothetical(?:ly)?|for (?:training|education))\b/i;
const EDUCATIONAL_READING_CONTEXT =
  /^\s*(?:what|why|how|when|where|can you|could you|tell me|explain|if|suppose|imagine)\b/i;
const EXPLICIT_CURRENT_READING_CHECK =
  /\bi\s+(?:just\s+)?(?:checked|tested|measured|am\s+checking)\s+(?:my\s+)?(?:(?:blood|urine)\s+)?(?:ketones?|ketone\s+(?:test\s+)?strip|glucose|blood\s+sugar|cgm|libre|dexcom|sensor)\b/i;
const EXPLICIT_CURRENT_READING_ASSERTION =
  /\b(?:my|our)\s+(?:(?:blood|urine)\s+)?ketones?(?:\s+(?:level|reading))?\s+(?:are|is|read|reads|show|shows)\b[^;.!?]{0,55}\b(?:now|currently|right\s+now|today)\b/i;

const NUMERIC_REPLY =
  /^(?:(?:mine|they|it|the reading)\s+(?:is|are|reads?|shows?)\s+)?([<>]=?|[\u2265\u2264])?\s*(\d{1,2}(?:[.,]\d{1,2})?)(?:\s*mmol(?:\/l)?)?(?:\s+(?:now|right now|currently|at the moment))?[.!]?$/i;
const URINE_PLUS_REPLY =
  /^(?:(?:mine|they|it|the reading)\s+(?:is|are|reads?|shows?)\s+)?(\+{1,4}|[1-4]\s*\+|(?:one|two|three|four)\s+plus|plus(?:\s+plus){1,3}|large)(?:\s+(?:now|right now|currently|at the moment))?[.!]?$/i;
const SPOKEN_NUMERIC_REPLY =
  /^(?:(?:mine|they|it|the reading)\s+(?:is|are|reads?|shows?)\s+)?((?:zero|one|two|three|four|five|six|seven|eight|nine|ten)\s+(?:(?:point|dot|decimal|comma)\s+(?:oh|nought|naught|zero|one|two|three|four|five|six|seven|eight|nine)(?:\s+(?:oh|nought|naught|zero|one|two|three|four|five|six|seven|eight|nine))*|and\s+a\s+half))(?:\s+(?:now|right now|currently|at the moment))?[.!]?$/i;

function normalise(text: string) {
  return text
    .trim()
    .normalize("NFKC")
    .replace(/[’‘]/g, "'")
    .replace(/\s+/g, " ");
}

/**
 * Returns only the immediately preceding user turn. One assistant response may
 * sit between it and the new message; older turns are deliberately ignored.
 */
function immediatePreviousUserText(history: TarvisConversationTurn[]) {
  const last = history.at(-1);
  if (last?.role === "user") return last.text;
  if (last?.role !== "assistant") return undefined;
  const previous = history.at(-2);
  return previous?.role === "user" ? previous.text : undefined;
}

function hasMultipleRelatedPeople(text: string) {
  const matcher = new RegExp(RELATED_PERSON.source, "gi");
  const relations = new Set<string>();
  for (const match of text.matchAll(matcher)) {
    const relation = match[1]?.toLowerCase();
    if (relation) relations.add(relation);
  }
  return relations.size > 1;
}

function subjectContext(previous: string): SafetyContext | undefined {
  if (!TYPE_1.test(previous) || hasMultipleRelatedPeople(previous)) {
    return undefined;
  }
  const child = CHILD_SUBJECT.exec(previous);
  if (
    child &&
    !EXPLICIT_ADULT_RELATION.test(previous) &&
    !CHILD_TYPE_1_NEGATION.test(previous) &&
    !TYPE_1_UNCERTAINTY.test(previous)
  ) {
    const childAssertion = previous.slice(
      child.index,
      child.index + child[0].length + 100,
    );
    if (CHILD_TYPE_1_RELATION.test(childAssertion)) {
      return {
        kind: "subject",
        subject: "child",
        gender: relationGender(previous),
      };
    }
  }
  const related = RELATED_PERSON.exec(previous);
  if (
    related &&
    (EXPLICIT_ADULT_RELATION.test(previous) ||
      /^(?:brother|dad|father|husband|boyfriend|sister|mum|mom|mother|wife|girlfriend|partner|friend)$/.test(
        related[1]?.toLowerCase() ?? "",
      )) &&
    !RELATED_TYPE_1_NEGATION.test(previous) &&
    !TYPE_1_UNCERTAINTY.test(previous)
  ) {
    const relatedAssertion = previous.slice(
      related.index,
      related.index + related[0].length + 100,
    );
    if (CHILD_TYPE_1_RELATION.test(relatedAssertion)) {
      return {
        kind: "subject",
        subject: "adult-other",
        gender: relationGender(previous),
      };
    }
  }
  if (
    ADULT_TYPE_1_ASSERTION.test(previous) &&
    !ADULT_TYPE_1_NEGATION.test(previous) &&
    !TYPE_1_UNCERTAINTY.test(previous) &&
    !ADULT_TYPE_1_UNCERTAINTY.test(previous) &&
    !/^\s*(?:if|suppose|imagine|hypothetically)\b/i.test(previous)
  ) {
    return { kind: "subject", subject: "adult-self" };
  }
  return undefined;
}

function relationGender(text: string): "male" | "female" | undefined {
  const relation = RELATED_PERSON.exec(text)?.[1]?.toLowerCase();
  if (!relation) return undefined;
  if (
    /^(?:son|boy|brother|dad|father|husband|boyfriend|nephew|grandson)$/.test(
      relation,
    )
  ) {
    return "male";
  }
  if (
    /^(?:daughter|girl|sister|mum|mom|mother|wife|girlfriend|niece|granddaughter)$/.test(
      relation,
    )
  ) {
    return "female";
  }
  return undefined;
}

function readingContext(previous: string): SafetyContext | undefined {
  if (
    previous.length > 280 ||
    (NON_CURRENT_READING_CONTEXT.test(previous) &&
      !EXPLICIT_CURRENT_READING_CHECK.test(previous) &&
      !EXPLICIT_CURRENT_READING_ASSERTION.test(previous)) ||
    EDUCATIONAL_READING_CONTEXT.test(previous) ||
    !PERSONAL_READING.test(previous)
  ) {
    return undefined;
  }

  const personalKetone = PERSONAL_KETONE.test(previous);
  const bloodKetone = personalKetone && BLOOD_KETONE.test(previous);
  const urineKetone = personalKetone && URINE_KETONE.test(previous);
  const genericKetone =
    personalKetone && !bloodKetone && !urineKetone && KETONE.test(previous);
  const glucose = GLUCOSE.test(previous) && PERSONAL_GLUCOSE.test(previous);
  const matches = [bloodKetone, urineKetone, genericKetone, glucose].filter(
    Boolean,
  ).length;
  if (matches !== 1) return undefined;
  if (bloodKetone) return { kind: "reading", modality: "blood-ketone" };
  if (urineKetone) return { kind: "reading", modality: "urine-ketone" };
  if (genericKetone) return { kind: "reading", modality: "ketone" };
  return { kind: "reading", modality: "glucose" };
}

function currentSymptom(question: string, expectedGender?: "male" | "female") {
  const statedGender = /^(?:he|his)\b/i.test(question)
    ? "male"
    : /^(?:she|her)\b/i.test(question)
      ? "female"
      : undefined;
  if (expectedGender && statedGender && expectedGender !== statedGender) {
    return undefined;
  }
  if (
    /^(?:she|he|they)\s+(?:has|have)(?:\s+got)?\s+(?:tummy|stomach|abdominal)\s+(?:pain|ache)(?:\s+now)?[.!]?$/i.test(
      question,
    )
  ) {
    return "has tummy pain now";
  }
  if (
    /^(?:(?:she|he)(?:'s|\s+is)|they(?:'re|\s+are))\s+(?:vomiting|throwing up|being sick)(?:\s+now)?[.!]?$/i.test(
      question,
    )
  ) {
    return "is vomiting now";
  }
  if (
    /^(?:(?:she|he)(?:'s|\s+is)|they(?:'re|\s+are))\s+(?:(?:taking\s+)?(?:very\s+)?(?:deep|rapid|fast)\s+breaths?|breathing\s+(?:very\s+)?(?:deeply|rapidly|fast))(?:\s+now)?[.!]?$/i.test(
      question,
    )
  ) {
    return "is taking very deep breaths now";
  }
  if (
    /^(?:(?:she|he)(?:'s|\s+is)|they(?:'re|\s+are))\s+dehydrated(?:\s+now)?[.!]?$/i.test(
      question,
    )
  ) {
    return "is dehydrated now";
  }
  if (
    /^(?:she|he|they)\s+(?:cannot|can't)\s+keep\s+(?:anything|food|fluids?|liquids?|water|drinks?)\s+down(?:\s+now)?[.!]?$/i.test(
      question,
    )
  ) {
    return "cannot keep fluids down now";
  }
  if (
    /^(?:she|he|they)\s+feels?\s+(?:sick|nauseous|unwell)(?:\s+now)?[.!]?$/i.test(
      question,
    )
  ) {
    return "feels sick now";
  }
  if (
    /^(?:her|his|their)\s+(?:tummy|stomach|abdomen)\s+(?:hurts|aches)(?:\s+now)?[.!]?$/i.test(
      question,
    )
  ) {
    return "has tummy pain now";
  }
  return undefined;
}

function currentAdultSymptom(question: string) {
  if (
    /^i\s+have(?:\s+got)?\s+(?:tummy|stomach|abdominal)\s+(?:pain|ache)(?:\s+now)?[.!]?$/i.test(
      question,
    )
  ) {
    return "I have stomach pain now";
  }
  if (
    /^i\s+(?:feel|am feeling)\s+(?:sick|nauseous|unwell)(?:\s+now)?[.!]?$/i.test(
      question,
    )
  ) {
    return "I feel sick now";
  }
  if (
    /^i(?:'m|\s+am)\s+(?:vomiting|throwing up|being sick)(?:\s+now)?[.!]?$/i.test(
      question,
    )
  ) {
    return "I am vomiting now";
  }
  if (/^i(?:'m|\s+am)\s+dehydrated(?:\s+now)?[.!]?$/i.test(question)) {
    return "I am dehydrated now";
  }
  return undefined;
}

/**
 * Builds a local-only prompt for the deterministic safety preflight. It does
 * not add history to model or scope routes, and returns the original question
 * unless both the last user turn and the terse reply match a strict allowlist.
 */
export function safetyQuestionWithImmediateContext(
  question: string,
  history: TarvisConversationTurn[],
) {
  const current = normalise(question);
  const previousRaw = immediatePreviousUserText(history);
  if (!previousRaw || current.length > 100) return question;
  const previous = normalise(previousRaw);
  if (!previous || previous.length > 280) return question;

  const subject = subjectContext(previous);
  if (subject?.kind === "subject") {
    if (subject.subject === "child") {
      const symptom = currentSymptom(current, subject.gender);
      if (symptom) return `My child with Type 1 diabetes ${symptom}.`;
    } else if (subject.subject === "adult-self") {
      const symptom = currentAdultSymptom(current);
      if (symptom) return `I have Type 1 diabetes. ${symptom}.`;
    } else {
      const symptom = currentSymptom(current, subject.gender);
      if (symptom) return `My partner with Type 1 diabetes ${symptom}.`;
    }
  }

  const reading = readingContext(previous);
  if (reading?.kind !== "reading") return question;
  if (reading.modality === "urine-ketone") {
    const plus = URINE_PLUS_REPLY.exec(current)?.[1];
    return plus ? `My urine ketones are ${plus} now.` : question;
  }

  const numeric = NUMERIC_REPLY.exec(current);
  const spoken = SPOKEN_NUMERIC_REPLY.exec(current);
  if (!numeric && !spoken) return question;
  const numericText = numeric?.[2] ?? spoken?.[1];
  if (!numericText) return question;
  if (numeric) {
    const value = Number(numericText.replace(",", "."));
    if (!Number.isFinite(value) || value > 50) return question;
  }
  const comparator = numeric?.[1] ? `${numeric[1]} ` : "";
  if (reading.modality === "blood-ketone") {
    return `My blood ketones are ${comparator}${numericText} mmol/L now.`;
  }
  if (reading.modality === "ketone") {
    return `My ketones are ${comparator}${numericText} mmol/L now.`;
  }
  return `My glucose is ${comparator}${numericText} mmol/L now.`;
}
