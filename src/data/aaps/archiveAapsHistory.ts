import { AAPS_HISTORICAL_SOURCE_ID, AAPS_LOCAL_SOURCE_ID } from './types';

interface AapsArchiveDatabase {
  runAsync(sql: string, ...params: (string | number)[]): Promise<unknown>;
}

/** Moves a prior local session out of the live selector without losing history. */
export async function archiveAapsGlucoseInTransaction(
  transaction: AapsArchiveDatabase,
  writeEpoch: number,
  selectionGeneration: number,
) {
  const archivePrefix =
    `${AAPS_HISTORICAL_SOURCE_ID}:${writeEpoch}:${selectionGeneration}:`;
  await transaction.runAsync(
    `UPDATE glucose_readings
        SET id = ? || id,
            source_id = ?,
            source_device_id = ? || source_device_id
      WHERE source_id = ?`,
    archivePrefix, AAPS_HISTORICAL_SOURCE_ID, archivePrefix,
    AAPS_LOCAL_SOURCE_ID,
  );
}
