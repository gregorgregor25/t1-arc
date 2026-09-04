import { describe, expect, it } from 'vitest';

import { assertManualGlookoImportIntegrity } from '@/data/glooko/glookoImportIntegrity';

const confirmed = {
  samePersonOrFirstGlookoDataConfirmed: true,
  ukTimestampFormatConfirmed: true,
} as const;

describe('manual Glooko import integrity', () => {
  it('requires an explicit same-person and UK-format attestation', () => {
    const prepared = { preview: { unsafeTimestampLocale: false } } as never;

    expect(() => assertManualGlookoImportIntegrity(prepared)).toThrow(
      /same person.*Europe\/London/i,
    );
    expect(() =>
      assertManualGlookoImportIntegrity(prepared, confirmed),
    ).not.toThrow();
  });

  it('rejects detected month-first timestamps despite confirmation', () => {
    const prepared = { preview: { unsafeTimestampLocale: true } } as never;

    expect(() =>
      assertManualGlookoImportIntegrity(prepared, confirmed),
    ).toThrow(/month\/day\/year.*repeated autumn hour.*Nothing was imported/i);
  });
});
