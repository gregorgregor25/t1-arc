import type { BasalDelivery, BolusDelivery, TimeRange } from './models';

/**
 * Provenance labels for AAPS treatments received on this phone. Android
 * usually cannot confirm the sender of AAPS's broadcast; the confirmed label
 * is used only when it did and the sender was AAPS.
 */
export const AAPS_LOCAL_UNVERIFIED_SOURCE_FILE = 'Received on this phone; sender not verified';
export const AAPS_LOCAL_VERIFIED_SOURCE_FILE =
  'Received on this phone from AAPS; sender confirmed by Android';

/** Insulin records AAPS made, received on this phone or read from Nightscout. */
export const AAPS_INSULIN_SOURCE_IDS = ['aaps-local', 'nightscout'] as const;

export type AapsNightscoutFillState = 'on' | 'off' | 'not-connected';

export interface AapsInsulinProvenanceInput {
  /** The glucose source chosen in T1 Arc. Only `aaps-local` produces a result. */
  selectedSourceId: string | undefined;
  nightscoutFill: AapsNightscoutFillState;
  /** Reconciled records for the range, as Today shows them. */
  basal: readonly BasalDelivery[];
  boluses: readonly BolusDelivery[];
  range: TimeRange;
}

export interface AapsInsulinProvenance {
  /** Where the counted AAPS records came from, in plain words. */
  sourceLabel?: string;
  /** Latest AAPS delivery start inside the range; undefined when there is none. */
  dataThrough?: number;
  /**
   * Nightscout carries temporary basals only. Without a pump export for the
   * period, scheduled basal is not part of the total.
   */
  scheduledBasalMissing: boolean;
  /** Shown with "No data" when nothing was recorded in the range. */
  emptyDetail: string;
}

function inRange(timestamp: number, range: TimeRange) {
  return timestamp >= range.start && timestamp < range.end;
}

function overlaps(record: BasalDelivery, range: TimeRange) {
  return record.start < range.end && record.end > range.start;
}

const isAapsSource = (sourceId: string) =>
  (AAPS_INSULIN_SOURCE_IDS as readonly string[]).includes(sourceId);

/**
 * Describes what the Today insulin figure is made of while AAPS supplies
 * glucose. It reports records only; it never estimates missing insulin.
 */
export function describeAapsInsulinProvenance(
  input: AapsInsulinProvenanceInput,
): AapsInsulinProvenance | undefined {
  if (input.selectedSourceId !== 'aaps-local') return undefined;
  const boluses = input.boluses.filter(
    (record) => isAapsSource(record.sourceId) && inRange(record.timestamp, input.range),
  );
  const basal = input.basal.filter(
    (record) => isAapsSource(record.sourceId) && overlaps(record, input.range),
  );
  const records = [...boluses, ...basal];
  const sources = new Set(records.map((record) => record.sourceId));
  const local = records.filter((record) => record.sourceId === 'aaps-local');
  const localLabel = local.every(
    (record) => record.sourceFile === AAPS_LOCAL_VERIFIED_SOURCE_FILE,
  )
    ? 'on this phone'
    : 'on this phone (sender not verified)';
  const sourceLabel =
    local.length > 0 && sources.has('nightscout')
      ? `AAPS records via Nightscout and ${localLabel}`
      : local.length > 0
        ? `AAPS records ${localLabel}`
        : sources.has('nightscout')
          ? 'AAPS records via Nightscout'
          : undefined;
  const starts = [
    ...boluses.map((record) => record.timestamp),
    ...basal.map((record) => Math.max(record.start, input.range.start)),
  ];
  const dataThrough = starts.length ? Math.max(...starts) : undefined;
  const pumpExportBasal = input.basal.some(
    (record) => record.sourceId === 'glooko-export' && overlaps(record, input.range),
  );
  const emptyDetail =
    input.nightscoutFill === 'on'
      ? 'No AAPS insulin records for today yet'
      : input.nightscoutFill === 'off'
        ? 'Nightscout insulin history is switched off for AAPS'
        : 'No AAPS insulin records yet; connect Nightscout, or turn on the on-phone AAPS broadcast option';
  return {
    sourceLabel,
    dataThrough,
    scheduledBasalMissing: !pumpExportBasal,
    emptyDetail,
  };
}
