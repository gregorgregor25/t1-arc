import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { presentHealthConnectState } from '@/components/healthConnect/presentation';

const NOW = 1_800_000_000_000;

const base = {
  allSelectedCategoriesSynced: false,
  availability: 'available' as const,
  connected: false,
  importsPaused: false,
  initialLoading: false,
  loadFailed: false,
  latestHealthData: 0,
  latestSuccessfulSync: 0,
  oldestSelectedSuccessfulSync: 0,
  now: NOW,
  syncFailureCount: 0,
};

describe('Health Connect status presentation', () => {
  it('acknowledges preference saves before broad source refresh work', () => {
    const source = readFileSync(
      new URL('../src/components/HealthConnectCard.tsx', import.meta.url),
      'utf8',
    );
    const start = source.indexOf('async function saveCategoryChoices()');
    const end = source.indexOf('async function enableBackgroundUpdates()', start);
    const saveFlow = source.slice(start, end);

    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    expect(saveFlow).toContain(
      'await saveHealthConnectPreferences(nextSelection)',
    );
    expect(saveFlow).toContain('setOperation(undefined)');
    expect(saveFlow).toContain(
      'scheduleHealthPreferencesPostCommitRefresh()',
    );
    expect(saveFlow).not.toContain(
      'await updateHealthConnectBackgroundSyncRegistration()',
    );
    expect(saveFlow).not.toContain('await onDataChanged?.()');
    expect(saveFlow).not.toContain('await load()');
  });

  it('does not claim disconnected while status is loading or unreadable', () => {
    expect(
      presentHealthConnectState({ ...base, initialLoading: true }).statusLabel,
    ).toBe('Checking');
    expect(
      presentHealthConnectState({
        ...base,
        availability: undefined,
        loadFailed: true,
      }).statusLabel,
    ).toBe('Unavailable');
    expect(
      presentHealthConnectState({
        ...base,
        availability: 'available',
        connected: true,
        loadFailed: true,
      }),
    ).toMatchObject({
      statusLabel: 'Refresh failed',
      summaryTitle: 'Health Connect could not be refreshed',
    });
  });

  it('does not claim up to date before a successful sync', () => {
    expect(
      presentHealthConnectState({ ...base, connected: true }).summaryTitle,
    ).toBe('Ready for the first health import');
    expect(
      presentHealthConnectState({
        ...base,
        allSelectedCategoriesSynced: true,
        connected: true,
        latestSuccessfulSync: NOW - 20 * 60_000,
        oldestSelectedSuccessfulSync: NOW - 20 * 60_000,
      }).summaryTitle,
    ).toBe('Last checked 20 min ago');
    expect(
      presentHealthConnectState({
        ...base,
        allSelectedCategoriesSynced: true,
        connected: true,
        latestHealthData: NOW - 2 * 24 * 60 * 60_000,
        latestSuccessfulSync: NOW - 20 * 60_000,
        oldestSelectedSuccessfulSync: NOW - 20 * 60_000,
      }).summaryTitle,
    ).toBe('Latest health data 2 days ago');
    expect(
      presentHealthConnectState({
        ...base,
        allSelectedCategoriesSynced: true,
        connected: true,
        latestHealthData: NOW - 2 * 24 * 60 * 60_000,
        latestSuccessfulSync: NOW - 5 * 60_000,
        oldestSelectedSuccessfulSync: NOW - 5 * 60_000,
      }).summaryTitle,
    ).toBe('Health Connect is up to date');
  });

  it('requires every selected category to have been checked recently', () => {
    const presentation = presentHealthConnectState({
      ...base,
      allSelectedCategoriesSynced: true,
      connected: true,
      latestHealthData: NOW - 5 * 60_000,
      latestSuccessfulSync: NOW - 5 * 60_000,
      oldestSelectedSuccessfulSync: NOW - 2 * 24 * 60 * 60_000,
    });

    expect(presentation.summaryTitle).toBe('Latest health data 5 min ago');
    expect(presentation.summaryTitle).not.toBe('Health Connect is up to date');
  });

  it('does not claim up to date when only some selected categories synced', () => {
    expect(
      presentHealthConnectState({
        ...base,
        connected: true,
        latestHealthData: NOW - 60_000,
        latestSuccessfulSync: NOW - 60_000,
      }).summaryTitle,
    ).toBe('Some health data has not been checked');
  });
});
