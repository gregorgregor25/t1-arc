import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

function source(relativePath: string) {
  return readFileSync(new URL(`../${relativePath}`, import.meta.url), 'utf8');
}

describe('Glooko PDF R8 configuration', () => {
  it('owns the narrow optional JP2 decoder warning rule in the PDF module', () => {
    const buildGradle = source(
      'modules/t1arc-glooko-export/android/build.gradle',
    );
    const consumerRules = source(
      'modules/t1arc-glooko-export/android/consumer-rules.pro',
    );

    expect(buildGradle).toContain(
      "consumerProguardFiles 'consumer-rules.pro'",
    );
    const activeRules = consumerRules
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith('#'));
    expect(activeRules).toEqual(['-dontwarn com.gemalto.jp2.JP2Decoder']);
  });
});
