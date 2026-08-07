import { describe, expect, it, vi } from 'vitest';

import type { GlucoseSource } from '@/data/contracts';
import {
  glucoseAutomationSummary,
  glucoseReadingChanged,
  refreshGlucoseSources,
} from '@/data/live/glucoseSourceRefresh';

function source(
  sourceId: string,
  refresh: () => Promise<void>,
): GlucoseSource {
  return {
    sourceId,
    refresh,
    getReadings: vi.fn(async () => []),
    getLatestReading: vi.fn(async () => undefined),
    getStatus: vi.fn(async () => ({
      id: sourceId,
      label: sourceId,
      detail: '',
      freshness: 'missing' as const,
      origin: 'live' as const,
      isLive: true,
    })),
  };
}

describe('configured glucose refresh diagnostics', () => {
  it('only invalidates consumers when the latest glucose snapshot changes', () => {
    const reading = {
      id: 'reading-1',
      sourceId: 'daymark-librelinkup',
      timestamp: 100,
      receivedAt: 110,
      mmolL: 6.2,
      trend: 'flat' as const,
      quality: 'measured' as const,
    };
    expect(glucoseReadingChanged(reading, { ...reading })).toBe(false);
    expect(
      glucoseReadingChanged(reading, { ...reading, timestamp: 200 }),
    ).toBe(true);
    expect(glucoseReadingChanged(reading, undefined)).toBe(true);
  });

  it('keeps source identities when refreshes settle', async () => {
    const results = await refreshGlucoseSources([
      source('daymark-librelinkup', async () => undefined),
      source('nightscout', async () => {
        throw new Error('offline');
      }),
    ]);

    expect(results).toMatchObject([
      { sourceId: 'daymark-librelinkup', status: 'fulfilled' },
      { sourceId: 'nightscout', status: 'rejected' },
    ]);
  });

  it('names the failed source without retaining its raw error', () => {
    const summary = glucoseAutomationSummary(
      [
        { sourceId: 'daymark-librelinkup', status: 'fulfilled' },
        {
          sourceId: 'nightscout',
          status: 'rejected',
          reason: new Error('secret endpoint details'),
        },
      ],
      true,
    );

    expect(summary).toEqual({
      outcome: 'partial',
      detail:
        'Nightscout could not update. T1 Arc will try again automatically.',
    });
    expect(summary.detail).not.toContain('secret');
  });

  it('does not describe an empty setup as a successful source check', () => {
    expect(glucoseAutomationSummary([], true)).toEqual({
      outcome: 'skipped',
      detail:
        'No live glucose source is connected; stored displays were checked.',
    });
  });

  it('distinguishes current Nightscout data from an older-history retry', () => {
    expect(
      glucoseAutomationSummary(
        [
          {
            sourceId: 'nightscout',
            status: 'fulfilled',
            historyStatus: 'rejected',
          },
        ],
        true,
      ),
    ).toEqual({
      outcome: 'partial',
      detail:
        'Current glucose updated; older Nightscout history will retry automatically.',
    });
  });
});
