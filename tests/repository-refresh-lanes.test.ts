import { describe, expect, it, vi } from 'vitest';

import {
  CombinedDiabetesRepository,
  type GlucoseSource,
  type InsulinSource,
} from '@/data/contracts';

describe('CombinedDiabetesRepository refresh lanes', () => {
  it('shares overlapping source requests but releases glucose before slow insulin', async () => {
    let finishGlucose!: () => void;
    let finishInsulin!: () => void;
    const glucoseRefresh = vi.fn(() => new Promise<void>((resolve) => { finishGlucose=resolve; }));
    const insulinRefresh = vi.fn(() => new Promise<void>((resolve) => { finishInsulin=resolve; }));
    const repository = new CombinedDiabetesRepository(
      {refresh:glucoseRefresh} as unknown as GlucoseSource,
      {refresh:insulinRefresh} as unknown as InsulinSource,
    );
    const full = repository.refresh();
    const glucose = repository.refreshGlucose();
    await Promise.resolve();
    expect(glucoseRefresh).toHaveBeenCalledOnce();
    finishGlucose(); await glucose;
    const next = repository.refreshGlucose();
    await Promise.resolve();
    expect(glucoseRefresh).toHaveBeenCalledTimes(2);
    finishGlucose(); await next;
    finishInsulin(); await full;
  });

  it('allows retry after a rejected glucose request', async () => {
    const refresh = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined);
    const repository = new CombinedDiabetesRepository(
      {refresh} as unknown as GlucoseSource, {} as InsulinSource,
    );
    await expect(repository.refreshGlucose()).rejects.toThrow('offline');
    await repository.refreshGlucose();
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it('refreshes glucose without invoking the insulin importer', async () => {
    const glucoseRefresh = vi.fn(async () => undefined);
    const insulinRefresh = vi.fn(async () => undefined);
    const repository = new CombinedDiabetesRepository(
      { refresh: glucoseRefresh } as unknown as GlucoseSource,
      { refresh: insulinRefresh } as unknown as InsulinSource,
    );

    await repository.refreshGlucose();

    expect(glucoseRefresh).toHaveBeenCalledOnce();
    expect(insulinRefresh).not.toHaveBeenCalled();

    await repository.refresh();

    expect(glucoseRefresh).toHaveBeenCalledTimes(2);
    expect(insulinRefresh).toHaveBeenCalledOnce();
  });
});
