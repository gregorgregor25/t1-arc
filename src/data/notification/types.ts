import {
  CapturedNotificationEnvelope,
  NotificationCaptureRule,
} from '../../../modules/t1arc-notification-source';
import { GlucoseReading } from '@/domain/models';

export const NOTIFICATION_SOURCE_ID = 'android-notification';
export const NOTIFICATION_PARSER_VERSION = 1;

/**
 * Evidence compatibility is explicit rather than coupled to the newest
 * capture parser. A future parser bump must deliberately retain or remove an
 * older version here after its stored IOB semantics have been reviewed.
 */
export const TIMESTAMPED_IOB_EVIDENCE_PARSER_VERSIONS = [1] as const;

export function isTimestampedIobEvidenceParserVersion(value: number) {
  return (
    TIMESTAMPED_IOB_EVIDENCE_PARSER_VERSIONS as readonly number[]
  ).includes(value);
}

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
