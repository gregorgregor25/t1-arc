import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
  injectT1ArcReleaseSigning,
} = require(
  path.join(
    process.cwd(),
    'plugins',
    'with-t1arc-release-signing.js',
  ),
) as {
  injectT1ArcReleaseSigning: (contents: string) => string;
};

const generatedAppGradle = `apply plugin: "com.android.application"
apply plugin: "com.facebook.react"

android {
    signingConfigs {
        debug {
            storeFile file('debug.keystore')
            storePassword 'android'
            keyAlias 'androiddebugkey'
            keyPassword 'android'
        }
    }
    buildTypes {
        debug {
            signingConfig signingConfigs.debug
        }
        release {
            signingConfig signingConfigs.debug
            minifyEnabled false
        }
    }
}
`;

describe('T1 Arc Android release signing policy', () => {
  it('injects a common optional production certificate into generated phone builds', () => {
    const result = injectT1ArcReleaseSigning(generatedAppGradle);

    expect(result).toContain(
      "apply from: rootProject.file('../scripts/gradle/t1arc-signing.gradle')",
    );
    expect(result).toContain('if (t1ArcProductionSigningConfigured)');
    expect(result).toContain('production {');
    expect(result).toContain('storeFile t1ArcProductionStoreFile');
    expect(result).toContain(
      'signingConfig t1ArcProductionSigningConfigured ? signingConfigs.production : signingConfigs.debug',
    );
  });

  it('is idempotent across repeated Expo prebuilds', () => {
    const once = injectT1ArcReleaseSigning(generatedAppGradle);

    expect(injectT1ArcReleaseSigning(once)).toBe(once);
  });

  it('fails loudly when Expo changes an expected signing anchor', () => {
    expect(() =>
      injectT1ArcReleaseSigning(
        generatedAppGradle.replaceAll(
          'signingConfig signingConfigs.debug',
          'signingConfig signingConfigs.other',
        ),
      ),
    ).toThrow(/private release signing line/);
  });

  it('keeps the phone, companion and every watch face on the shared policy', () => {
    const modules = [
      'wear/companion/build.gradle',
      'wear/watchface-meridian/build.gradle',
      'wear/watchface-chronograph/build.gradle',
      'wear/watchface-orbit/build.gradle',
    ];

    for (const module of modules) {
      const contents = readFileSync(
        path.join(process.cwd(), module),
        'utf8',
      );
      expect(contents).toContain(
        "apply from: rootProject.file('../scripts/gradle/t1arc-signing.gradle')",
      );
      expect(contents).toContain(
        'if (t1ArcProductionSigningConfigured)',
      );
      expect(contents).toContain(
        'signingConfig t1ArcProductionSigningConfigured',
      );
    }
  });

  it('refuses store bundles that are not production-signed', () => {
    const policy = readFileSync(
      path.join(
        process.cwd(),
        'scripts',
        'gradle',
        't1arc-signing.gradle',
      ),
      'utf8',
    );

    expect(policy).toContain("task.name == 'bundleRelease'");
    expect(policy).toContain("task.name == 'publishReleaseBundle'");
    expect(policy).toContain(
      'T1 Arc refuses to create a store bundle with the private test certificate.',
    );
  });
});
