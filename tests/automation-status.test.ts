import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getAutomationStatus } from '@/data/background/automationStatus';

const mocks = vi.hoisted(() => ({
  backgroundStatus: vi.fn(),
  registeredTasks: vi.fn(),
  runs: vi.fn(),
  evidence: vi.fn(),
  glooko: vi.fn(),
  glookoReport: vi.fn(),
  healthOverview: vi.fn(),
  healthStatus: vi.fn(),
  glucoseSources: vi.fn(),
  hevyConnection: vi.fn(),
  hevyStatus: vi.fn(),
  buildTiming: vi.fn(),
}));

vi.mock('expo-background-task', () => ({
  BackgroundTaskStatus: { Available: 2 },
  getStatusAsync: mocks.backgroundStatus,
}));
vi.mock('expo-task-manager', () => ({
  getRegisteredTasksAsync: mocks.registeredTasks,
}));
vi.mock('@/data/background/automationRunLog', () => ({
  listAutomationRuns: mocks.runs,
}));
vi.mock('@/data/background/automationEvidence', () => ({
  loadAutomationDataEvidence: mocks.evidence,
}));
vi.mock('@/data/background/automationTiming', () => ({
  buildAutomationTiming: mocks.buildTiming,
}));
vi.mock('@/data/glooko/glookoSyncState', () => ({
  loadGlookoSyncState: mocks.glooko,
}));
vi.mock('@/data/glooko/glookoReportSyncState', () => ({
  loadGlookoReportSyncState: mocks.glookoReport,
}));
vi.mock('@/data/healthConnect/healthConnectRepository', () => ({
  getHealthConnectOverview: mocks.healthOverview,
  getHealthConnectStatus: mocks.healthStatus,
}));
vi.mock('@/data/live/configuredGlucoseSources', () => ({
  configuredGlucoseSources: mocks.glucoseSources,
}));
vi.mock('@/data/live/glucoseSourceRefresh', () => ({
  glucoseSourceLabel: (sourceId: string) =>
    ({
      'dexcom-share': 'Dexcom Share',
      'medtrum-easyfollow': 'Medtrum',
    })[sourceId] ?? 'Glucose source',
}));
vi.mock('@/data/hevy/secureStore', () => ({
  loadHevyConnection: mocks.hevyConnection,
}));
vi.mock('@/data/hevy/repository', () => ({
  HevyWorkoutRepository: class {
    status() {
      return mocks.hevyStatus();
    }
  },
}));

const EMPTY_EVIDENCE = {
  glucose: { recordCount: 0 },
  glooko: { recordCount: 0 },
  'health-connect': { recordCount: 0 },
  hevy: { recordCount: 0 },
  'insight-review': { recordCount: 0 },
};

describe('automatic update status', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.backgroundStatus.mockResolvedValue(2);
    mocks.registeredTasks.mockResolvedValue([]);
    mocks.runs.mockResolvedValue([]);
    mocks.evidence.mockResolvedValue(EMPTY_EVIDENCE);
    mocks.glooko.mockResolvedValue({
      automaticEnabled: false,
      sessionStatus: 'unknown',
      consecutiveFailures: 0,
    });
    mocks.glookoReport.mockResolvedValue({ consecutiveFailures: 0 });
    mocks.healthOverview.mockResolvedValue({
      totalRecords: 0,
      preferences: [],
      sync: [],
      sources: [],
    });
    mocks.healthStatus.mockResolvedValue({
      availability: 'available',
      categories: [],
    });
    mocks.glucoseSources.mockResolvedValue([]);
    mocks.hevyConnection.mockResolvedValue(undefined);
    mocks.hevyStatus.mockResolvedValue({ connected: false, workoutCount: 0 });
    mocks.buildTiming.mockReturnValue({});
  });

  it('treats the glucose row as all configured live providers and includes Hevy', async () => {
    mocks.registeredTasks.mockResolvedValue([
      { taskName: 't1arc.background.librelinkup-sync.v1' },
      { taskName: 't1arc.background.hevy-sync.v1' },
    ]);
    mocks.glucoseSources.mockResolvedValue([
      { sourceId: 'dexcom-share' },
      { sourceId: 'medtrum-easyfollow' },
      { sourceId: 'dexcom-share' },
    ]);
    mocks.hevyConnection.mockResolvedValue({ user: { id: 'hevy-user' } });
    mocks.hevyStatus.mockResolvedValue({
      connected: false,
      workoutCount: 14,
      lastAttemptAt: 123_000,
      lastSuccessAt: 120_000,
    });

    const status = await getAutomationStatus();

    expect(status.glucoseSourceLabels).toEqual(['Dexcom Share', 'Medtrum']);
    expect(status.registered.glucose).toBe(true);
    expect(status.registered.hevy).toBe(true);
    expect(status.lastAttemptAt.hevy).toBe(123_000);
    expect(mocks.buildTiming).toHaveBeenCalledWith(
      expect.objectContaining({
        hevy: expect.objectContaining({ connected: true, workoutCount: 14 }),
      }),
    );
  });

  it('does not call stale task registrations enabled without their connection', async () => {
    mocks.registeredTasks.mockResolvedValue([
      { taskName: 't1arc.background.librelinkup-sync.v1' },
      { taskName: 't1arc.background.hevy-sync.v1' },
    ]);

    const status = await getAutomationStatus();

    expect(status.registered.glucose).toBe(false);
    expect(status.registered.hevy).toBe(false);
  });
});
