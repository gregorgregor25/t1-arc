import { describe, expect, it } from 'vitest';

import {
  NIGHTSCOUT_HISTORY_BLOCK_MS,
  NIGHTSCOUT_HISTORY_INTERVAL_MS,
  planNightscoutHistoryBackfill,
} from '@/data/nightscout/historyBackfill';
import { dayRange } from '@/domain/time';

describe('Nightscout history backfill', () => {
  it('plans continuous 14-day blocks working backwards', () => {
    const now = Date.UTC(2026, 6, 27, 12);
    const first = planNightscoutHistoryBackfill(
      {
        targetDate: '2026-01-01',
        cursorBeforeMs: now,
      },
      now,
    );

    expect(first).toEqual({
      startMs: now - NIGHTSCOUT_HISTORY_BLOCK_MS,
      endMs: now,
      targetMs: dayRange('2026-01-01').start,
      finalBlock: false,
    });

    const second = planNightscoutHistoryBackfill(
      {
        targetDate: '2026-01-01',
        cursorBeforeMs: first!.startMs,
      },
      now,
    );
    expect(second?.endMs).toBe(first?.startMs);
    expect(second?.startMs).toBe(
      first!.startMs - NIGHTSCOUT_HISTORY_BLOCK_MS,
    );
  });

  it('clamps the final block to the London start of the chosen date', () => {
    const targetMs = dayRange('2026-03-29').start;
    const plan = planNightscoutHistoryBackfill(
      {
        targetDate: '2026-03-29',
        cursorBeforeMs: targetMs + 3 * 86_400_000,
      },
      targetMs + 4 * 86_400_000,
    );

    expect(plan).toMatchObject({
      startMs: targetMs,
      finalBlock: true,
    });
  });

  it('waits between blocks and stops after completion', () => {
    const now = Date.UTC(2026, 6, 27, 12);
    const state = {
      targetDate: '2025-01-01' as const,
      cursorBeforeMs: now,
      lastAttemptAt: now - NIGHTSCOUT_HISTORY_INTERVAL_MS + 1,
    };
    expect(planNightscoutHistoryBackfill(state, now)).toBeUndefined();
    expect(
      planNightscoutHistoryBackfill(
        { ...state, lastAttemptAt: now - NIGHTSCOUT_HISTORY_INTERVAL_MS },
        now,
      ),
    ).toBeDefined();
    expect(
      planNightscoutHistoryBackfill(
        { ...state, completedAt: now - 1 },
        now,
      ),
    ).toBeUndefined();
  });
});
