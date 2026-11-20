import { describe, expect, it } from 'vitest';

import {
  NIGHTSCOUT_HISTORY_BLOCK_MS,
  NIGHTSCOUT_HISTORY_INTERVAL_MS,
  NIGHTSCOUT_INITIAL_HISTORY_DAYS,
  planNightscoutHistoryBackfill,
  seedInitialNightscoutHistory,
} from '@/data/nightscout/historyBackfill';
import { addDays, dayRange, toDateKey } from '@/domain/time';

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

describe('initial Nightscout history target', () => {
  const now = Date.UTC(2030, 3, 9, 15);

  it('gives a new connection a 14-day target that the history job then reads', () => {
    const seeded = seedInitialNightscoutHistory({}, now, 'connected');
    expect(NIGHTSCOUT_INITIAL_HISTORY_DAYS).toBe(14);
    expect(seeded.targetDate).toBe(addDays(toDateKey(now), -14));
    const first = planNightscoutHistoryBackfill(seeded, now);
    expect(first).toMatchObject({
      endMs: now,
      startMs: now - NIGHTSCOUT_HISTORY_BLOCK_MS,
      targetMs: dayRange(seeded.targetDate!).start,
    });
    // The rest of the oldest day follows on the next history pass.
    const later = now + NIGHTSCOUT_HISTORY_INTERVAL_MS;
    const second = planNightscoutHistoryBackfill(
      { ...seeded, cursorBeforeMs: first!.startMs, lastAttemptAt: now },
      later,
    );
    expect(second).toMatchObject({
      startMs: dayRange(seeded.targetDate!).start,
      finalBlock: true,
    });
  });

  it('keeps a target the person already chose, earlier or later', () => {
    const earlier = { targetDate: '2029-06-01' as const };
    expect(seedInitialNightscoutHistory(earlier, now, 'connected')).toBe(earlier);
    const later = { targetDate: addDays(toDateKey(now), -3) };
    expect(seedInitialNightscoutHistory(later, now, 'connected')).toBe(later);
    expect(seedInitialNightscoutHistory(later, now, 'fill-enabled')).toBe(later);
  });

  it('re-reads a completed range once when the fill switch is turned on', () => {
    const completed = {
      targetDate: '2030-03-20' as const,
      cursorBeforeMs: dayRange('2030-03-20').start,
      lastAttemptAt: now - 60_000,
      lastSuccessAt: now - 60_000,
      completedAt: now - 60_000,
    };
    expect(seedInitialNightscoutHistory(completed, now, 'connected')).toBe(completed);
    const reset = seedInitialNightscoutHistory(completed, now, 'fill-enabled');
    expect(reset).toMatchObject({ targetDate: '2030-03-20', lastSuccessAt: now - 60_000 });
    expect(reset.cursorBeforeMs).toBeUndefined();
    expect(reset.completedAt).toBeUndefined();
    expect(reset.lastAttemptAt).toBeUndefined();
    expect(planNightscoutHistoryBackfill(reset, now)?.endMs).toBe(now);
  });

  it('uses local calendar days across a clock change', () => {
    // 14 local days back from just after the UK spring clock change.
    const afterChange = Date.UTC(2030, 2, 31, 12);
    const seeded = seedInitialNightscoutHistory({}, afterChange, 'connected', 'Europe/London');
    expect(seeded.targetDate).toBe('2030-03-17');
  });
});
