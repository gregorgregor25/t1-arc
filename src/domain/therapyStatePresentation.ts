import { formatGlucose, formatRegionalNumber, glucoseUnitLabel } from './regionalFormat';
import { getRuntimeRegionalDefaults } from './regionalProfileRuntime';
import type {
  LoopRunningMode,
  TemporaryTargetReason,
  TherapyStateInterval,
  TherapyStateSourceRef,
} from './therapyStates';
import { formatShortDate, formatTime, toDateKey } from './time';

/**
 * Plain wording for recorded AAPS therapy states. Every phrase describes
 * what was recorded; none suggests a setting.
 */

const TARGET_REASON_LABELS: Record<TemporaryTargetReason, string> = {
  activity: 'Activity',
  hypo: 'Hypo',
  'eating-soon': 'Eating soon',
  custom: 'Custom',
  automation: 'Automation',
  wear: 'Watch',
  other: 'Other',
};

const LOOP_MODE_LABELS: Record<LoopRunningMode, string> = {
  'closed-loop': 'Closed loop',
  'closed-loop-lgs': 'Closed loop, low-glucose suspend only',
  'open-loop': 'Open loop',
  'disabled-loop': 'Loop disabled',
  'super-bolus': 'Superbolus mode',
  'disconnected-pump': 'Pump disconnected',
  'suspended-by-pump': 'Loop suspended by the pump',
  'suspended-by-user': 'Loop suspended',
  'suspended-by-dst': 'Loop suspended for a clock change',
  unknown: 'Loop running mode not recognised',
};

export function temporaryTargetReasonLabel(state: Pick<TherapyStateInterval, 'targetReason' | 'reasonText'>) {
  if (!state.targetReason) return undefined;
  if (state.targetReason === 'other') return state.reasonText || undefined;
  return TARGET_REASON_LABELS[state.targetReason];
}

function signedHours(hours: number) {
  const regional = getRuntimeRegionalDefaults();
  return `${formatRegionalNumber(hours, regional.locale, {
    maximumFractionDigits: 1,
    signDisplay: 'exceptZero',
  })} h`;
}

export function formatTherapyTarget(
  state: Pick<TherapyStateInterval, 'targetLowMmolL' | 'targetHighMmolL'>,
  regional: Parameters<typeof formatGlucose>[1] = getRuntimeRegionalDefaults(),
) {
  const low = state.targetLowMmolL;
  const high = state.targetHighMmolL;
  if (low === undefined || high === undefined) return undefined;
  const lowText = formatGlucose(low, regional, { withUnit: false });
  const highText = formatGlucose(high, regional, { withUnit: false });
  const unit = glucoseUnitLabel(regional.glucoseUnit);
  return lowText === highText ? `${highText} ${unit}` : `${lowText}–${highText} ${unit}`;
}

/** A short title, for example "Activity temporary target" or "Profile at 80%". */
export function therapyStateTitle(state: TherapyStateInterval) {
  switch (state.kind) {
    case 'temporary-target': {
      const reason = temporaryTargetReasonLabel(state);
      return reason ? `${reason} temporary target` : 'Temporary target';
    }
    case 'profile-switch': {
      const parts: string[] = [];
      if (state.percentage !== undefined && state.percentage !== 100) {
        parts.push(`${formatRegionalNumber(state.percentage, getRuntimeRegionalDefaults().locale, { maximumFractionDigits: 0 })}%`);
      }
      if (state.timeshiftHours) parts.push(`time shift ${signedHours(state.timeshiftHours)}`);
      return parts.length ? `Profile at ${parts.join(', ')}` : 'Profile switch';
    }
    case 'loop-mode':
      return LOOP_MODE_LABELS[state.loopMode ?? 'unknown'];
    case 'pump-suspend':
      return 'Pump suspended';
    case 'exercise':
      return 'Exercise logged';
  }
}

/** The recorded settings that belong with the title, if any. */
export function therapyStateDetail(state: TherapyStateInterval) {
  switch (state.kind) {
    case 'temporary-target': {
      const target = formatTherapyTarget(state);
      return target ? `target ${target}` : undefined;
    }
    case 'profile-switch':
      return state.profileName ? `profile "${state.profileName}"` : undefined;
    case 'loop-mode':
      return state.autoForced ? 'set automatically by AAPS' : undefined;
    case 'pump-suspend':
      return state.suspendBasis === 'temp-basal'
        ? 'recorded as a zero-rate temporary basal'
        : undefined;
    default:
      return undefined;
  }
}

export function therapyStateLabel(state: TherapyStateInterval) {
  const detail = therapyStateDetail(state);
  return detail ? `${therapyStateTitle(state)} (${detail})` : therapyStateTitle(state);
}

function localTime(timestamp: number, includeDate: boolean) {
  return includeDate
    ? `${formatShortDate(toDateKey(timestamp))} ${formatTime(timestamp)}`
    : formatTime(timestamp);
}

/** "17:00–18:30", with dates when the interval crosses midnight or `withDate` is set. */
export function formatTherapyStateSpan(
  state: Pick<TherapyStateInterval, 'start' | 'end'>,
  withDate = false,
) {
  const crossesDay = toDateKey(state.start) !== toDateKey(state.end);
  const start = localTime(state.start, withDate || crossesDay);
  const end = localTime(state.end, crossesDay);
  return `${start}–${end}`;
}

export function therapyStateEndNote(state: TherapyStateInterval) {
  switch (state.endBasis) {
    case 'open':
      return 'no end was recorded; shown to the end of the records read';
    case 'next-record':
      return 'ended when the next record of this kind started';
    case 'cancelled':
      return 'ended by a cancel or resume record';
    default:
      return undefined;
  }
}

export function therapyStateSourceName(source: TherapyStateSourceRef) {
  if (source.sourceId === 'nightscout') return 'Nightscout';
  return /sender confirmed/i.test(source.sourceFile)
    ? 'AAPS on this phone, sender confirmed'
    : 'AAPS on this phone, sender not verified';
}

export function therapyStateSourceNote(state: TherapyStateInterval) {
  const names = [state.source, ...state.duplicateSources]
    .map(therapyStateSourceName)
    .filter((name, index, all) => all.indexOf(name) === index);
  return names.join('; also ');
}

/**
 * "Activity temporary target (target 8.0 mmol/L), recorded 17:00–18:30".
 * The word "recorded" keeps each line a description of a record.
 */
export function describeTherapyState(state: TherapyStateInterval, withDate = false) {
  const end = therapyStateEndNote(state);
  return `${therapyStateLabel(state)}, recorded ${formatTherapyStateSpan(state, withDate)}${end ? ` (${end})` : ''}`;
}

/** Raw source record IDs behind an interval, for the evidence inspector. */
export function therapyStateRecordIds(state: TherapyStateInterval) {
  return [state.source, ...state.duplicateSources].map(({ rawRecordId }) => rawRecordId);
}

/** States that are worth naming as context: everything except the ordinary background state. */
export function notableTherapyStates(states: readonly TherapyStateInterval[] | undefined) {
  return (states ?? []).filter((state) => !state.baseline);
}

export type TherapyStateTone = 'target' | 'profile' | 'interruption';

/** Groups states into the three colours the timeline lane uses. */
export function therapyStateTone(state: Pick<TherapyStateInterval, 'kind'>): TherapyStateTone {
  switch (state.kind) {
    case 'profile-switch':
      return 'profile';
    case 'loop-mode':
    case 'pump-suspend':
      return 'interruption';
    default:
      return 'target';
  }
}

export const THERAPY_STATE_TONE_LABELS: Record<TherapyStateTone, string> = {
  target: 'Temporary target or exercise',
  profile: 'Profile switch',
  interruption: 'Loop mode or pump suspend',
};
