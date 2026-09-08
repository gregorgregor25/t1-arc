import { GLUCOSE_CURRENT_AFTER_MINUTES } from './freshness';
import type { ContextNoteEvent, GlucoseReading, HealthContextEvent } from './models';
import { FUTURE_CLOCK_SKEW_TOLERANCE_MS } from './time';

export const SENSOR_RESUMED_RECEIPT_WINDOW_MS = GLUCOSE_CURRENT_AFTER_MINUTES * 60_000;
export const SENSOR_RESUMED_CLOCK_SKEW_MS = FUTURE_CLOCK_SKEW_TOLERANCE_MS;

export function isRecordedSensorStart(event: HealthContextEvent): event is ContextNoteEvent {
  return event.kind === 'note' && event.category === 'sensor' &&
    event.origin === 'manual' && event.sensorStarted === true;
}

/** Receipt freshness, not today's age, prevents a resumed sensor reverting to waiting later. */
export function readingConfirmsSensorResumed(
  event: ContextNoteEvent,
  reading: GlucoseReading,
  now: number,
) {
  return isRecordedSensorStart(event) && Boolean(event.sensorGlucoseSourceId) &&
    reading.sourceId === event.sensorGlucoseSourceId &&
    Number.isFinite(reading.timestamp) && Number.isFinite(reading.receivedAt) &&
    Number.isFinite(reading.mmolL) && reading.mmolL > 0 &&
    reading.timestamp > event.start && reading.timestamp <= now &&
    reading.receivedAt <= now && reading.receivedAt >= reading.timestamp - SENSOR_RESUMED_CLOCK_SKEW_MS &&
    reading.receivedAt - reading.timestamp <= SENSOR_RESUMED_RECEIPT_WINDOW_MS &&
    reading.importedAt === undefined && reading.sourceFile === undefined;
}

export interface SensorChangeStatusValue {
  event: ContextNoteEvent;
  waiting: boolean;
}
