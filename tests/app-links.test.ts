import { describe, expect, it } from 'vitest';

import {
  APP_LINK_PREFIXES,
  GLOOKO_SHARED_REPORT_LINK,
  isGlookoSourceLink,
  isSafeNavigationLink,
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

describe('navigation input boundary', () => {
  it.each([
    GLOOKO_SHARED_REPORT_LINK,
    't1arc://today/log-food?request=123',
    't1arc://sources/region',
    't1arc://insights',
    't1arc://history?focus=glucose',
    't1arc://history?request=%E6%97%A5%E6%9C%AC',
  ])('preserves supported and valid encoded links: %s', (url) => {
    expect(isSafeNavigationLink(url)).toBe(true);
  });

  it.each([
    'https://example.com/today',
    't1arc-malicious://today',
    't1arc://history?request=%FF',
    't1arc://today?request=%',
    't1arc://today?request=%E0%A4',
    `t1arc://today?request=${'%FE%FF'.repeat(1000)}`,
    `t1arc://today?request=${'a'.repeat(2048)}`,
  ])('rejects malformed or oversized input before parsing (%#)', (url) => {
    expect(isSafeNavigationLink(url)).toBe(false);
  });
});
