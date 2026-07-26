import {
  ActivityEvent,
  HealthContextEvent,
  MealEvent,
} from '@/domain/models';

export const MANUAL_CONTEXT_SOURCE_ID = 'daymark-manual';

interface DraftBase {
  timestamp: number;
  title?: string;
}

export type ManualContextDraft =
  | (DraftBase & {
      kind: 'meal';
      mealType: MealEvent['mealType'];
      carbsGrams: number;
    })
  | (DraftBase & {
      kind: 'activity';
      activityType: ActivityEvent['activityType'];
      durationMinutes: number;
      intensity: ActivityEvent['intensity'];
    })
  | (DraftBase & {
      kind: 'sleep';
      durationMinutes: number;
      qualityPercent?: number;
    })
  | (DraftBase & {
      kind: 'weight';
      kilograms: number;
    })
  | (DraftBase & {
      kind: 'medication';
      amount?: number;
      unit?: string;
    });

function assertTimestamp(value: number) {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error('Choose a valid date and time.');
  }
}

function requireRange(
  value: number,
  minimum: number,
  maximum: number,
  message: string,
) {
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw new Error(message);
  }
  return value;
}

function defaultTitle(draft: ManualContextDraft) {
  switch (draft.kind) {
    case 'meal':
      return draft.mealType[0]!.toUpperCase() + draft.mealType.slice(1);
    case 'activity':
      return draft.activityType === 'other'
        ? 'Activity'
        : draft.activityType[0]!.toUpperCase() + draft.activityType.slice(1);
    case 'sleep':
      return 'Sleep';
    case 'weight':
      return 'Weight';
    case 'medication':
      return 'Medication';
  }
}

function createLocalId(kind: ManualContextDraft['kind'], timestamp: number) {
  const entropy = Math.random().toString(36).slice(2, 12);
  return `${MANUAL_CONTEXT_SOURCE_ID}:${kind}:${timestamp}:${Date.now().toString(36)}-${entropy}`;
}

export function createManualContextEvent(
  draft: ManualContextDraft,
  options: { id?: string; recordedAt?: number } = {},
): HealthContextEvent {
  assertTimestamp(draft.timestamp);
  const recordedAt = options.recordedAt ?? Date.now();
  const id =
    options.id ?? createLocalId(draft.kind, draft.timestamp);
  const title = draft.title?.trim() || defaultTitle(draft);
  const base = {
    id,
    start: draft.timestamp,
    title,
    sourceId: MANUAL_CONTEXT_SOURCE_ID,
    origin: 'manual' as const,
    recordedAt,
  };

  switch (draft.kind) {
    case 'meal':
      return {
        ...base,
        kind: 'meal',
        mealType: draft.mealType,
        carbsGrams: requireRange(
          draft.carbsGrams,
          0,
          1000,
          'Carbohydrate must be between 0 and 1,000 grams.',
        ),
      };
    case 'activity': {
      const durationMinutes = requireRange(
        draft.durationMinutes,
        1,
        1440,
        'Activity duration must be between 1 and 1,440 minutes.',
      );
      return {
        ...base,
        kind: 'activity',
        activityType: draft.activityType,
        durationMinutes,
        intensity: draft.intensity,
        end: draft.timestamp + durationMinutes * 60_000,
      };
    }
    case 'sleep': {
      const durationMinutes = requireRange(
        draft.durationMinutes,
        1,
        1440,
        'Sleep duration must be between 1 and 1,440 minutes.',
      );
      const qualityPercent =
        draft.qualityPercent === undefined
          ? undefined
          : requireRange(
              draft.qualityPercent,
              0,
              100,
              'Sleep quality must be between 0 and 100 percent.',
            );
      return {
        ...base,
        kind: 'sleep',
        start: draft.timestamp - durationMinutes * 60_000,
        end: draft.timestamp,
        durationMinutes,
        qualityPercent,
      };
    }
    case 'weight':
      return {
        ...base,
        kind: 'weight',
        kilograms: requireRange(
          draft.kilograms,
          20,
          400,
          'Weight must be between 20 and 400 kilograms.',
        ),
      };
    case 'medication':
      if (
        draft.amount !== undefined &&
        (!Number.isFinite(draft.amount) || draft.amount < 0)
      ) {
        throw new Error('Medication amount cannot be negative.');
      }
      return {
        ...base,
        kind: 'medication',
        amount: draft.amount,
        unit: draft.unit?.trim() || undefined,
      };
  }
}
