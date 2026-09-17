import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

import type { WatchFaceDeviceStatus } from '../modules/t1arc-glucose-display/src/T1ArcGlucoseDisplay.types';
import { applyWatchFaceResult, canInstallWatchFace, WATCH_FACES, watchFaceStatusCopy, watchFaceUpdateRequired } from '../src/domain/watchFaces';

const ready: WatchFaceDeviceStatus = {
  nodeId: 'watch-a', watchName: 'My watch', supported: true, code: 'ready',
  catalog: ['meridian', 'chronograph', 'atelier', 'pace', 'summit'],
};

describe('phone watch-face chooser', () => {
  it('keeps shared designs usable on an older companion and explains new designs', () => {
    const oldCompanion = { ...ready, catalog: ['meridian', 'chronograph'] as const };
    const status = { ...oldCompanion, catalog: [...oldCompanion.catalog] };
    expect(canInstallWatchFace(status, 'meridian')).toBe(true);
    for (const id of ['atelier', 'pace', 'summit'] as const) {
      expect(canInstallWatchFace(status, id)).toBe(false);
      expect(watchFaceUpdateRequired(status, id)).toBe(true);
    }
    expect(watchFaceUpdateRequired(undefined, 'pace')).toBe(false);
    expect(watchFaceUpdateRequired({ ...status, code: 'busy' }, 'pace')).toBe(false);
  });

  it('acknowledges an installed Orbit without offering to reinstall it', () => {
    const status = { ...ready, active: true, retiredFaceId: 'orbit' as const };
    expect(watchFaceStatusCopy(status)).toContain('Orbit is still active');
    expect(watchFaceStatusCopy({ ...status, active: false })).toContain('retired');
    expect(WATCH_FACES.some((face) => String(face.id) === 'orbit')).toBe(false);
    const replaced = applyWatchFaceResult(status, { code: 'active', supported: true, installedFaceId: 'summit', active: true });
    expect(replaced.retiredFaceId).toBeUndefined();
  });
  it('makes only the platform face installer visible to the companion', () => {
    const manifest = readFileSync('wear/companion/src/main/AndroidManifest.xml', 'utf8');
    const queries = manifest.match(/<queries>([\s\S]*?)<\/queries>/)?.[1];
    expect(queries).toContain('com.google.wear.ACTION_PUSH_WATCH_FACES');
    expect(manifest).not.toContain('android.permission.QUERY_ALL_PACKAGES');
    const runtime = readFileSync('wear/companion/src/main/java/io/github/gregorgregor25/t1arc/wear/watchfaces/WatchFaceRuntime.kt', 'utf8');
    expect(runtime).toContain('PackageManager.MATCH_SYSTEM_ONLY');
    expect(runtime).toContain('if (service?.serviceInfo == null) return null');
  });

  it('offers only the five bundled designs', () => {
    expect(WATCH_FACES.map((face) => face.id)).toEqual(['meridian', 'chronograph', 'atelier', 'pace', 'summit']);
  });

  it('requires a supported selected watch and its confirmed catalog', () => {
    expect(canInstallWatchFace(ready, 'pace')).toBe(true);
    expect(canInstallWatchFace(undefined, 'pace')).toBe(false);
    expect(canInstallWatchFace({ ...ready, supported: false }, 'pace')).toBe(false);
    expect(canInstallWatchFace({ ...ready, catalog: ['meridian'] }, 'pace')).toBe(false);
  });

  it.each(['unsupported', 'companion_update_required', 'unreachable', 'busy', 'uncertain', 'failed'] as const)(
    'does not install in %s state', (code) => {
      expect(canInstallWatchFace({ ...ready, code }, 'pace')).toBe(false);
      expect(watchFaceStatusCopy({ ...ready, code })).toBeTruthy();
    },
  );

  it('does not turn an uncertain reply into an old active-face claim', () => {
    const result = applyWatchFaceResult({ ...ready, active: true, installedFaceId: 'pace' },
      { code: 'uncertain', supported: true });
    expect(result.nodeId).toBe('watch-a');
    expect(result.active).toBeUndefined();
    expect(result.installedFaceId).toBeUndefined();
    expect(canInstallWatchFace(result, 'pace')).toBe(false);
  });

  it('separates installed and active and respects one-shot activation', () => {
    const installed = { ...ready, installedFaceId: 'pace' as const, active: false };
    expect(watchFaceStatusCopy(installed)).toContain('Open setup');
    expect(watchFaceStatusCopy({ ...installed, activationUsed: true })).toContain('Touch and hold');
    expect(watchFaceStatusCopy({ ...installed, activationDenied: true })).toContain('Touch and hold');
    expect(watchFaceStatusCopy({ ...installed, active: true })).toContain('is active');
  });
});
