import {
  ActivityEvent,
  ContextNoteEvent,
  HealthContextEvent,
  MealEvent,
} from '@/domain/models';
import { contextNoteCategoryLabel } from '@/domain/contextNotes';

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
    })
  | (DraftBase & {
      kind: 'note';
      category: ContextNoteEvent['category'];
      detail?: string;
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
    case 'note':
      return contextNoteCategoryLabel(draft.category);
  }
}

function optionalText(value: string | undefined, maximum: number, label: string) {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  if (trimmed.length > maximum) {
    throw new Error(
      `${label} must be ${maximum.toLocaleString('en-GB')} characters or fewer.`,
    );
  }
  return trimmed;
}

function createLocalId(kind: ManualContextDraft['kind'], timestamp: number) {
  const entropy = Math.random().toString(36).slice(2, 12);
  return `${MANUAL_CONTEXT_SOURCE_ID}:${kind}:${timestamp}:${Date.now().toString(36)}-${entropy}`;
}

function customTitle(
  event: HealthContextEvent,
  draft: ManualContextDraft,
) {
  if (event.kind === 'medication') return event.title;
  return event.title === defaultTitle(draft) ? undefined : event.title;
}

export function manualContextDraftFromEvent(
  event: HealthContextEvent,
): ManualContextDraft {
  let draft: ManualContextDraft;
  switch (event.kind) {
    case 'meal':
      draft = {
        kind: 'meal',
        timestamp: event.start,
        mealType: event.mealType,
        carbsGrams: event.carbsGrams,
      };
      break;
    case 'activity':
      draft = {
        kind: 'activity',
        timestamp: event.start,
        activityType: event.activityType,
        durationMinutes: event.durationMinutes,
        intensity: event.intensity,
      };
      break;
    case 'sleep':
      draft = {
        kind: 'sleep',
        timestamp: event.end,
        durationMinutes: event.durationMinutes,
        qualityPercent: event.qualityPercent,
      };
      break;
    case 'weight':
      draft = {
        kind: 'weight',
        timestamp: event.start,
        kilograms: event.kilograms,
      };
      break;
    case 'medication':
      draft = {
        kind: 'medication',
        timestamp: event.start,
        amount: event.amount,
        unit: event.unit,
      };
      break;
    case 'note':
      draft = {
        kind: 'note',
        timestamp: event.start,
        category: event.category,
        detail: event.detail,
      };
      break;
  }
  const title = customTitle(event, draft);
  return title ? { ...draft, title } : draft;
}

export function createManualContextEvent(
  draft: ManualContextDraft,
  options: { id?: string; recordedAt?: number } = {},
): HealthContextEvent {
  assertTimestamp(draft.timestamp);
  const recordedAt = options.recordedAt ?? Date.now();
  const id =
    options.id ?? createLocalId(draft.kind, draft.timestamp);
  const title = optionalText(draft.title, 120, 'Label') || defaultTitle(draft);
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
        unit: optionalText(draft.unit, 40, 'Medication unit'),
      };
    case 'note':
      return {
        ...base,
        kind: 'note',
        category: draft.category,
        detail: optionalText(draft.detail, 1_000, 'Detail'),
      };
  }
}

export function reviseManualContextEvent(
  existing: HealthContextEvent,
  draft: ManualContextDraft,
): HealthContextEvent {
  if (
    existing.origin !== 'manual' ||
    existing.sourceId !== MANUAL_CONTEXT_SOURCE_ID
  ) {
    throw new Error('Only entries created in T1 Arc can be edited.');
  }
  if (existing.kind !== draft.kind) {
    throw new Error('The type of an existing context entry cannot be changed.');
  }
  return createManualContextEvent(draft, {
    id: existing.id,
    recordedAt: existing.recordedAt,
  });
}
