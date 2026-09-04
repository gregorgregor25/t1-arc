import T1ArcNotificationSource, {
  type NotificationCaptureRule,
  type NotificationSourceConfiguration,
  type NotificationSourceConfigurationSnapshot,
  type NotificationSourceStatus,
} from '../../../modules/t1arc-notification-source';

import { withT1ArcTransaction } from '@/data/persistence/t1arcDatabase';

import { advanceNotificationSourceEpochInTransaction } from './notificationSourceEpoch';

export class NotificationConfigurationSupersededError extends Error {
  constructor() {
    super('The notification drain was superseded by a settings change.');
    this.name = 'NotificationConfigurationSupersededError';
  }
}

export function isNotificationConfigurationSupersededError(
  error: unknown,
): error is NotificationConfigurationSupersededError {
  return error instanceof NotificationConfigurationSupersededError;
}

export interface NotificationConfigurationLease {
  readonly fingerprint: string;
  readonly revision: number;
}

function configurationRevision(
  snapshot: NotificationSourceConfigurationSnapshot,
) {
  const revision = snapshot.configurationRevision ?? 0;
  if (!Number.isSafeInteger(revision) || revision < 0) {
    throw new Error('The native notification configuration revision is invalid.');
  }
  return revision;
}

function normalizedRule(rule: NotificationCaptureRule) {
  if (
    !rule ||
    typeof rule.packageName !== 'string' ||
    typeof rule.displayName !== 'string' ||
    typeof rule.captureGlucose !== 'boolean' ||
    typeof rule.captureInsulin !== 'boolean' ||
    !['auto', 'mmolL', 'mgDl'].includes(rule.glucoseUnit)
  ) {
    throw new Error('The native notification configuration is invalid.');
  }
  return {
    packageName: rule.packageName,
    displayName: rule.displayName,
    captureGlucose: rule.captureGlucose,
    captureInsulin: rule.captureInsulin,
    glucoseUnit: rule.glucoseUnit,
  };
}

function configurationFingerprint(
  snapshot: NotificationSourceConfigurationSnapshot,
) {
  if (
    typeof snapshot.enabled !== 'boolean' ||
    !Array.isArray(snapshot.rules)
  ) {
    throw new Error('The native notification configuration is invalid.');
  }
  return JSON.stringify({
    enabled: snapshot.enabled,
    rules: snapshot.rules.map(normalizedRule),
  });
}

export function captureNotificationConfiguration(
  snapshot: NotificationSourceStatus | NotificationSourceConfigurationSnapshot,
): NotificationConfigurationLease {
  return {
    fingerprint: configurationFingerprint(snapshot),
    revision: configurationRevision(snapshot),
  };
}

export async function assertNotificationConfigurationCurrent(
  lease: NotificationConfigurationLease,
) {
  const current =
    await T1ArcNotificationSource.getConfigurationSnapshotAsync();
  if (
    configurationRevision(current) !== lease.revision ||
    configurationFingerprint(current) !== lease.fingerprint
  ) {
    throw new NotificationConfigurationSupersededError();
  }
}

/**
 * The SQLite writer is the cross-runtime linearization point: an older drain
 * either commits first, or observes the advanced epoch after native has staged
 * disabled and cryptographically replaced its queue/configuration.
 */
export function setNotificationSourceConfiguration(
  configuration: NotificationSourceConfiguration,
) {
  return withT1ArcTransaction(async (transaction) => {
    await advanceNotificationSourceEpochInTransaction(transaction);
    return T1ArcNotificationSource.setConfigurationAsync(configuration);
  });
}
