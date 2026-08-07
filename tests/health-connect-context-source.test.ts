import { beforeEach, describe, expect, it, vi } from 'vitest';

import { selectHealthConnectContext } from '@/data/healthConnect/healthConnectContextSelection';
import { healthConnectContextConflicts } from '@/data/healthConnect/healthConnectContextConflicts';
import type { HealthContextEvent } from '@/domain/models';

const { database, openDaymarkDatabase } = vi.hoisted(() => {
  const database = {
    getAllAsync: vi.fn(),
  };
  return {
    database,
    openDaymarkDatabase: vi.fn(async () => database),
  };
});

vi.mock('@/data/persistence/daymarkDatabase', () => ({
  openDaymarkDatabase,
  withDaymarkTransaction: vi.fn(),
}));

import { SqliteHealthRecordStore } from '@/data/persistence/SqliteHealthRecordStore';

describe('Health Connect context source selection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    database.getAllAsync.mockResolvedValue([]);
  });

  it('loads source preferences alongside events and cycle notes', async () => {
    const store = new SqliteHealthRecordStore();
    await store.getContextEvents({ start: 100, end: 200 });

    const eventQuery = database.getAllAsync.mock.calls[0]?.[0] as string;
    const noteQuery = database.getAllAsync.mock.calls[1]?.[0] as string;
    const preferenceQuery = database.getAllAsync.mock.calls[2]?.[0] as string;

    expect(eventQuery).toContain('SELECT * FROM context_events');
    expect(noteQuery).toContain('SELECT * FROM context_notes');
    expect(preferenceQuery).toContain('preferred_source_package');
    expect(preferenceQuery).toContain("'nutrition'");
    expect(preferenceQuery).toContain("'cycle'");
  });
});

function activity(
  id: string,
  sourceId: string,
): HealthContextEvent {
  return {
    id,
    sourceId,
    origin: 'imported',
    kind: 'activity',
    start: 100,
    end: 200,
    title: 'Walk',
    activityType: 'walk',
    durationMinutes: 1,
    intensity: 'light',
  };
}

describe('selectHealthConnectContext', () => {
  it('withholds an overlapping category until a source is chosen', () => {
    const manual = activity('manual', 'manual');
    const selected = selectHealthConnectContext(
      [
        activity('samsung', 'health-connect:com.sec.android.app.shealth'),
        activity('fitbit', 'health-connect:com.fitbit.FitbitMobile'),
        manual,
      ],
      [],
    );

    expect(selected.needsSource).toEqual(['workouts']);
    expect(selected.events).toEqual([manual]);
  });

  it('uses the chosen source without deleting other raw records', () => {
    const samsung = activity(
      'samsung',
      'health-connect:com.sec.android.app.shealth',
    );
    const fitbit = activity(
      'fitbit',
      'health-connect:com.fitbit.FitbitMobile',
    );
    const selected = selectHealthConnectContext(
      [samsung, fitbit],
      [
        {
          category: 'workouts',
          preferredSourcePackage: 'com.sec.android.app.shealth',
        },
      ],
    );

    expect(selected.needsSource).toEqual([]);
    expect(selected.events).toEqual([samsung]);
  });

  it('keeps a single provider and non-Health Connect context', () => {
    const samsung = activity(
      'samsung',
      'health-connect:com.sec.android.app.shealth',
    );
    const manual = activity('manual', 'manual');
    const selected = selectHealthConnectContext(
      [samsung, manual],
      [],
    );

    expect(selected.needsSource).toEqual([]);
    expect(selected.events).toEqual([samsung, manual]);
  });
});

describe('healthConnectContextConflicts', () => {
  const sources = [
    { category: 'sleep' as const, sourcePackage: 'samsung' },
    { category: 'sleep' as const, sourcePackage: 'fitbit' },
    { category: 'nutrition' as const, sourcePackage: 'samsung' },
  ];

  it('reports only categories with multiple unselected providers', () => {
    expect(healthConnectContextConflicts(sources, [])).toEqual(['sleep']);
  });

  it('clears the warning after a provider is selected', () => {
    expect(
      healthConnectContextConflicts(sources, [
        { category: 'sleep', preferredSourcePackage: 'samsung' },
      ]),
    ).toEqual([]);
  });
});
