import type { HealthContextEvent, TimeRange } from '@/domain/models';

export type TimelineAddKind = 'meal' | 'note';

/** A message about a timeline edit, tied to the period it was raised for. */
export interface TimelineActionMessage {
  message: string;
  /** The History period the message belongs to. */
  rangeKey: string;
  /** True when it was raised because food details were still loading. */
  whileFoodLoading: boolean;
}

/**
 * A timeline message only applies to the period it was raised for, and a
 * "still loading" message no longer applies once food details have loaded.
 */
export function visibleTimelineActionError(
  state: TimelineActionMessage | undefined,
  rangeKey: string,
  foodLoading: boolean,
): string | undefined {
  if (!state || state.rangeKey !== rangeKey) return undefined;
  if (state.whileFoodLoading && !foodLoading) return undefined;
  return state.message;
}

/** An add started from the timeline, waiting for its record to appear. */
export interface PendingTimelineAdd {
  kind: TimelineAddKind;
  rangeKey: string;
  /** Sources that save this kind of record (the food log and manual records). */
  sourceIds: readonly string[];
  /** Matching records that already existed when the add started. */
  knownIds: readonly string[];
}

function isTimelineAddRecord(
  event: HealthContextEvent,
  kind: TimelineAddKind,
  sourceIds: readonly string[],
) {
  return event.origin === 'manual' && event.kind === kind && sourceIds.includes(event.sourceId);
}

/** Ids of the records an add of this kind could create. */
export function timelineAddRecordIds(
  events: readonly HealthContextEvent[],
  kind: TimelineAddKind,
  sourceIds: readonly string[],
): string[] {
  return events.filter((event) => isTimelineAddRecord(event, kind, sourceIds)).map((event) => event.id);
}

/**
 * Confirmation for an add started from the History timeline. The log sheets
 * report their own errors; this only confirms once a new record of the same
 * kind has been saved and appears in the period on screen.
 */
export function timelineSavedConfirmation(
  pending: PendingTimelineAdd | undefined,
  rangeKey: string,
  events: readonly HealthContextEvent[] | undefined,
): string | undefined {
  if (!pending || !events || pending.rangeKey !== rangeKey) return undefined;
  const known = new Set(pending.knownIds);
  const saved = events.some(
    (event) => isTimelineAddRecord(event, pending.kind, pending.sourceIds) && !known.has(event.id),
  );
  if (!saved) return undefined;
  return pending.kind === 'meal'
    ? 'Saved. The meal now appears on the timeline.'
    : 'Saved. The note now appears on the timeline.';
}

const ONE_DAY_MS = 24 * 3_600_000;
/** Allows for a 25-hour day when clocks change. */
const LONGEST_DAY_MS = ONE_DAY_MS + 3_600_000;

/**
 * Spoken label for the timeline's "Add meal" and "Add note" buttons. When the
 * chart covers more than one day the time alone is ambiguous, so the date is
 * included.
 */
export function timelineAddActionLabel(
  kind: TimelineAddKind,
  timestamp: number,
  range: TimeRange,
  format: { time(timestamp: number): string; day(timestamp: number): string },
): string {
  const action = kind === 'meal' ? 'Add meal' : 'Add note';
  return range.end - range.start > LONGEST_DAY_MS
    ? `${action} on ${format.day(timestamp)} at ${format.time(timestamp)}`
    : `${action} at ${format.time(timestamp)}`;
}
