import { describe, expect, it, vi } from 'vitest';
import {
  createManualInsulinDelivery,
  isManualInsulinDelivery,
  manualInsulinDraftFromDelivery,
  reviseManualInsulinDelivery,
} from '@/data/manualInsulin';
import { ImportedInsulinSource } from '@/data/live/ImportedInsulinSource';
import { MemoryHealthRecordStore } from '@/data/persistence/HealthRecordStore';

vi.mock('@/data/persistence/SqliteHealthRecordStore', () => ({
  SqliteHealthRecordStore: class {},
}));

describe('manual insulin point doses', () => {
  it('creates an exact delivered point dose under the stable manual source', () => {
    const delivery = createManualInsulinDelivery(
      {
        timestamp: 1_750_000_000_000,
        units: 4.5,
        insulinType: 'rapid-acting',
      },
      { id: 'manual-dose', recordedAt: 1_750_000_000_100 },
    );

    expect(delivery).toEqual({
      id: 'manual-dose',
      timestamp: 1_750_000_000_000,
      units: 4.5,
      deliveryType: 'Manual rapid-acting dose',
      sourceId: 't1arc-manual',
      importedAt: 1_750_000_000_100,
    });
    expect(isManualInsulinDelivery(delivery)).toBe(true);
    expect(manualInsulinDraftFromDelivery(delivery)).toEqual({
      timestamp: 1_750_000_000_000,
      units: 4.5,
      insulinType: 'rapid-acting',
    });
  });

  it('preserves identity and original recording time when corrected', () => {
    const original = createManualInsulinDelivery(
      {
        timestamp: 1_750_000_000_000,
        units: 18,
        insulinType: 'long-acting',
      },
      { id: 'manual-dose', recordedAt: 1_750_000_000_100 },
    );

    expect(
      reviseManualInsulinDelivery(original, {
        timestamp: 1_750_000_060_000,
        units: 17.5,
        insulinType: 'long-acting',
      }),
    ).toMatchObject({
      id: 'manual-dose',
      timestamp: 1_750_000_060_000,
      units: 17.5,
      deliveryType: 'Manual long-acting dose',
      sourceId: 't1arc-manual',
      importedAt: 1_750_000_000_100,
    });
  });

  it('rejects invalid amounts and imported insulin rows', () => {
    expect(() =>
      createManualInsulinDelivery({
        timestamp: 1_750_000_000_000,
        units: 0,
        insulinType: 'other',
      }),
    ).toThrow('more than 0');
    expect(() =>
      manualInsulinDraftFromDelivery({
        id: 'imported',
        timestamp: 1_750_000_000_000,
        units: 2,
        deliveryType: 'Bolus',
        sourceId: 'glooko-export',
      }),
    ).toThrow('Only insulin doses recorded in T1 Arc');
  });

  it('describes manual-only insulin honestly instead of claiming an import', async () => {
    const store = new MemoryHealthRecordStore();
    const now = 1_750_000_000_000;
    await store.saveManualInsulin(
      createManualInsulinDelivery(
        { timestamp: now, units: 2, insulinType: 'other' },
        { id: 'manual-dose', recordedAt: now },
      ),
    );

    await expect(new ImportedInsulinSource(store).getStatus(now)).resolves.toMatchObject({
      detail: 'Manual insulin doses recorded on this phone',
      freshness: 'current',
      origin: 'live',
      recordCount: 1,
    });
  });
});
