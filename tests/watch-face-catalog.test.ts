import { createRequire } from 'node:module';
import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { validationToken, certificateDigest, faceManifest, checkFaceArchive, checkFaceInfo } =
  require('../scripts/prepare-watch-face-catalog.mjs') as {
    validationToken: (report: string) => string;
    certificateDigest: (report: string) => string;
    checkFaceInfo: (xml: string) => void;
    faceManifest: (xml: string, companion: string, id: string) => {
      packageName: string; versionCode: number; revision: string;
    };
    checkFaceArchive: (bytes: Uint8Array, companion: string) => void;
  };

const companion = 'example.app.sideload';
const manifest = '<manifest package="example.app.sideload.watchfacepush.pace" android:versionCode="2">' +
  '<uses-sdk android:minSdkVersion="33"/><application android:hasCode="false">' +
  '<property android:name="com.google.wear.watchface.format.version" android:value="1"/>' +
  '<property android:name="t1arc.face.revision" android:value="0123456789abcdef"/>' +
  '</application></manifest>';

const token = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=:MS4wLjA=';
const success = 'Validation is successful\nNo failing checks detected, generated token: ' + token + '\n';
const archive = {
  'AndroidManifest.xml': strToU8(manifest),
  'resources.arsc': new Uint8Array([1]),
  'res/raw/watchface.xml': strToU8('<WatchFace><DefaultProviderPolicy primaryProvider="example.app.sideload/example.Glucose"/></WatchFace>'),
};

describe('bundled watch face validation', () => {
  it('requires the runtime picker preview even when the official validator accepts its omission', () => {
    expect(() => checkFaceInfo('<WatchFaceInfo><Preview value="@drawable/pace_picker_preview"/></WatchFaceInfo>')).not.toThrow();
    expect(() => checkFaceInfo('<WatchFaceInfo><Preview value="@ref/0x7f010002" /></WatchFaceInfo>')).not.toThrow();
    expect(() => checkFaceInfo('<WatchFaceInfo/>')).toThrow();
    expect(() => checkFaceInfo('<WatchFaceInfo><Preview value=""/><Preview value="@drawable/other"/></WatchFaceInfo>')).toThrow();
    expect(() => checkFaceInfo('<WatchFaceInfo><Preview value="@null"/></WatchFaceInfo>')).toThrow();
  });
  it('requires an explicit successful report, not merely a zero process exit', () => {
    expect(validationToken(success)).toBe(token);
    expect(() => validationToken('Validation is unsuccessful\n1 failing checks detected')).toThrow();
    expect(() => validationToken('generated token: ' + token)).toThrow();
    expect(() => validationToken(success.replace(token, ''))).toThrow();
    expect(() => validationToken(success + success)).toThrow();
  });

  it('requires one APK signing certificate', () => {
    const report = 'Signer #1 certificate SHA-256 digest: ' + 'a'.repeat(64) + '\n';
    expect(certificateDigest(report)).toBe('a'.repeat(64));
    expect(() => certificateDigest('DOES NOT VERIFY')).toThrow();
    expect(() => certificateDigest(report + report.replace('#1', '#2'))).toThrow();
  });

  it('checks exact variant identity, revision, WFF and SDK metadata', () => {
    expect(faceManifest(manifest, companion, 'pace')).toEqual({
      packageName: companion + '.watchfacepush.pace', versionCode: 2, revision: '0123456789abcdef',
    });
    expect(() => faceManifest(manifest, 'example.app', 'pace')).toThrow();
    expect(() => faceManifest(manifest, companion, '../other')).toThrow();
    expect(() => faceManifest(manifest.replace('hasCode="false"', 'hasCode="true"'), companion, 'pace')).toThrow();
    expect(() => faceManifest(manifest.replace('minSdkVersion="33"', 'minSdkVersion="36"'), companion, 'pace')).toThrow();
    expect(() => faceManifest(manifest.replace('0123456789abcdef', 'unknown'), companion, 'pace')).toThrow();
    expect(() => faceManifest(manifest.replace('versionCode="2"', 'versionCode="0"'), companion, 'pace')).toThrow();
  });

  it('rejects executable content, path traversal and wrong complication providers', () => {
    expect(() => checkFaceArchive(zipSync(archive), companion)).not.toThrow();
    expect(() => checkFaceArchive(zipSync({ ...archive, 'classes.dex': new Uint8Array([1]) }), companion)).toThrow();
    expect(() => checkFaceArchive(zipSync({ ...archive, 'res/../other': new Uint8Array([1]) }), companion)).toThrow();
    expect(() => checkFaceArchive(zipSync(archive), 'example.app')).toThrow();
    expect(() => checkFaceArchive(zipSync({ 'AndroidManifest.xml': strToU8(manifest) }), companion)).toThrow();
  });
});
