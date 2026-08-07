import type { HealthConnectCategoryId } from '../../../modules/daymark-health-connect';

const SAMSUNG_HEALTH_PACKAGE = 'com.sec.android.app.shealth';
const HEALTH_SYNC_PACKAGE = 'nl.appyhapps.healthsync';
const RENPHO_HEALTH_PACKAGE = 'com.renpho.health';
const FITBIT_PACKAGE = 'com.fitbit.FitbitMobile';

const SOURCE_LABELS: Record<string, string> = {
  [SAMSUNG_HEALTH_PACKAGE]: 'Samsung Health',
  [HEALTH_SYNC_PACKAGE]: 'Health Sync',
  [RENPHO_HEALTH_PACKAGE]: 'Renpho Health',
  [FITBIT_PACKAGE]: 'Fitbit',
};

export interface HealthConnectSourceCandidate {
  packageName: string;
  recordCount: number;
  dataThrough?: number;
}

export interface HealthConnectSourceDecision {
  packageName: string;
  reason: 'direct-device' | 'freshest-complete-source';
}

export function healthConnectSourceDisplayName(
  packageName: string,
  storedDisplayName: string,
) {
  if (packageName === 'android') return 'This phone (legacy steps)';
  if (packageName.startsWith('com.android.healthconnect.phone.')) {
    return 'This phone (Health Connect)';
  }
  return SOURCE_LABELS[packageName] ?? storedDisplayName;
}

function sourcePriority(
  category: HealthConnectCategoryId,
  packageName: string,
) {
  if (category === 'weight' || category === 'body_composition') {
    if (packageName === RENPHO_HEALTH_PACKAGE) return 240;
    if (packageName === SAMSUNG_HEALTH_PACKAGE) return 110;
    if (packageName === HEALTH_SYNC_PACKAGE) return 90;
  }

  if (packageName === SAMSUNG_HEALTH_PACKAGE) return 100;
  if (packageName === HEALTH_SYNC_PACKAGE) return 90;
  if (packageName === FITBIT_PACKAGE) return 70;
  if (packageName.startsWith('com.android.healthconnect.phone.')) return 30;
  if (packageName === 'android') return 10;
  return 50;
}

function freshnessScore(dataThrough: number | undefined, now: number) {
  if (!dataThrough) return 0;
  const age = Math.max(0, now - dataThrough);
  if (age <= 24 * 60 * 60 * 1000) return 300;
  if (age <= 7 * 24 * 60 * 60 * 1000) return 220;
  if (age <= 30 * 24 * 60 * 60 * 1000) return 120;
  if (age <= 180 * 24 * 60 * 60 * 1000) return 50;
  return 0;
}

function coverageScore(recordCount: number) {
  return Math.min(160, Math.log10(Math.max(0, recordCount) + 1) * 35);
}

/**
 * Chooses exactly one provider for a metric. Fresh, complete history wins;
 * known direct-device apps provide a deterministic tie-break. Package name is
 * the final tie-break so the result cannot change because SQLite row order did.
 */
export function chooseAutomaticHealthConnectSource(
  category: HealthConnectCategoryId,
  candidates: HealthConnectSourceCandidate[],
  now = Date.now(),
): HealthConnectSourceDecision | undefined {
  const ranked = candidates
    .filter((candidate) => candidate.recordCount > 0)
    .map((candidate) => ({
      candidate,
      priority: sourcePriority(category, candidate.packageName),
      score:
        freshnessScore(candidate.dataThrough, now) +
        coverageScore(candidate.recordCount) +
        sourcePriority(category, candidate.packageName),
    }))
    .sort(
      (left, right) =>
        right.score - left.score ||
        (right.candidate.dataThrough ?? 0) -
          (left.candidate.dataThrough ?? 0) ||
        right.candidate.recordCount - left.candidate.recordCount ||
        left.candidate.packageName.localeCompare(
          right.candidate.packageName,
        ),
    );
  const selected = ranked[0];
  if (!selected) return undefined;

  return {
    packageName: selected.candidate.packageName,
    reason:
      selected.priority >= 200
        ? 'direct-device'
        : 'freshest-complete-source',
  };
}
