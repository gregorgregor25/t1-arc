import { describe, expect, it, vi } from 'vitest';

import {
  CombinedDiabetesRepository,
  type GlucoseSource,
  type InsulinSource,
} from '@/data/contracts';

describe('CombinedDiabetesRepository refresh lanes', () => {
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
