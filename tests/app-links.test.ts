import { describe, expect, it } from 'vitest';

import {
  APP_LINK_PREFIXES,
  GLOOKO_SHARED_REPORT_LINK,
  isGlookoSourceLink,
} from '@/navigation/appLinks';

describe('T1 Arc deep-link identity', () => {
  it('uses one canonical T1 Arc scheme', () => {
    expect(APP_LINK_PREFIXES).toEqual(['t1arc://']);
    expect(GLOOKO_SHARED_REPORT_LINK).toBe(
      't1arc://sources/glooko?shared-report=1',
    );
  });

  it.each([
    't1arc://sources/glooko',
    't1arc://sources/glooko?shared-report=1',
    't1arc://sources/glooko',
    't1arc://sources/glooko?shared-report=1',
  ])('accepts current and legacy Glooko source links: %s', (url) => {
    expect(isGlookoSourceLink(url)).toBe(true);
  });

  it.each([
    'https://sources/glooko',
    'other://sources/glooko',
    't1arc://sources/glookout',
    't1arc-malicious://sources/glooko',
  ])('rejects unrelated or lookalike links: %s', (url) => {
    expect(isGlookoSourceLink(url)).toBe(false);
  });
});
