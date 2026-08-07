import { describe, expect, it } from 'vitest';

import {
  createManualContextEvent,
  manualContextDraftFromEvent,
  reviseManualContextEvent,
} from '@/data/manualContext';

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

  it('creates a factual context note without implying causation', () => {
    const timestamp = Date.parse('2026-07-26T19:15:00+01:00');
    expect(
      createManualContextEvent(
        {
          kind: 'note',
          timestamp,
          category: 'pump',
          detail: 'Changed pod after a suspected site issue',
        },
        { id: 'manual-note', recordedAt: timestamp + 2_000 },
      ),
    ).toEqual({
      id: 'manual-note',
      kind: 'note',
      start: timestamp,
      title: 'Pod / site',
      category: 'pump',
      detail: 'Changed pod after a suspected site issue',
      sourceId: 'daymark-manual',
      origin: 'manual',
      recordedAt: timestamp + 2_000,
    });
  });

  it('rejects oversized note detail', () => {
    expect(() =>
      createManualContextEvent({
        kind: 'note',
        timestamp: Date.now(),
        category: 'other',
        detail: 'x'.repeat(1_001),
      }),
    ).toThrow(/1,000 characters or fewer/i);
  });

  it('revises a manual entry without changing its identity or entered time', () => {
    const originalTime = Date.parse('2026-07-26T18:00:00+01:00');
    const correctedTime = Date.parse('2026-07-26T18:30:00+01:00');
    const existing = createManualContextEvent(
      {
        kind: 'note',
        timestamp: originalTime,
        category: 'stress',
        detail: 'Busy afternoon',
      },
      { id: 'manual-note-edit', recordedAt: originalTime + 5_000 },
    );

    expect(
      reviseManualContextEvent(existing, {
        kind: 'note',
        timestamp: correctedTime,
        category: 'illness',
        detail: 'Actually felt unwell',
        title: 'Feeling unwell',
      }),
    ).toEqual({
      id: 'manual-note-edit',
      kind: 'note',
      start: correctedTime,
      title: 'Feeling unwell',
      category: 'illness',
      detail: 'Actually felt unwell',
      sourceId: 'daymark-manual',
      origin: 'manual',
      recordedAt: originalTime + 5_000,
    });
  });

  it('does not let an edit silently change the record type or source owner', () => {
    const timestamp = Date.parse('2026-07-26T18:00:00+01:00');
    const existing = createManualContextEvent(
      {
        kind: 'weight',
        timestamp,
        kilograms: 78,
      },
      { id: 'manual-weight-edit' },
    );

    expect(() =>
      reviseManualContextEvent(existing, {
        kind: 'activity',
        timestamp,
        activityType: 'walk',
        durationMinutes: 30,
        intensity: 'light',
      }),
    ).toThrow(/type .* cannot be changed/i);

    expect(() =>
      reviseManualContextEvent(
        { ...existing, sourceId: 'daymark-food' },
        {
          kind: 'weight',
          timestamp,
          kilograms: 79,
        },
      ),
    ).toThrow(/created in T1 Arc/i);
  });

  it('prefills an edit without turning an automatic label into a custom one', () => {
    const timestamp = Date.parse('2026-07-26T08:00:00+01:00');
    const automatic = createManualContextEvent(
      {
        kind: 'activity',
        timestamp,
        activityType: 'walk',
        durationMinutes: 25,
        intensity: 'moderate',
      },
      { id: 'manual-walk-edit' },
    );
    const custom = { ...automatic, title: 'Walk to work' };

    expect(manualContextDraftFromEvent(automatic)).toEqual({
      kind: 'activity',
      timestamp,
      activityType: 'walk',
      durationMinutes: 25,
      intensity: 'moderate',
    });
    expect(manualContextDraftFromEvent(custom)).toEqual({
      kind: 'activity',
      timestamp,
      activityType: 'walk',
      durationMinutes: 25,
      intensity: 'moderate',
      title: 'Walk to work',
    });

    const stress = createManualContextEvent(
      {
        kind: 'note',
        timestamp,
        category: 'stress',
        detail: 'Busy day',
      },
      { id: 'manual-stress-edit' },
    );
    const stressDraft = manualContextDraftFromEvent(stress);
    if (stressDraft.kind !== 'note') throw new Error('Expected note draft.');
    expect(stressDraft.title).toBeUndefined();
    expect(
      reviseManualContextEvent(stress, {
        ...stressDraft,
        kind: 'note',
        category: 'illness',
      }),
    ).toMatchObject({
      id: 'manual-stress-edit',
      title: 'Illness',
      category: 'illness',
    });
  });
});
