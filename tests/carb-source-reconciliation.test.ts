import { describe, expect, it, vi } from 'vitest';

import type { HealthRecordStore } from '@/data/persistence/HealthRecordStore';
import { StoredContextSource } from '@/data/live/StoredContextSource';
import { reconcileContextSources } from '@/domain/insulinSourceReconciliation';
import type { HealthContextEvent, MealEvent } from '@/domain/models';
import { summarizePeriod } from '@/domain/periodSummary';

vi.mock('@/data/persistence/SqliteHealthRecordStore', () => ({ SqliteHealthRecordStore: class {} }));

const minute = 60_000;
const at = Date.parse('2026-11-12T12:30:00Z');

function meal(
  id: string,
  sourceId: string,
  start: number,
  carbsGrams: number | undefined,
  origin: MealEvent['origin'] = 'imported',
): MealEvent {
  return {
    id,
    kind: 'meal',
    start,
    title: 'Meal Bolus',
    mealType: 'lunch',
    carbsGrams,
    sourceId,
    origin,
  };
}

const ids = (events: readonly HealthContextEvent[]) => events.map((event) => event.id);
const grams = (events: readonly HealthContextEvent[]) =>
  events.reduce((sum, event) => sum + (event.kind === 'meal' ? (event.carbsGrams ?? 0) : 0), 0);

describe('one meal recorded by several sources', () => {
  const sources = {
    glooko: meal('glooko:meal:1', 'glooko-export', at, 30),
    local: meal('aaps-local:meal:1', 'aaps-local', at, 30),
    nightscout: meal('nightscout:meal:1', 'nightscout', at, 30),
  };

  it.each([
    [['glooko', 'local', 'nightscout'], 'glooko:meal:1'],
    [['nightscout', 'local', 'glooko'], 'glooko:meal:1'],
    [['glooko', 'local'], 'glooko:meal:1'],
    [['glooko', 'nightscout'], 'glooko:meal:1'],
    [['local', 'nightscout'], 'aaps-local:meal:1'],
    [['glooko'], 'glooko:meal:1'],
    [['local'], 'aaps-local:meal:1'],
    [['nightscout'], 'nightscout:meal:1'],
  ] as const)('counts %j once, keeping %s', (names, keptId) => {
    const result = reconcileContextSources(names.map((name) => sources[name]));
    expect(ids(result)).toEqual([keptId]);
    expect(grams(result)).toBe(30);
  });

  it('keeps two real meals close together in one source, each absorbing its own copies', () => {
    const later = at + 90_000;
    const result = reconcileContextSources([
      meal('glooko:meal:a', 'glooko-export', at, 30),
      meal('glooko:meal:b', 'glooko-export', later, 30),
      meal('aaps-local:meal:a', 'aaps-local', at, 30),
      meal('aaps-local:meal:b', 'aaps-local', later, 30),
      meal('nightscout:meal:a', 'nightscout', at, 30),
      meal('nightscout:meal:b', 'nightscout', later, 30),
    ]);
    expect(ids(result)).toEqual(['glooko:meal:a', 'glooko:meal:b']);
    expect(grams(result)).toBe(60);
  });

  it('keeps a separate meal from a lower source when the higher source holds only one', () => {
    const result = reconcileContextSources([
      meal('glooko:meal:1', 'glooko-export', at, 30),
      meal('nightscout:meal:a', 'nightscout', at, 30),
      meal('nightscout:meal:b', 'nightscout', at + 60_000, 30),
    ]);
    expect(ids(result)).toEqual(['glooko:meal:1', 'nightscout:meal:b']);
  });

  it('matches within 2 minutes and 0.5 g, and keeps meals just outside', () => {
    const glooko = meal('glooko:meal:1', 'glooko-export', at, 30);
    const count = (offset: number, carbs: number) =>
      reconcileContextSources([glooko, meal('nightscout:meal:x', 'nightscout', at + offset, carbs)]).length;
    expect(count(2 * minute, 30)).toBe(1);
    expect(count(-2 * minute, 30)).toBe(1);
    expect(count(2 * minute + 1_000, 30)).toBe(2);
    expect(count(0, 30.4)).toBe(1);
    expect(count(0, 30.6)).toBe(2);
    expect(count(0, 45)).toBe(2);
  });

  it('never hides or matches manual meals, and never uses meals without carbohydrate', () => {
    const result = reconcileContextSources([
      meal('manual:1', 'manual-context', at, 30, 'manual'),
      meal('glooko:meal:none', 'glooko-export', at, undefined),
      sources.nightscout,
      meal('manual:2', 'glooko-export', at, 30, 'manual'),
    ]);
    expect(ids(result)).toEqual(['manual:1', 'glooko:meal:none', 'nightscout:meal:1', 'manual:2']);
  });

  it('leaves other context such as activity untouched', () => {
    const walk: HealthContextEvent = {
      id: 'nightscout:activity:1',
      kind: 'activity',
      start: at,
      title: 'Walk',
      activityType: 'walk',
      durationMinutes: 30,
      intensity: 'light',
      sourceId: 'nightscout',
      origin: 'imported',
    };
    expect(ids(reconcileContextSources([sources.glooko, walk]))).toEqual([
      'glooko:meal:1',
      'nightscout:activity:1',
    ]);
  });

  it('gives the period summary and exports one 30 g meal through the stored context source', async () => {
    const store = {
      getContextEvents: async () => [sources.nightscout, sources.local, sources.glooko],
    } as unknown as HealthRecordStore;
    const range = { start: at - 60 * minute, end: at + 60 * minute };
    const context = await new StoredContextSource(store).getEvents(range);
    const summary = summarizePeriod(
      { range, glucose: [], basal: [], boluses: [], context },
      null,
    );
    expect(summary.carbs).toMatchObject({ grams: 30, mealCount: 1, sourceIds: ['glooko-export'] });
  });
});

describe('AAPS notes and large ranges', () => {
  it('counts an AAPS temporary target received both ways once, but keeps a Glooko note', () => {
    const note = (id: string, sourceId: string): HealthContextEvent => ({
      id,
      kind: 'note',
      start: at,
      title: 'Temporary Target',
      category: 'pump',
      sourceId,
      origin: 'imported',
    });
    expect(
      ids(
        reconcileContextSources([
          note('aaps-local:note:1', 'aaps-local'),
          note('nightscout:note:1', 'nightscout'),
          note('glooko:note:1', 'glooko-export'),
        ]),
      ),
    ).toEqual(['aaps-local:note:1', 'glooko:note:1']);
  });

  it('reconciles 90 days of five-minute records from two sources quickly', () => {
    const records: MealEvent[] = [];
    for (let index = 0; index < 90 * 288; index += 1) {
      const start = at + index * 5 * minute;
      records.push(meal(`aaps-local:meal:${index}`, 'aaps-local', start, 5));
      records.push(meal(`nightscout:meal:${index}`, 'nightscout', start, 5));
    }
    const started = performance.now();
    const result = reconcileContextSources(records);
    expect(result).toHaveLength(90 * 288);
    expect(performance.now() - started).toBeLessThan(5_000);
  });
});
