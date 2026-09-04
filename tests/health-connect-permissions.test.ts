import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  loadHealthConnectPreferences,
  requestHealthConnectBackgroundPermission,
  requestHealthConnectHistoryPermission,
  requestHealthConnectPermissions,
} from '@/data/healthConnect/healthConnectRepository';
import { STARTER_HEALTH_CONNECT_CATEGORIES } from '@/data/healthConnect/healthConnectRecords';

const nativeHealthConnect = vi.hoisted(() => ({
  getStatusAsync: vi.fn(),
  requestPermissionsAsync: vi.fn(),
}));
const appState = vi.hoisted(() => ({
  currentState: 'active',
  remove: vi.fn(),
  addEventListener: vi.fn(),
}));
const persistence = vi.hoisted(() => ({
  database: {
    getAllAsync: vi.fn(),
    getFirstAsync: vi.fn(),
    runAsync: vi.fn(),
  },
}));

vi.mock('../modules/t1arc-health-connect', () => ({
  default: nativeHealthConnect,
}));

vi.mock('react-native', () => ({
  AppState: appState,
}));

vi.mock('@/data/persistence/t1arcDatabase', () => ({
  openT1ArcDatabase: vi.fn(async () => persistence.database),
  withT1ArcTransaction: vi.fn(
    async (work: (database: typeof persistence.database) => Promise<unknown>) =>
      work(persistence.database),
  ),
}));

const availableStatus = {
  availability: 'available',
  sdkStatus: 1,
  historyGranted: false,
  backgroundGranted: false,
  backgroundAvailable: true,
  sourceDiscoveryAvailable: false,
  grantedPermissions: [],
  categories: [],
};

describe('Health Connect least-privilege permission scopes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    appState.currentState = 'active';
    appState.addEventListener.mockReturnValue({ remove: appState.remove });
    nativeHealthConnect.requestPermissionsAsync.mockResolvedValue(
      availableStatus,
    );
  });

  it('requests only ordinary access for explicitly chosen categories', async () => {
    await requestHealthConnectPermissions(['steps', 'sleep']);

    expect(nativeHealthConnect.requestPermissionsAsync).toHaveBeenCalledWith(
      ['steps', 'sleep'],
      false,
      false,
    );
  });

  it('requests older history separately without adding categories', async () => {
    await requestHealthConnectHistoryPermission();

    expect(nativeHealthConnect.requestPermissionsAsync).toHaveBeenCalledWith(
      [],
      true,
      false,
    );
  });

  it('requests background access separately without adding categories', async () => {
    await requestHealthConnectBackgroundPermission();

    expect(nativeHealthConnect.requestPermissionsAsync).toHaveBeenCalledWith(
      [],
      false,
      true,
    );
  });
});

describe('Health Connect first-use choices', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    persistence.database.getAllAsync.mockResolvedValue([]);
    persistence.database.getFirstAsync.mockResolvedValue(undefined);
  });

  it('starts with a small contextual set instead of every health category', async () => {
    const preferences = await loadHealthConnectPreferences();

    expect(
      preferences
        .filter((preference) => preference.enabled)
        .map((preference) => preference.category),
    ).toEqual(STARTER_HEALTH_CONNECT_CATEGORIES);
    expect(STARTER_HEALTH_CONNECT_CATEGORIES).toEqual([
      'steps',
      'workouts',
      'heart_rate',
      'sleep',
    ]);
  });

  it('does not silently enable a category missing from saved choices', async () => {
    persistence.database.getAllAsync.mockResolvedValue([
      {
        category: 'steps',
        enabled: 1,
        preferred_source_package: null,
        preferred_source_mode: null,
        updated_at_ms: 10,
      },
    ]);

    const preferences = await loadHealthConnectPreferences();

    expect(
      preferences.find((preference) => preference.category === 'steps')
        ?.enabled,
    ).toBe(true);
    expect(
      preferences.find((preference) => preference.category === 'nutrition')
        ?.enabled,
    ).toBe(false);
  });
});
