import * as BackgroundTask from 'expo-background-task';
import * as TaskManager from 'expo-task-manager';

import {
  AutomationConnector,
  AutomationRun,
  listAutomationRuns,
} from './automationRunLog';
import {
  AutomationDataEvidence,
  loadAutomationDataEvidence,
} from './automationEvidence';
import { AUTOMATION_TASK_BY_CONNECTOR } from './backgroundTaskNames';
import { AutomationTiming, buildAutomationTiming } from './automationTiming';
import {
  AutomationConnectorIssue,
  buildGlookoAutomationIssue,
  buildHevyAutomationIssue,
} from './automationIssue';
import { loadGlookoReportSyncState } from '@/data/glooko/glookoReportSyncState';
import { loadGlookoSyncState } from '@/data/glooko/glookoSyncState';
import {
  getHealthConnectOverview,
  getHealthConnectStatus,
} from '@/data/healthConnect/healthConnectRepository';
import { HevyWorkoutRepository } from '@/data/hevy/repository';
import { loadHevyConnection } from '@/data/hevy/secureStore';
import { configuredGlucoseSources } from '@/data/live/configuredGlucoseSources';
import { glucoseSourceLabel } from '@/data/live/glucoseSourceRefresh';

export interface AutomationStatus {
  schedulerAvailable: boolean;
  registered: Record<AutomationConnector, boolean>;
  evidence: Record<AutomationConnector, AutomationDataEvidence>;
  timing: Record<AutomationConnector, AutomationTiming>;
  issues: Partial<Record<AutomationConnector, AutomationConnectorIssue>>;
  lastAttemptAt: Partial<Record<AutomationConnector, number>>;
  glucoseSourceLabels: string[];
  runs: AutomationRun[];
  checkedAt: number;
}

export async function getAutomationStatus(): Promise<AutomationStatus> {
  const checkedAt = Date.now();
  const [
    schedulerStatus,
    tasks,
    runs,
    evidence,
    glooko,
    glookoReport,
    healthConnect,
    healthConnectStatus,
    configuredSources,
    hevyConnection,
    storedHevyStatus,
  ] = await Promise.all([
    BackgroundTask.getStatusAsync(),
    TaskManager.getRegisteredTasksAsync(),
    listAutomationRuns(24),
    loadAutomationDataEvidence(),
    loadGlookoSyncState(),
    loadGlookoReportSyncState(),
    getHealthConnectOverview(),
    getHealthConnectStatus(),
    configuredGlucoseSources().catch(() => []),
    loadHevyConnection().catch(() => undefined),
    new HevyWorkoutRepository().status(),
  ]);
  const taskNames = new Set(tasks.map((task) => task.taskName));
  const glucoseSourceLabels = Array.from(
    new Set(
      configuredSources.map(({ sourceId }) => glucoseSourceLabel(sourceId)),
    ),
  );
  const hevy = {
    ...storedHevyStatus,
    connected: Boolean(hevyConnection),
  };
  const registered: Record<AutomationConnector, boolean> = {
    glucose:
      glucoseSourceLabels.length > 0 &&
      taskNames.has(AUTOMATION_TASK_BY_CONNECTOR.glucose),
    glooko: taskNames.has(AUTOMATION_TASK_BY_CONNECTOR.glooko),
    'health-connect': taskNames.has(
      AUTOMATION_TASK_BY_CONNECTOR['health-connect'],
    ),
    'insight-review': taskNames.has(
      AUTOMATION_TASK_BY_CONNECTOR['insight-review'],
    ),
    hevy: hevy.connected && taskNames.has(AUTOMATION_TASK_BY_CONNECTOR.hevy),
  };
  const glookoIssue = buildGlookoAutomationIssue(glooko, glookoReport);
  const hevyIssue = buildHevyAutomationIssue(hevy);
  return {
    schedulerAvailable:
      schedulerStatus === BackgroundTask.BackgroundTaskStatus.Available,
    registered,
    evidence,
    issues: {
      ...(glookoIssue ? { glooko: glookoIssue } : {}),
      ...(hevyIssue ? { hevy: hevyIssue } : {}),
    },
    lastAttemptAt: {
      ...(hevy.lastAttemptAt === undefined ? {} : { hevy: hevy.lastAttemptAt }),
    },
    glucoseSourceLabels,
    timing: buildAutomationTiming({
      glooko,
      healthConnect,
      healthConnectAccess: {
        available: healthConnectStatus.availability === 'available',
        readGranted: healthConnectStatus.categories.some(
          (category) => category.granted,
        ),
        grantedCategories: healthConnectStatus.categories
          .filter((category) => category.granted)
          .map((category) => category.id),
      },
      hevy,
      now: checkedAt,
      registered,
    }),
    runs,
    checkedAt,
  };
}
