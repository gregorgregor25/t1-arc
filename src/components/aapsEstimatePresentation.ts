import type { AapsContextObservation } from '@/data/aaps/types';
import type { NightscoutIobCobSnapshot } from '@/data/nightscout/types';
import { formatRegionalNumber } from '@/domain/regionalFormat';
import { FUTURE_CLOCK_SKEW_TOLERANCE_MS, relativeAge } from '@/domain/time';

/** Who calculated the estimates shown beside glucose. */
export type OnBoardEstimateProvenance = 'aaps' | 'nightscout';

export interface AapsEstimateInput {
  /** Defaults to AAPS; Nightscout estimates come from the user's looping system. */
  provenance?: OnBoardEstimateProvenance;
  /** An AAPS observation, or just the estimate fields from another source. */
  context?: Pick<AapsContextObservation, 'iobUnits' | 'cobGrams' | 'receivedAt'> &
    Partial<AapsContextObservation>;
  unavailable?: boolean;
}

const COPY: Record<OnBoardEstimateProvenance, {
  heading: string;
  received: string;
  noEstimates: string;
  waiting: string;
  unavailable: string;
  clockMismatch: string;
  calculated: string;
}> = {
  aaps: {
    heading: 'AAPS estimates',
    received: 'Received',
    noEstimates: 'No estimates in the latest broadcast',
    waiting: 'Waiting for AAPS estimates',
    unavailable: 'Open Settings to check the local AAPS source.',
    clockMismatch: 'The estimate receipt time is ahead of this phone’s clock.',
    calculated: 'Calculated by AAPS; not delivered insulin or logged carbs.',
  },
  nightscout: {
    heading: 'Estimates via Nightscout',
    received: 'Reported',
    noEstimates: 'No estimates in the latest Nightscout status',
    waiting: 'Waiting for Nightscout estimates',
    unavailable: 'Open Settings to check the Nightscout connection.',
    clockMismatch: 'The estimate time is ahead of this phone’s clock.',
    calculated:
      'Calculated by your looping system via Nightscout; not delivered insulin or logged carbs.',
  },
};

export function aapsEstimatePresentation(input: AapsEstimateInput, now: number, locale: string) {
  const copy = COPY[input.provenance ?? 'aaps'];
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
    : receivedAt !== undefined ? `${copy.received} ${relativeAge(receivedAt, now)}`
      : context ? copy.noEstimates : copy.waiting;
  const note = input.unavailable
    ? copy.unavailable
    : clockMismatch ? copy.clockMismatch
      : stale ? 'No recent estimates received. These estimates may be out of date.'
        : copy.calculated;
  return { heading: copy.heading, iob, cob, age, note, stale, accessibilityLabel:
    `${copy.heading}. Insulin on board: ${iob.replace(/ U$/, ' units')}. Carbs on board: ${cob.replace(/ g$/, ' grams')}. ${age}. ${note}` };
}

/**
 * The estimate input for the combined Today card, or undefined when
 * Nightscout has not reported IOB or COB recently. The card then keeps its
 * usual glucose-only layout instead of showing empty estimates.
 */
export function nightscoutCardEstimates(
  snapshot: NightscoutIobCobSnapshot | undefined,
): AapsEstimateInput | undefined {
  if (!snapshot) return undefined;
  if (snapshot.iobUnits === undefined && snapshot.cobGrams === undefined) return undefined;
  return {
    provenance: 'nightscout',
    context: {
      iobUnits: snapshot.iobUnits,
      cobGrams: snapshot.cobGrams,
      receivedAt: snapshot.timestamp,
    },
  };
}
