import { describe, expect, it } from 'vitest';

import {
  aapsEstimatePresentation,
  nightscoutCardEstimates,
} from '@/components/aapsEstimatePresentation';

const NOW = Date.UTC(2026, 10, 2, 12);

describe('Nightscout estimates on the Today card', () => {
  it('uses the combined card only when Nightscout reported IOB or COB', () => {
    expect(nightscoutCardEstimates(undefined)).toBeUndefined();
    expect(nightscoutCardEstimates({ timestamp: NOW })).toBeUndefined();
    expect(nightscoutCardEstimates({ cobGrams: 0, timestamp: NOW - 60_000 })).toEqual({
      provenance: 'nightscout',
      context: { iobUnits: undefined, cobGrams: 0, receivedAt: NOW - 60_000 },
    });
  });

  it('labels the looping system via Nightscout as the source', () => {
    const input = nightscoutCardEstimates({ iobUnits: -0.4, cobGrams: 0, timestamp: NOW - 2 * 60_000 });
    const shown = aapsEstimatePresentation(input ?? {}, NOW, 'en-GB');
    expect(shown.heading).toBe('Estimates via Nightscout');
    expect(shown.iob).toBe('-0.40 U');
    expect(shown.cob).toBe('0.0 g');
    expect(shown.age).toBe('Reported 2 min ago');
    expect(shown.note).toBe(
      'Calculated by your looping system via Nightscout; not delivered insulin or logged carbs.',
    );
    expect(shown.accessibilityLabel.startsWith('Estimates via Nightscout.')).toBe(true);
  });

  it('marks an old Nightscout estimate with its own age', () => {
    const input = nightscoutCardEstimates({ iobUnits: 1.2, timestamp: NOW - 25 * 60_000 });
    const shown = aapsEstimatePresentation(input ?? {}, NOW, 'en-GB');
    expect(shown.stale).toBe(true);
    expect(shown.age).toBe('Reported 25 min ago');
    expect(shown.note).toContain('out of date');
    expect(shown.cob).toBe('Unavailable');
  });

  it('keeps the AAPS wording by default', () => {
    const shown = aapsEstimatePresentation({ context: { iobUnits: 1, receivedAt: NOW } }, NOW, 'en-GB');
    expect(shown.heading).toBe('AAPS estimates');
    expect(shown.note).toBe('Calculated by AAPS; not delivered insulin or logged carbs.');
  });
});
