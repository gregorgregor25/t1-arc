import { describe, expect, it, vi } from 'vitest';

import type { GlucoseSource } from '@/data/contracts';
import {
  glucoseAutomationSummary,
  glucoseReadingChanged,
  omitSupersededSourceRefreshes,
  observeGlucoseReadingForPublication,
  refreshGlucoseSources,
} from '@/data/live/glucoseSourceRefresh';
import { SourceConnectionSupersededError } from '@/data/live/sourceConnectionOwnership';

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
      sourceId: 't1arc-librelinkup',
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

  it('publishes a headless row that existed before foreground refresh began', () => {
    const oldReading = {
      id: 'reading-1',
      sourceId: 't1arc-librelinkup',
      timestamp: 100,
      receivedAt: 110,
      mmolL: 6.2,
      trend: 'flat' as const,
      quality: 'measured' as const,
    };
    const headlessReading = {
      ...oldReading,
      id: 'reading-2',
      timestamp: 200,
      receivedAt: 210,
      mmolL: 6.4,
    };
    const watermark = { reading: oldReading };

    // Both foreground samples see the row already written by Headless JS.
    expect(
      observeGlucoseReadingForPublication(watermark, headlessReading),
    ).toBe(true);
    expect(
      observeGlucoseReadingForPublication(watermark, headlessReading),
    ).toBe(false);
  });

  it('keeps source identities when refreshes settle', async () => {
    const results = await refreshGlucoseSources([
      source('t1arc-librelinkup', async () => undefined),
      source('nightscout', async () => {
        throw new Error('offline');
      }),
    ]);

    expect(results).toMatchObject([
      { sourceId: 't1arc-librelinkup', status: 'fulfilled' },
      { sourceId: 'nightscout', status: 'rejected' },
    ]);
  });

  it('treats a replaced source owner as benign cancellation', () => {
    expect(
      omitSupersededSourceRefreshes([
        {
          sourceId: 't1arc-librelinkup',
          status: 'rejected',
          reason: new SourceConnectionSupersededError(
            't1arc-librelinkup',
          ),
        },
        {
          sourceId: 'nightscout',
          status: 'rejected',
          reason: new Error('offline'),
        },
      ]),
    ).toMatchObject([
      {
        sourceId: 'nightscout',
        status: 'rejected',
        reason: expect.objectContaining({ message: 'offline' }),
      },
    ]);
  });

  it('names the failed source without retaining its raw error', () => {
    const summary = glucoseAutomationSummary(
      [
        { sourceId: 't1arc-librelinkup', status: 'fulfilled' },
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
