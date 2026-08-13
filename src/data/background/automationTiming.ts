import type { AutomationConnector } from './automationRunLog';
import type { GlookoSyncState } from '@/data/glooko/glookoSyncPolicy';
import {
  GLOOKO_INCREMENTAL_INTERVAL_MS,
  planAutomaticGlookoSync,
} from '@/data/glooko/glookoSyncPolicy';
import type { HealthConnectCategoryId } from '../../../modules/daymark-health-connect';
import type { HealthConnectOverview } from '@/data/healthConnect/healthConnectRepository';

export const HEALTH_CONNECT_FOREGROUND_INTERVAL_MS = 5 * 60 * 1000;

export type AutomationTimingState =
  | 'off'
  | 'paused'
  | 'due'
  | 'waiting'
  | 'android-controlled';

export interface AutomationTiming {
  state: AutomationTimingState;
  detail: string;
  nextEligibleAt?: number;
}

type RegisteredConnectors = Record<AutomationConnector, boolean>;

function sharedWorkerTiming(
  registered: boolean,
  enabledDetail: string,
  disabledDetail: string,
): AutomationTiming {
  return registered
    ? {
        state: 'android-controlled',
        detail: enabledDetail,
      }
    : {
        state: 'off',
        detail: disabledDetail,
      };
}

function glookoTiming(
  state: GlookoSyncState,
  registered: boolean,
  now: number,
): AutomationTiming {
  const plan = planAutomaticGlookoSync(state, now);
  if (!plan.due && plan.reason === 'disabled') {
    return {
      state: 'off',
      detail: 'Automatic Glooko updates are off.',
    };
  }
  if (!plan.due && plan.reason === 'sign-in-required') {
    return {
      state: 'paused',
      detail: 'Paused until you sign into Glooko again.',
    };
  }
  if (plan.due) {
    const work =
      plan.reason === 'reconciliation' || plan.reason === 'initial'
        ? '30-day check'
        : plan.reason === 'history-backfill'
          ? 'older history'
          : 'latest Glooko data';
    return {
      state: 'due',
      detail: registered
        ? `${work} is ready to update when Android allows it.`
        : `${work} is ready; open T1 Arc to update now.`,
    };
  }
  return {
    state: 'waiting',
    detail:
      plan.reason === 'backoff'
        ? 'T1 Arc is waiting before trying again.'
        : 'Recent Glooko data is checked hourly; the past 30 days are checked daily.',
    nextEligibleAt:
      plan.nextEligibleAt ??
      (state.lastSuccessAt === undefined
        ? undefined
        : state.lastSuccessAt + GLOOKO_INCREMENTAL_INTERVAL_MS),
  };
}

function healthConnectTiming(
  overview: HealthConnectOverview,
  registered: boolean,
  now: number,
  access: {
    available: boolean;
    readGranted: boolean;
    grantedCategories?: HealthConnectCategoryId[];
  },
): AutomationTiming {
  if (!access.available) {
    return {
      state: 'off',
      detail: 'Health Connect is unavailable or needs an update.',
    };
  }
  if (!access.readGranted) {
    return {
      state: 'off',
      detail: 'No Health Connect read categories are allowed yet.',
    };
  }
  const grantedCategories = access.grantedCategories
    ? new Set(access.grantedCategories)
    : undefined;
  const enabled = overview.preferences.filter(
    (preference) =>
      preference.enabled &&
      (!grantedCategories ||
        grantedCategories.has(preference.category)),
  );
  if (!enabled.length) {
    return {
      state: 'off',
      detail: 'No Health Connect categories are selected.',
    };
  }
  const syncByCategory = new Map(
    overview.sync.map((state) => [state.category, state]),
  );
  const nextEligibleAt = enabled.reduce<number | undefined>(
    (earliest, preference) => {
      const lastAttempt = syncByCategory.get(
        preference.category,
      )?.lastAttemptAt;
      if (lastAttempt === undefined) return now;
      const categoryDueAt =
        lastAttempt + HEALTH_CONNECT_FOREGROUND_INTERVAL_MS;
      return earliest === undefined
        ? categoryDueAt
        : Math.min(earliest, categoryDueAt);
    },
    undefined,
  );
  if (nextEligibleAt === undefined || nextEligibleAt <= now) {
    return {
      state: 'due',
      detail: registered
        ? 'Health data is ready to update when Android allows it.'
        : 'Health data is ready; open T1 Arc to update now.',
    };
  }
  return {
    state: 'waiting',
    detail: registered
      ? 'Checks every 5 minutes while you use T1 Arc, and automatically when Android allows it.'
      : 'Checks every 5 minutes while T1 Arc is in use.',
    nextEligibleAt,
  };
}

export function buildAutomationTiming(input: {
  glooko: GlookoSyncState;
  healthConnect: HealthConnectOverview;
  healthConnectAccess: {
    available: boolean;
    readGranted: boolean;
    grantedCategories?: HealthConnectCategoryId[];
  };
  now: number;
  registered: RegisteredConnectors;
}): Record<AutomationConnector, AutomationTiming> {
  return {
    glucose: sharedWorkerTiming(
      input.registered.glucose,
      'Checks automatically about every 15 minutes.',
      'Automatic glucose checks are off.',
    ),
    glooko: glookoTiming(
      input.glooko,
      input.registered.glooko,
      input.now,
    ),
    'health-connect': healthConnectTiming(
      input.healthConnect,
      input.registered['health-connect'],
      input.now,
      input.healthConnectAccess,
    ),
    'insight-review': sharedWorkerTiming(
      input.registered['insight-review'],
      'Checks about every 15 minutes for a scheduled review.',
      'Scheduled review checks are off.',
    ),
  };
}
