import {
  CapturedNotificationEnvelope,
  NotificationCaptureRule,
} from '../../../modules/daymark-notification-source';
import { GlucoseReading } from '@/domain/models';

export const NOTIFICATION_SOURCE_ID = 'android-notification';
export const NOTIFICATION_PARSER_VERSION = 1;

export type PumpMode = 'automated' | 'manual' | 'limited' | 'unknown';

export interface ParsedPumpObservation {
  iobUnits?: number;
  mode?: PumpMode;
}

export interface ParsedNotificationObservation {
  envelope: CapturedNotificationEnvelope;
  rule: NotificationCaptureRule;
  glucose?: GlucoseReading;
  pump?: ParsedPumpObservation;
}

export interface StoredNotificationEvent {
  observation: ParsedNotificationObservation;
  importedAt: number;
}
