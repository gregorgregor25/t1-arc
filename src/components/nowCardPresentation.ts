import type { GlucoseRange } from '@/domain/glucoseAppearance';
import { recordSourceLabel } from '@/domain/recordSourceLabels';
import type { SourceFreshness } from '@/domain/models';
import { formatRegionalNumber } from '@/domain/regionalFormat';
import { getRuntimeRegionalDefaults } from '@/domain/regionalProfileRuntime';
import {
  temporaryTargetReasonLabel,
  therapyStateLabel,
  therapyStateSourceNote,
  therapyStateTitle,
} from '@/domain/therapyStatePresentation';
import type { TherapyStateInterval } from '@/domain/therapyStates';
import { formatShortDate, formatTime, toDateKey } from '@/domain/time';

/**
 * What the Today "Now" card is saying, in one word plus a shape. The shape
 * keeps the state readable without colour:
 *
 * - `circle`: in range
 * - `triangle-up`: high or very high
 * - `triangle-down`: low or very low
 * - `ring`: no recent reading
 */
export type NowCardMode = 'normal' | 'low' | 'stale';
export type NowStateShape = 'circle' | 'triangle-up' | 'triangle-down' | 'ring';

export interface NowCardState {
  mode: NowCardMode;
  word: string;
  shape: NowStateShape;
}

/**
 * The whole card changes only when it matters: a current low or very low
 * value, or a reading that is too old to treat as current.
 */
export function nowCardState(range: GlucoseRange, freshness: SourceFreshness): NowCardState {
  if (freshness === 'stale' || freshness === 'missing' || range === 'stale') {
    return { mode: 'stale', word: 'No new reading', shape: 'ring' };
  }
  switch (range) {
    case 'veryLow':
      return { mode: 'low', word: 'Very low', shape: 'triangle-down' };
    case 'low':
      return { mode: 'low', word: 'Low', shape: 'triangle-down' };
    case 'high':
      return { mode: 'normal', word: 'High', shape: 'triangle-up' };
    case 'veryHigh':
      return { mode: 'normal', word: 'Very high', shape: 'triangle-up' };
    case 'target':
      return { mode: 'normal', word: 'In range', shape: 'circle' };
  }
}

const SHORT_SOURCE_NAMES: Readonly<Record<string, string>> = {
  'aaps-local': 'AAPS',
  'android-notification': 'The notification source',
};

/** Short source name for "3 min ago · AAPS" and the stale message. */
export function nowCardSourceName(sourceId: string | undefined): string | undefined {
  if (!sourceId) return undefined;
  return SHORT_SOURCE_NAMES[sourceId] ?? recordSourceLabel(sourceId);
}

/**
 * Plain explanation for a reading that stopped updating. Says what is known
 * (the last time) and where to look, without guessing at the cause.
 */
export function staleReadingMessage(
  sourceName: string | undefined,
  lastTime: string,
  options: { clockAhead?: boolean } = {},
) {
  if (options.clockAhead) {
    return `This reading is dated ${lastTime}, which is ahead of this phone's clock, so it is not shown as current. Check this phone's date, time and time zone. Use a meter if you need a reading now.`;
  }
  const source = sourceName && sourceName !== 'Other source' ? sourceName : 'Your glucose source';
  const check = sourceName && sourceName !== 'Other source' ? `your sensor and ${sourceName}` : 'your sensor and glucose source';
  return `${source} has not sent a glucose reading since ${lastTime}. Check ${check}. Use a meter if you need a reading now.`;
}

/** Readings dated more than this far ahead of the phone clock are a clock mismatch. */
export const NOW_CARD_CLOCK_AHEAD_MS = 120_000;

/** Plain statement of which configured level the current value is below. */
export function lowReadingMessage(range: GlucoseRange, levelText: string) {
  return range === 'veryLow'
    ? `At or below your very low level of ${levelText}.`
    : `Below your low level of ${levelText}.`;
}

/**
 * Recorded AAPS therapy states that are active right now, for the one calm
 * line under the Now card ("Activity target until 11:30"). The line only
 * repeats what AAPS recorded; it never suggests a setting.
 */
export interface NowTherapyStateLine {
  id: string;
  /** "Activity target until 11:30" */
  text: string;
  /** Full description for the tap-to-show detail and screen readers. */
  detail: string;
  /** Where the record came from, for example "AAPS on this phone, sender confirmed". */
  source: string;
  state: TherapyStateInterval;
}

/** Records older than this are not treated as describing "now". */
export const NOW_THERAPY_STATE_MAX_AGE_MS = 30 * 60_000;
/** At most this many lines show at once; the rest stay on the timeline. */
export const NOW_THERAPY_STATE_LIMIT = 2;

const NOW_THERAPY_STATE_PRIORITY: Partial<Record<TherapyStateInterval['kind'], number>> = {
  'pump-suspend': 0,
  'loop-mode': 1,
  'temporary-target': 2,
  'profile-switch': 3,
};

/**
 * When the recorded state is due to end, or `undefined` when it stays until
 * the next change. Interval ends are cut at the time the records were read,
 * so a programmed state uses its recorded duration instead.
 */
export function therapyStateRecordedUntil(state: TherapyStateInterval): number | undefined {
  if (state.endBasis === 'open') return undefined;
  if (state.endBasis === 'programmed' && state.programmedDurationMs !== undefined) {
    return state.start + state.programmedDurationMs;
  }
  return state.end;
}

function shortTherapyStateName(state: TherapyStateInterval): string {
  const locale = getRuntimeRegionalDefaults().locale;
  switch (state.kind) {
    case 'temporary-target': {
      const reason = temporaryTargetReasonLabel(state);
      return reason ? `${reason} target` : 'Temporary target';
    }
    case 'profile-switch': {
      const parts: string[] = [];
      if (state.percentage !== undefined && state.percentage !== 100) {
        parts.push(`${formatRegionalNumber(state.percentage, locale, { maximumFractionDigits: 0 })}%`);
      }
      if (state.timeshiftHours) {
        parts.push(`time shift ${formatRegionalNumber(state.timeshiftHours, locale, {
          maximumFractionDigits: 1,
          signDisplay: 'exceptZero',
        })} h`);
      }
      return parts.length ? `Profile ${parts.join(', ')}` : 'Profile switch';
    }
    default:
      return therapyStateTitle(state);
  }
}

function untilText(until: number | undefined, at: number) {
  if (until === undefined) return 'until next change';
  return toDateKey(until) === toDateKey(at)
    ? `until ${formatTime(until)}`
    : `until ${formatShortDate(toDateKey(until))} ${formatTime(until)}`;
}

/**
 * Picks the recorded states active at `at` and words them. Shows nothing
 * when the records are missing or older than {@link NOW_THERAPY_STATE_MAX_AGE_MS}
 * (`recordsFreshAt` is when T1 Arc last saw current AAPS data). Baseline
 * states (closed loop, 100% profile) and logged exercise are left out.
 * Overlapping states are ordered pump suspend, loop mode, temporary target,
 * profile, then most recent first, and at most {@link NOW_THERAPY_STATE_LIMIT} show.
 */
export function nowTherapyStateLines(
  states: readonly TherapyStateInterval[] | undefined,
  at: number,
  recordsFreshAt: number | undefined,
): NowTherapyStateLine[] {
  if (!states?.length || recordsFreshAt === undefined) return [];
  if (at - recordsFreshAt > NOW_THERAPY_STATE_MAX_AGE_MS) return [];
  return states
    .filter((state) => {
      if (state.baseline || NOW_THERAPY_STATE_PRIORITY[state.kind] === undefined) return false;
      if (state.start > at) return false;
      const until = therapyStateRecordedUntil(state);
      return until === undefined || until > at;
    })
    .sort((left, right) =>
      (NOW_THERAPY_STATE_PRIORITY[left.kind] ?? 9) - (NOW_THERAPY_STATE_PRIORITY[right.kind] ?? 9)
      || right.start - left.start
      || left.id.localeCompare(right.id))
    .slice(0, NOW_THERAPY_STATE_LIMIT)
    .map((state) => {
      const until = therapyStateRecordedUntil(state);
      const text = `${shortTherapyStateName(state)} ${untilText(until, at)}`;
      const started = toDateKey(state.start) === toDateKey(at)
        ? formatTime(state.start)
        : `${formatShortDate(toDateKey(state.start))} ${formatTime(state.start)}`;
      return {
        id: state.id,
        text,
        detail: `${therapyStateLabel(state)}, recorded from ${started}, ${untilText(until, at)}.`,
        source: therapyStateSourceNote(state),
        state,
      };
    });
}
