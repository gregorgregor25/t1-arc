import { GLUCOSE_STALE_AFTER_MINUTES } from './freshness';
import type { TimelineData } from './models';
import { formatClockNear, type ClockSettings } from './exportTime';

export type DataThroughKind = 'glucose' | 'insulin';

/** How far the newest record may trail before a "through" stamp appears. */
export const DATA_THROUGH_LAG_MS: Record<DataThroughKind, number> = {
  glucose: GLUCOSE_STALE_AFTER_MINUTES * 60_000,
  insulin: 60 * 60_000,
};

/** Insulin typed into T1 Arc is not synced, so it cannot lag. */
const UNSYNCED_INSULIN_SOURCE_IDS = new Set(['t1arc-manual']);

export interface DataThroughStamp {
  kind: DataThroughKind;
  through: number;
  text: string;
}

type StampInput = Pick<TimelineData, 'range' | 'glucose' | 'basal' | 'boluses'>;

/**
 * Newest record time per data type inside the range. Insulin uses synced
 * records only: a basal record counts through its end (capped at `now`).
 */
export function newestRecordTimes(data: StampInput, now: number) {
  const end = Math.min(now, data.range.end);
  let glucose: number | undefined;
  data.glucose.forEach((reading) => {
    if (reading.timestamp >= data.range.start && reading.timestamp < data.range.end) {
      glucose = glucose === undefined ? reading.timestamp : Math.max(glucose, reading.timestamp);
    }
  });
  let insulin: number | undefined;
  const consider = (timestamp: number) => {
    insulin = insulin === undefined ? timestamp : Math.max(insulin, timestamp);
  };
  data.boluses.forEach((record) => {
    if (UNSYNCED_INSULIN_SOURCE_IDS.has(record.sourceId)) return;
    if (record.timestamp >= data.range.start && record.timestamp < data.range.end) consider(record.timestamp);
  });
  data.basal.forEach((record) => {
    if (UNSYNCED_INSULIN_SOURCE_IDS.has(record.sourceId)) return;
    if (record.start < data.range.end && record.end > data.range.start) {
      consider(Math.min(record.end, end));
    }
  });
  return { glucose, insulin };
}

const STAMP_NOUN: Record<DataThroughKind, string> = {
  glucose: 'Glucose',
  insulin: 'Insulin',
};

/**
 * Stamps such as "Insulin records through 13:00", only for data types whose
 * newest record trails the end of the range (or now) by more than the lag
 * allowance. A type with no records in the range gets no stamp; empty states
 * describe that case.
 */
export function laggingDataStamps(
  data: StampInput,
  now: number,
  settings: ClockSettings,
  kinds: readonly DataThroughKind[] = ['glucose', 'insulin'],
): DataThroughStamp[] {
  const reference = Math.min(now, data.range.end);
  const newest = newestRecordTimes(data, now);
  return kinds.flatMap((kind) => {
    const through = newest[kind];
    if (through === undefined || reference - through <= DATA_THROUGH_LAG_MS[kind]) return [];
    return [{
      kind,
      through,
      text: `${STAMP_NOUN[kind]} records through ${formatClockNear(through, reference, settings)}`,
    }];
  });
}
