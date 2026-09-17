import { isDefaultContextQuestion, isDefaultHealthContextQuestion } from '@/domain/tarvisEntry';
import { coordinateTarvisRequest, type CoordinateTarvisRequestInput, type TarvisRequestPlan } from './requestCoordinator';
import { MAX_LOCAL_GLUCOSE_SCOPE_DAYS } from './localScopeLimit';
import { modelSafeTarvisHistory } from './modelConversationPrivacy';

/** A newly selected record is not anchored to the unrelated review visible behind it. */
export function resolveSelectedContextAsOf(input: {
  entryContext?: unknown;
  question: string;
  ownerIdentity?: string;
  selectionAsOf?: number;
  fallbackAsOf: number;
}) {
  const { selectionAsOf, entryContext, question } = input;
  const owner = input.ownerIdentity ?? '';
  if (typeof selectionAsOf !== 'number' || !Number.isSafeInteger(selectionAsOf) ||
      selectionAsOf <= 0 || selectionAsOf >= 8_640_000_000_000_000 ||
      !(isDefaultContextQuestion(entryContext, question, owner) || isDefaultHealthContextQuestion(entryContext, question, owner))) {
    return input.fallbackAsOf;
  }
  // This is the DataProvider's clock, not a timestamp inferred from route text.
  // Repository records still determine availability and coverage; moving this
  // cutoff does not regenerate or add readings to the demo repository.
  return selectionAsOf;
}

/**
 * A validated app selection supplies exact boundaries, not a second natural-
 * language date guess. The ordinary safety/scope coordinator still runs first.
 * Edited questions and changed owners always retain ordinary free-form routing.
 */
export function coordinateTarvisContextRequest(input: CoordinateTarvisRequestInput & {
  entryContext?: unknown;
  ownerIdentity?: string;
}): TarvisRequestPlan {
  const ordinary = coordinateTarvisRequest(input);
  if (ordinary.kind === 'answer' && (ordinary.source === 'safety' || ordinary.source === 'scope')) return ordinary;
  const entry = input.entryContext;
  if (!isDefaultHealthContextQuestion(entry, input.question, input.ownerIdentity ?? '')) return ordinary;
  const end = Math.min(entry.range.end, input.asOf);
  const duration = end - entry.range.start;
  if (!Number.isSafeInteger(input.asOf) || duration <= 0 ||
      duration * 2 > MAX_LOCAL_GLUCOSE_SCOPE_DAYS * 86_400_000 || entry.range.start - duration <= 0) {
    return { kind: 'answer', source: 'evidence-range', answer: {
      headline: 'Choose a shorter recorded period',
      answer: 'Open a period of up to 45 days that already has records, then ask again. The preceding equally long period is used only as comparison context.',
      confidence: 'limited', evidenceIds: [], limitations: ['No health records were loaded for this request.'],
    } };
  }
  return {
    kind: 'model-evidence',
    selectedHealthMetric: entry.healthMetric,
    evidenceRanges: {
      current: { start: entry.range.start, end },
      previous: { start: entry.range.start - duration, end: entry.range.start },
    },
    history: modelSafeTarvisHistory(input.conversationHistory ?? []),
  };
}
