import {
  isReadyTarvisIntent,
  PendingTarvisClarification,
  resolveTarvisClarificationReply,
  TarvisIntentHistoryEntry,
  TarvisIntentResolution,
  TarvisIntentV1,
} from './intent';
import { resolveTarvisEvidenceRangeRequest } from './evidenceRange';
import { routeTarvisIntent } from './onDeviceRouting';
import { classifyTarvisSafety } from './safety';
import { classifyTarvisQuestion, TarvisScope } from './scope';
import { TarvisAnswer, TarvisConversationTurn } from './types';
import type { TarvisEvidenceRanges } from './evidenceRange';

export type TarvisRequestPlan =
  | {
      kind: 'answer';
      answer: TarvisAnswer;
      pendingClarification?: PendingTarvisClarification;
      source: 'safety' | 'scope' | 'capability' | 'evidence-range';
    }
  | {
      kind: 'scoped-glucose';
      intent: TarvisIntentV1;
    }
  | {
      kind: 'scoped-personal-data';
      intent: TarvisIntentV1;
    }
  | {
      kind: 'model-education';
      history: TarvisConversationTurn[];
      intent?: TarvisIntentV1;
    }
  | {
      kind: 'model-evidence';
      evidenceRanges?: TarvisEvidenceRanges;
      history: TarvisConversationTurn[];
      intent?: TarvisIntentV1;
    };

export interface CoordinateTarvisRequestInput {
  question: string;
  asOf: number;
  conversationHistory?: TarvisConversationTurn[];
  intentHistory?: TarvisIntentHistoryEntry[];
  pendingClarification?: PendingTarvisClarification;
}

const EXPLICIT_DEPENDENT_FOLLOW_UP =
  /^(?:(?:why|how)\??|(?:can you\s+)?explain (?:that|this|it)|tell me more(?: about (?:that|this|it))?|go deeper(?: on (?:that|this|it))?|what (?:does|did) (?:that|this|it) mean|what about (?:that|this|it|the previous answer)|you said\b[\s\S]*)[?.! ]*$/i;

function scopeAnswer(scope: Exclude<TarvisScope, 'in_scope'>): TarvisAnswer {
  const credentialRequest = scope === 'sensitive_credentials';
  return {
    headline: credentialRequest
      ? 'I can\u2019t reveal private credentials'
      : 'That is outside Tarv1s\u2019s scope',
    answer: credentialRequest
      ? 'Tarv1s cannot retrieve or display passwords, API keys, tokens or other secrets. No OpenAI request was made.'
      : 'Tarv1s only answers questions about Type 1 diabetes and the health evidence available in T1 Arc. No OpenAI request was made.',
    confidence: 'high',
    evidenceIds: [],
    limitations: [],
  };
}

function unsupportedRangeAnswer(reason: string): TarvisAnswer {
  return {
    headline: 'I need an exact period for that review',
    answer: `${reason} Please ask with one exact supported period, such as yesterday, last week, or the last 14 days. I won\u2019t substitute the report currently shown on screen.`,
    confidence: 'limited',
    evidenceIds: [],
    limitations: [
      'No health records were loaded and no OpenAI request was made for the unsupported time or comparison request.',
    ],
  };
}

function modelHistoryForEducation(
  question: string,
  history: TarvisConversationTurn[],
) {
  if (!EXPLICIT_DEPENDENT_FOLLOW_UP.test(question.trim())) return [];
  // A dependent explanation needs only the immediately preceding exchange,
  // never the rest of the personal conversation.
  return history.slice(-2);
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
  const safety = classifyTarvisSafety(question);
  if (safety.kind !== 'allow') {
    return { kind: 'answer', answer: safety.answer, source: 'safety' };
  }

  const dependentEducationFollowUp =
    EXPLICIT_DEPENDENT_FOLLOW_UP.test(question.trim()) &&
    conversationHistory.length >= 2;

  const resolution: TarvisIntentResolution = resolveTarvisClarificationReply(
    question,
    {
      history: intentHistory,
      now: asOf,
      timezone: 'Europe/London',
    },
    pendingClarification,
  );
  // Scope still runs before API-key/settings state. The deterministic resolver
  // is allowed to recognise terse local commands first so conversational
  // phrases and misspellings are not mistaken for unrelated chat.
  const scope = classifyTarvisQuestion(question, conversationHistory);
  if (
    scope !== 'in_scope' &&
    scope !== 'sensitive_credentials' &&
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
    return { kind: 'answer', answer: scopeAnswer(scope), source: 'scope' };
  }
  if (scope === 'sensitive_credentials') {
    return { kind: 'answer', answer: scopeAnswer(scope), source: 'scope' };
  }
  if (dependentEducationFollowUp) {
    return {
      kind: 'model-education',
      history: modelHistoryForEducation(question, conversationHistory),
    };
  }
  const route = routeTarvisIntent(resolution);

  if (route.kind === 'capability') {
    const nextClarification =
      resolution.outcome.status === 'needs_clarification'
        ? (pendingClarification ?? {
            question,
            resolution,
          })
        : undefined;
    return {
      kind: 'answer',
      answer: route.answer,
      pendingClarification: nextClarification,
      source: 'capability',
    };
  }

  if (
    route.kind === 'scoped-glucose' ||
    route.kind === 'scoped-personal-data'
  ) {
    if (!isReadyTarvisIntent(resolution)) {
      throw new Error('A deterministic route was not fully resolved.');
    }
    return { kind: route.kind, intent: resolution.intent };
  }

  const intent = isReadyTarvisIntent(resolution)
    ? resolution.intent
    : undefined;
  if (route.kind === 'model-education') {
    return {
      kind: 'model-education',
      history: modelHistoryForEducation(question, conversationHistory),
      intent,
    };
  }

  const evidenceRequest = resolveTarvisEvidenceRangeRequest(resolution, asOf);
  if (evidenceRequest.kind === 'unsupported') {
    return {
      kind: 'answer',
      answer: unsupportedRangeAnswer(evidenceRequest.reason),
      source: 'evidence-range',
    };
  }
  return {
    kind: 'model-evidence',
    evidenceRanges:
      evidenceRequest.kind === 'resolved' ? evidenceRequest.ranges : undefined,
    history: conversationHistory,
    intent,
  };
}
