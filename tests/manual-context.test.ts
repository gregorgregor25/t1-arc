import { describe, expect, it } from 'vitest';

import { createManualContextEvent } from '@/data/manualContext';

describe('manual context normalisation', () => {
  it('creates a traceable meal event', () => {
    const timestamp = Date.parse('2026-07-26T12:30:00+01:00');
    expect(
      createManualContextEvent(
        {
          kind: 'meal',
          timestamp,
          mealType: 'lunch',
          carbsGrams: 56,
        },
        { id: 'manual-1', recordedAt: timestamp + 1000 },
      ),
    ).toEqual({
      id: 'manual-1',
      kind: 'meal',
      start: timestamp,
      title: 'Lunch',
      mealType: 'lunch',
      carbsGrams: 56,
      sourceId: 'daymark-manual',
      origin: 'manual',
      recordedAt: timestamp + 1000,
    });
  });

  it('stores sleep as the interval ending at the selected wake time', () => {
    const wake = Date.parse('2026-07-26T07:00:00+01:00');
    const event = createManualContextEvent(
      {
        kind: 'sleep',
        timestamp: wake,
        durationMinutes: 450,
        qualityPercent: 82,
      },
      { id: 'manual-sleep' },
    );

    expect(event.kind).toBe('sleep');
    expect(event.start).toBe(wake - 450 * 60_000);
    expect(event.end).toBe(wake);
  });

  it('rejects implausible values instead of silently storing them', () => {
    expect(() =>
      createManualContextEvent(
        {
          kind: 'weight',
          timestamp: Date.now(),
          kilograms: 5,
        },
        { id: 'bad-weight' },
      ),
    ).toThrow(/between 20 and 400/);
  });
});
