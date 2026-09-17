import T1ArcNotificationSource, {
  CapturedNotificationEnvelope,
  CapturedNotificationReceipt,
  NotificationCaptureRule,
  NotificationSourceStatus,
} from '../../../modules/t1arc-notification-source';
import { GlucoseSource } from '@/data/contracts';
import {
  GlucoseHistoryStore,
  MemoryGlucoseHistoryStore,
} from '@/data/persistence/GlucoseHistoryStore';
import { glucoseFreshness } from '@/domain/freshness';
import { DataSourceStatus, TimeRange } from '@/domain/models';

import { NotificationEventStore } from './NotificationEventStore';
import {
  assertNotificationConfigurationCurrent,
  captureNotificationConfiguration,
  isNotificationConfigurationSupersededError,
} from './notificationSourceConfiguration';
import { NotificationDrainSupersededError } from './notificationSourceEpoch';
import { parseCapturedNotification } from './notificationParser';
import { normalizeKnownNotificationRule } from './supportedApps';
import { NOTIFICATION_SOURCE_ID } from './types';

const MAX_DRAIN_PASSES = 10;
const BATCH_SIZE = 100;
const CAPTURE_TOKEN_PATTERN =
  /^notification-capture:v1:[A-Za-z0-9_-]{43}$/;
const LEGACY_NOTIFICATION_ID_PATTERN = /^[A-Za-z0-9_-]{43}$/;

function exactCaptureReceipt(
  envelope: CapturedNotificationEnvelope,
): CapturedNotificationReceipt | undefined {
  if (
    !envelope.captureToken ||
    !CAPTURE_TOKEN_PATTERN.test(envelope.captureToken) ||
    !LEGACY_NOTIFICATION_ID_PATTERN.test(envelope.id) ||
    !Number.isSafeInteger(envelope.receivedAt) ||
    envelope.receivedAt <= 0
  ) {
    return undefined;
  }
  return {
    captureToken: envelope.captureToken,
    id: envelope.id,
    receivedAt: envelope.receivedAt,
  };
}

function matchingRule(
  status: NotificationSourceStatus,
  packageName: string,
): NotificationCaptureRule | undefined {
  const rule = status.rules.find(
    (candidate) => candidate.packageName === packageName,
  );
  return rule ? normalizeKnownNotificationRule(rule) : undefined;
}

export class NotificationGlucoseSource implements GlucoseSource {
  readonly sourceId = NOTIFICATION_SOURCE_ID;
  private refreshInFlight?: Promise<void>;

  constructor(
    private readonly history: GlucoseHistoryStore = new MemoryGlucoseHistoryStore(),
    private readonly events = new NotificationEventStore(),
  ) {}

  async isConfigured() {
    const status = await T1ArcNotificationSource.getStatusAsync();
    return status.supported && status.enabled && status.accessGranted;
  }

  async refresh() {
    if (this.refreshInFlight) return this.refreshInFlight;
    this.refreshInFlight = this.drain()
      .catch((error) => {
        if (
          error instanceof NotificationDrainSupersededError ||
          isNotificationConfigurationSupersededError(error)
        ) {
          return;
        }
        throw error;
      })
      .finally(() => {
        this.refreshInFlight = undefined;
      });
    return this.refreshInFlight;
  }

  private async drain() {
    const status = await T1ArcNotificationSource.getStatusAsync();
    if (!status.supported || !status.enabled || !status.accessGranted) {
      // A disabled notification source has nothing to drain. In particular,
      // do not turn the app's frequent foreground/status polls into encrypted
      // database writes for a source the user has not enabled.
      return;
    }
    const configurationLease = captureNotificationConfiguration(status);
    const assertConfigurationCurrent = () =>
      assertNotificationConfigurationCurrent(configurationLease);

    await this.history.initialize();
    const attemptedAt = Date.now();
    const epoch = await this.events.acquireDrainEpoch();
    let processed = 0;
    let parsed = 0;
    let drainCompleted = false;
    for (let pass = 0; pass < MAX_DRAIN_PASSES; pass += 1) {
      const envelopes = await T1ArcNotificationSource.peekAsync(BATCH_SIZE);
      if (envelopes.length === 0) {
        drainCompleted = true;
        break;
      }
      const importedAt = Date.now();
      const observations = envelopes.map((envelope) => {
        const rule = matchingRule(status, envelope.packageName);
        return rule
          ? parseCapturedNotification(envelope, rule)
          : {
              envelope,
              rule: {
                packageName: envelope.packageName,
                displayName: envelope.packageName,
                captureGlucose: false,
                captureInsulin: false,
                glucoseUnit: 'auto' as const,
              },
            };
      });
      const readings = observations.flatMap((item) =>
        item.glucose ? [item.glucose] : [],
      );
      parsed += readings.length;
      await this.events.commitDrainBatch({
        epoch,
        assertConfigurationCurrent,
        events: observations.map((observation) => ({
          observation,
          importedAt,
        })),
        readings,
        sourceId: this.sourceId,
        attemptedAt,
        completedAt: importedAt,
        hasParsedGlucose: parsed > 0,
      });
      const receipts = envelopes.map(exactCaptureReceipt);
      if (receipts.some((receipt) => !receipt)) {
        throw new Error(
          'A retained notification is missing a valid native capture token; update T1 Arc before this notification can be acknowledged safely.',
        );
      }
      const acknowledged = await T1ArcNotificationSource.acknowledgeCapturedAsync(
        receipts as CapturedNotificationReceipt[],
      );
      if (
        !Number.isSafeInteger(acknowledged) ||
        acknowledged < 0 ||
        acknowledged > receipts.length
      ) {
        throw new Error('The native notification acknowledgement was invalid.');
      }
      processed += envelopes.length;
      // Even a full acknowledgement of a short peek is not proof that the
      // queue is empty: a changed capture can be appended between peek and
      // acknowledgement. Only a subsequent empty peek completes the drain.
      continue;
    }
    if (!drainCompleted) {
      throw new Error(
        'The native notification queue could not be acknowledged safely within the bounded drain.',
      );
    }

    if (processed === 0) {
      await this.events.commitEmptyDrain({
        epoch,
        assertConfigurationCurrent,
        sourceId: this.sourceId,
        attemptedAt,
      });
    }
  }

  async getReadings(range: TimeRange) {
    await this.history.initialize();
    return this.history.getReadings(range, this.sourceId);
  }

  async getLatestReading() {
    await this.history.initialize();
    return this.history.getLatestReading(this.sourceId);
  }

  async getStatus(now = Date.now()): Promise<DataSourceStatus> {
    // Status is an observation, not a sync trigger. Composite callers already
    // coordinate source refreshes; refreshing here caused a second drain (and
    // write transaction) while merely rendering Settings.
    const native = await T1ArcNotificationSource.getStatusAsync();
    if (!native.supported || !native.enabled || !native.accessGranted) {
      return {
        id: this.sourceId,
        label: 'Phone notification source',
        detail: !native.supported
          ? 'Phone notification capture is unavailable'
          : !native.enabled
            ? 'No notification source selected'
            : 'Notification access is off',
        freshness: 'missing',
        origin: 'live',
        recordCount: 0,
        isLive: false,
      };
    }

    await this.history.initialize();
    const [latest, state, bounds] = await Promise.all([
      this.history.getLatestReading(this.sourceId),
      this.history.getSyncState(this.sourceId),
      this.history.getBounds(this.sourceId),
    ]);
    return {
      id: this.sourceId,
      label: 'Phone notification source',
      detail: 'Selected health-app notifications are processed on this phone',
      freshness: glucoseFreshness(latest?.timestamp, now),
      origin: 'live',
      lastAttemptAt: state?.lastAttemptAt,
      lastUpdatedAt: state?.lastSuccessAt,
      dataThrough: latest?.timestamp,
      recordCount: bounds.count,
      errorCode: state?.lastErrorCode,
      isLive: true,
    };
  }
}
