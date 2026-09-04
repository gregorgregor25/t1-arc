import { readFileSync } from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  assertNotificationConfigurationCurrent,
  captureNotificationConfiguration,
  setNotificationSourceConfiguration,
} from '@/data/notification/notificationSourceConfiguration';

const mocks = vi.hoisted(() => ({
  advanceEpoch: vi.fn(),
  nativeConfigurationSnapshot: vi.fn(),
  nativeSetConfiguration: vi.fn(),
  transaction: {},
  withTransaction: vi.fn(),
}));

vi.mock('../modules/t1arc-notification-source', () => ({
  default: {
    getConfigurationSnapshotAsync: mocks.nativeConfigurationSnapshot,
    setConfigurationAsync: mocks.nativeSetConfiguration,
  },
}));
vi.mock('@/data/notification/notificationSourceEpoch', () => ({
  advanceNotificationSourceEpochInTransaction: mocks.advanceEpoch,
}));
vi.mock('@/data/persistence/t1arcDatabase', () => ({
  withT1ArcTransaction: mocks.withTransaction,
}));

describe('notification-source configuration ownership', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.advanceEpoch.mockResolvedValue(4);
    mocks.nativeSetConfiguration.mockResolvedValue({
      supported: true,
      accessGranted: true,
      enabled: false,
      rules: [],
      pendingCount: 0,
      configurationRevision: 7,
    });
    mocks.nativeConfigurationSnapshot.mockResolvedValue({
      enabled: true,
      rules: [],
      configurationRevision: 3,
    });
    mocks.withTransaction.mockImplementation(
      async (work: (transaction: object) => Promise<unknown>) =>
        work(mocks.transaction),
    );
  });

  it('advances the durable drain epoch inside the writer before native reconfiguration', async () => {
    const events: string[] = [];
    mocks.advanceEpoch.mockImplementation(async () => {
      events.push('epoch');
      return 4;
    });
    mocks.nativeSetConfiguration.mockImplementation(async () => {
      events.push('native');
      return {
        supported: true,
        accessGranted: true,
        enabled: false,
        rules: [],
        pendingCount: 0,
        configurationRevision: 7,
      };
    });

    const result = await setNotificationSourceConfiguration({
      enabled: false,
      rules: [],
    });

    expect(events).toEqual(['epoch', 'native']);
    expect(mocks.advanceEpoch).toHaveBeenCalledWith(mocks.transaction);
    expect(mocks.nativeSetConfiguration).toHaveBeenCalledWith({
      enabled: false,
      rules: [],
    });
    expect(result.configurationRevision).toBe(7);
  });

  it('rolls back the writer operation when native reconfiguration fails', async () => {
    const failure = new Error('native settings failed');
    mocks.nativeSetConfiguration.mockRejectedValue(failure);

    await expect(
      setNotificationSourceConfiguration({ enabled: false, rules: [] }),
    ).rejects.toBe(failure);
    expect(mocks.advanceEpoch).toHaveBeenCalledOnce();
  });

  it('rejects the same rules when their native process revision changed', async () => {
    const lease = captureNotificationConfiguration({
      enabled: true,
      rules: [],
      configurationRevision: 2,
    });
    mocks.nativeConfigurationSnapshot.mockResolvedValue({
      enabled: true,
      rules: [],
      configurationRevision: 3,
    });

    await expect(
      assertNotificationConfigurationCurrent(lease),
    ).rejects.toMatchObject({
      name: 'NotificationConfigurationSupersededError',
    });
  });

  it('rejects changed normalized rules even for a legacy revision value', async () => {
    const lease = captureNotificationConfiguration({
      enabled: true,
      rules: [],
    });
    mocks.nativeConfigurationSnapshot.mockResolvedValue({
      enabled: false,
      rules: [],
    });

    await expect(
      assertNotificationConfigurationCurrent(lease),
    ).rejects.toMatchObject({
      name: 'NotificationConfigurationSupersededError',
    });
  });

  it('routes every settings-card configuration change through the SQLite writer fence', () => {
    const source = readFileSync(
      path.join(process.cwd(), 'src', 'components', 'NotificationSourceCard.tsx'),
      'utf8',
    );

    expect(source).toContain('setNotificationSourceConfiguration({');
    expect(source).not.toContain(
      'T1ArcNotificationSource.setConfigurationAsync(',
    );
  });

  it('acknowledges a durable disable without awaiting an unrelated full data refresh', () => {
    const source = readFileSync(
      path.join(process.cwd(), 'src', 'components', 'NotificationSourceCard.tsx'),
      'utf8',
    );
    const disableStart = source.indexOf('async function disable()');
    const disableEnd = source.indexOf('\n  return (', disableStart);
    const disable = source.slice(disableStart, disableEnd);

    expect(disable).toContain('await setNotificationSourceConfiguration({');
    expect(disable).toContain('setStatus(next);');
    expect(disable).not.toContain('refreshData');
    expect(source).not.toContain('await onConnected?.()');
    expect(source).toContain('schedulePostCommitRefresh();');
  });
});
