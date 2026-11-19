import { type TimeRange } from './models';
import { parseExternalAbsoluteTimestamp } from './externalTimestamp';
import { temporaryTargetRange } from './temporaryTargets';

/**
 * Typed therapy-state intervals recorded by AAPS (or another Nightscout
 * uploader): temporary targets, profile switches, loop running mode, pump
 * suspensions and logged exercise.
 *
 * These describe what the system recorded as active. They are never used to
 * calculate insulin or to suggest settings. Each interval keeps the stored
 * raw source record it came from, so it can be inspected, and the IDs of any
 * duplicate copies from another route.
 */

export type TherapyStateKind =
  | 'temporary-target'
  | 'profile-switch'
  | 'loop-mode'
  | 'pump-suspend'
  | 'exercise';

/** AAPS temporary-target reasons, plus `other` for free text from other uploaders. */
export type TemporaryTargetReason =
  | 'activity'
  | 'hypo'
  | 'eating-soon'
  | 'custom'
  | 'automation'
  | 'wear'
  | 'other';

/** AAPS 3.3+ running modes, plus the older "OpenAPS Offline" reasons mapped onto them. */
export type LoopRunningMode =
  | 'closed-loop'
  | 'closed-loop-lgs'
  | 'open-loop'
  | 'disabled-loop'
  | 'super-bolus'
  | 'disconnected-pump'
  | 'suspended-by-pump'
  | 'suspended-by-user'
  | 'suspended-by-dst'
  | 'unknown';

/**
 * How the interval's end is known:
 * - `programmed`: the recorded duration ran its course (AAPS shortens the
 *   record when a state is cancelled early, so this is also the cancelled end);
 * - `next-record`: a later record of the same kind started first;
 * - `cancelled`: an explicit cancel or resume record ended it;
 * - `open`: no duration and no later record in the data read; the interval
 *   is shown up to the end of the records read and is not a confirmed end.
 */
export type TherapyStateEndBasis = 'programmed' | 'next-record' | 'cancelled' | 'open';

export type TherapyStateSourceId = 'nightscout' | 'aaps-local';

export interface TherapyStateSourceRef {
  rawRecordId: string;
  sourceId: string;
  sourceFile: string;
}

export interface TherapyStateInterval {
  id: string;
  kind: TherapyStateKind;
  start: number;
  end: number;
  endBasis: TherapyStateEndBasis;
  /** The recorded duration, when one was supplied. */
  programmedDurationMs?: number;
  /**
   * The ordinary background state: closed loop, or a 100% profile with no
   * time shift that stays until the next switch. Evidence leaves these out
   * unless asked, because one is always active.
   */
  baseline: boolean;
  targetReason?: TemporaryTargetReason;
  /** The uploader's own reason text, trimmed. */
  reasonText?: string;
  targetLowMmolL?: number;
  targetHighMmolL?: number;
  profileName?: string;
  percentage?: number;
  timeshiftHours?: number;
  loopMode?: LoopRunningMode;
  /** AAPS forced this running mode by a constraint, not a user choice. */
  autoForced?: boolean;
  suspendBasis?: 'pump-event' | 'temp-basal' | 'running-mode';
  /** Preferred copy: Nightscout, then AAPS on this phone (verified, then not). */
  source: TherapyStateSourceRef;
  /** Other stored copies of the same record that were merged into this one. */
  duplicateSources: TherapyStateSourceRef[];
}

/** One stored treatment that starts, or ends, a therapy state. */
export interface TherapyStateEvent {
  kind: TherapyStateKind;
  start: number;
  /** A cancel/resume marker: it ends the active state of its kind and starts nothing. */
  isEnd: boolean;
  programmedDurationMs?: number;
  /** Running modes split into an ongoing mode and temporary overlays. */
  temporaryOverlay?: boolean;
  targetReason?: TemporaryTargetReason;
  reasonText?: string;
  targetLowMmolL?: number;
  targetHighMmolL?: number;
  profileName?: string;
  percentage?: number;
  timeshiftHours?: number;
  loopMode?: LoopRunningMode;
  autoForced?: boolean;
  suspendBasis?: TherapyStateInterval['suspendBasis'];
  source: TherapyStateSourceRef;
}

/** The stored raw record kinds that carry Nightscout-shaped AAPS treatments. */
export const THERAPY_STATE_RAW_RECORD_KINDS = [
  'nightscout-treatment',
  'aaps-local-treatment',
] as const;

/**
 * Case-insensitive substrings that every therapy-state treatment contains.
 * Stores use them to avoid parsing every SMB and carb record.
 */
export const THERAPY_STATE_PAYLOAD_MARKERS = [
  'Temporary Target',
  'Profile Switch',
  'OpenAPS Offline',
  'Suspend',
  'Pump Resume',
  'Exercise',
  'Activity',
] as const;

/** Read recent records this far back, plus earlier starts and ends for ongoing states. */
export const THERAPY_STATE_LOOKBACK_MS = 7 * 24 * 60 * 60_000;

/** Longer recorded durations are treated as "until changed". */
const MAX_PROGRAMMED_MS = 7 * 24 * 60 * 60_000;
/** Copies from two routes match when their starts are this close. */
const DUPLICATE_START_TOLERANCE_MS = 2 * 60_000;

function numeric(value: unknown) {
  const parsed =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim()
        ? Number(value)
        : Number.NaN;
  return Number.isFinite(parsed) ? parsed : undefined;
}

function text(value: unknown, maximum = 80) {
  return typeof value === 'string'
    ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, maximum)
    : '';
}

function treatmentTimestamp(treatment: Record<string, unknown>) {
  const direct = numeric(treatment.mills ?? treatment.date ?? treatment.timestamp);
  if (direct !== undefined && direct > 0) {
    return direct < 10_000_000_000 ? direct * 1_000 : direct;
  }
  return typeof treatment.created_at === 'string'
    ? parseExternalAbsoluteTimestamp(treatment.created_at)
    : undefined;
}

/**
 * Milliseconds when AAPS supplied them, otherwise Nightscout's whole
 * minutes. Zero means "until changed" for most AAPS records; `undefined`
 * means no duration was supplied.
 */
function recordedDurationMs(treatment: Record<string, unknown>) {
  const exact = numeric(treatment.durationInMilliseconds);
  if (exact !== undefined && exact >= 0) return exact;
  const minutes = numeric(treatment.duration);
  if (minutes !== undefined && minutes >= 0) return minutes * 60_000;
  return undefined;
}

function boundedDuration(value: number | undefined) {
  return value !== undefined && value > 0 && value <= MAX_PROGRAMMED_MS
    ? value
    : undefined;
}

export function temporaryTargetReason(value: unknown): TemporaryTargetReason | undefined {
  const reason = text(value).toLowerCase().replace(/[_-]+/g, ' ');
  if (!reason) return undefined;
  if (reason === 'activity' || reason === 'exercise') return 'activity';
  if (reason === 'hypo' || reason === 'hypoglycemia' || reason === 'hypoglycaemia') return 'hypo';
  if (reason === 'eating soon') return 'eating-soon';
  if (reason === 'custom') return 'custom';
  if (reason === 'automation') return 'automation';
  if (reason === 'wear') return 'wear';
  return 'other';
}

const RUNNING_MODES: Record<string, LoopRunningMode> = {
  CLOSED_LOOP: 'closed-loop',
  CLOSED_LOOP_LGS: 'closed-loop-lgs',
  OPEN_LOOP: 'open-loop',
  DISABLED_LOOP: 'disabled-loop',
  SUPER_BOLUS: 'super-bolus',
  DISCONNECTED_PUMP: 'disconnected-pump',
  SUSPENDED_BY_PUMP: 'suspended-by-pump',
  SUSPENDED_BY_USER: 'suspended-by-user',
  SUSPENDED_BY_DST: 'suspended-by-dst',
};

/** "OpenAPS Offline" reasons written before AAPS had running modes. */
const LEGACY_OFFLINE_REASONS: Record<string, LoopRunningMode> = {
  DISCONNECT_PUMP: 'disconnected-pump',
  SUSPEND: 'suspended-by-user',
  DISABLE_LOOP: 'disabled-loop',
  SUPER_BOLUS: 'super-bolus',
};

const ONGOING_MODES = new Set<LoopRunningMode>([
  'closed-loop',
  'closed-loop-lgs',
  'open-loop',
  'disabled-loop',
]);

function profilePercentageFromName(name: string) {
  const match = /\((\d{1,3})%/.exec(name);
  return match ? Number(match[1]) : undefined;
}

/**
 * Turns one stored Nightscout-shaped treatment into a therapy-state event,
 * or `undefined` when it is not one. Withdrawn records are ignored.
 */
export function therapyStateEventFromTreatment(
  treatment: Record<string, unknown>,
  source: TherapyStateSourceRef,
): TherapyStateEvent | undefined {
  if (!treatment || typeof treatment !== 'object' || treatment.isValid === false) {
    return undefined;
  }
  const start = treatmentTimestamp(treatment);
  if (start === undefined) return undefined;
  const eventType = text(treatment.eventType, 40);
  const duration = recordedDurationMs(treatment);
  const base = { start, source };

  if (/^temporary target cancel$/i.test(eventType)) {
    return { ...base, kind: 'temporary-target', isEnd: true };
  }
  if (/^temporary target$/i.test(eventType)) {
    const target = temporaryTargetRange(treatment.targetBottom, treatment.targetTop, treatment.units, source.sourceId);
    const reasonText = text(treatment.reason, 40) || undefined;
    const hasRecordedTarget =
      (treatment.targetBottom !== undefined && treatment.targetBottom !== null) ||
      (treatment.targetTop !== undefined && treatment.targetTop !== null);
    // A zero duration, or neither a target nor a reason (AAPS's xDrip+
    // cancel shape), cancels the running target.
    if (duration === 0 || (!hasRecordedTarget && !reasonText)) {
      return { ...base, kind: 'temporary-target', isEnd: true };
    }
    return {
      ...base,
      kind: 'temporary-target',
      isEnd: false,
      programmedDurationMs: boundedDuration(duration),
      targetReason: temporaryTargetReason(reasonText),
      reasonText,
      targetLowMmolL: target?.targetLowMmolL,
      targetHighMmolL: target?.targetHighMmolL,
    };
  }
  if (/^profile switch$/i.test(eventType)) {
    const customized = text(treatment.profile);
    const original = text(treatment.originalProfileName);
    const percentage =
      numeric(treatment.percentage) ?? profilePercentageFromName(customized);
    const timeshift = numeric(treatment.timeshift);
    // AAPS's originalDuration is exact milliseconds; 0 means until changed.
    const original_ms = numeric(treatment.originalDuration);
    const programmed = original_ms !== undefined && original_ms >= 0
      ? original_ms
      : duration;
    return {
      ...base,
      kind: 'profile-switch',
      isEnd: false,
      programmedDurationMs: boundedDuration(programmed),
      profileName: original || customized || undefined,
      percentage:
        percentage !== undefined && percentage > 0 && percentage <= 1_000
          ? percentage
          : undefined,
      timeshiftHours:
        timeshift !== undefined && Math.abs(timeshift) <= 23 ? timeshift : undefined,
    };
  }
  if (/^openaps offline$/i.test(eventType)) {
    const mode =
      RUNNING_MODES[text(treatment.mode, 40).toUpperCase()] ??
      LEGACY_OFFLINE_REASONS[text(treatment.reason, 40).toUpperCase()] ??
      'unknown';
    const originalMs = numeric(treatment.originalDuration);
    // AAPS writes ongoing modes with duration 0 and an open-ended disabled
    // loop as ten years; originalDuration 0 marks both as "until changed".
    const programmed = originalMs !== undefined && originalMs >= 0 ? originalMs : duration;
    const temporaryOverlay = !ONGOING_MODES.has(mode);
    return {
      ...base,
      kind: 'loop-mode',
      isEnd: false,
      temporaryOverlay,
      programmedDurationMs: boundedDuration(programmed),
      loopMode: mode,
      autoForced: treatment.autoForced === true ? true : undefined,
      reasonText: text(treatment.reasons, 80) || undefined,
      suspendBasis: mode.startsWith('suspended') ? 'running-mode' : undefined,
    };
  }
  if (/^pump suspend$/i.test(eventType)) {
    return {
      ...base,
      kind: 'pump-suspend',
      isEnd: false,
      programmedDurationMs: boundedDuration(duration),
      suspendBasis: 'pump-event',
    };
  }
  if (/^pump resume$/i.test(eventType)) {
    return { ...base, kind: 'pump-suspend', isEnd: true };
  }
  if (/^temp(?:orary)? basal$/i.test(eventType)) {
    const type = text(treatment.type, 40).toUpperCase();
    if (type !== 'PUMP_SUSPEND' && type !== 'EMULATED_PUMP_SUSPEND') return undefined;
    const programmed = boundedDuration(duration);
    if (programmed === undefined) return undefined;
    return {
      ...base,
      kind: 'pump-suspend',
      isEnd: false,
      programmedDurationMs: programmed,
      suspendBasis: 'temp-basal',
    };
  }
  // Logged exercise: AAPS's "Exercise" event, or a timed note that names
  // exercise or activity (Nightscout careportal).
  if (
    /^exercise$/i.test(eventType) ||
    (/^(?:note|announcement|activity)$/i.test(eventType) &&
      /\b(?:exercise|activity)\b/i.test(`${text(treatment.notes)} ${text(treatment.reason)}`))
  ) {
    const programmed = boundedDuration(duration);
    if (programmed === undefined) return undefined;
    return {
      ...base,
      kind: 'exercise',
      isEnd: false,
      programmedDurationMs: programmed,
    };
  }
  return undefined;
}

export interface TherapyStateRawRecord {
  id: string;
  sourceId: string;
  recordKind: string;
  sourceFile: string;
  payloadJson: string;
}

export function therapyStateEventsFromRawRecords(
  records: readonly TherapyStateRawRecord[],
): TherapyStateEvent[] {
  const kinds = new Set<string>(THERAPY_STATE_RAW_RECORD_KINDS);
  return records.flatMap((record) => {
    if (!kinds.has(record.recordKind)) return [];
    let payload: unknown;
    try {
      payload = JSON.parse(record.payloadJson);
    } catch {
      return [];
    }
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return [];
    const event = therapyStateEventFromTreatment(payload as Record<string, unknown>, {
      rawRecordId: record.id,
      sourceId: record.sourceId,
      sourceFile: record.sourceFile,
    });
    return event ? [event] : [];
  });
}

/** Nightscout (read with the user's token) first, then a confirmed, then an unconfirmed phone sender. */
function sourceRank(source: TherapyStateSourceRef) {
  if (source.sourceId === 'nightscout') return 0;
  if (/sender confirmed/i.test(source.sourceFile)) return 1;
  return 2;
}

function closeNumber(left: number | undefined, right: number | undefined, tolerance: number) {
  if (left === undefined || right === undefined) return left === right;
  return Math.abs(left - right) <= tolerance;
}

function sameRecord(left: TherapyStateEvent, right: TherapyStateEvent) {
  if (left.kind !== right.kind || left.isEnd !== right.isEnd) return false;
  if (Math.abs(left.start - right.start) > DUPLICATE_START_TOLERANCE_MS) return false;
  switch (left.kind) {
    case 'temporary-target':
      return (
        left.targetReason === right.targetReason &&
        closeNumber(left.targetLowMmolL, right.targetLowMmolL, 0.12) &&
        closeNumber(left.targetHighMmolL, right.targetHighMmolL, 0.12)
      );
    case 'profile-switch':
      return (
        (left.percentage ?? 100) === (right.percentage ?? 100) &&
        (left.profileName ?? '') === (right.profileName ?? '')
      );
    case 'loop-mode':
      return left.loopMode === right.loopMode;
    case 'pump-suspend':
      return left.suspendBasis === right.suspendBasis;
    default:
      return true;
  }
}

interface MergedEvent {
  event: TherapyStateEvent;
  duplicates: TherapyStateSourceRef[];
}

/**
 * The same AAPS record can arrive from Nightscout and from this phone. One
 * copy is kept per record, preferring Nightscout; the others stay listed as
 * duplicates. Two records from the same source are never merged.
 */
export function mergeTherapyStateEvents(events: readonly TherapyStateEvent[]): MergedEvent[] {
  const ordered = [...events].sort(
    (left, right) =>
      sourceRank(left.source) - sourceRank(right.source) ||
      left.start - right.start ||
      left.source.rawRecordId.localeCompare(right.source.rawRecordId),
  );
  const kept: MergedEvent[] = [];
  for (const event of ordered) {
    const match = kept.find(
      (candidate) =>
        candidate.event.source.sourceId !== event.source.sourceId &&
        !candidate.duplicates.some((copy) => copy.sourceId === event.source.sourceId) &&
        sameRecord(candidate.event, event),
    );
    if (match) {
      match.duplicates.push(event.source);
    } else {
      kept.push({ event, duplicates: [] });
    }
  }
  return kept.sort(
    (left, right) =>
      left.event.start - right.event.start ||
      left.event.source.rawRecordId.localeCompare(right.event.source.rawRecordId),
  );
}

function isBaseline(event: TherapyStateEvent, programmed: number | undefined) {
  if (event.kind === 'loop-mode') return event.loopMode === 'closed-loop';
  if (event.kind === 'profile-switch') {
    return (
      programmed === undefined &&
      (event.percentage ?? 100) === 100 &&
      (event.timeshiftHours ?? 0) === 0
    );
  }
  return false;
}

/**
 * Builds intervals from merged events. A later record of the same kind ends
 * an earlier one (Nightscout's own rule); a cancel or resume record ends it
 * with no successor; a recorded duration ends it otherwise. With none of
 * these, the interval is `open` and runs to `openUntil`.
 *
 * Running modes: a temporary overlay (suspension, disconnection, super
 * bolus) ends at its duration or at the next running-mode record; an ongoing
 * mode (closed, open, disabled loop) runs until the next ongoing mode.
 */
export function resolveTherapyStateIntervals(
  events: readonly TherapyStateEvent[],
  openUntil: number,
): TherapyStateInterval[] {
  const merged = mergeTherapyStateEvents(events);
  const intervals: TherapyStateInterval[] = [];
  merged.forEach(({ event, duplicates }, index) => {
    if (event.isEnd || event.start >= openUntil) return;
    const next = merged.slice(index + 1).find(
      ({ event: candidate }) =>
        candidate.kind === event.kind &&
        candidate.start > event.start &&
        // An ongoing running mode is not ended by a temporary overlay.
        (event.kind !== 'loop-mode' ||
          event.temporaryOverlay === true ||
          candidate.temporaryOverlay !== true),
    )?.event;
    const programmed = event.programmedDurationMs;
    const programmedEnd = programmed !== undefined ? event.start + programmed : undefined;
    let end: number;
    let endBasis: TherapyStateEndBasis;
    if (programmedEnd !== undefined && (next === undefined || programmedEnd <= next.start)) {
      end = programmedEnd;
      endBasis = 'programmed';
    } else if (next !== undefined) {
      end = next.start;
      endBasis = next.isEnd ? 'cancelled' : 'next-record';
    } else {
      end = openUntil;
      endBasis = 'open';
    }
    if (endBasis === 'open' || end > openUntil) {
      end = Math.min(end, openUntil);
    }
    if (end <= event.start) return;
    intervals.push({
      id: `therapy-state:${event.source.rawRecordId}`,
      kind: event.kind,
      start: event.start,
      end,
      endBasis,
      programmedDurationMs: programmed,
      baseline: isBaseline(event, programmed),
      targetReason: event.targetReason,
      reasonText: event.reasonText,
      targetLowMmolL: event.targetLowMmolL,
      targetHighMmolL: event.targetHighMmolL,
      profileName: event.profileName,
      percentage: event.percentage,
      timeshiftHours: event.timeshiftHours,
      loopMode: event.loopMode,
      autoForced: event.autoForced,
      suspendBasis: event.suspendBasis,
      source: event.source,
      duplicateSources: duplicates,
    });
  });
  return intervals.sort((left, right) => left.start - right.start || left.id.localeCompare(right.id));
}

/** Resolve the recent records and their predecessors, then keep intervals that overlap the requested period. */
export function therapyStatesForRange(
  records: readonly TherapyStateRawRecord[],
  range: TimeRange,
  now: number,
): TherapyStateInterval[] {
  const openUntil = Math.min(range.end, now);
  return resolveTherapyStateIntervals(therapyStateEventsFromRawRecords(records), openUntil)
    .filter((interval) => interval.start < range.end && interval.end > range.start);
}
