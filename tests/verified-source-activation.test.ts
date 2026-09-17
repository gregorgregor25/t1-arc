import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  invalidatePreviousNativeOwner,
  verifiedSourceActivationOptions,
} from '@/data/live/verifiedSourceActivation';

const persistence = vi.hoisted(() => ({
  clearGlucose: vi.fn(async () => undefined),
  commitSnapshot: vi.fn(async () => ({ count: 1 })),
  clearHealth: vi.fn(async () => undefined),
  clearInsights: vi.fn(async () => undefined),
  invalidateNative: vi.fn(async () => undefined),
  invalidateAlerts: vi.fn(async () => undefined),
  clearNativeOwner: vi.fn(async () => undefined),
}));

vi.mock('@/data/persistence/SqliteGlucoseHistoryStore', () => ({
  clearOwnedGlucoseSourceDataInTransaction: persistence.clearGlucose,
  commitVerifiedSnapshotInTransaction: persistence.commitSnapshot,
}));
vi.mock('@/data/persistence/SqliteHealthRecordStore', () => ({
  clearOwnedHealthSourceDataInTransaction: persistence.clearHealth,
}));
vi.mock('@/data/insights/insightReportRepository', () => ({
  clearSavedInsightReportsInTransaction: persistence.clearInsights,
}));
vi.mock('@/data/glucoseAlerts/glucoseAlertPreferences', () => ({
  invalidateGlucoseAlertsForSourceReplacement: persistence.invalidateAlerts,
}));
vi.mock('../modules/t1arc-glucose-display', () => ({
  default: {
    clearPrivateGlucoseForWriteEpochAsync: persistence.clearNativeOwner,
  },
}));

const transaction = {} as never;
const sourceWriteLease = {
  sourceId: 'nightscout' as const,
  localDataWriteLease: { epoch: 4 },
  ownerGeneration: 8,
  identityDigest: 'b'.repeat(64),
};
const reading = {
  id: 'nightscout:new',
  sourceId: 'nightscout',
  timestamp: 100,
  receivedAt: 101,
  mmolL: 6,
  trend: 'flat' as const,
  quality: 'measured' as const,
};

describe('verified source activation transaction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    persistence.invalidateAlerts.mockResolvedValue(undefined);
    persistence.clearNativeOwner.mockResolvedValue(undefined);
  });

  it('invalidates serialized alert state before completing the native owner clear', async () => {
    await invalidatePreviousNativeOwner(4);

    expect(persistence.invalidateAlerts).toHaveBeenCalledOnce();
    expect(persistence.clearNativeOwner).toHaveBeenCalledWith(
      4,
      'No personal glucose reading',
    );
    expect(persistence.invalidateAlerts.mock.invocationCallOrder[0]).toBeLessThan(
      persistence.clearNativeOwner.mock.invocationCallOrder[0]!,
    );
  });

  it('still blanks native glucose but rejects replacement when alert invalidation fails', async () => {
    persistence.invalidateAlerts.mockRejectedValueOnce(
      new Error('alert cancellation failed'),
    );

    await expect(invalidatePreviousNativeOwner(4)).rejects.toThrow(
      'alert cancellation failed',
    );
    expect(persistence.clearNativeOwner).toHaveBeenCalledWith(
      4,
      'No personal glucose reading',
    );
  });

  it('clears old glucose and Nightscout treatment rows before staging a different identity', async () => {
    const options = verifiedSourceActivationOptions({
      sourceId: 'nightscout',
      readings: [reading],
      activatedAt: 200,
      clearHealthRecordsOnIdentityChange: true,
      invalidatePreviousNativeOwner: persistence.invalidateNative,
    });

    await options.beforeCommit!({
      transaction,
      previousIdentityDigest: 'a'.repeat(64),
      sourceWriteLease,
    });

    expect(persistence.clearGlucose).toHaveBeenCalledWith(
      transaction,
      'nightscout',
    );
    expect(persistence.clearHealth).toHaveBeenCalledWith(
      transaction,
      'nightscout',
    );
    expect(persistence.invalidateNative).toHaveBeenCalledWith(4);
    expect(persistence.clearInsights).toHaveBeenCalledWith(transaction);
    expect(persistence.invalidateNative.mock.invocationCallOrder[0]).toBeLessThan(
      persistence.clearGlucose.mock.invocationCallOrder[0]!,
    );
    expect(persistence.clearGlucose.mock.invocationCallOrder[0]).toBeLessThan(
      persistence.commitSnapshot.mock.invocationCallOrder[0]!,
    );
    expect(persistence.commitSnapshot).toHaveBeenCalledWith(
      transaction,
      'nightscout',
      [reading],
      200,
    );
  });

  it('preserves same-identity history while staging the verified snapshot', async () => {
    const options = verifiedSourceActivationOptions({
      sourceId: 'nightscout',
      readings: [reading],
      activatedAt: 200,
      clearHealthRecordsOnIdentityChange: true,
      invalidatePreviousNativeOwner: persistence.invalidateNative,
    });

    await options.beforeCommit!({
      transaction,
      previousIdentityDigest: sourceWriteLease.identityDigest,
      sourceWriteLease,
    });

    expect(persistence.clearGlucose).not.toHaveBeenCalled();
    expect(persistence.clearHealth).not.toHaveBeenCalled();
    expect(persistence.invalidateNative).not.toHaveBeenCalled();
    expect(persistence.clearInsights).not.toHaveBeenCalled();
    expect(persistence.commitSnapshot).toHaveBeenCalledOnce();
  });

  it('preserves retained history when reconnecting after ordinary disconnect to the same identity', async () => {
    const options = verifiedSourceActivationOptions({
      sourceId: 'xdrip-local',
      readings: [{ ...reading, sourceId: 'xdrip-local' }],
    });
    const reconnectLease = {
      ...sourceWriteLease,
      sourceId: 'xdrip-local' as const,
    };

    await options.beforeCommit!({
      transaction,
      previousIdentityDigest: reconnectLease.identityDigest,
      sourceWriteLease: reconnectLease,
    });

    expect(persistence.clearGlucose).not.toHaveBeenCalled();
    expect(persistence.commitSnapshot).toHaveBeenCalledOnce();
  });

  it('rejects an activation callback attached to a different source owner', async () => {
    const options = verifiedSourceActivationOptions({
      sourceId: 'xdrip-local',
      readings: [{ ...reading, sourceId: 'xdrip-local' }],
    });

    await expect(
      options.beforeCommit!({
        transaction,
        previousIdentityDigest: sourceWriteLease.identityDigest,
        sourceWriteLease,
      }),
    ).rejects.toMatchObject({ name: 'SourceConnectionSupersededError' });
    expect(persistence.clearGlucose).not.toHaveBeenCalled();
    expect(persistence.commitSnapshot).not.toHaveBeenCalled();
  });

  it('purges unknown-provenance source rows and reviews before first verified activation', async () => {
    const options = verifiedSourceActivationOptions({
      sourceId: 'nightscout',
      readings: [reading],
      invalidatePreviousNativeOwner: persistence.invalidateNative,
    });

    await options.beforeCommit!({
      transaction,
      previousIdentityDigest: undefined,
      sourceWriteLease,
    });

    expect(persistence.invalidateNative).toHaveBeenCalledWith(4);
    expect(persistence.clearGlucose).toHaveBeenCalledWith(
      transaction,
      'nightscout',
    );
    expect(persistence.clearInsights).toHaveBeenCalledWith(transaction);
    expect(persistence.commitSnapshot).toHaveBeenCalledOnce();
  });

  it('does not stage a replacement when native invalidation fails', async () => {
    persistence.invalidateNative.mockRejectedValueOnce(
      new Error('native clear failed'),
    );
    const options = verifiedSourceActivationOptions({
      sourceId: 'nightscout',
      readings: [reading],
      invalidatePreviousNativeOwner: persistence.invalidateNative,
    });

    await expect(
      options.beforeCommit!({
        transaction,
        previousIdentityDigest: 'a'.repeat(64),
        sourceWriteLease,
      }),
    ).rejects.toThrow('native clear failed');

    expect(persistence.clearGlucose).not.toHaveBeenCalled();
    expect(persistence.clearInsights).not.toHaveBeenCalled();
    expect(persistence.commitSnapshot).not.toHaveBeenCalled();
  });
});
