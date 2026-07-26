import { describe, expect, it, vi } from 'vitest';

import { createDemoRepository } from '@/data/demoRepository';
import { SyntheticGlucoseSource } from '@/data/synthetic/SyntheticGlucoseSource';
import { dayRange, toDateKey } from '@/domain/time';

describe('synthetic repository', () => {
  it('keeps live-style glucose and delayed insulin as separate sources', async () => {
    const now = Date.parse('2026-07-25T20:00:00+01:00');
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now);
    try {
      const repository = createDemoRepository(now);
      const range = dayRange(toDateKey(now), now);
      const timeline = await repository.getTimeline(range);

      expect(timeline.glucose.length).toBeGreaterThan(100);
      expect(timeline.basal.length).toBeGreaterThan(20);
      expect(timeline.boluses.length).toBeGreaterThan(1);
      expect(timeline.context.some((event) => event.kind === 'meal')).toBe(true);
      expect(timeline.context.some((event) => event.kind === 'activity')).toBe(
        true,
      );
      expect(timeline.sources[0]?.freshness).toBe('current');
      expect(timeline.sources[0]?.origin).toBe('synthetic');
      expect(timeline.sources[0]?.isLive).toBe(true);
      expect(timeline.sources[1]?.freshness).toBe('delayed');
      expect(timeline.sources[1]?.origin).toBe('synthetic');
      expect(timeline.sources[1]?.isLive).toBe(false);
      expect(timeline.sources[1]?.dataThrough).toBeLessThan(now);
    } finally {
      clock.mockRestore();
    }
  });

  it('advances the demo glucose feed instead of becoming permanently stale', async () => {
    const now = Date.parse('2026-07-25T20:00:00+01:00');
    const source = new SyntheticGlucoseSource(now);
    const initial = await source.getLatestReading();
    const clock = vi
      .spyOn(Date, 'now')
      .mockReturnValue(now + 15 * 60_000);

    try {
      await source.refresh();
      const refreshed = await source.getLatestReading();
      expect(refreshed?.timestamp).toBeGreaterThan(initial?.timestamp ?? 0);
      expect((await source.getStatus(Date.now())).freshness).toBe('current');
    } finally {
      clock.mockRestore();
    }
  });
});
