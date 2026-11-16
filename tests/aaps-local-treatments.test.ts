import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AapsLocalTreatment } from '../modules/t1arc-glucose-display';
import {
  drainAapsLocalTreatments,
  normalizeAapsLocalTreatments,
} from '@/data/aaps/localAapsTreatments';
import { MemoryHealthRecordStore } from '@/data/persistence/HealthRecordStore';
import {
  reconcileBolusSources,
  reconcileContextSources,
} from '@/domain/insulinSourceReconciliation';
import type { HealthContextEvent } from '@/domain/models';

const mocks = vi.hoisted(() => ({
  status: vi.fn(),
  peek: vi.fn(),
  ack: vi.fn(),
}));

vi.mock('../modules/t1arc-glucose-display', () => ({
  default: {
    peekAapsTreatmentsAsync: mocks.peek,
    acknowledgeAapsTreatmentsAsync: mocks.ack,
  },
}));
vi.mock('@/data/aaps/localAapsSource', () => ({
  getAapsLocalSourceStatus: mocks.status,
}));
vi.mock('@/data/privacy/localDataWriteEpoch', () => ({
  acquireLocalDataWriteLease: vi.fn(async () => ({ epoch: 5 })),
}));
vi.mock('expo-crypto', () => ({
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  digestStringAsync: vi.fn(async (_algorithm: string, value: string) => {
    let hash = 0;
    for (let index = 0; index < value.length; index += 1) {
      hash = (Math.imul(hash, 31) + value.charCodeAt(index)) >>> 0;
    }
    return hash.toString(16).padStart(64, '0');
  }),
}));

const T0 = Date.parse('2026-11-10T08:00:00Z');
const minute = 60_000;

let next = 0;
function queued(
  treatment: AapsLocalTreatment['treatment'],
  overrides: Partial<AapsLocalTreatment> = {},
): AapsLocalTreatment {
  next += 1;
  return {
    id: `q-${next}`,
    receivedAt: T0 + next,
    writeEpoch: 5,
    selectionGeneration: 3,
    treatment,
    ...overrides,
  };
}

const smb = {
  identifier: `bolus-${T0}`,
  eventType: 'Correction Bolus',
  date: T0,
  insulin: 0.3,
  type: 'SMB',
  isSMB: true,
  isValid: true,
};

beforeEach(() => {
  next = 0;
  mocks.status.mockReset().mockResolvedValue({
    supported: true,
    selectedSourceId: 'aaps-local',
    selectionGeneration: 3,
    writeEpoch: 5,
    bufferedCount: 0,
  });
  mocks.peek.mockReset();
  mocks.ack.mockReset().mockResolvedValue(true);
});

describe('AAPS treatments received on this phone', () => {
  it('records what AAPS sent with on-phone provenance', () => {
    const normalized = normalizeAapsLocalTreatments(
      [
        queued(smb),
        queued({ identifier: `carbs-${T0}`, eventType: 'Meal Bolus', date: T0, carbs: 30 }),
        queued({
          identifier: `temporary-target-${T0}`,
          eventType: 'Temporary Target',
          date: T0,
          duration: 60,
          targetBottom: 7.5,
          targetTop: 7.5,
          units: 'mmol',
        }),
      ],
      T0 + minute,
    );
    expect(normalized.boluses).toEqual([
      expect.objectContaining({
        id: `aaps-local:bolus:bolus-${T0}`,
        sourceId: 'aaps-local',
        sourceFile: 'AAPS xDrip+ broadcast',
        deliveryType: 'SMB',
        units: 0.3,
      }),
    ]);
    expect(normalized.context).toEqual([
      expect.objectContaining({ id: `aaps-local:meal:carbs-${T0}`, kind: 'meal', carbsGrams: 30 }),
      expect.objectContaining({
        id: `aaps-local:note:temporary-target-${T0}`,
        detail: 'target 7.5 mmol as recorded',
      }),
    ]);
    expect(normalized.rawRecords.every((record) => record.recordKind === 'aaps-local-treatment')).toBe(true);
  });

  it('keeps only listed fields and rejects records without an identity', () => {
    const normalized = normalizeAapsLocalTreatments(
      [
        queued({ ...smb, profileJson: '{"large":true}', created_at: 7 } as never),
        queued({ eventType: 'Meal Bolus', date: T0, insulin: 2 }),
      ],
      T0,
    );
    expect(normalized.rejected).toBe(1);
    expect(JSON.parse(normalized.rawRecords[0]!.payloadJson)).not.toHaveProperty('profileJson');
    expect(JSON.parse(normalized.rawRecords[0]!.payloadJson)).not.toHaveProperty('created_at');
  });

  it('applies the latest copy of a record when an edit and a deletion arrive together', () => {
    const normalized = normalizeAapsLocalTreatments(
      [queued({ ...smb, insulin: 0.4 }), queued({ ...smb, isValid: false })],
      T0,
    );
    expect(normalized.boluses).toEqual([]);
    expect(normalized.withdrawn).toBe(1);
    expect(normalized.revisedRecordIds).toContain(`aaps-local:bolus:bolus-${T0}`);
  });
});

describe('draining the native AAPS treatment queue', () => {
  it('stores the current batch, then acknowledges it, and replaces a record AAPS later withdraws', async () => {
    const store = new MemoryHealthRecordStore();
    mocks.peek.mockResolvedValueOnce([
      queued(smb),
      // A stale row from an earlier selection is never stored.
      queued({ ...smb, identifier: 'bolus-old', insulin: 5 }, { selectionGeneration: 2 }),
    ]);
    expect(await drainAapsLocalTreatments(store, () => T0 + minute)).toBe(1);
    const range = { start: T0 - minute, end: T0 + minute };
    expect((await store.getBolusDeliveries(range)).map((record) => record.units)).toEqual([0.3]);
    expect(mocks.ack).toHaveBeenCalledWith(['q-1'], 3, 5);

    mocks.peek.mockResolvedValueOnce([queued({ ...smb, isValid: false })]);
    await drainAapsLocalTreatments(store, () => T0 + 2 * minute);
    expect(await store.getBolusDeliveries(range)).toEqual([]);
  });

  it('does nothing unless AAPS is the selected source in the current privacy epoch', async () => {
    const store = new MemoryHealthRecordStore();
    mocks.status.mockResolvedValueOnce({
      supported: true,
      selectedSourceId: 'nightscout',
      selectionGeneration: 3,
      writeEpoch: 5,
      bufferedCount: 0,
    });
    expect(await drainAapsLocalTreatments(store)).toBe(0);
    mocks.status.mockResolvedValueOnce({
      supported: true,
      selectedSourceId: 'aaps-local',
      selectionGeneration: 3,
      writeEpoch: 4,
      bufferedCount: 0,
    });
    expect(await drainAapsLocalTreatments(store)).toBe(0);
    expect(mocks.peek).not.toHaveBeenCalled();
  });
});

describe('the same AAPS record on this phone and in Nightscout', () => {
  it('counts the bolus and the carbs once, keeping the on-phone copy', () => {
    const local = normalizeAapsLocalTreatments(
      [
        queued(smb),
        queued({ identifier: `carbs-${T0}`, eventType: 'Meal Bolus', date: T0, carbs: 30 }),
      ],
      T0,
    );
    const nightscoutMeal: HealthContextEvent = {
      id: 'nightscout:meal:abc',
      kind: 'meal',
      start: T0,
      title: 'Meal Bolus',
      mealType: 'breakfast',
      carbsGrams: 30,
      sourceId: 'nightscout',
      origin: 'imported',
    };
    const laterMeal: HealthContextEvent = { ...nightscoutMeal, id: 'nightscout:meal:later', start: T0 + 30 * minute };
    const manualMeal: HealthContextEvent = { ...nightscoutMeal, id: 'manual:1', sourceId: 'manual-context', origin: 'manual' };
    expect(
      reconcileContextSources([...local.context, nightscoutMeal, laterMeal, manualMeal]).map((event) => event.id),
    ).toEqual([`aaps-local:meal:carbs-${T0}`, 'nightscout:meal:later', 'manual:1']);
    expect(
      reconcileBolusSources([
        ...local.boluses,
        { id: 'nightscout:bolus:abc', sourceId: 'nightscout', timestamp: T0, units: 0.3 },
      ]).boluses.map((record) => record.sourceId),
    ).toEqual(['aaps-local']);
  });
});
