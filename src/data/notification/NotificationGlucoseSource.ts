import DaymarkNotificationSource, {
  NotificationCaptureRule,
  NotificationSourceStatus,
} from '../../../modules/daymark-notification-source';
import { GlucoseSource } from '@/data/contracts';
import {
  GlucoseHistoryStore,
  MemoryGlucoseHistoryStore,
} from '@/data/persistence/GlucoseHistoryStore';
import { glucoseFreshness } from '@/domain/freshness';
import { DataSourceStatus, TimeRange } from '@/domain/models';

import { NotificationEventStore } from './NotificationEventStore';
import { parseCapturedNotification } from './notificationParser';
import { NOTIFICATION_SOURCE_ID } from './types';

const MAX_DRAIN_PASSES = 10;
const BATCH_SIZE = 100;

function matchingRule(
  status: NotificationSourceStatus,
  packageName: string,
): NotificationCaptureRule | undefined {
  return status.rules.find((rule) => rule.packageName === packageName);
}

export class NotificationGlucoseSource implements GlucoseSource {
  readonly sourceId = NOTIFICATION_SOURCE_ID;
  private refreshInFlight?: Promise<void>;

  constructor(
    private readonly history: GlucoseHistoryStore =
      new MemoryGlucoseHistoryStore(),
    private readonly events = new NotificationEventStore(),
  ) {}

  async isConfigured() {
    const status = await DaymarkNotificationSource.getStatusAsync();
    return status.supported && status.enabled && status.accessGranted;
  }

  async refresh() {
    if (this.refreshInFlight) return this.refreshInFlight;
    this.refreshInFlight = this.drain().finally(() => {
      this.refreshInFlight = undefined;
    });
    return this.refreshInFlight;
  }

  private async drain() {
    await this.history.initialize();
    const attemptedAt = Date.now();
    const previous = await this.history.getSyncState(this.sourceId);
    const status = await DaymarkNotificationSource.getStatusAsync();
    if (!status.supported || !status.enabled || !status.accessGranted) {
      const bounds = await this.history.getBounds(this.sourceId);
      await this.history.saveSyncState({
        sourceId: this.sourceId,
        lastAttemptAt: attemptedAt,
        lastSuccessAt: previous?.lastSuccessAt,
        recordCount: bounds.count,
      });
      return;
    }

    let processed = 0;
    let parsed = 0;
    for (let pass = 0; pass < MAX_DRAIN_PASSES; pass += 1) {
      const envelopes = await DaymarkNotificationSource.peekAsync(BATCH_SIZE);
      if (envelopes.length === 0) break;
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
      await this.events.save(
        observations.map((observation) => ({
          observation,
          importedAt,
        })),
      );
      await this.history.upsertReadings(readings);
      await DaymarkNotificationSource.acknowledgeAsync(
        envelopes.map((envelope) => envelope.id),
      );
      processed += envelopes.length;
      parsed += readings.length;
      if (envelopes.length < BATCH_SIZE) break;
    }

    const bounds = await this.history.getBounds(this.sourceId);
    await this.history.saveSyncState({
      sourceId: this.sourceId,
      lastAttemptAt: attemptedAt,
      lastSuccessAt: processed > 0 ? Date.now() : previous?.lastSuccessAt,
      lastErrorCode:
        processed > 0 && parsed === 0 ? 'no-glucose-value' : undefined,
      lastErrorMessage:
        processed > 0 && parsed === 0
          ? 'Selected notifications were retained but contained no recognised glucose value.'
          : undefined,
      recordCount: bounds.count,
    });
  }

  async getReadings(range: TimeRange) {
    await this.refresh();
    return this.history.getReadings(range, this.sourceId);
  }

  async getLatestReading() {
    await this.refresh();
    return this.history.getLatestReading(this.sourceId);
  }

  async getStatus(now = Date.now()): Promise<DataSourceStatus> {
    await this.refresh();
    const [native, latest, state, bounds] = await Promise.all([
      DaymarkNotificationSource.getStatusAsync(),
      this.history.getLatestReading(this.sourceId),
      this.history.getSyncState(this.sourceId),
      this.history.getBounds(this.sourceId),
    ]);
    return {
      id: this.sourceId,
      label: 'Phone notification source',
      detail: !native.enabled
        ? 'No notification source selected'
        : !native.accessGranted
          ? 'Notification access is off'
          : 'Selected health-app notifications are processed on this phone',
      freshness: glucoseFreshness(latest?.timestamp, now),
      origin: 'live',
      lastAttemptAt: state?.lastAttemptAt,
      lastUpdatedAt: state?.lastSuccessAt,
      dataThrough: latest?.timestamp,
      recordCount: bounds.count,
      errorCode: state?.lastErrorCode,
      isLive: native.supported && native.enabled && native.accessGranted,
    };
  }
}
