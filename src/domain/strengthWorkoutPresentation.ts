import type { StrengthWorkoutSet } from './models';
import {
  formatDistance as formatRegionalDistance,
  formatRegionalNumber,
  formatWeight,
} from './regionalFormat';
import { getRuntimeRegionalDefaults } from './regionalProfileRuntime';

function compactDecimal(value: number, maximumFractionDigits = 1) {
  return formatRegionalNumber(value, getRuntimeRegionalDefaults().locale, {
    maximumFractionDigits,
    minimumFractionDigits: 0,
  });
}

function formatSetType(type: string) {
  const normalized = type.trim().toLowerCase();
  if (!normalized || normalized === 'normal') return undefined;
  if (normalized === 'warmup' || normalized === 'warm_up') return 'Warm-up';
  if (normalized === 'dropset' || normalized === 'drop_set') return 'Drop set';
  if (normalized === 'failure') return 'To failure';
  return normalized
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function formatDuration(seconds: number) {
  const rounded = Math.max(0, Math.round(seconds));
  const hours = Math.floor(rounded / 3_600);
  const minutes = Math.floor((rounded % 3_600) / 60);
  const remainder = rounded % 60;
  return [
    hours ? `${compactDecimal(hours, 0)} hr` : undefined,
    minutes ? `${compactDecimal(minutes, 0)} min` : undefined,
    remainder || (!hours && !minutes)
      ? `${compactDecimal(remainder, 0)} sec`
      : undefined,
  ]
    .filter(Boolean)
    .join(' ');
}

function formatDistance(metres: number) {
  return formatRegionalDistance(metres, getRuntimeRegionalDefaults());
}

/** Turns the exact metrics retained from Hevy into one scan-friendly set line. */
export function formatStrengthWorkoutSet(set: StrengthWorkoutSet) {
  const parts = [
    formatSetType(set.type),
    set.weightKilograms === undefined
      ? undefined
      : formatWeight(set.weightKilograms, getRuntimeRegionalDefaults()),
    set.reps === undefined
      ? undefined
      : `${compactDecimal(set.reps)} ${set.reps === 1 ? 'rep' : 'reps'}`,
    set.durationSeconds === undefined
      ? undefined
      : formatDuration(set.durationSeconds),
    set.distanceMetres === undefined
      ? undefined
      : formatDistance(set.distanceMetres),
    set.rpe === undefined ? undefined : `RPE ${compactDecimal(set.rpe)}`,
    set.customMetric === undefined
      ? undefined
      : `Custom metric ${compactDecimal(set.customMetric, 2)}`,
  ].filter((part): part is string => Boolean(part));

  return parts.length ? parts.join(' · ') : 'Recorded set';
}
