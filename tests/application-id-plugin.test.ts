import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { injectT1ArcReleaseSigning } = require(
  path.join(process.cwd(), 'plugins', 'with-t1arc-release-signing.js'),
) as { injectT1ArcReleaseSigning: (contents: string) => string };
const { injectT1ArcApplicationId } = require(
  path.join(process.cwd(), 'plugins', 'with-t1arc-application-id.js'),
) as { injectT1ArcApplicationId: (contents: string) => string };

const generatedAppGradle = `apply plugin: "com.android.application"
apply plugin: "com.facebook.react"

android {
    namespace 'io.github.gregorgregor25.t1arc'
    defaultConfig {
        applicationId 'io.github.gregorgregor25.t1arc'
    }
    signingConfigs {
        debug {
            storeFile file('debug.keystore')
        }
    }
    buildTypes {
        debug {
            signingConfig signingConfigs.debug
        }
        release {
            signingConfig signingConfigs.debug
        }
    }
}
`;

describe('T1 Arc Android application identity policy', () => {
  it('injects isolated phone identities without changing the source namespace', () => {
    const signed = injectT1ArcReleaseSigning(generatedAppGradle);
    const result = injectT1ArcApplicationId(signed);

    expect(result).toContain(
      "namespace 'io.github.gregorgregor25.t1arc'",
    );
    expect(result).toContain('applicationId t1ArcPhoneApplicationId');
    expect(result).toContain(
      'applicationIdSuffix t1ArcDebugApplicationIdSuffix',
    );
    expect(result).toContain(
      'applicationIdSuffix t1ArcReleaseApplicationIdSuffix',
    );
    expect(result).toContain(
      'resValue "string", "t1arc_application_id", t1ArcVariantApplicationId(t1ArcPhoneApplicationId, "debug")',
    );
    expect(result).toContain(
      'resValue "string", "t1arc_application_id", t1ArcVariantApplicationId(t1ArcPhoneApplicationId, "release")',
    );
  });

  it('is idempotent across repeated Expo prebuilds', () => {
    const once = injectT1ArcApplicationId(
      injectT1ArcReleaseSigning(generatedAppGradle),
    );
    expect(injectT1ArcApplicationId(once)).toBe(once);
  });

  it('fails if Expo emits an unexpected phone identity', () => {
    expect(() =>
      injectT1ArcApplicationId(
        generatedAppGradle.replace(
          "applicationId 'io.github.gregorgregor25.t1arc'",
          "applicationId 'com.example.unreviewed'",
        ),
      ),
    ).toThrow(/unexpected phone application ID/);
  });

  it('defines one validated policy for official, fork, debug and sideload IDs', () => {
    const policy = readFileSync(
      path.join(process.cwd(), 'scripts', 'gradle', 't1arc-application-id.gradle'),
      'utf8',
    );

    expect(policy).toContain(
      "officialApplicationIdBase = 'io.github.gregorgregor25.t1arc'",
    );
    expect(policy).toContain(
      "forkEnvironmentVariable = 'T1ARC_FORK_APPLICATION_ID_BASE'",
    );
    expect(policy).toContain("debugApplicationIdSuffix = '.dev'");
    expect(policy).toContain("privateTestApplicationIdSuffix = '.sideload'");
    expect(policy).toContain('reverseDnsApplicationId');
    expect(policy).toContain('t1ArcVariantApplicationId');
  });

  it('keeps phone and companion IDs equal for every build variant', () => {
    const companion = readFileSync(
      path.join(process.cwd(), 'wear', 'companion', 'build.gradle'),
      'utf8',
    );
    expect(companion).toContain('applicationId t1ArcWearCompanionApplicationId');
    expect(companion).toContain(
      'applicationIdSuffix t1ArcDebugApplicationIdSuffix',
    );
    expect(companion).toContain(
      'applicationIdSuffix t1ArcReleaseApplicationIdSuffix',
    );
  });

  it('generates variant-correct watch-face complication providers', () => {
    const providerPolicy = readFileSync(
      path.join(
        process.cwd(),
        'scripts',
        'gradle',
        't1arc-watchface-provider.gradle',
      ),
      'utf8',
    );
    expect(providerPolicy).toContain("['debug', 'release']");
    expect(providerPolicy).toContain('t1ArcVariantApplicationId');
    expect(providerPolicy).toContain('primaryProvider');
    expect(providerPolicy).toContain('pre${capitalizedBuildType}Build');

    for (const face of ['meridian', 'chronograph', 'atelier', 'pace', 'summit']) {
      const gradle = readFileSync(
        path.join(process.cwd(), 'wear', `watchface-${face}`, 'build.gradle'),
        'utf8',
      );
      expect(gradle).toContain(
        `applicationId t1ArcWatchFaceApplicationId('${face}')`,
      );
      expect(gradle).toContain(
        "apply from: rootProject.file('../scripts/gradle/t1arc-watchface-provider.gradle')",
      );
      expect(gradle).toContain(
        'applicationIdSuffix t1ArcDebugApplicationIdSuffix',
      );
      expect(gradle).toContain(
        'applicationIdSuffix t1ArcReleaseApplicationIdSuffix',
      );
    }
  });

  it('checks the actual phone package before accepting a signed Wear APK set', () => {
    const verifier = readFileSync('scripts/verify-wear-apks.ps1', 'utf8');
    expect(verifier).toContain('manifest application-id $phone');
    expect(verifier).toContain('$phonePackage -cne $expectedPhonePackage');
    expect(verifier).toContain('$companion.Package -cne $phonePackage');
    expect(verifier).toContain('$companion.Certificate -ne $phoneCertificate');
    expect(verifier.indexOf('$phonePackage -cne $expectedPhonePackage')).toBeLessThan(
      verifier.indexOf('$phoneCertificate = CertificateDigest $phone'),
    );
  });

  it('explains separate watch connections without promising delivery from a queued reading', () => {
    const card = readFileSync('src/components/WearCompanionCard.tsx', 'utf8');
    expect(card).toContain('companion from the same release as this phone app');
    expect(card.replace(/\s+/g, ' ')).toContain('package and signing certificate');
    expect(card).toContain('recent graph history and display preferences');
    expect(card).toContain('The latest glucose was queued securely for the watch.');
  });
});
