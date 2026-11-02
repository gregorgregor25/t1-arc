import type { AapsContextObservation } from '@/data/aaps/types';
import { formatRegionalNumber } from '@/domain/regionalFormat';
import { FUTURE_CLOCK_SKEW_TOLERANCE_MS, relativeAge } from '@/domain/time';

export interface AapsEstimateInput {
  context?: AapsContextObservation;
  unavailable?: boolean;
}

export function aapsEstimatePresentation(input: AapsEstimateInput, now: number, locale: string) {
  const context = input.unavailable ? undefined : input.context;
  const number = (value: number | undefined, digits: number, unit: string) =>
    value === undefined || !Number.isFinite(value)
      ? 'Unavailable'
      : `${formatRegionalNumber(value, locale, {
          minimumFractionDigits: digits, maximumFractionDigits: digits,
        })} ${unit}`;
  const iob = number(context?.iobUnits, 2, 'U');
  const cob = number(context?.cobGrams, 1, 'g');
  const hasEstimates = iob !== 'Unavailable' || cob !== 'Unavailable';
  const receivedAt = hasEstimates ? context?.receivedAt : undefined;
  const clockMismatch = receivedAt !== undefined && receivedAt - now > FUTURE_CLOCK_SKEW_TOLERANCE_MS;
  const stale = receivedAt !== undefined && (now - receivedAt > 12 * 60_000 || clockMismatch);
  const age = input.unavailable ? 'Estimates could not be checked'
    : receivedAt !== undefined ? `Received ${relativeAge(receivedAt, now)}`
      : context ? 'No estimates in the latest broadcast' : 'Waiting for AAPS estimates';
  const note = input.unavailable
    ? 'Open Settings to check the local AAPS source.'
    : clockMismatch ? 'The estimate receipt time is ahead of this phone’s clock.'
      : stale ? 'No recent estimates received. These estimates may be out of date.'
        : 'Calculated by AAPS; not delivered insulin or logged carbs.';
  return { iob, cob, age, note, stale, accessibilityLabel:
    `AAPS estimates. Insulin on board: ${iob.replace(/ U$/, ' units')}. Carbs on board: ${cob.replace(/ g$/, ' grams')}. ${age}. ${note}` };
}
