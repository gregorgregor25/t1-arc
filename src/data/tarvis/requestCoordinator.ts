import {
  isReadyTarvisIntent,
  PendingTarvisClarification,
  resolveTarvisClarificationReply,
  TarvisIntentHistoryEntry,
  TarvisIntentResolution,
  TarvisIntentV1,
} from "./intent";
import { resolveTarvisEvidenceRangeRequest } from "./evidenceRange";
import { routeTarvisIntent } from "./onDeviceRouting";
import { classifyTarvisSafety } from "./safety";
import { safetyQuestionWithImmediateContext } from "./safetyContext";
import {
  classifyTarvisQuestion,
  isClearlyOffTopicTarvisQuestion,
  isTarvisDependentFollowUp,
  TarvisScope,
} from "./scope";
import {
  hasConcreteTarvisEventMarker,
  isActivityEvidenceCategoryRequest,
  isRetrospectiveEventQuestion,
  rangeForRetrospectiveEventQuestion,
  retrospectiveGlucoseEventKind,
  retrospectiveTemporalIssue,
} from "./retrospectiveEventReview";
import { TarvisAnswer, TarvisConversationTurn } from "./types";
import type { TarvisEvidenceRanges } from "./evidenceRange";
import { modelSafeTarvisHistory } from "./modelConversationPrivacy";
import {
  isTarvisExplicitReviewedKnowledgeRequest,
  isTarvisReviewedKnowledgeQuestion,
  selectTarvisReviewedKnowledge,
} from "./reviewedKnowledge";
import { reviewedKnowledgeFallback } from "./reviewedKnowledgeAnswerGuardrail";
import { getRuntimeRegionalDefaults } from "@/domain/regionalProfileRuntime";
import {
  buildTarvisEvidencePlanningOptions,
  type TarvisEvidencePlanningOptions,
} from "./evidencePlanner";
import { isTarvisTreatmentProfileQuestion } from "./treatmentProfileAnswer";

const PERSONAL_ACTIVITY_GUIDANCE_REVIEW =
  /(?=[\s\S]*\b(?:nice|guidance|guidelines?)\b)(?=[\s\S]*\b(?:activity|exercise|walk(?:ed|ing)?|run|ran|running|cycle|cycled|cycling|swim|swam|swimming|workout|gym)\b)(?=[\s\S]*\b(?:glucose|blood sugar|sugar|readings?|low|high)\b)/i;

function isPersonalActivityGuidanceReview(question: string) {
  return (
    PERSONAL_ACTIVITY_GUIDANCE_REVIEW.test(question) &&
    hasConcreteTarvisEventMarker(question)
  );
}

const PERSONAL_ACTIVITY_GUIDANCE_DATA_REQUEST =
  /(?=[\s\S]*\b(?:nice|guidance|guidelines?)\b)(?=[\s\S]*\b(?:activity|exercise|walk(?:ed|ing)?|run|ran|running|cycle|cycled|cycling|swim|swam|swimming|workout|gym)\b)(?=[\s\S]*\bmy\s+(?:exercise\s+)?(?:data|records?|readings?|lows?|highs?|patterns?)\b)/i;

const OPEN_ENDED_GLUCOSE_EPISODE_REVIEW =
  /\b(?:why|investigat(?:e|ed|ing|ion)|explain|review|what (?:happened|was going on|might explain)|can you look into|any idea why|what do my records suggest)\b|\b(?:did|could|might)\b[\s\S]{0,100}\b(?:cause|caused|explain|affect|make|made|trigger|triggered|lead to|responsible)\b|\bwas\b[\s\S]{0,100}\b(?:related to|because|responsible for|caused by|affected by|triggered by|due to)\b/i;

function isOpenEndedGlucoseEpisodeReview(question: string) {
  return OPEN_ENDED_GLUCOSE_EPISODE_REVIEW.test(question);
}

const ANCILLARY_DATA_GAP_EVIDENCE_REQUEST =
  /(?=[\s\S]*\b(?:data|sensor|reading|coverage)?\s*gaps?\b)(?:[\s\S]*\b(?:check|include|consider|inspect|review|use|examine|assess|factor\s+in|take\s+into\s+account|account\s+for|look\s+(?:at|for)|search(?:\s+for)?|analy[sz]e)\b|(?=[\s\S]*\b(?:activity|exercise|workouts?|food|meals?|carbs?|carbohydrates?|insulin|bolus|basal|sleep|notes?|context|ketones?)\b))/i;
const EXACT_DATA_GAP_REQUEST =
  /\b(?:how\s+many|count|number|longest|duration|length|when|what\s+time|what\s+(?:were|are)|which|list|show|enumerate|itemi[sz]e|every|each|all)\b[\s\S]{0,80}\b(?:data|sensor|reading|coverage)?\s*gaps?\b|\b(?:data|sensor|reading|coverage)?\s*gaps?\b[\s\S]{0,80}\b(?:which|list|show|enumerate|itemi[sz]e|every|each|all)\b/i;
const EXACT_CONTEXTUAL_EVIDENCE_METRIC_REQUEST =
  /\b(?:how\s+many|how\s+much|how\s+long|calculate|compute|what\s+(?:was|were|is|are)\s+(?:(?:my|the)\s+)?(?:total|amount|duration|number|percentage|percent)|(?:give|show|tell)\s+me\s+(?:(?:my|the)\s+)?(?:total|amount|duration|number|percentage|percent))\b[\s\S]{0,100}\b(?:insulin|bolus|basal|carbs?|carbohydrates?|activity|exercise|workouts?|sleep|coverage|gaps?)\b/i;
const ANCILLARY_EPISODE_EVIDENCE_METRICS = new Set<
  TarvisIntentV1["metrics"][number]["value"]
>([
  "insulin.delivered_total",
  "insulin.basal_total",
  "insulin.bolus_total",
  "food.carbohydrate_total",
  "activity.duration",
  "sleep.duration",
  "data_quality.coverage",
  "data_quality.gaps",
]);

function hasOnlyAncillaryEpisodeEvidenceMetrics(
  question: string,
  metrics: TarvisIntentV1["metrics"],
) {
  if (metrics.length === 0) return true;
  if (
    !metrics.every(({ value }) =>
      ANCILLARY_EPISODE_EVIDENCE_METRICS.has(value),
    ) ||
    EXACT_CONTEXTUAL_EVIDENCE_METRIC_REQUEST.test(question) ||
    EXACT_DATA_GAP_REQUEST.test(question)
  ) {
    return false;
  }
  return (
    metrics.some(({ value }) => value !== "data_quality.gaps") ||
    ANCILLARY_DATA_GAP_EVIDENCE_REQUEST.test(question)
  );
}

type TarvisAnswerRequestPlan = {
      kind: "answer";
      answer: TarvisAnswer;
      pendingClarification?: PendingTarvisClarification;
      source: "safety" | "scope" | "capability" | "evidence-range";
    };

export type TarvisRequestPlan =
  | TarvisAnswerRequestPlan
  | {
      kind: "treatment-profile";
    }
  | {
      kind: "scoped-glucose";
      intent: TarvisIntentV1;
    }
  | {
      kind: "scoped-personal-data";
      intent: TarvisIntentV1;
    }
  | {
      kind: "retrospective-event";
      range: { start: number; end: number };
    }
  | {
      kind: "model-education";
      history: TarvisConversationTurn[];
      intent?: TarvisIntentV1;
    }
  | {
      kind: "model-evidence";
      evidenceRanges?: TarvisEvidenceRanges;
      history: TarvisConversationTurn[];
      intent?: TarvisIntentV1;
    }
  | {
      kind: "model-plan";
      options: TarvisEvidencePlanningOptions;
      history: TarvisConversationTurn[];
      fallback: TarvisAnswerRequestPlan;
    };

export interface CoordinateTarvisRequestInput {
  question: string;
  asOf: number;
  conversationHistory?: TarvisConversationTurn[];
  intentHistory?: TarvisIntentHistoryEntry[];
  pendingClarification?: PendingTarvisClarification;
}

function scopeAnswer(scope: Exclude<TarvisScope, "in_scope">): TarvisAnswer {
  const credentialRequest = scope === "sensitive_credentials";
  return {
    headline: credentialRequest
      ? "I can\u2019t reveal private credentials"
      : "That is outside Tarv1s\u2019s scope",
    answer: credentialRequest
      ? "Tarv1s cannot retrieve or display passwords, API keys, tokens or other secrets. No OpenAI request was made."
      : "Tarv1s only answers questions about Type 1 diabetes and the health evidence available in T1 Arc. No OpenAI request was made.",
    confidence: "high",
    evidenceIds: [],
    limitations: [],
  };
}

function unsupportedRangeAnswer(reason: string): TarvisAnswer {
  return {
    headline: "I need an exact period for that review",
    answer: `${reason} Please ask with one exact supported period, such as yesterday, last week, or the last 14 days. I won\u2019t substitute the report currently shown on screen.`,
    confidence: "limited",
    evidenceIds: [],
    limitations: [
      "No health records were loaded and no OpenAI request was made for the unsupported time or comparison request.",
    ],
  };
}

function evidencePlannerUnavailableAnswer(): TarvisAnswer {
  return {
    headline: "I couldn’t complete that evidence search",
    answer:
      "I recognised this as a question about one of your past glucose events, but I couldn’t safely turn it into a bounded T1 Arc evidence request. I haven’t guessed at a cause or substituted a different calculation.",
    confidence: "limited",
    evidenceIds: [],
    limitations: [
      "No health records were loaded for this answer.",
    ],
  };
}

function modelHistoryForEducation(
  question: string,
  history: TarvisConversationTurn[],
) {
  if (!isTarvisDependentFollowUp(question)) return [];
  // A dependent explanation needs only the immediately preceding exchange,
  // never the rest of the personal conversation.
  return modelSafeTarvisHistory(history.slice(-2));
}

/**
 * Production request coordinator. Safety and scope are resolved before key
 * state is relevant, exact local calculations remain local, and model calls
 * receive only the context required by their route.
 */
export function coordinateTarvisRequest({
  question,
  asOf,
  conversationHistory = [],
  intentHistory = [],
  pendingClarification,
}: CoordinateTarvisRequestInput): TarvisRequestPlan {
  const safety = classifyTarvisSafety(
    safetyQuestionWithImmediateContext(question, conversationHistory),
  );
  if (safety.kind !== "allow") {
    return { kind: "answer", answer: safety.answer, source: "safety" };
  }

  const scope = classifyTarvisQuestion(question, conversationHistory);
  if (scope === "sensitive_credentials") {
    return { kind: "answer", answer: scopeAnswer(scope), source: "scope" };
  }
  if (scope === "off_topic" && isClearlyOffTopicTarvisQuestion(question)) {
    return { kind: "answer", answer: scopeAnswer(scope), source: "scope" };
  }
  if (scope === "in_scope" && isTarvisTreatmentProfileQuestion(question)) {
    return { kind: "treatment-profile" };
  }
  const dependentEducationFollowUp =
    isTarvisDependentFollowUp(question) && conversationHistory.length >= 2;
  const selectedReviewedKnowledge = selectTarvisReviewedKnowledge(question);
  const retrospectiveQuestion =
    isRetrospectiveEventQuestion(question) ||
    isPersonalActivityGuidanceReview(question) ||
    (PERSONAL_ACTIVITY_GUIDANCE_DATA_REQUEST.test(question) &&
      hasConcreteTarvisEventMarker(question));
  if (retrospectiveQuestion) {
    if (scope !== "in_scope") {
      return { kind: "answer", answer: scopeAnswer(scope), source: "scope" };
    }
    const temporalIssue = retrospectiveTemporalIssue(question, asOf);
    if (temporalIssue) {
      return {
        kind: "answer",
        answer: unsupportedRangeAnswer(temporalIssue),
        source: "evidence-range",
      };
    }
    return {
      kind: "retrospective-event",
      range: rangeForRetrospectiveEventQuestion(question, asOf),
    };
  }
  if (
    scope === "in_scope" &&
    PERSONAL_ACTIVITY_GUIDANCE_DATA_REQUEST.test(question)
  ) {
    return {
      kind: "answer",
      answer: unsupportedRangeAnswer(
        "To compare your records with NICE activity guidance, I need an exact period or dated event.",
      ),
      source: "evidence-range",
    };
  }
  if (
    scope === "in_scope" &&
    isTarvisReviewedKnowledgeQuestion(question) &&
    selectedReviewedKnowledge.length > 0 &&
    !(
      isActivityEvidenceCategoryRequest(question) &&
      (retrospectiveGlucoseEventKind(question) === "high" ||
        retrospectiveGlucoseEventKind(question) === "low") &&
      hasConcreteTarvisEventMarker(question) &&
      isOpenEndedGlucoseEpisodeReview(question)
    )
  ) {
    return {
      kind: "model-education",
      history: modelHistoryForEducation(question, conversationHistory),
    };
  }
  if (
    scope === "in_scope" &&
    !dependentEducationFollowUp &&
    isTarvisExplicitReviewedKnowledgeRequest(question) &&
    selectedReviewedKnowledge.length === 0
  ) {
    return {
      kind: "answer",
      answer: reviewedKnowledgeFallback([]),
      source: "capability",
    };
  }

  const resolution: TarvisIntentResolution = resolveTarvisClarificationReply(
    question,
    {
      history: intentHistory,
      now: asOf,
      timezone: getRuntimeRegionalDefaults().timeZone,
    },
    pendingClarification,
  );
  // Scope still runs before API-key/settings state. The deterministic resolver
  // is allowed to recognise terse local commands first so conversational
  // phrases and misspellings are not mistaken for unrelated chat.
  if (
    scope !== "in_scope" &&
    !dependentEducationFollowUp &&
    !isReadyTarvisIntent(resolution) &&
    !resolution.intent.domain &&
    resolution.intent.metrics.length === 0 &&
    resolution.literals.clockWindows.length === 0 &&
    resolution.literals.durations.length === 0 &&
    resolution.literals.dates.length === 0 &&
    !resolution.intent.temporalScope &&
    !/\bwhat (?:did|have) i (?:eat|ate|have for (?:breakfast|lunch|dinner))\b/i.test(
      question,
    )
  ) {
    return { kind: "answer", answer: scopeAnswer(scope), source: "scope" };
  }
  if (dependentEducationFollowUp && !isReadyTarvisIntent(resolution)) {
    return {
      kind: "model-education",
      history: modelHistoryForEducation(question, conversationHistory),
    };
  }
  const route = routeTarvisIntent(resolution);

  const unresolvedEventKind = retrospectiveGlucoseEventKind(question);
  const evidencePlanningOptions =
    scope === "in_scope" &&
    (unresolvedEventKind === "high" || unresolvedEventKind === "low") &&
    hasConcreteTarvisEventMarker(question) &&
    isOpenEndedGlucoseEpisodeReview(question)
      ? buildTarvisEvidencePlanningOptions(question, asOf)
      : undefined;
  const hasCompleteBoundedEvidencePlan =
    evidencePlanningOptions?.rangeOptions.length === 1 &&
    evidencePlanningOptions.eventOptions.length === 1;
  const isUnresolvedGlucoseEpisode =
    scope === "in_scope" &&
    !isReadyTarvisIntent(resolution) &&
    hasOnlyAncillaryEpisodeEvidenceMetrics(
      question,
      resolution.intent.metrics,
    ) &&
    (unresolvedEventKind === "high" || unresolvedEventKind === "low") &&
    hasConcreteTarvisEventMarker(question) &&
    isOpenEndedGlucoseEpisodeReview(question);
  if (isUnresolvedGlucoseEpisode) {
    const temporalIssue = retrospectiveTemporalIssue(question, asOf);
    if (temporalIssue) {
      return {
        kind: "answer",
        answer: unsupportedRangeAnswer(temporalIssue),
        source: "evidence-range",
      };
    }
  }
  if (
    isUnresolvedGlucoseEpisode &&
    (resolution.outcome.status === "needs_clarification" ||
      route.kind === "model-evidence" ||
      route.kind === "model-education" ||
      hasCompleteBoundedEvidencePlan)
  ) {
    return {
      kind: "model-plan",
      options:
        evidencePlanningOptions ??
        buildTarvisEvidencePlanningOptions(question, asOf),
      history: modelSafeTarvisHistory(conversationHistory),
      fallback: {
        kind: "answer",
        answer: evidencePlannerUnavailableAnswer(),
        source: "capability",
      },
    };
  }

  if (route.kind === "capability") {
    const nextClarification =
      resolution.outcome.status === "needs_clarification"
        ? (pendingClarification ?? {
            question,
            resolution,
          })
        : undefined;
    return {
      kind: "answer",
      answer: route.answer,
      pendingClarification: nextClarification,
      source: "capability",
    };
  }

  if (
    route.kind === "scoped-glucose" ||
    route.kind === "scoped-personal-data"
  ) {
    if (!isReadyTarvisIntent(resolution)) {
      throw new Error("A deterministic route was not fully resolved.");
    }
    return { kind: route.kind, intent: resolution.intent };
  }

  const intent = isReadyTarvisIntent(resolution)
    ? resolution.intent
    : undefined;
  if (route.kind === "model-education") {
    return {
      kind: "model-education",
      history: modelHistoryForEducation(question, conversationHistory),
      intent,
    };
  }

  const evidenceRequest = resolveTarvisEvidenceRangeRequest(resolution, asOf);
  if (evidenceRequest.kind === "unsupported") {
    return {
      kind: "answer",
      answer: unsupportedRangeAnswer(evidenceRequest.reason),
      source: "evidence-range",
    };
  }
  return {
    kind: "model-evidence",
    evidenceRanges:
      evidenceRequest.kind === "resolved" ? evidenceRequest.ranges : undefined,
    history: modelSafeTarvisHistory(conversationHistory),
    intent,
  };
}
