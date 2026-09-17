import { beforeEach, describe, expect, it, vi } from 'vitest';

import { NotificationGlucoseSource } from '@/data/notification/NotificationGlucoseSource';
import { MemoryGlucoseHistoryStore } from '@/data/persistence/GlucoseHistoryStore';

const mocks = vi.hoisted(() => ({
  status: vi.fn(),
  configurationSnapshot: vi.fn(),
  peek: vi.fn(),
  acknowledge: vi.fn(),
  acknowledgeCaptured: vi.fn(),
  saveEvents: vi.fn(),
  acquireDrainEpoch: vi.fn(),
  commitDrainBatch: vi.fn(),
  commitEmptyDrain: vi.fn(),
}));

vi.mock('../modules/t1arc-notification-source', () => ({
  default: {
    getStatusAsync: mocks.status,
    getConfigurationSnapshotAsync: mocks.configurationSnapshot,
    peekAsync: mocks.peek,
    acknowledgeAsync: mocks.acknowledge,
    acknowledgeCapturedAsync: mocks.acknowledgeCaptured,
  },
}));

vi.mock('@/data/persistence/t1arcDatabase', () => ({
  openT1ArcDatabase: vi.fn(),
  withT1ArcTransaction: vi.fn(),
}));

vi.mock('@/data/notification/NotificationEventStore', () => ({
  NotificationEventStore: class {
    save = mocks.saveEvents;
    acquireDrainEpoch = mocks.acquireDrainEpoch;
    commitDrainBatch = mocks.commitDrainBatch;
    commitEmptyDrain = mocks.commitEmptyDrain;
  },
}));

describe('notification glucose source refresh policy', () => {
  const nativeId = 'n'.repeat(43);
  const captureToken = (character: string) =>
    `notification-capture:v1:${character.repeat(43)}`;

  beforeEach(() => {
    vi.resetAllMocks();
    mocks.acknowledgeCaptured.mockResolvedValue(1);
    mocks.acquireDrainEpoch.mockResolvedValue(0);
    mocks.commitDrainBatch.mockResolvedValue({ count: 0 });
    mocks.commitEmptyDrain.mockResolvedValue(undefined);
    mocks.configurationSnapshot.mockImplementation(async () => {
      const statusResult = mocks.status.mock.results.at(-1)?.value;
      const status = statusResult ? await statusResult : undefined;
      return {
        enabled: status?.enabled ?? false,
        rules: status?.rules ?? [],
        configurationRevision: status?.configurationRevision ?? 0,
      };
    });
  });

  it('does not write sync state when notification capture is not configured', async () => {
    mocks.status.mockResolvedValue({
      supported: true,
      enabled: false,
      accessGranted: false,
      rules: [],
    });
    const history = new MemoryGlucoseHistoryStore();
    const saveSyncState = vi.spyOn(history, 'saveSyncState');
    const getBounds = vi.spyOn(history, 'getBounds');
    const initialize = vi.spyOn(history, 'initialize');
    const getLatest = vi.spyOn(history, 'getLatestReading');
    const getSyncState = vi.spyOn(history, 'getSyncState');
    const source = new NotificationGlucoseSource(history);

    await source.refresh();

    expect(saveSyncState).not.toHaveBeenCalled();
    expect(getBounds).not.toHaveBeenCalled();
    expect(mocks.peek).not.toHaveBeenCalled();
    expect(mocks.acquireDrainEpoch).not.toHaveBeenCalled();

    await expect(source.getStatus()).resolves.toMatchObject({
      freshness: 'missing',
      isLive: false,
    });
    expect(getBounds).not.toHaveBeenCalled();
    expect(initialize).not.toHaveBeenCalled();
    expect(getLatest).not.toHaveBeenCalled();
    expect(getSyncState).not.toHaveBeenCalled();
  });

  it('reads configured status without starting a notification drain', async () => {
    mocks.status.mockResolvedValue({
      supported: true,
      enabled: true,
      accessGranted: true,
      rules: [],
    });
    const history = new MemoryGlucoseHistoryStore();
    const saveSyncState = vi.spyOn(history, 'saveSyncState');
    const source = new NotificationGlucoseSource(history);

    await expect(source.getStatus()).resolves.toMatchObject({ isLive: true });

    expect(saveSyncState).not.toHaveBeenCalled();
    expect(mocks.peek).not.toHaveBeenCalled();
  });

  it('reads saved glucose without draining notifications', async () => {
    const now = Date.parse('2026-08-24T14:00:00+01:00');
    const history = new MemoryGlucoseHistoryStore();
    await history.upsertReadings([
      {
        id: 'notification:saved',
        sourceId: 'android-notification',
        timestamp: now,
        receivedAt: now,
        mmolL: 7.2,
        trend: 'flat',
        quality: 'measured',
      },
    ]);
    const source = new NotificationGlucoseSource(history);

    await expect(source.getLatestReading()).resolves.toMatchObject({
      mmolL: 7.2,
    });
    expect(mocks.status).not.toHaveBeenCalled();
    expect(mocks.peek).not.toHaveBeenCalled();
    expect(mocks.acknowledge).not.toHaveBeenCalled();
    expect(mocks.acknowledgeCaptured).not.toHaveBeenCalled();
  });

  it('does not acknowledge a native notification when immutable evidence persistence rejects it', async () => {
    const capturedAt = Date.parse('2026-08-25T08:00:00+01:00');
    mocks.status.mockResolvedValue({
      supported: true,
      enabled: true,
      accessGranted: true,
      rules: [
        {
          packageName: 'com.insulet.myblue.pdm',
          displayName: 'Omnipod 5',
          captureGlucose: true,
          captureInsulin: true,
          glucoseUnit: 'auto',
        },
      ],
    });
    mocks.peek
      .mockResolvedValueOnce([
        {
          id: nativeId,
          captureToken: captureToken('a'),
          packageName: 'com.insulet.myblue.pdm',
          postedAt: capturedAt,
          receivedAt: capturedAt,
          isOngoing: true,
          text: 'IOB 1.25 U',
          textLines: [],
        },
      ])
      .mockResolvedValueOnce([]);
    mocks.commitDrainBatch.mockRejectedValue(
      new Error('Immutable notification observation collision.'),
    );

    await expect(
      new NotificationGlucoseSource(new MemoryGlucoseHistoryStore()).refresh(),
    ).rejects.toThrow(/immutable notification observation collision/i);
    expect(mocks.acknowledge).not.toHaveBeenCalled();
    expect(mocks.acknowledgeCaptured).not.toHaveBeenCalled();
  });

  it('canonicalizes an old selected Omnipod rule so new captures retain parser-contract IOB', async () => {
    const capturedAt = Date.parse('2026-08-25T08:00:00+01:00');
    mocks.status.mockResolvedValue({
      supported: true,
      enabled: true,
      accessGranted: true,
      rules: [
        {
          packageName: 'com.insulet.myblue.pdm',
          displayName: 'Omnipod 5',
          captureGlucose: true,
          captureInsulin: false,
          glucoseUnit: 'auto',
        },
      ],
    });
    mocks.peek
      .mockResolvedValueOnce([
        {
          id: nativeId,
          captureToken: captureToken('a'),
          packageName: 'com.insulet.myblue.pdm',
          postedAt: capturedAt,
          receivedAt: capturedAt,
          isOngoing: true,
          text: 'IOB 1.25 U',
          textLines: [],
        },
      ])
      .mockResolvedValueOnce([]);
    mocks.commitDrainBatch.mockResolvedValue({ count: 0 });

    await new NotificationGlucoseSource(
      new MemoryGlucoseHistoryStore(),
    ).refresh();

    expect(mocks.commitDrainBatch).toHaveBeenCalledOnce();
    expect(
      mocks.commitDrainBatch.mock.calls[0]?.[0]?.events?.[0]?.observation,
    ).toMatchObject({
      rule: {
        packageName: 'com.insulet.myblue.pdm',
        captureInsulin: true,
      },
      pump: { iobUnits: 1.25 },
    });
    expect(mocks.acknowledgeCaptured).toHaveBeenCalledWith([
      {
        captureToken: captureToken('a'),
        id: nativeId,
        receivedAt: capturedAt,
      },
    ]);
    expect(mocks.acknowledge).not.toHaveBeenCalled();
  });

  it('re-peeks after a conditional-ack race and retains both same-ID same-time captures', async () => {
    const capturedAt = Date.parse('2026-08-25T08:00:00+01:00');
    const base = {
      id: nativeId,
      packageName: 'com.insulet.myblue.pdm',
      postedAt: capturedAt,
      receivedAt: capturedAt,
      isOngoing: true,
      title: '7.2 mmol/L',
      textLines: [],
    };
    const oldCapture = {
      ...base,
      captureToken: captureToken('a'),
      text: 'IOB 1.25 U',
    };
    const replacement = {
      ...base,
      captureToken: captureToken('b'),
      text: 'IOB 2 U',
    };
    mocks.status.mockResolvedValue({
      supported: true,
      enabled: true,
      accessGranted: true,
      rules: [
        {
          packageName: 'com.insulet.myblue.pdm',
          displayName: 'Omnipod 5',
          captureGlucose: true,
          captureInsulin: true,
          glucoseUnit: 'auto',
        },
      ],
    });
    mocks.peek
      .mockResolvedValueOnce([oldCapture])
      .mockResolvedValueOnce([replacement])
      .mockResolvedValueOnce([]);
    mocks.commitDrainBatch.mockResolvedValue({ count: 0 });
    mocks.acknowledgeCaptured
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(1);

    await new NotificationGlucoseSource(
      new MemoryGlucoseHistoryStore(),
    ).refresh();

    expect(mocks.commitDrainBatch).toHaveBeenCalledTimes(2);
    expect(
      mocks.commitDrainBatch.mock.calls.map(
        (call) => call[0].events[0].observation.envelope.captureToken,
      ),
    ).toEqual([captureToken('a'), captureToken('b')]);
    expect(mocks.acknowledgeCaptured.mock.calls).toEqual([
      [[{ captureToken: captureToken('a'), id: nativeId, receivedAt: capturedAt }]],
      [[{ captureToken: captureToken('b'), id: nativeId, receivedAt: capturedAt }]],
    ]);
    expect(mocks.peek).toHaveBeenCalledTimes(3);
    expect(mocks.acknowledge).not.toHaveBeenCalled();
  });

  it('fails safely without destructive ID-only acknowledgement for an old native envelope', async () => {
    const capturedAt = Date.parse('2026-08-25T08:00:00+01:00');
    mocks.status.mockResolvedValue({
      supported: true,
      enabled: true,
      accessGranted: true,
      rules: [],
    });
    mocks.peek.mockResolvedValueOnce([
      {
        id: nativeId,
        packageName: 'com.insulet.myblue.pdm',
        postedAt: capturedAt,
        receivedAt: capturedAt,
        isOngoing: true,
        text: 'IOB 1.25 U',
        textLines: [],
      },
    ]);
    mocks.commitDrainBatch.mockResolvedValue({ count: 0 });

    await expect(
      new NotificationGlucoseSource(new MemoryGlucoseHistoryStore()).refresh(),
    ).rejects.toThrow(/capture token/i);

    expect(mocks.commitDrainBatch).toHaveBeenCalledOnce();
    expect(mocks.acknowledgeCaptured).not.toHaveBeenCalled();
    expect(mocks.acknowledge).not.toHaveBeenCalled();
  });

  it('acquires source ownership before peeking and records an empty drain under that epoch', async () => {
    mocks.status.mockResolvedValue({
      supported: true,
      enabled: true,
      accessGranted: true,
      rules: [],
    });
    mocks.acquireDrainEpoch.mockResolvedValue(9);
    mocks.peek.mockResolvedValue([]);

    await new NotificationGlucoseSource(
      new MemoryGlucoseHistoryStore(),
    ).refresh();

    expect(mocks.acquireDrainEpoch).toHaveBeenCalledOnce();
    expect(mocks.acquireDrainEpoch.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.peek.mock.invocationCallOrder[0]!,
    );
    expect(mocks.commitEmptyDrain).toHaveBeenCalledWith({
      epoch: 9,
      sourceId: 'android-notification',
      attemptedAt: expect.any(Number),
      assertConfigurationCurrent: expect.any(Function),
    });
  });

  it('benignly rejects a copied envelope when configuration changes before its writer transaction', async () => {
    const capturedAt = Date.parse('2026-08-25T08:00:00+01:00');
    mocks.status.mockResolvedValue({
      supported: true,
      enabled: true,
      accessGranted: true,
      configurationRevision: 4,
      rules: [
        {
          packageName: 'com.insulet.myblue.pdm',
          displayName: 'Omnipod 5',
          captureGlucose: true,
          captureInsulin: true,
          glucoseUnit: 'auto',
        },
      ],
    });
    mocks.configurationSnapshot.mockResolvedValue({
      enabled: false,
      rules: [],
      configurationRevision: 5,
    });
    mocks.peek.mockResolvedValueOnce([
      {
        id: nativeId,
        captureToken: captureToken('z'),
        packageName: 'com.insulet.myblue.pdm',
        postedAt: capturedAt,
        receivedAt: capturedAt,
        isOngoing: true,
        title: '7.2 mmol/L',
        textLines: [],
      },
    ]);
    mocks.commitDrainBatch.mockImplementation(async (batch) => {
      await batch.assertConfigurationCurrent();
    });

    await expect(
      new NotificationGlucoseSource(new MemoryGlucoseHistoryStore()).refresh(),
    ).resolves.toBeUndefined();

    expect(mocks.commitDrainBatch).toHaveBeenCalledOnce();
    expect(mocks.acknowledgeCaptured).not.toHaveBeenCalled();
  });
});
