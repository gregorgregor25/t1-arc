import type {
  GlucoseDisplayStatus,
  OnBoardEstimatePublication,
} from '../../../modules/t1arc-glucose-display';
import type { NightscoutIobCobSnapshot } from '@/data/nightscout/types';

export interface OnBoardEstimateBridge {
  updateOnBoardEstimateForWriteEpochAsync?(
    writeEpoch: number,
    selectionGeneration: number,
    estimate: OnBoardEstimatePublication | null,
  ): Promise<boolean>;
}

/**
 * The Nightscout estimate in the shape the native glance surfaces accept.
 * Null clears a previous Nightscout estimate. A missing value is omitted,
 * never sent as zero; negative IOB and zero COB are kept.
 */
export function nightscoutOnBoardPublication(
  snapshot: NightscoutIobCobSnapshot | undefined,
): OnBoardEstimatePublication | null {
  if (!snapshot || !Number.isFinite(snapshot.timestamp)) return null;
  const receivedAt = Math.round(snapshot.timestamp);
  if (receivedAt <= 0 || !Number.isSafeInteger(receivedAt)) return null;
  const iobUnits =
    typeof snapshot.iobUnits === 'number' && Number.isFinite(snapshot.iobUnits)
      ? snapshot.iobUnits
      : undefined;
  const cobGrams =
    typeof snapshot.cobGrams === 'number' &&
    Number.isFinite(snapshot.cobGrams) &&
    snapshot.cobGrams >= 0
      ? snapshot.cobGrams
      : undefined;
  if (iobUnits === undefined && cobGrams === undefined) return null;
  return {
    provenance: 'nightscout',
    ...(iobUnits === undefined ? {} : { iobUnits }),
    ...(cobGrams === undefined ? {} : { cobGrams }),
    receivedAt,
  };
}

let lastPublishedIdentity: string | undefined;

/** Called when the native glucose snapshot was cleared, which clears its estimate too. */
export function forgetPublishedOnBoardEstimate() {
  lastPublishedIdentity = undefined;
}

/**
 * Sends the estimate once per epoch, selection and value, so an unchanged
 * periodic sync does not redraw the notification. Older native builds
 * without the bridge are skipped. Failures never block glucose.
 */
export async function publishOnBoardEstimate(
  bridge: OnBoardEstimateBridge,
  writeEpoch: number,
  selectionGeneration: number,
  estimate: OnBoardEstimatePublication | null,
) {
  if (!bridge.updateOnBoardEstimateForWriteEpochAsync) return false;
  const identity = JSON.stringify([writeEpoch, selectionGeneration, estimate]);
  if (identity === lastPublishedIdentity) return true;
  const published = await bridge
    .updateOnBoardEstimateForWriteEpochAsync(writeEpoch, selectionGeneration, estimate)
    .catch(() => false);
  lastPublishedIdentity = published ? identity : undefined;
  return published;
}

/** True when the installed native module can show IOB/COB on glance surfaces. */
export function onBoardEstimatesSupported(
  status: Pick<GlucoseDisplayStatus, 'supported' | 'onBoardEstimatesVisible'> | undefined,
) {
  return Boolean(status?.supported) && typeof status?.onBoardEstimatesVisible === 'boolean';
}
