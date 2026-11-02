import type { GlucoseReading, TimeRange } from '@/domain/models';
import type { AapsContextObservation, AapsLocalStatus } from './types';
import { AAPS_LOCAL_SOURCE_ID } from './types';

export type AapsCardSnapshot =
  | { kind: 'other' }
  | { kind: 'changed' }
  | {
      kind: 'aaps';
      selectionGeneration: number;
      writeEpoch: number;
      reading?: GlucoseReading;
      history: GlucoseReading[];
      context?: AapsContextObservation;
    };

export interface AapsCardSnapshotReader {
  status(): Promise<AapsLocalStatus>;
  context(): Promise<AapsContextObservation | undefined>;
  latest(): Promise<GlucoseReading | undefined>;
  history(range: TimeRange): Promise<GlucoseReading[]>;
}

/** A source/session switch or erase must never pair one session's estimates with another's glucose. */
export async function loadAapsCardSnapshot(reader: AapsCardSnapshotReader): Promise<AapsCardSnapshot> {
  const before = await reader.status();
  if (!before.supported || before.selectedSourceId !== AAPS_LOCAL_SOURCE_ID) {
    return { kind: 'other' };
  }
  // context() drains the durable native queue before either glucose read.
  const context = await reader.context();
  const reading = await reader.latest();
  const history = reading ? await reader.history({
    start: reading.timestamp - 4 * 3_600_000,
    end: reading.timestamp + 1,
  }) : [];
  const after = await reader.status();
  if (!after.supported || after.selectedSourceId !== AAPS_LOCAL_SOURCE_ID ||
      before.writeEpoch !== after.writeEpoch ||
      before.selectionGeneration !== after.selectionGeneration) {
    return { kind: 'changed' };
  }
  return {
    kind: 'aaps',
    selectionGeneration: after.selectionGeneration,
    writeEpoch: after.writeEpoch,
    reading: reading?.sourceId === AAPS_LOCAL_SOURCE_ID ? reading : undefined,
    history: history.filter((value) => value.sourceId === AAPS_LOCAL_SOURCE_ID),
    context: context?.reconciliationScope === 'local' &&
      context.writeEpoch === after.writeEpoch &&
      context.selectionGeneration === after.selectionGeneration
      ? context : undefined,
  };
}
