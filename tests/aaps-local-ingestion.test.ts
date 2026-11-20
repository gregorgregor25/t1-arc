import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  drainAapsLocalReadings,
  enableAapsLocalSource,
  stopAapsLocalSourceForDemoInTransaction,
} from '@/data/aaps/localAapsSource';

const mocks = vi.hoisted(() => ({
  status: vi.fn(),
  peek: vi.fn(),
  ack: vi.fn(),
  select: vi.fn(),
  transaction: vi.fn(),
  run: vi.fn(),
  first: vi.fn(),
  upsert: vi.fn(),
  cancelAlerts: vi.fn(),
  loadDataMode: vi.fn(),
}));

vi.mock('../modules/t1arc-glucose-display', () => ({
  default: {
    getAapsLocalStatusAsync: mocks.status,
    peekAapsReadingsAsync: mocks.peek,
    acknowledgeAapsReadingsAsync: mocks.ack,
    setLocalGlucoseSourceAsync: mocks.select,
  },
}));
vi.mock('@/data/privacy/localDataWriteEpoch', () => ({
  acquireLocalDataWriteLease: vi.fn().mockResolvedValue({ epoch: 5 }),
  withLocalDataWriteLeaseTransaction: mocks.transaction,
}));
vi.mock('@/data/persistence/t1arcDatabase', () => ({
  openT1ArcDatabase: vi.fn(),
}));
vi.mock('@/data/persistence/SqliteGlucoseHistoryStore', () => ({
  upsertGlucoseReadingsInTransaction: mocks.upsert,
}));
vi.mock('@/data/glucoseAlerts/glucoseAlertPreferences', () => ({
  invalidateGlucoseAlertsForSourceReplacement: mocks.cancelAlerts,
}));
vi.mock('@/data/libreLinkUp/secureStore', () => ({
  loadDataMode: mocks.loadDataMode,
}));
vi.mock('@/data/glucoseDisplay/glucoseDisplayCoordinator', () => ({
  updateGlucoseDisplayFromHistory: vi.fn().mockResolvedValue(true),
}));

const NOW = Date.UTC(2026, 10, 1, 12);
const current = {
  supported: true,
  selectedSourceId: 'aaps-local',
  selectionGeneration: 3,
  writeEpoch: 5,
  bufferedCount: 1,
};

describe('AAPS durable queue ingestion', () => {
  beforeEach(() => {
    mocks.status.mockReset().mockResolvedValue(current);
    mocks.peek.mockReset().mockResolvedValue([]);
    mocks.ack.mockReset().mockResolvedValue(true);
    mocks.select.mockReset();
    mocks.run.mockReset().mockResolvedValue({ changes: 1 });
    mocks.first.mockReset().mockResolvedValue({ count: 1 });
    mocks.upsert.mockReset().mockResolvedValue(undefined);
    mocks.cancelAlerts.mockReset().mockResolvedValue(undefined);
    mocks.loadDataMode.mockReset().mockResolvedValue('live');
    mocks.transaction.mockReset().mockImplementation(async (_lease, work) =>
      work({ runAsync: mocks.run, getFirstAsync: mocks.first }));
  });

  it('stores glucose and signed context before acknowledging the native receipt', async () => {
    mocks.peek.mockResolvedValueOnce([{
      id: 'native-1', receivedAt: NOW, writeEpoch: 5, selectionGeneration: 3,
      glucoseTimestamp: NOW - 60_000, glucoseMgdl: 150, trend: 'flat',
      iobUnits: -0.4, cobGrams: 0,
    }]).mockResolvedValueOnce([]);
    const order: string[] = [];
    mocks.upsert.mockImplementation(async () => { order.push('glucose'); });
    mocks.run.mockImplementation(async (sql: string) => {
      if (sql.includes('INSERT OR IGNORE')) order.push('context');
      return { changes: 1 };
    });
    mocks.ack.mockImplementation(async () => { order.push('ack'); return true; });

    await expect(drainAapsLocalReadings()).resolves.toBe(1);
    expect(order).toEqual(['glucose', 'context', 'ack']);
    expect(mocks.upsert.mock.calls[0]?.[1]).toMatchObject([{
      id: `aaps-local:${NOW - 60_000}`,
      sourceId: 'aaps-local',
      timestamp: NOW - 60_000,
    }]);
    const contextArgs = mocks.run.mock.calls.find(([sql]) =>
      String(sql).includes('INSERT OR IGNORE'));
    expect(contextArgs).toContain(-0.4);
    expect(contextArgs).toContain(0);
  });

  it('does not acknowledge a receipt when the encrypted database write fails', async () => {
    mocks.peek.mockResolvedValue([{ id: 'native-2', receivedAt: NOW,
      writeEpoch: 5, selectionGeneration: 3, iobUnits: 1.2 }]);
    mocks.run.mockRejectedValue(new Error('disk busy'));
    await expect(drainAapsLocalReadings()).rejects.toThrow('disk busy');
    expect(mocks.ack).not.toHaveBeenCalled();
  });

  it('commits prior-session archive before a native selection survives a later failure', async () => {
    const previous = { ...current, selectedSourceId: 'none', selectionGeneration: 2 };
    mocks.status.mockResolvedValue(previous);
    const order: string[] = [];
    mocks.run.mockImplementation(async (sql: string) => {
      if (sql.includes('UPDATE glucose_readings')) order.push('archive-old-glucose');
      return { changes: 1 };
    });
    mocks.transaction.mockImplementation(async (_lease, work) => {
      const result = await work({ runAsync: mocks.run, getFirstAsync: mocks.first });
      order.push('commit');
      return result;
    });
    mocks.select.mockImplementation(async () => {
      order.push('native-select');
      throw new Error('process died after native selection');
    });

    await expect(enableAapsLocalSource()).rejects.toThrow('process died');
    expect(order).toEqual(['archive-old-glucose', 'commit', 'native-select']);
  });

  it('stops AAPS before demo mode can be saved and rejects re-enabling while demo is active', async () => {
    const order: string[] = [];
    mocks.cancelAlerts.mockImplementation(async () => { order.push('cancel-alerts'); });
    mocks.select.mockImplementation(async (sourceId: string, epoch: number) => {
      order.push(`native-${sourceId}-${epoch}`);
      return { ...current, selectedSourceId: sourceId, selectionGeneration: 4 };
    });

    await expect(stopAapsLocalSourceForDemoInTransaction({ epoch: 5 }))
      .resolves.toBe(true);
    order.push('persist-demo-mode');
    expect(order).toEqual(['cancel-alerts', 'native-none-5', 'persist-demo-mode']);

    mocks.loadDataMode.mockResolvedValue('demo');
    mocks.status.mockResolvedValue({ ...current, selectedSourceId: 'none' });
    await expect(enableAapsLocalSource()).rejects.toThrow('Leave demo mode');
    expect(mocks.select).toHaveBeenCalledTimes(1);
  });
});
