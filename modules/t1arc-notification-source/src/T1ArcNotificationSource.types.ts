export type NotificationGlucoseUnit = 'auto' | 'mmolL' | 'mgDl';

export interface NotificationCaptureRule {
  packageName: string;
  displayName: string;
  captureGlucose: boolean;
  captureInsulin: boolean;
  glucoseUnit: NotificationGlucoseUnit;
}

export interface NotificationSourceConfiguration {
  enabled: boolean;
  rules: NotificationCaptureRule[];
}

export interface NotificationSourceConfigurationSnapshot
  extends NotificationSourceConfiguration {
  /** Optional only for a temporarily mismatched previous native binary. */
  configurationRevision?: number;
}

export interface NotificationSourceStatus
  extends NotificationSourceConfigurationSnapshot {
  supported: boolean;
  accessGranted: boolean;
  pendingCount: number;
  lastCapturedAt?: number;
  lastPackageName?: string;
  lastError?: string;
}

export interface CapturedNotificationEnvelope {
  id: string;
  /** Present on current captures; optional while draining previous queue entries. */
  captureToken?: string;
  packageName: string;
  postedAt: number;
  notificationWhen?: number;
  receivedAt: number;
  isOngoing: boolean;
  title?: string;
  text?: string;
  bigText?: string;
  subText?: string;
  infoText?: string;
  textLines: string[];
  category?: string;
  channelId?: string;
}

export interface CapturedNotificationReceipt {
  captureToken: string;
  id: string;
  receivedAt: number;
}
