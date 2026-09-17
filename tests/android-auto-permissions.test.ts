import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const moduleRoot = 'modules/t1arc-glucose-display/android/src/main';
const manifest = readFileSync(`${moduleRoot}/AndroidManifest.xml`, 'utf8');
const kotlinRoot = `${moduleRoot}/java/io/github/gregorgregor25/t1arc/glucosedisplay`;

describe('Android Auto permission boundary', () => {
  it('keeps the media browser available without unused media foreground privileges', () => {
    expect(manifest).not.toContain('FOREGROUND_SERVICE_MEDIA_PLAYBACK');
    const carService = manifest.match(/<service\s+android:name="\.T1ArcCarMediaBrowserService"[\s\S]*?<\/service>/)?.[0];
    expect(carService).toBeDefined();
    expect(carService).toContain('android:enabled="true"');
    expect(carService).toContain('android:exported="true"');
    expect(carService).toContain('android.media.browse.MediaBrowserService');
    expect(carService).not.toContain('foregroundServiceType');
    expect(manifest).toContain('com.google.android.gms.car.application');
  });

  it('retains the separate foreground service actually used by glucose monitoring', () => {
    expect(manifest).toContain('android.permission.FOREGROUND_SERVICE_SPECIAL_USE');
    expect(manifest).toContain('android:foregroundServiceType="specialUse"');
    const display = readFileSync(`${kotlinRoot}/T1ArcGlucoseDisplayModule.kt`, 'utf8');
    expect(display).toContain('ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE');
  });

  it('requires reassessment if the car implementation starts a foreground service', () => {
    const car = readFileSync(`${kotlinRoot}/T1ArcAndroidAuto.kt`, 'utf8');
    expect(car).not.toMatch(/\bstartForeground(?:Service)?\s*\(/);
    expect(car).toContain('class T1ArcCarMediaBrowserService : MediaBrowserServiceCompat()');
    expect(car).toContain('publish(PlaybackStateCompat.STATE_PAUSED)');
  });
});
