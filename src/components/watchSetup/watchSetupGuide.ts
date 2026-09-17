import type { WatchEndpoint } from '../../../modules/t1arc-watch-installer';

export function automaticWatchChoice(devices: WatchEndpoint[], host: string, manual: boolean, selectedId = ''): WatchEndpoint | undefined {
  // A manual fallback after an incomplete scan still belongs to the selected
  // watch. Refresh its advertised ports without selecting another device.
  if (manual) return devices.find(device => device.id === selectedId && device.host === host);
  if (host) return devices.find(device => device.host === host);
  return devices.length === 1 ? devices[0] : undefined;
}

export type WatchBrand = 'samsung' | 'pixel' | 'other';
export const WATCH_BRANDS: { id: WatchBrand; label: string; developerSteps: string }[] = [
  { id: 'samsung', label: 'Samsung Galaxy Watch', developerSteps: 'On your watch, open Settings → About watch → Software information. Tap Software version five times, until developer mode is enabled.' },
  { id: 'pixel', label: 'Google Pixel Watch', developerSteps: 'On your watch, open Settings → System → About → Versions. Tap Build number seven times, until developer options are enabled.' },
  { id: 'other', label: 'Another Wear OS watch', developerSteps: 'On your watch, open Settings → System → About (sometimes About watch). Find Build number under Versions or Software information and tap it seven times, until developer options are enabled.' },
];

export const WATCH_SETUP_TITLES = ['Prepare your watch', 'Enable developer options', 'Turn on wireless debugging', 'Pair your watch', 'Install T1 Arc', 'Finish setup'];

export function watchPort(value: string): number | undefined {
  if (!/^\d{1,5}$/.test(value.trim())) return undefined;
  const port = Number(value);
  return port > 0 && port <= 65535 ? port : undefined;
}

export function setupError(error: unknown): string {
  if (error instanceof Error && error.message) {
    // Expo wraps native errors with a bridge/function name that is not useful in setup.
    const cause = error.message.split(/\n(?:→\s*)?Caused by:\s*/).at(-1)!;
    return cause.startsWith('Call to function ') ? 'That step could not finish. Keep your watch awake and try again.' : cause;
  }
  return 'That step could not finish. Keep your watch awake and try again.';
}
