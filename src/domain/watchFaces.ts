import type { WatchFaceDeviceStatus, WatchFaceId, WatchFaceResult } from '../../modules/t1arc-glucose-display/src/T1ArcGlucoseDisplay.types';

export const WATCH_FACES: readonly { id: WatchFaceId; name: string; description: string }[] = [
  { id: 'meridian', name: 'Meridian', description: 'A clear digital clock with glucose and a recent graph.' },
  { id: 'chronograph', name: 'Chronograph', description: 'An analogue dial with glucose at its centre.' },
  { id: 'atelier', name: 'Atelier', description: 'A refined analogue dial with faceted hands and a quiet glucose window.' },
  { id: 'pace', name: 'Pace', description: 'A bold sports clock, large glucose and a wide recent-history strip.' },
  { id: 'summit', name: 'Summit', description: 'A field-watch dial with clear indices and separate glucose information.' },
];

export function canInstallWatchFace(status: WatchFaceDeviceStatus | undefined, id: WatchFaceId): boolean {
  return Boolean(status?.supported && status.catalog?.includes(id) &&
    ['ready', 'active', 'activation_required'].includes(status.code));
}

export function watchFaceStatusCopy(status?: WatchFaceDeviceStatus): string {
  if (!status) return 'Connect your watch and install the companion from the same T1 Arc release.';
  switch (status.code) {
    case 'unsupported':
      return 'Choosing faces here needs Wear OS 6 or later. The glucose companion still works on older supported watches.';
    case 'companion_update_required':
      return 'Install or update the watch companion from the same release as this phone app.';
    case 'unreachable':
      return 'The companion did not reply. Keep your watch nearby and check again.';
    case 'busy':
      return 'The watch is still working on a face. Wait a moment, then check its status.';
    case 'uncertain':
      return 'The installation result was not received. Check the watch before trying again.';
    case 'failed':
      return 'The face could not be installed. Check the watch and try again.';
    default:
      if (status.retiredFaceId === 'orbit') return status.active
        ? 'Orbit is still active. Choose a new design when you are ready to replace it.'
        : 'Orbit is installed but retired from this collection. Choose a replacement below.';
      if (status.active) return 'Your T1 Arc face is active on this watch.';
      if (status.installedFaceId) return status.activationUsed || status.activationDenied
        ? 'Installed. Touch and hold your current watch face, choose Add watch face, then select T1 Arc.'
        : 'Installed. Open setup on your watch to make it your current face.';
      return 'Choose a design below. The face files are already bundled in the companion.';
  }
}

export function watchFaceUpdateRequired(status: WatchFaceDeviceStatus | undefined, id: WatchFaceId): boolean {
  return Boolean(status?.supported && status.catalog && !status.catalog.includes(id) &&
    ['ready', 'active', 'activation_required'].includes(status.code));
}

export function applyWatchFaceResult(device: WatchFaceDeviceStatus, result: WatchFaceResult): WatchFaceDeviceStatus {
  // Do not carry an old active/installed claim into an uncertain result.
  return { nodeId: device.nodeId, watchName: device.watchName, ...result };
}
