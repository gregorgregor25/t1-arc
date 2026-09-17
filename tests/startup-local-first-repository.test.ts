import { describe, expect, it, vi } from 'vitest';

import type { DiabetesRepository } from '@/data/contracts';
import { StartupLocalFirstRepository } from '@/data/live/StartupLocalFirstRepository';
import type { TimelineData, TimeRange } from '@/domain/models';

const range: TimeRange = { start: 1_000, end: 2_000 };

function repository(label: string): DiabetesRepository {
  const timeline: TimelineData = {
    range,
    glucose: [],
    basal: [],
    boluses: [],
    dailyInsulinTotals: [],
    pumpStates: [],
    context: [],
    sources: [],
  };
  return {
    refresh: vi.fn(async () => undefined),
    refreshGlucose: vi.fn(async () => undefined),
    getTimeline: vi.fn(async () => ({ ...timeline, marker: label }) as TimelineData),
    getLatestGlucose: vi.fn(async () => undefined),
    getSourceStatuses: vi.fn(async () => []),
  };
}

describe('StartupLocalFirstRepository', () => {
  it('keeps one hook owner while switching from cache-only reads to configured sources', async () => {
    const cached = repository('cached');
    const configured = repository('configured');
    const stable = new StartupLocalFirstRepository(cached);
    const owner = stable;

    expect((await stable.getTimeline(range) as TimelineData & { marker: string }).marker)
      .toBe('cached');
    stable.upgrade(configured);

    expect(stable).toBe(owner);
    expect((await stable.getTimeline(range) as TimelineData & { marker: string }).marker)
      .toBe('configured');
    await stable.refreshGlucose?.();
    expect(configured.refreshGlucose).toHaveBeenCalledOnce();
    expect(cached.refreshGlucose).not.toHaveBeenCalled();
  });

  it('falls back to full refresh when a delegate has no glucose-only lane', async () => {
    const delegate = repository('cached');
    delete delegate.refreshGlucose;
    const stable = new StartupLocalFirstRepository(delegate);

    await stable.refreshGlucose?.();

    expect(delegate.refresh).toHaveBeenCalledOnce();
  });
});
