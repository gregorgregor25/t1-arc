import { repeatFoodLogDraft } from './repeatFoodLog';
import type { FoodLog, FoodLogDraft } from './types';
import {
  getZonedDateTimeParts,
  isDateKey,
  resolveZonedWallClock,
  toDateKey,
  type DateKey,
} from '@/domain/time';

export type FoodCopyMode = 'append' | 'replace';
export type AmbiguousFoodCopyTimeResolution = 'reject' | 'earlier' | 'later';

export interface FoodCopySelection {
  logId: string;
  /** Omit to copy every item. Item order always follows the source snapshot. */
  itemIds?: readonly string[];
}

export interface FoodCopyDestination {
  date: DateKey;
  timeZone: string;
  /** Omit to retain each source meal's type. */
  mealType?: FoodLog['mealType'];
}

export interface FoodCopyPlanInput {
  sourceLogs: readonly FoodLog[];
  selections: readonly FoodCopySelection[];
  sourceTimeZone: string;
  destination: FoodCopyDestination;
  mode: FoodCopyMode;
  existingDestinationLogs?: readonly FoodLog[];
  ambiguousTimeResolution?: AmbiguousFoodCopyTimeResolution;
}

export interface PlannedFoodLogCopy {
  sourceLogId: string;
  sourceItemIds: string[];
  draft: FoodLogDraft;
}

export interface FoodLogCopyPlan {
  mode: FoodCopyMode;
  sourceTimeZone: string;
  destination: FoodCopyDestination;
  copies: PlannedFoodLogCopy[];
  /** Exact snapshots replaced atomically and retained by the undo token. */
  replaceLogs: FoodLog[];
}

/**
 * Resolves a local wall-clock time without silently normalising a DST gap or
 * choosing one side of a repeated hour. Callers must make ambiguity explicit.
 */
export function resolveFoodCopyWallClock(
  date: DateKey,
  hour: number,
  minute: number,
  second: number,
  timeZone: string,
  ambiguousResolution: AmbiguousFoodCopyTimeResolution = 'reject',
  millisecond = 0,
) {
  return resolveZonedWallClock(
    date,
    hour,
    minute,
    second,
    timeZone,
    ambiguousResolution,
    millisecond,
  );
}

function cloneFoodLog(log: FoodLog): FoodLog {
  return {
    ...log,
    isFavorite: Boolean(log.isFavorite),
    nutrition: { ...log.nutrition },
    items: log.items.map((item) => ({
      ...item,
      nutrition: { ...item.nutrition },
    })),
  };
}

export function foodLogSnapshotSignature(log: FoodLog) {
  return JSON.stringify(cloneFoodLog(log));
}

export function planFoodLogCopy(input: FoodCopyPlanInput): FoodLogCopyPlan {
  if (!isDateKey(input.destination.date)) {
    throw new Error('Choose a valid destination date.');
  }
  getZonedDateTimeParts(0, input.sourceTimeZone);
  getZonedDateTimeParts(0, input.destination.timeZone);
  if (!input.selections.length) throw new Error('Choose at least one meal to copy.');

  const sourceById = new Map(input.sourceLogs.map((log) => [log.id, log]));
  const selectedLogIds = new Set<string>();
  const copies = input.selections.map((selection): PlannedFoodLogCopy => {
    if (selectedLogIds.has(selection.logId)) {
      throw new Error('A source meal can only be selected once.');
    }
    selectedLogIds.add(selection.logId);
    const source = sourceById.get(selection.logId);
    if (!source) throw new Error('A selected source meal is no longer available.');

    const requestedItemIds = selection.itemIds === undefined
      ? source.items.map((item) => item.id)
      : [...selection.itemIds];
    if (!requestedItemIds.length) throw new Error('Choose at least one food from each meal.');
    if (new Set(requestedItemIds).size !== requestedItemIds.length) {
      throw new Error('A source food can only be selected once.');
    }
    const requested = new Set(requestedItemIds);
    if (requestedItemIds.some((id) => !source.items.some((item) => item.id === id))) {
      throw new Error('A selected source food is no longer available.');
    }
    const sourceClock = getZonedDateTimeParts(
      source.timestamp,
      input.sourceTimeZone,
    );
    const timestamp = resolveFoodCopyWallClock(
      input.destination.date,
      sourceClock.hour,
      sourceClock.minute,
      sourceClock.second,
      input.destination.timeZone,
      input.ambiguousTimeResolution,
      ((source.timestamp % 1_000) + 1_000) % 1_000,
    );
    const repeated = repeatFoodLogDraft(source, timestamp);
    const items = repeated.items.filter((_, index) => requested.has(source.items[index]!.id));
    return {
      sourceLogId: source.id,
      sourceItemIds: source.items
        .filter((item) => requested.has(item.id))
        .map((item) => item.id),
      draft: {
        ...repeated,
        mealType: input.destination.mealType ?? repeated.mealType,
        items,
      },
    };
  });

  const copiedMealTypes = new Set(copies.map((copy) => copy.draft.mealType));
  const replaceLogs = input.mode === 'replace'
    ? (input.existingDestinationLogs ?? [])
      .filter((log) =>
        toDateKey(log.timestamp, input.destination.timeZone) === input.destination.date &&
        copiedMealTypes.has(log.mealType),
      )
      .map(cloneFoodLog)
    : [];

  return {
    mode: input.mode,
    sourceTimeZone: input.sourceTimeZone,
    destination: { ...input.destination },
    copies,
    replaceLogs,
  };
}
