import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  saveHealthConnectPreferences,
  syncHealthConnect,
} from '@/data/healthConnect/healthConnectRepository';
import { DEFAULT_HEALTH_CONNECT_CATEGORIES } from '@/data/healthConnect/healthConnectRecords';

const nativeHealthConnect = vi.hoisted(() => ({
  getStatusAsync: vi.fn(),
}));
const persistence = vi.hoisted(() => {
  const database = {
    getAllAsync: vi.fn(),
    getFirstAsync: vi.fn(),
    runAsync: vi.fn(),
  };
  return {
    database,
    openT1ArcDatabase: vi.fn(async () => database),
    withT1ArcTransaction: vi.fn(
      async (work: (value: typeof database) => Promise<unknown>) =>
        work(database),
    ),
  };
});

vi.mock('../modules/t1arc-health-connect', () => ({
  default: nativeHealthConnect,
}));

vi.mock('react-native', () => ({
  AppState: {
    currentState: 'active',
    addEventListener: vi.fn(),
  },
}));

vi.mock('@/data/persistence/t1arcDatabase', () => ({
  openT1ArcDatabase: persistence.openT1ArcDatabase,
  withT1ArcTransaction: persistence.withT1ArcTransaction,
}));

vi.mock('@/data/privacy/localDataWriteEpoch', () => ({
  acquireLocalDataWriteLease: vi.fn(async () => ({ epoch: 0 })),
  assertLocalDataWriteLeaseInTransaction: vi.fn(async () => undefined),
  isLocalDataWriteSupersededError: vi.fn(() => false),
}));

describe('Health Connect preference ownership', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    nativeHealthConnect.getStatusAsync.mockResolvedValue({
      availability: 'available',
      categories: [{ id: 'steps', granted: true }],
    });
  });

  it('does not restore a stale selection while a sync is completing', async () => {
    const enabled = new Map(
      DEFAULT_HEALTH_CONNECT_CATEGORIES.map((category) => [category, true]),
    );
    let resolveStalePreferences:
      ((rows: Record<string, unknown>[]) => void) | undefined;
    const stalePreferences = new Promise<Record<string, unknown>[]>(
      (resolve) => {
        resolveStalePreferences = resolve;
      },
    );

    persistence.database.getAllAsync.mockImplementationOnce(
      async () => stalePreferences,
    );
    persistence.database.getFirstAsync.mockRejectedValue(
      new Error('stop after preference selection'),
    );
    persistence.database.runAsync.mockImplementation(
      async (sql: string, ...parameters: unknown[]) => {
        if (sql.includes('INSERT INTO health_connect_preferences')) {
          for (let index = 0; index < parameters.length; index += 3) {
            const category = parameters[index] as (
              typeof DEFAULT_HEALTH_CONNECT_CATEGORIES
            )[number];
            enabled.set(category, parameters[index + 1] === 1);
          }
        }
        return { changes: 0 };
      },
    );

    const syncPromise = syncHealthConnect({ categories: ['steps'] });
    await vi.waitFor(() => {
      expect(persistence.database.getAllAsync).toHaveBeenCalledTimes(1);
    });

    await saveHealthConnectPreferences([]);
    expect([...enabled.values()].every((value) => !value)).toBe(true);

    resolveStalePreferences?.(
      DEFAULT_HEALTH_CONNECT_CATEGORIES.map((category) => ({
        category,
        enabled: 1,
        preferred_source_package: null,
        preferred_source_mode: null,
        updated_at_ms: 1,
      })),
    );

    await expect(syncPromise).rejects.toThrow(
      'stop after preference selection',
    );
    expect([...enabled.values()].every((value) => !value)).toBe(true);
  });
});
