import type { AutomationConnector } from './automationRunLog';

export const GLOOKO_BACKGROUND_TASK = 't1arc.background.glooko-sync.v1';
export const HEALTH_CONNECT_BACKGROUND_TASK = 't1arc.background.health-connect-sync.v1';
export const LIBRE_BACKGROUND_TASK = 't1arc.background.librelinkup-sync.v1';
export const INSIGHT_REVIEW_BACKGROUND_TASK = 't1arc.background.insight-review.v1';
export const HEVY_BACKGROUND_TASK = 't1arc.background.hevy-sync.v1';

export const AUTOMATION_TASK_BY_CONNECTOR: Record<AutomationConnector, string> =
  {
    glucose: LIBRE_BACKGROUND_TASK,
    glooko: GLOOKO_BACKGROUND_TASK,
    'health-connect': HEALTH_CONNECT_BACKGROUND_TASK,
    'insight-review': INSIGHT_REVIEW_BACKGROUND_TASK,
    hevy: HEVY_BACKGROUND_TASK,
  };
