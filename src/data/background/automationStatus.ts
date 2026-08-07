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
import {
  AutomationTiming,
  buildAutomationTiming,
} from './automationTiming';
import {
  AutomationConnectorIssue,
  buildGlookoAutomationIssue,
} from './automationIssue';
import { loadGlookoReportSyncState } from '@/data/glooko/glookoReportSyncState';
import { loadGlookoSyncState } from '@/data/glooko/glookoSyncState';
import {
  getHealthConnectOverview,
  getHealthConnectStatus,
} from '@/data/healthConnect/healthConnectRepository';

export interface AutomationStatus {
  schedulerAvailable: boolean;
  registered: Record<AutomationConnector, boolean>;
  evidence: Record<AutomationConnector, AutomationDataEvidence>;
  timing: Record<AutomationConnector, AutomationTiming>;
  issues: Partial<Record<AutomationConnector, AutomationConnectorIssue>>;
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
  ] = await Promise.all([
    BackgroundTask.getStatusAsync(),
    TaskManager.getRegisteredTasksAsync(),
    listAutomationRuns(24),
    loadAutomationDataEvidence(),
    loadGlookoSyncState(),
    loadGlookoReportSyncState(),
    getHealthConnectOverview(),
    getHealthConnectStatus(),
  ]);
  const taskNames = new Set(tasks.map((task) => task.taskName));
  const registered: Record<AutomationConnector, boolean> = {
    glucose: taskNames.has(AUTOMATION_TASK_BY_CONNECTOR.glucose),
    glooko: taskNames.has(AUTOMATION_TASK_BY_CONNECTOR.glooko),
    'health-connect': taskNames.has(
      AUTOMATION_TASK_BY_CONNECTOR['health-connect'],
    ),
    'insight-review': taskNames.has(
      AUTOMATION_TASK_BY_CONNECTOR['insight-review'],
    ),
  };
  const glookoIssue = buildGlookoAutomationIssue(glooko, glookoReport);
  return {
    schedulerAvailable:
      schedulerStatus === BackgroundTask.BackgroundTaskStatus.Available,
    registered,
    evidence,
    issues: glookoIssue ? { glooko: glookoIssue } : {},
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
      now: checkedAt,
      registered,
    }),
    runs,
    checkedAt,
  };
}
