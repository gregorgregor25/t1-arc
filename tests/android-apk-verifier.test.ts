import {
  chmodSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { zipSync } from 'fflate';
import { afterEach, describe, expect, it } from 'vitest';

const verifierPath = path.join(
  process.cwd(),
  'scripts',
  'verify-android-apk.ps1',
);
const appConfig = JSON.parse(
  readFileSync(path.join(process.cwd(), 'app.json'), 'utf8'),
) as {
  expo: {
    version: string;
    android: { versionCode: number };
  };
};

const requiredClasses = [
  'expo.modules.ExpoModulesPackageList',
  'expo.modules.adapters.react.apploader.RNHeadlessAppLoader',
  'io.github.gregorgregor25.t1arc.backup.T1ArcBackupCryptoModule',
  'io.github.gregorgregor25.t1arc.glooko.T1ArcGlookoExportModule',
  'io.github.gregorgregor25.t1arc.glucosedisplay.T1ArcGlucoseDisplayModule',
  'io.github.gregorgregor25.t1arc.healthconnect.T1ArcHealthConnectModule',
  'io.github.gregorgregor25.t1arc.notificationsource.T1ArcNotificationSourceModule',
];

const headlessLoaderClass =
  'expo.modules.adapters.react.apploader.RNHeadlessAppLoader';
const headlessLoaderMetadata =
  'org.unimodules.core.AppLoader#react-native-headless';

const requiredPermissions = [
  'android.permission.INTERNET',
  'android.permission.ACCESS_NETWORK_STATE',
  'android.permission.CAMERA',
  'android.permission.VIBRATE',
  'android.permission.POST_NOTIFICATIONS',
  'android.permission.health.READ_STEPS',
  'android.permission.health.READ_EXERCISE',
  'android.permission.health.READ_SLEEP',
  'android.permission.health.READ_NUTRITION',
  'android.permission.health.READ_HEALTH_DATA_IN_BACKGROUND',
  'android.permission.health.READ_HEALTH_DATA_HISTORY',
];

const tempDirectories: string[] = [];

const writeTool = (toolPath: string, windowsBody: string, unixBody: string) => {
  mkdirSync(path.dirname(toolPath), { recursive: true });
  writeFileSync(toolPath, process.platform === 'win32' ? windowsBody : unixBody);
  if (process.platform !== 'win32') {
    chmodSync(toolPath, 0o755);
  }
};

const createFixture = (
  definedClasses: string[],
  headlessMetadataValue: string | null = headlessLoaderClass,
  headlessMetadataOwner: 'application' | 'activity' = 'application',
) => {
  const root = mkdtempSync(path.join(tmpdir(), 't1arc-apk-verifier-'));
  tempDirectories.push(root);

  const androidHome = path.join(root, 'android-sdk');
  const toolSuffix = process.platform === 'win32' ? '.bat' : '';
  const analyzerPath = path.join(
    androidHome,
    'cmdline-tools',
    'latest',
    'bin',
    `apkanalyzer${toolSuffix}`,
  );
  const signerPath = path.join(
    androidHome,
    'build-tools',
    '36.0.0',
    `apksigner${toolSuffix}`,
  );
  const dexRecords = definedClasses.flatMap((className) => [
    `C d 1 1 1 ${className}`,
    `M d 1 1 1 ${className} void a()`,
    `F d 1 1 1 ${className} int a`,
  ]);
  const metadataLine =
    headlessMetadataValue === null
      ? null
      : `    <meta-data android:name="${headlessLoaderMetadata}" android:value="${headlessMetadataValue}" />`;
  const manifestBody =
    metadataLine === null
      ? []
      : headlessMetadataOwner === 'application'
        ? [metadataLine]
        : [
            '    <activity android:name="fixture.WrongOwnerActivity">',
            `  ${metadataLine}`,
            '    </activity>',
          ];
  const manifestLines = [
    '<manifest xmlns:android="http://schemas.android.com/apk/res/android">',
    '  <application>',
    ...manifestBody,
    '  </application>',
    '</manifest>',
  ];
  const windowsAnalyzer = [
    '@echo off',
    'if "%1:%2"=="manifest:application-id" echo io.github.gregorgregor25.t1arc& exit /b 0',
    `if "%1:%2"=="manifest:version-name" echo ${appConfig.expo.version}& exit /b 0`,
    `if "%1:%2"=="manifest:version-code" echo ${appConfig.expo.android.versionCode}& exit /b 0`,
    'if "%1:%2"=="manifest:min-sdk" echo 26& exit /b 0',
    'if "%1:%2"=="manifest:target-sdk" echo 36& exit /b 0',
    'if "%1:%2"=="manifest:debuggable" echo false& exit /b 0',
    'if "%1:%2"=="manifest:print" goto manifest',
    'if "%1:%2"=="dex:packages" goto dex',
    'if "%1:%2"=="manifest:permissions" goto permissions',
    'exit /b 2',
    ':manifest',
    ...manifestLines.map(
      (line) => `echo ${line.replaceAll('<', '^<').replaceAll('>', '^>')}`,
    ),
    'exit /b 0',
    ':dex',
    ...dexRecords.map((record) => `echo ${record}`),
    'exit /b 0',
    ':permissions',
    ...requiredPermissions.map((permission) => `echo ${permission}`),
    'exit /b 0',
  ].join('\r\n');
  const unixAnalyzer = [
    '#!/bin/sh',
    'case "$1:$2" in',
    '  manifest:application-id) echo io.github.gregorgregor25.t1arc ;;',
    `  manifest:version-name) echo ${appConfig.expo.version} ;;`,
    `  manifest:version-code) echo ${appConfig.expo.android.versionCode} ;;`,
    '  manifest:min-sdk) echo 26 ;;',
    '  manifest:target-sdk) echo 36 ;;',
    '  manifest:debuggable) echo false ;;',
    '  manifest:print)',
    ...manifestLines.map((line) => `    echo '${line}'`),
    '    ;;',
    '  dex:packages)',
    ...dexRecords.map((record) => `    echo '${record}'`),
    '    ;;',
    '  manifest:permissions)',
    ...requiredPermissions.map((permission) => `    echo ${permission}`),
    '    ;;',
    '  *) exit 2 ;;',
    'esac',
  ].join('\n');

  writeTool(analyzerPath, windowsAnalyzer, unixAnalyzer);
  writeTool(
    signerPath,
    '@echo off\r\nexit /b 0\r\n',
    '#!/bin/sh\nexit 0\n',
  );

  const apkPath = path.join(root, 'app-release.apk');
  writeFileSync(
    apkPath,
    zipSync({
      'assets/index.android.bundle': new Uint8Array(101 * 1024),
      'lib/arm64-v8a/libreactnative.so': new Uint8Array([1]),
    }),
  );

  return { androidHome, apkPath, root };
};

const invokeVerifier = (
  definedClasses: string[],
  mappingEntries?: readonly (readonly [original: string, obfuscated: string])[],
  headlessMetadataValue: string | null = headlessLoaderClass,
  headlessMetadataOwner: 'application' | 'activity' = 'application',
) => {
  const fixture = createFixture(
    definedClasses,
    headlessMetadataValue,
    headlessMetadataOwner,
  );
  const args = [
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    verifierPath,
    '-ApkPath',
    fixture.apkPath,
  ];

  if (mappingEntries) {
    const mappingPath = path.join(fixture.root, 'mapping.txt');
    writeFileSync(
      mappingPath,
      `${mappingEntries
        .map(([original, obfuscated]) => `${original} -> ${obfuscated}:`)
        .join('\n')}\n`,
    );
    args.push('-MappingPath', mappingPath);
  }

  return spawnSync(process.platform === 'win32' ? 'powershell.exe' : 'pwsh', args, {
    encoding: 'utf8',
    env: {
      ...process.env,
      ANDROID_HOME: fixture.androidHome,
    },
    maxBuffer: 1024 * 1024,
  });
};

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe('Android APK verifier', () => {
  it('continues to verify non-minified DEX classes without a mapping file', () => {
    const result = invokeVerifier(requiredClasses);

    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    expect(result.stdout).toContain('Verified app-release.apk');
  });

  it('rejects an APK whose headless app-loader class is absent', () => {
    const result = invokeVerifier(
      requiredClasses.filter((className) => className !== headlessLoaderClass),
    );

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).toContain(headlessLoaderClass);
  });

  it('verifies required classes by their R8-obfuscated names when given a mapping', () => {
    const mappings = requiredClasses.map(
      (original, index) =>
        [
          original,
          original === headlessLoaderClass
            ? original
            : `r8.${String.fromCharCode(97 + index)}`,
        ] as const,
    );
    const result = invokeVerifier(
      mappings.map(([, obfuscated]) => obfuscated),
      mappings,
    );

    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    expect(result.stdout).toContain('R8 mapping');
  });

  it('rejects a mapping that renames the manifest-loaded headless app loader', () => {
    const mappings = requiredClasses.map(
      (original, index) =>
        [original, original === headlessLoaderClass ? 'r8.headless' : `r8.${index}`] as const,
    );
    const result = invokeVerifier(
      mappings.map(([, obfuscated]) => obfuscated),
      mappings,
    );

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).toContain(headlessLoaderClass);
    expect(`${result.stdout}\n${result.stderr}`).toMatch(/must keep its runtime name/i);
  });

  it('rejects even a case-only rename of the headless app loader', () => {
    const caseRenamedLoader = headlessLoaderClass.replace(
      'RNHeadlessAppLoader',
      'rnHeadlessAppLoader',
    );
    const mappings = requiredClasses.map(
      (original, index) =>
        [
          original,
          original === headlessLoaderClass ? caseRenamedLoader : `r8.${index}`,
        ] as const,
    );
    const result = invokeVerifier(
      mappings.map(([, obfuscated]) => obfuscated),
      mappings,
    );

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).toContain(headlessLoaderClass);
    expect(`${result.stdout}\n${result.stderr}`).toMatch(/must keep its runtime name/i);
  });

  it('rejects a missing headless app-loader manifest entry', () => {
    const result = invokeVerifier(requiredClasses, undefined, null);

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).toContain(headlessLoaderMetadata);
  });

  it('rejects a headless app-loader manifest entry with the wrong value', () => {
    const result = invokeVerifier(requiredClasses, undefined, 'r8.headless');

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).toContain(headlessLoaderMetadata);
    expect(`${result.stdout}\n${result.stderr}`).toContain(headlessLoaderClass);
  });

  it('rejects headless metadata owned by an activity instead of the app', () => {
    const result = invokeVerifier(
      requiredClasses,
      undefined,
      headlessLoaderClass,
      'activity',
    );

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).toContain(headlessLoaderMetadata);
  });

  it('rejects a stale mapping file paired with a different APK', () => {
    const mappings = requiredClasses.map(
      (original, index) =>
        [
          original,
          original === headlessLoaderClass ? original : `r8.stale${index}`,
        ] as const,
    );
    const result = invokeVerifier(requiredClasses, mappings);

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).toMatch(/mapping.*APK|APK.*mapping/i);
  });

  it('does not treat method or field names as an obfuscated class match', () => {
    const mappings = requiredClasses.map(
      (original, index) =>
        [
          original,
          original === headlessLoaderClass
            ? original
            : index === 0
              ? 'a'
              : `r8.${index}`,
        ] as const,
    );
    const definedClasses = ['data', ...mappings.slice(1).map(([, obfuscated]) => obfuscated)];
    const result = invokeVerifier(definedClasses, mappings);

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).toContain(requiredClasses[0]);
  });

  it('still rejects a minified APK when no mapping file is supplied', () => {
    const result = invokeVerifier(requiredClasses.map((_, index) => `r8.${index}`));

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).toContain(requiredClasses[0]);
  });
});
