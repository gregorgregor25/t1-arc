import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { injectT1ArcR8Compat } = require(
  path.join(process.cwd(), 'plugins', 'with-t1arc-r8-compat.js'),
) as {
  injectT1ArcR8Compat: (contents: string) => string;
};

const generatedAppGradle = `android {
    buildTypes {
        release {
            minifyEnabled enableMinifyInReleaseBuilds
            proguardFiles getDefaultProguardFile("proguard-android.txt"), "proguard-rules.pro"
        }
    }
}
`;

describe('T1 Arc R8 compatibility plugin', () => {
  it('links the narrow compatibility rules into generated release builds', () => {
    const result = injectT1ArcR8Compat(generatedAppGradle);

    expect(result).toContain(
      "rootProject.file('../scripts/gradle/t1arc-r8-compat.pro')",
    );
  });

  it('is idempotent across repeated Expo prebuilds', () => {
    const once = injectT1ArcR8Compat(generatedAppGradle);

    expect(injectT1ArcR8Compat(once)).toBe(once);
  });

  it('fails loudly when Expo changes the expected ProGuard anchor', () => {
    expect(() =>
      injectT1ArcR8Compat(
        generatedAppGradle.replace('proguardFiles', 'consumerProguardFiles'),
      ),
    ).toThrow(/ProGuard configuration/);
  });

  it('fails closed when the generated file contains more than one anchor', () => {
    const ambiguousGradle = generatedAppGradle.replace(
      '    buildTypes {',
      `    buildTypes {
        debugOptimized {
            ${
              'proguardFiles getDefaultProguardFile("proguard-android.txt"), "proguard-rules.pro"'
            }
        }`,
    );

    expect(() => injectT1ArcR8Compat(ambiguousGradle)).toThrow(/unique/i);
  });

  it('fails closed when the sole anchor is outside the release build type', () => {
    const misplacedGradle = `android {
    buildTypes {
        debug {
            proguardFiles getDefaultProguardFile("proguard-android.txt"), "proguard-rules.pro"
        }
        release {
            minifyEnabled enableMinifyInReleaseBuilds
        }
    }
}
`;

    expect(() => injectT1ArcR8Compat(misplacedGradle)).toThrow(/release/i);
  });

  it('fails closed when the sole release anchor is inside a block comment', () => {
    const commentedGradle = generatedAppGradle.replace(
      '            proguardFiles',
      '            /*\n            proguardFiles',
    ).replace(
      '"proguard-rules.pro"',
      '"proguard-rules.pro"\n            */',
    );

    expect(() => injectT1ArcR8Compat(commentedGradle)).toThrow(/active/i);
  });

  it('keeps only the manifest-loaded Expo app loader', () => {
    const rules = readFileSync(
      path.join(
        process.cwd(),
        'scripts',
        'gradle',
        't1arc-r8-compat.pro',
      ),
      'utf8',
    );
    const activeRules = rules
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith('#'));

    expect(activeRules).toEqual([
      '-keep class expo.modules.adapters.react.apploader.RNHeadlessAppLoader {',
      'public <init>();',
      '}',
    ]);
  });
});
