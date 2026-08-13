import { describe, expect, it } from 'vitest';

import { buildAutomationTiming } from '@/data/background/automationTiming';
import {
  DEFAULT_GLOOKO_SYNC_STATE,
  GLOOKO_INCREMENTAL_INTERVAL_MS,
} from '@/data/glooko/glookoSyncPolicy';
import type { HealthConnectOverview } from '@/data/healthConnect/healthConnectRepository';

const NOW = Date.UTC(2026, 6, 28, 8);

function healthOverview(
  overrides: Partial<HealthConnectOverview> = {},
): HealthConnectOverview {
  return {
    totalRecords: 0,
    preferences: [],
    sync: [],
    sources: [],
    ...overrides,
  };
}

function registered(
  overrides: Partial<Record<
    'glucose' | 'glooko' | 'health-connect' | 'insight-review',
    boolean
  >> = {},
) {
  return {
    glucose: false,
    glooko: false,
    'health-connect': false,
    'insight-review': false,
    ...overrides,
  };
}

describe('automatic connector timing', () => {
  it('distinguishes Glooko eligibility from Android execution', () => {
    const timing = buildAutomationTiming({
      glooko: {
        ...DEFAULT_GLOOKO_SYNC_STATE,
        automaticEnabled: true,
        sessionStatus: 'ready',
        lastSuccessAt: NOW - 3 * 60 * 60 * 1000,
        lastFullSuccessAt: NOW - 3 * 60 * 60 * 1000,
      },
      healthConnect: healthOverview(),
      healthConnectAccess: { available: true, readGranted: false },
      now: NOW,
      registered: registered({ glooko: true }),
    });

    expect(timing.glooko).toEqual({
      state: 'due',
      detail: 'latest Glooko data is ready to update when Android allows it.',
    });
  });

  it('shows the exact next Glooko eligibility time when data is fresh', () => {
    const lastSuccessAt = NOW - 30 * 60 * 1000;
    const timing = buildAutomationTiming({
      glooko: {
        ...DEFAULT_GLOOKO_SYNC_STATE,
        automaticEnabled: true,
        sessionStatus: 'ready',
        lastSuccessAt,
        lastFullSuccessAt: NOW,
        lastExtendedSuccessAt: NOW,
      },
      healthConnect: healthOverview(),
      healthConnectAccess: { available: true, readGranted: false },
      now: NOW,
      registered: registered({ glooko: true }),
    });

    expect(timing.glooko.state).toBe('waiting');
    expect(timing.glooko.nextEligibleAt).toBe(
      lastSuccessAt + GLOOKO_INCREMENTAL_INTERVAL_MS,
    );
  });

  it('uses the earliest selected Health Connect category due time', () => {
    const timing = buildAutomationTiming({
      glooko: DEFAULT_GLOOKO_SYNC_STATE,
      healthConnect: healthOverview({
        preferences: [
          {
            category: 'steps',
            enabled: true,
            updatedAt: NOW,
          },
          {
            category: 'sleep',
            enabled: true,
            updatedAt: NOW,
          },
        ],
        sync: [
          {
            category: 'steps',
            lastAttemptAt: NOW - 2 * 60 * 1000,
            recordCount: 12,
          },
          {
            category: 'sleep',
            lastAttemptAt: NOW - 3 * 60 * 1000,
            recordCount: 1,
          },
        ],
      }),
      healthConnectAccess: { available: true, readGranted: true },
      now: NOW,
      registered: registered({ 'health-connect': true }),
    });

    expect(timing['health-connect']).toEqual({
      state: 'waiting',
      detail:
        'Checks every 5 minutes while you use T1 Arc, and automatically when Android allows it.',
      nextEligibleAt: NOW + 2 * 60 * 1000,
    });
  });

  it('reports a never-synced Health Connect category as due now', () => {
    const timing = buildAutomationTiming({
      glooko: DEFAULT_GLOOKO_SYNC_STATE,
      healthConnect: healthOverview({
        preferences: [
          {
            category: 'steps',
            enabled: true,
            updatedAt: NOW,
          },
        ],
      }),
      healthConnectAccess: { available: true, readGranted: true },
      now: NOW,
      registered: registered(),
    });

    expect(timing['health-connect']).toEqual({
      state: 'due',
      detail: 'Health data is ready; open T1 Arc to update now.',
    });
  });

  it('does not let an enabled but ungranted category look overdue', () => {
    const recentAttempt = NOW - 2 * 60 * 1000;
    const timing = buildAutomationTiming({
      glooko: DEFAULT_GLOOKO_SYNC_STATE,
      healthConnect: healthOverview({
        preferences: [
          {
            category: 'steps',
            enabled: true,
            updatedAt: NOW,
          },
          {
            category: 'nutrition',
            enabled: true,
            updatedAt: NOW,
          },
        ],
        sync: [
          {
            category: 'steps',
            lastAttemptAt: recentAttempt,
            recordCount: 12,
          },
        ],
      }),
      healthConnectAccess: {
        available: true,
        readGranted: true,
        grantedCategories: ['steps'],
      },
      now: NOW,
      registered: registered({ 'health-connect': true }),
    });

    expect(timing['health-connect']).toEqual({
      state: 'waiting',
      detail:
        'Checks every 5 minutes while you use T1 Arc, and automatically when Android allows it.',
      nextEligibleAt:
        recentAttempt + 5 * 60 * 1000,
    });
  });

  it('does not call Health Connect due before Android grants read access', () => {
    const timing = buildAutomationTiming({
      glooko: DEFAULT_GLOOKO_SYNC_STATE,
      healthConnect: healthOverview({
        preferences: [
          {
            category: 'steps',
            enabled: true,
            updatedAt: NOW,
          },
        ],
      }),
      healthConnectAccess: { available: true, readGranted: false },
      now: NOW,
      registered: registered(),
    });

    expect(timing['health-connect']).toEqual({
      state: 'off',
      detail: 'No Health Connect read categories are allowed yet.',
    });
  });
});
