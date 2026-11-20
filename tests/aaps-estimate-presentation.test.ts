import { describe, expect, it } from 'vitest';

import { aapsEstimatePresentation } from '@/components/aapsEstimatePresentation';
import type { AapsContextObservation } from '@/data/aaps/types';

const NOW = Date.UTC(2026, 10, 2, 12);
const context: AapsContextObservation = { id: 'capture', receivedAt: NOW - 2 * 60_000,
  writeEpoch: 4, selectionGeneration: 7, reconciliationScope: 'local', iobUnits: -0.4, cobGrams: 0 };

describe('AAPS estimate card presentation', () => {
  it('keeps signed IOB, genuine zero COB, source units and regional decimal formatting', () => {
    const shown = aapsEstimatePresentation({ context }, NOW, 'de-DE');
    expect(shown.iob).toBe('-0,40 U');
    expect(shown.cob).toBe('0,0 g');
    expect(shown.accessibilityLabel).toContain('Insulin on board: -0,40 units');
    expect(shown.accessibilityLabel).toContain('Carbs on board: 0,0 grams');
    expect(shown.age).toBe('Received 2 min ago');
  });

  it('does not substitute zero for an individually missing estimate', () => {
    const shown = aapsEstimatePresentation({ context: { ...context, iobUnits: undefined } }, NOW, 'en-GB');
    expect(shown.iob).toBe('Unavailable');
    expect(shown.cob).toBe('0.0 g');
  });

  it('ages estimates from reception independently of the glucose measurement', () => {
    const shown = aapsEstimatePresentation({ context: { ...context, receivedAt: NOW - 25 * 60_000,
      glucoseTimestamp: NOW } }, NOW, 'en-GB');
    expect(shown.age).toBe('Received 25 min ago');
    expect(shown.stale).toBe(true);
    expect(shown.note).toContain('out of date');
  });

  it('does not present a new glucose-only broadcast as fresh estimates', () => {
    const shown = aapsEstimatePresentation({ context: { ...context, receivedAt: NOW,
      iobUnits: undefined, cobGrams: undefined } }, NOW, 'en-GB');
    expect(shown.age).toBe('No estimates in the latest broadcast');
    expect(shown.iob).toBe('Unavailable');
    expect(shown.cob).toBe('Unavailable');
  });

  it('distinguishes waiting for the first capture from a failed check', () => {
    expect(aapsEstimatePresentation({}, NOW, 'en-GB').age).toBe('Waiting for AAPS estimates');
    const failed = aapsEstimatePresentation({ context, unavailable: true }, NOW, 'en-GB');
    expect(failed.age).toBe('Estimates could not be checked');
    expect(failed.iob).toBe('Unavailable');
    expect(failed.cob).toBe('Unavailable');
  });

  it('marks future clock mismatch rather than showing a newly received estimate', () => {
    const shown = aapsEstimatePresentation({ context: { ...context, receivedAt: NOW + 8 * 60_000 } }, NOW, 'en-GB');
    expect(shown.stale).toBe(true);
    expect(shown.age).toBe('Received 8 min ahead');
    expect(shown.note).toContain('clock');
  });
});
