import { describe, expect, it } from 'vitest';

import {
  nextPresentationClock,
  PRESENTATION_CLOCK_BUCKET_MS,
} from '@/providers/presentationClock';

describe('presentation clock', () => {
  it('coalesces frequent stored-glucose observations within one minute', () => {
    const previous = Date.UTC(2026, 7, 30, 10, 41, 2);

    expect(PRESENTATION_CLOCK_BUCKET_MS).toBe(60_000);
    expect(nextPresentationClock(previous, previous + 15_000)).toBe(previous);
    expect(nextPresentationClock(previous, previous + 45_000)).toBe(previous);
  });

  it('publishes the observed time after crossing a minute boundary', () => {
    const previous = Date.UTC(2026, 7, 30, 10, 41, 2);
    const observed = Date.UTC(2026, 7, 30, 10, 42, 2);

    expect(nextPresentationClock(previous, observed)).toBe(observed);
  });
});
