import type { BasalDelivery, BolusDelivery, TimeRange } from './models';

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
  const sources = new Set([...boluses, ...basal].map((record) => record.sourceId));
  const sourceLabel =
    sources.has('aaps-local') && sources.has('nightscout')
      ? 'AAPS records on this phone and via Nightscout'
      : sources.has('aaps-local')
        ? 'AAPS records on this phone'
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
        : 'No AAPS insulin records yet; turn on xDrip+ sync in AAPS or connect Nightscout';
  return {
    sourceLabel,
    dataThrough,
    scheduledBasalMissing: !pumpExportBasal,
    emptyDetail,
  };
}
