import type { TarvisAnswer, TarvisRetrospectiveEvidencePacket } from "./types";
import { NICE_TYPE_1_EXERCISE_KNOWLEDGE } from "./reviewedKnowledge";

export const TARVIS_RETROSPECTIVE_CLAIM_IDS = [
  "activity-timing-could-have-contributed",
  "activity-with-adequate-insulin-may-lower-glucose",
  "activity-when-hyperglycaemic-and-hypoinsulinaemic-may-worsen",
  "recorded-iob-does-not-prove-insulin-adequacy",
] as const;

export const TARVIS_RETROSPECTIVE_LEAD_STYLES = [
  "direct-cautious",
  "timeline-first",
  "uncertainty-first",
] as const;

export const TARVIS_RETROSPECTIVE_CLOSING_STYLES = [
  "none",
  "offer-evidence",
  "offer-limitations",
] as const;

type RetrospectiveClaimId = (typeof TARVIS_RETROSPECTIVE_CLAIM_IDS)[number];
type RetrospectiveLeadStyle = (typeof TARVIS_RETROSPECTIVE_LEAD_STYLES)[number];
type RetrospectiveClosingStyle =
  (typeof TARVIS_RETROSPECTIVE_CLOSING_STYLES)[number];

interface ApprovedRetrospectiveClaim {
  id: RetrospectiveClaimId;
  meaning: string;
  evidenceIds: string[];
  knowledgeIds: string[];
  localCopy: string;
}

interface RetrospectiveClaimSelection {
  claimId: RetrospectiveClaimId;
  evidenceIds: string[];
  knowledgeIds: string[];
  bridgeText: string;
}

interface RetrospectiveNarrativePlan {
  leadStyle: RetrospectiveLeadStyle;
  leadText: string;
  claims: RetrospectiveClaimSelection[];
  closingStyle: RetrospectiveClosingStyle;
  closingText: string;
}

const MAX_CLAIMS = 4;
const MAX_MODEL_EVIDENCE_REFERENCES = 5;
const MAX_HOSTED_CONNECTOR_CHARACTERS = 720;

const COMMON_CONNECTOR_WORDS = new Set([
  "a",
  "an",
  "and",
  "as",
  "at",
  "be",
  "but",
  "can",
  "can't",
  "from",
  "give",
  "gives",
  "here",
  "here's",
  "how",
  "i",
  "i'd",
  "i'll",
  "i'm",
  "i've",
  "if",
  "in",
  "it",
  "its",
  "keep",
  "let's",
  "like",
  "make",
  "makes",
  "me",
  "more",
  "most",
  "my",
  "not",
  "of",
  "on",
  "see",
  "so",
  "start",
  "stay",
  "still",
  "that",
  "that's",
  "the",
  "them",
  "then",
  "this",
  "through",
  "to",
  "want",
  "way",
  "we",
  "we'll",
  "what",
  "where",
  "why",
  "with",
  "you",
  "you'd",
  "you'll",
  "you're",
  "your",
]);

const CONNECTOR_WORDS = {
  lead: new Set([
    ...COMMON_CONNECTOR_WORDS,
    "answer",
    "best",
    "careful",
    "carefully",
    "cautious",
    "certain",
    "clearest",
    "context",
    "facts",
    "honest",
    "honestly",
    "order",
    "part",
    "possibilities",
    "question",
    "reading",
    "recorded",
    "records",
    "sense",
    "separate",
    "sequence",
    "timeline",
    "uncertain",
    "uncertainty",
    "understand",
    "useful",
  ]),
  bridge: new Set([
    ...COMMON_CONNECTOR_WORDS,
    "context",
    "fits",
    "matters",
    "next",
    "part",
    "point",
    "reading",
    "reasoning",
  ]),
  closing: new Set([
    ...COMMON_CONNECTOR_WORDS,
    "closely",
    "evidence",
    "limits",
    "look",
    "records",
    "together",
    "uncertainty",
  ]),
} as const;

function fallbackAnswer(
  packet: TarvisRetrospectiveEvidencePacket,
): TarvisAnswer {
  return {
    headline: packet.verifiedReview.headline,
    answer: packet.verifiedReview.chronology,
    confidence: packet.verifiedReview.confidence,
    evidenceIds: packet.evidence.map(({ id }) => id),
    limitations: [...packet.verifiedReview.limitations],
  };
}

function evidenceIdForLabel(
  packet: TarvisRetrospectiveEvidencePacket,
  label: string,
) {
  return packet.evidence.find((item) => item.label === label)?.id;
}

function approvedClaims(
  packet: TarvisRetrospectiveEvidencePacket,
): ApprovedRetrospectiveClaim[] {
  const exerciseKnowledgeAvailable = packet.reviewedKnowledge.some(
    ({ id }) => id === NICE_TYPE_1_EXERCISE_KNOWLEDGE.id,
  );
  if (!exerciseKnowledgeAvailable) return [];

  const knowledgeIds = [NICE_TYPE_1_EXERCISE_KNOWLEDGE.id];
  const activityId = evidenceIdForLabel(packet, "Recorded activity");
  const glucoseId = evidenceIdForLabel(packet, "Glucose around the activity");
  const iobId = evidenceIdForLabel(packet, "Notification-reported IOB");
  const loweringEvent =
    packet.verifiedReview.eventObserved &&
    (packet.verifiedReview.eventKind === "low" ||
      packet.verifiedReview.eventKind === "drop");
  const risingEvent =
    packet.verifiedReview.eventObserved &&
    packet.verifiedReview.eventKind === "high";
  const claims: ApprovedRetrospectiveClaim[] = [];

  if (
    activityId &&
    glucoseId &&
    loweringEvent &&
    packet.verifiedReview.activityContributionSupported
  ) {
    claims.push({
      id: "activity-timing-could-have-contributed",
      meaning:
        "Select only when the recorded activity and glucose timing make activity a cautious possible contributor, without asserting causation.",
      evidenceIds: [activityId, glucoseId],
      knowledgeIds,
      localCopy:
        "One cautious interpretation is that the activity could have contributed to the recorded glucose change. NICE says activity is likely to lower glucose when insulin levels are adequate, but these records don’t establish physiological insulin adequacy or prove what caused this event.",
    });
  }

  if (
    loweringEvent &&
    !claims.some(({ id }) => id === "activity-timing-could-have-contributed")
  ) {
    claims.push({
      id: "activity-with-adequate-insulin-may-lower-glucose",
      meaning:
        "Select when the NICE conditional about activity lowering glucose with adequate insulin helps explain the event in general terms.",
      evidenceIds: [],
      knowledgeIds,
      localCopy:
        "NICE says physical activity is likely to lower glucose when insulin levels are adequate. That is general guidance, not proof of what happened in this event.",
    });
  }
  if (risingEvent) {
    claims.push({
      id: "activity-when-hyperglycaemic-and-hypoinsulinaemic-may-worsen",
      meaning:
        "Select when the contrasting NICE condition is relevant; never imply that the user met this condition unless their records establish it.",
      evidenceIds: [],
      knowledgeIds,
      localCopy:
        "NICE also makes the contrasting condition explicit: when someone is both hyperglycaemic and hypoinsulinaemic, physical activity can worsen hyperglycaemia and ketonaemia may occur.",
    });
  }

  if (iobId) {
    claims.push({
      id: "recorded-iob-does-not-prove-insulin-adequacy",
      meaning:
        "Select when notification-reported IOB is present and its evidential limitation matters.",
      evidenceIds: [iobId],
      knowledgeIds,
      localCopy:
        "The notification-reported IOB is useful timing context, but it doesn’t prove that physiological insulin levels were adequate.",
    });
  }

  return claims;
}

/**
 * Supplies the model with a closed menu. The model personalises emphasis,
 * order and companion-style presentation, while the app maps the accepted
 * plan back to reviewed local wording after validating every claim's exact
 * provenance.
 */
export function tarvisRetrospectiveClaimOptions(
  packet: TarvisRetrospectiveEvidencePacket,
) {
  return approvedClaims(packet).map(
    ({ id, meaning, evidenceIds, knowledgeIds }) => ({
      id,
      meaning,
      evidenceIds,
      knowledgeIds,
    }),
  );
}

function strictStringIds(value: unknown) {
  if (
    !Array.isArray(value) ||
    !value.every((item) => typeof item === "string")
  ) {
    return undefined;
  }
  if (new Set(value).size !== value.length) return undefined;
  return value as string[];
}

function sameIds(actual: readonly string[], expected: readonly string[]) {
  return (
    actual.length === expected.length &&
    actual.every((id, index) => id === expected[index])
  );
}

function isExactEnumValue<T extends string>(
  value: unknown,
  allowed: readonly T[],
): value is T {
  return typeof value === "string" && allowed.includes(value as T);
}

type ConnectorSlot = keyof typeof CONNECTOR_WORDS;

const FORBIDDEN_UNICODE =
  /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/;

function connectorTokens(value: string) {
  return value.toLowerCase().match(/[a-z]+(?:'[a-z]+)?/g) ?? [];
}

function normaliseConnectorText(
  value: unknown,
  slot: ConnectorSlot,
): string | undefined {
  if (typeof value !== "string" || FORBIDDEN_UNICODE.test(value)) {
    return undefined;
  }
  // Optional framing must not force filler. Only an exact empty value bypasses
  // prose checks; nonempty text retains the same closed vocabulary and guards.
  if (value === "" && slot !== "closing") return "";
  const text = value
    .normalize("NFKC")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u2010-\u2015]/g, "-")
    .trim()
    .replace(/[ \t]+/g, " ");
  const limits =
    slot === "lead"
      ? { minimum: 20, maximum: 180, minimumWords: 4, maximumWords: 40 }
      : slot === "bridge"
        ? { minimum: 10, maximum: 100, minimumWords: 3, maximumWords: 22 }
        : { minimum: 20, maximum: 140, minimumWords: 4, maximumWords: 30 };
  if (
    text.length < limits.minimum ||
    text.length > limits.maximum ||
    /[^A-Za-z ,.!?']/.test(text) ||
    /[.!?]{2,}/.test(text)
  ) {
    return undefined;
  }
  const withoutContractions = text.replace(/[A-Za-z]+'[A-Za-z]+/g, "");
  if (withoutContractions.includes("'")) return undefined;
  const tokens = connectorTokens(text);
  if (
    tokens.length < limits.minimumWords ||
    tokens.length > limits.maximumWords ||
    /\byou can\b/i.test(text) ||
    tokens.some((token) => !CONNECTOR_WORDS[slot].has(token))
  ) {
    return undefined;
  }
  const terminators = text.match(/[.!?]/g)?.length ?? 0;
  if (!/[.!?]$/.test(text)) return undefined;
  if (slot === "lead" && (terminators < 1 || terminators > 2)) {
    return undefined;
  }
  if (slot !== "lead" && terminators !== 1) return undefined;
  if (slot === "bridge" && text.endsWith("?")) return undefined;
  return text;
}

function validLeadText(text: string, style: RetrospectiveLeadStyle) {
  const lower = text.toLowerCase();
  const tokens = new Set(connectorTokens(text));
  const startsSafely = /^(?:i\b|we\b|let's\b|here's\b|this\b)/i.test(text);
  const sharedVoice =
    tokens.has("i") || tokens.has("we") || tokens.has("let's");
  const framing = [
    "answer",
    "context",
    "question",
    "reading",
    "sense",
    "sequence",
    "timeline",
    "uncertainty",
  ].some((token) => tokens.has(token));
  if (!startsSafely || !sharedVoice || !framing || /\byou can\b/.test(lower)) {
    return false;
  }
  if (tokens.has("certain") && !lower.includes("can't be certain")) {
    return false;
  }
  if (style === "direct-cautious") {
    return ["careful", "carefully", "cautious", "honest", "honestly"].some(
      (token) => tokens.has(token),
    );
  }
  if (style === "timeline-first") {
    return ["order", "sequence", "timeline"].some((token) => tokens.has(token));
  }
  return (
    tokens.has("uncertainty") ||
    tokens.has("uncertain") ||
    lower.includes("can't be certain")
  );
}

function validBridgeText(text: string) {
  if (!/^(?:that|this|the|it)\b/i.test(text)) return false;
  const tokens = new Set(connectorTokens(text));
  return ["context", "fits", "matters", "next", "part", "point"].some((token) =>
    tokens.has(token),
  );
}

function validClosingText(
  text: string,
  style: Exclude<RetrospectiveClosingStyle, "none">,
) {
  const lower = text.toLowerCase();
  if (!/^(?:if you'd like|we can)\b/.test(lower) || /\byou can\b/.test(lower)) {
    return false;
  }
  const tokens = new Set(connectorTokens(text));
  return style === "offer-evidence"
    ? tokens.has("evidence") || tokens.has("records")
    : tokens.has("limits") || tokens.has("uncertainty");
}

function sentenceKeys(text: string) {
  return text
    .split(/[.!?]/)
    .map((sentence) => sentence.trim().toLowerCase())
    .filter(Boolean);
}

function connectorEchoesUntrustedData(
  text: string,
  packet: TarvisRetrospectiveEvidencePacket,
  untrustedQuestion: string,
) {
  const needle = text.toLowerCase();
  return (
    untrustedQuestion.normalize("NFKC").toLowerCase().includes(needle) ||
    JSON.stringify(packet).normalize("NFKC").toLowerCase().includes(needle)
  );
}

function parseSelection(
  value: string,
  packet: TarvisRetrospectiveEvidencePacket,
  untrustedQuestion = "",
): { answer: TarvisAnswer; acceptedHostedAnswer: boolean } {
  let parsed: Partial<RetrospectiveNarrativePlan> & {
    claims?: unknown;
  };
  try {
    parsed = JSON.parse(value) as typeof parsed;
  } catch {
    return { answer: fallbackAnswer(packet), acceptedHostedAnswer: false };
  }

  if (
    !parsed ||
    typeof parsed !== "object" ||
    Object.keys(parsed).some(
      (key) =>
        ![
          "leadStyle",
          "leadText",
          "claims",
          "closingStyle",
          "closingText",
        ].includes(key),
    ) ||
    Object.keys(parsed).length !== 5 ||
    !isExactEnumValue(parsed.leadStyle, TARVIS_RETROSPECTIVE_LEAD_STYLES) ||
    typeof parsed.leadText !== "string" ||
    !Array.isArray(parsed.claims) ||
    parsed.claims.length > MAX_CLAIMS ||
    !isExactEnumValue(
      parsed.closingStyle,
      TARVIS_RETROSPECTIVE_CLOSING_STYLES,
    ) ||
    typeof parsed.closingText !== "string"
  ) {
    return { answer: fallbackAnswer(packet), acceptedHostedAnswer: false };
  }

  const leadText = normaliseConnectorText(parsed.leadText, "lead");
  const closingText =
    parsed.closingStyle === "none"
      ? parsed.closingText === ""
        ? ""
        : undefined
      : normaliseConnectorText(parsed.closingText, "closing");
  if (
    leadText === undefined ||
    closingText === undefined ||
    (leadText !== "" && !validLeadText(leadText, parsed.leadStyle)) ||
    (parsed.closingStyle !== "none" &&
      !validClosingText(closingText, parsed.closingStyle)) ||
    (leadText !== "" && connectorEchoesUntrustedData(leadText, packet, untrustedQuestion)) ||
    (closingText &&
      connectorEchoesUntrustedData(closingText, packet, untrustedQuestion))
  ) {
    return { answer: fallbackAnswer(packet), acceptedHostedAnswer: false };
  }

  const options = new Map(
    approvedClaims(packet).map((claim) => [claim.id, claim]),
  );
  const selections: RetrospectiveClaimSelection[] = [];
  const seenClaims = new Set<string>();
  let citedEvidenceCount = 0;

  for (const value of parsed.claims) {
    if (!value || typeof value !== "object") {
      return { answer: fallbackAnswer(packet), acceptedHostedAnswer: false };
    }
    if (
      Object.keys(value).some(
        (key) =>
          !["claimId", "evidenceIds", "knowledgeIds", "bridgeText"].includes(
            key,
          ),
      )
    ) {
      return { answer: fallbackAnswer(packet), acceptedHostedAnswer: false };
    }
    const candidate = value as Partial<RetrospectiveClaimSelection>;
    const evidenceIds = strictStringIds(candidate.evidenceIds);
    const knowledgeIds = strictStringIds(candidate.knowledgeIds);
    const bridgeText = normaliseConnectorText(candidate.bridgeText, "bridge");
    const claim =
      typeof candidate.claimId === "string"
        ? options.get(candidate.claimId as RetrospectiveClaimId)
        : undefined;
    if (
      !claim ||
      seenClaims.has(claim.id) ||
      !evidenceIds ||
      !knowledgeIds ||
      bridgeText === undefined ||
      (bridgeText !== "" && !validBridgeText(bridgeText)) ||
      (bridgeText !== "" && connectorEchoesUntrustedData(bridgeText, packet, untrustedQuestion)) ||
      evidenceIds.length > MAX_MODEL_EVIDENCE_REFERENCES ||
      !sameIds(evidenceIds, claim.evidenceIds) ||
      !sameIds(knowledgeIds, claim.knowledgeIds)
    ) {
      return { answer: fallbackAnswer(packet), acceptedHostedAnswer: false };
    }
    const incompatibleClaims: RetrospectiveClaimId[] =
      claim.id === "activity-with-adequate-insulin-may-lower-glucose"
        ? [
            "activity-timing-could-have-contributed",
            "activity-when-hyperglycaemic-and-hypoinsulinaemic-may-worsen",
          ]
        : claim.id === "activity-timing-could-have-contributed"
          ? ["activity-with-adequate-insulin-may-lower-glucose"]
          : claim.id ===
              "activity-when-hyperglycaemic-and-hypoinsulinaemic-may-worsen"
            ? ["activity-with-adequate-insulin-may-lower-glucose"]
            : [];
    if (incompatibleClaims.some((id) => seenClaims.has(id))) {
      return { answer: fallbackAnswer(packet), acceptedHostedAnswer: false };
    }
    citedEvidenceCount += evidenceIds.length;
    if (citedEvidenceCount > MAX_MODEL_EVIDENCE_REFERENCES) {
      return { answer: fallbackAnswer(packet), acceptedHostedAnswer: false };
    }
    seenClaims.add(claim.id);
    selections.push({
      claimId: claim.id,
      evidenceIds,
      knowledgeIds,
      bridgeText,
    });
  }

  const hostedText = [
    leadText,
    ...selections.map(({ bridgeText }) => bridgeText),
    closingText,
  ].filter(Boolean);
  const hostedSentences = hostedText.flatMap(sentenceKeys);
  if (
    hostedText.reduce((total, text) => total + text.length, 0) >
      MAX_HOSTED_CONNECTOR_CHARACTERS ||
    new Set(hostedSentences).size !== hostedSentences.length
  ) {
    return { answer: fallbackAnswer(packet), acceptedHostedAnswer: false };
  }
  const selectedCopy = selections.flatMap(({ bridgeText, claimId }) => [
    bridgeText,
    options.get(claimId)?.localCopy ?? "",
  ]);
  return {
    answer: {
      headline: packet.verifiedReview.headline,
      answer: [
        leadText,
        packet.verifiedReview.chronology,
        ...selectedCopy,
        closingText,
      ]
        .filter(Boolean)
        .join("\n\n"),
      confidence: packet.verifiedReview.confidence,
      evidenceIds: packet.evidence.map(({ id }) => id),
      limitations: [...packet.verifiedReview.limitations],
    },
    acceptedHostedAnswer: true,
  };
}

export function parseTarvisRetrospectiveAnswer(
  value: string,
  packet: TarvisRetrospectiveEvidencePacket,
  untrustedQuestion = "",
): TarvisAnswer {
  return parseSelection(value, packet, untrustedQuestion).answer;
}

export function parseTarvisRetrospectiveAnswerResult(
  value: string,
  packet: TarvisRetrospectiveEvidencePacket,
  untrustedQuestion = "",
) {
  return parseSelection(value, packet, untrustedQuestion);
}
