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

export interface NotificationSourceStatus {
  supported: boolean;
  accessGranted: boolean;
  enabled: boolean;
  rules: NotificationCaptureRule[];
  pendingCount: number;
  lastCapturedAt?: number;
  lastPackageName?: string;
  lastError?: string;
}

export interface CapturedNotificationEnvelope {
  id: string;
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
