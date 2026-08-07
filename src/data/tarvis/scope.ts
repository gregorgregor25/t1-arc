import { TarvisConversationTurn } from './types';
import { InsightPeriodDays } from '@/domain/insightRanges';

export type TarvisScope =
  | 'in_scope'
  | 'off_topic'
  | 'sensitive_credentials';

const DIABETES_AND_HEALTH_TERMS = [
  'active energy',
  'activity',
  'average',
  'basal',
  'blood glucose',
  'blood sugar',
  'bolus',
  'breakfast',
  'carb',
  'cgm',
  'claim',
  'comparison',
  'coverage',
  'data',
  'dexcom',
  'diabetes',
  'dinner',
  'dose',
  'evidence',
  'exercise',
  'food',
  'glucose',
  'health',
  'heart rate',
  'high',
  'hypo',
  'insulin',
  'libre',
  'low',
  'lunch',
  'meal',
  'medication',
  'mmol',
  'nightscout',
  'omnipod',
  'overnight',
  'last night',
  'morning',
  'pattern',
  'pump',
  'reading',
  'research',
  'sleep',
  'source',
  'steps',
  'study',
  'stale',
  'spike',
  'sugar',
  'time in range',
  'timing range',
  'tir',
  'trend',
  'guidance',
  'guideline',
  'variability',
  'weight',
  'workout',
  'xdrip',
  'yesterday',
];

const CLEARLY_OFF_TOPIC =
  /\b(capital of|country|geography|weather|football|sports? score|celebrity|stock price|share price|cryptocurrency|write (?:me )?(?:a )?(?:poem|essay|story|code)|translate|homework|tell (?:me )?(?:a )?joke|trivia)\b/i;

const CREDENTIAL_EXTRACTION =
  /\b(show|tell|reveal|display|retrieve|give)\b[\s\S]{0,80}\b(password|passcode|api[ -]?key|secret|credential|token)\b/i;

const FOLLOW_UP =
  /^(why|how|explain|go deeper|tell me more|which one|show me|compare them|what about that|and this|is that good|is that bad|(?:what|how) about (?:the )?(?:previous|prior|earlier|recent|current) period)[?.! ]*$/i;

const PERSONAL_DATA_QUESTION =
  /\b(my|mine|me|i)\b[\s\S]{0,120}\b(data|records?|history|summary|result|results|reading|readings|today|yesterday|week|fortnight|month|days?|date|average|total|highest|lowest|change|changed|compare|comparison|pattern|patterns)\b|\b(data|records?|history|summary|result|results|reading|readings|today|yesterday|week|fortnight|month|days?|date|average|total|highest|lowest|change|changed|compare|comparison|pattern|patterns)\b[\s\S]{0,120}\b(my|mine|me|i)\b/i;

const PERIOD_DAY_VALUES = new Set<InsightPeriodDays>([3, 7, 14, 30, 90]);

/**
 * Returns a supported T1 Arc comparison period when the user explicitly asks
 * for one. Unsupported periods remain undefined rather than silently changing
 * the meaning of the question.
 */
export function requestedTarvisPeriodDays(
  question: string,
): InsightPeriodDays | undefined {
  const normalized = question.trim().toLowerCase();
  if (
    /\b(today|yesterday|last night|overnight|this morning|yesterday morning|yesterday evening)\b/.test(
      normalized,
    )
  ) {
    return 3;
  }
  const dayMatch = normalized.match(
    /\b(?:last|past|previous|over|for|during|in)\s+(?:the\s+)?(\d{1,2})\s*(?:day|days|d)\b/,
  );
  if (dayMatch) {
    const value = Number(dayMatch[1]);
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
    return 'sensitive_credentials';
  }
  if (CLEARLY_OFF_TOPIC.test(normalized)) {
    return 'off_topic';
  }
  if (
    DIABETES_AND_HEALTH_TERMS.some((term) => normalized.includes(term))
  ) {
    return 'in_scope';
  }
  if (PERSONAL_DATA_QUESTION.test(normalized)) {
    return 'in_scope';
  }
  if (history.length > 0 && FOLLOW_UP.test(normalized)) {
    return 'in_scope';
  }
  return 'off_topic';
}
