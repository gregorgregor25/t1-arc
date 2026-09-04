import { createRequire } from 'node:module';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { injectT1ArcWindowsNativeStaging } = require(
  path.join(
    process.cwd(),
    'plugins',
    'with-t1arc-windows-native-staging.js',
  ),
) as {
  injectT1ArcWindowsNativeStaging: (contents: string) => string;
};

const generatedAppGradle = `android {
    namespace 'com.t1arc.app'
}
`;

describe('T1 Arc Windows native staging plugin', () => {
  it('uses a short native build staging path on Windows', () => {
    const result = injectT1ArcWindowsNativeStaging(generatedAppGradle);

    expect(result).toContain("contains('windows')");
    expect(result).toContain(
      "System.getenv('T1ARC_CMAKE_STAGING_DIR') ?: 'C:/t1arc-cxx'",
    );
  });

  it('does not change non-Windows native staging at runtime', () => {
    const result = injectT1ArcWindowsNativeStaging(generatedAppGradle);

    expect(result).toContain(
      "if (System.getProperty('os.name').toLowerCase().contains('windows'))",
    );
  });

  it('is idempotent across repeated Expo prebuilds', () => {
    const once = injectT1ArcWindowsNativeStaging(generatedAppGradle);

    expect(injectT1ArcWindowsNativeStaging(once)).toBe(once);
  });

  it('fails closed when the generated Android anchor is ambiguous', () => {
    expect(() =>
      injectT1ArcWindowsNativeStaging(`${generatedAppGradle}\nandroid {}`),
    ).toThrow(/unique/i);
  });
});
