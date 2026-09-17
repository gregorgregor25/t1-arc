import { describe, expect, it } from 'vitest';
import { createManualContextEvent, manualContextDraftFromEvent, reviseManualContextEvent } from '@/data/manualContext';
import type { ContextNoteEvent, GlucoseReading } from '@/domain/models';
import { isRecordedSensorStart, readingConfirmsSensorResumed } from '@/domain/sensorChange';

const start = Date.parse('2026-08-01T10:00:00Z');
const event = createManualContextEvent({ kind: 'sensor-start', timestamp: start, glucoseSourceId: 'libre-link-up' },
  { id: 'sensor-change', recordedAt: start + 20_000 }) as ContextNoteEvent;
const reading: GlucoseReading = {
  id: 'reading', sourceId: 'libre-link-up', timestamp: start + 3_600_000,
  receivedAt: start + 3_610_000, mmolL: 6.5, trend: 'flat', quality: 'measured',
};

describe('explicit sensor-change context', () => {
  it('round-trips an editable factual note without changing existing generic sensor notes', () => {
    expect(isRecordedSensorStart(event)).toBe(true);
    expect(event).toMatchObject({ kind: 'note', category: 'sensor', title: 'Started a new sensor', sensorStarted: true });
    expect(manualContextDraftFromEvent(event)).toEqual({ kind: 'sensor-start', timestamp: start, glucoseSourceId: 'libre-link-up' });
    expect(isRecordedSensorStart({ ...event, sensorStarted: undefined })).toBe(false);
    const revised = reviseManualContextEvent(event, { kind: 'sensor-start', timestamp: start - 600_000, glucoseSourceId: 'libre-link-up' });
    expect(revised).toMatchObject({ id: event.id, recordedAt: event.recordedAt, start: start - 600_000 });
    expect(() => reviseManualContextEvent(event, { kind: 'note', timestamp: start, category: 'sensor' })).toThrow(/type/);
  });

  it('records without choosing a sensor model or source but does not infer waiting', () => {
    const unbound = createManualContextEvent({ kind: 'sensor-start', timestamp: start }) as ContextNoteEvent;
    expect(unbound.sensorStarted).toBe(true);
    expect(readingConfirmsSensorResumed(unbound, reading, start + 7_200_000)).toBe(false);
  });

  it('uses receipt freshness, so a later outage does not restart warm-up', () => {
    expect(readingConfirmsSensorResumed(event, reading, start + 7_200_000)).toBe(true);
    expect(readingConfirmsSensorResumed(event, reading, start + 86_400_000)).toBe(true);
  });

  it('allows the existing small source-clock tolerance only once the observation time has arrived', () => {
    const skewed = { ...reading, receivedAt: reading.timestamp - 60_000 };
    expect(readingConfirmsSensorResumed(event, skewed, reading.timestamp - 1)).toBe(false);
    expect(readingConfirmsSensorResumed(event, skewed, reading.timestamp + 1)).toBe(true);
    expect(readingConfirmsSensorResumed(event, { ...skewed, receivedAt: reading.timestamp - 180_000 }, reading.timestamp + 1)).toBe(false);
  });

  it.each([
    { sourceId: 'unrelated-provider' },
    { timestamp: start - 1 },
    { timestamp: start },
    { receivedAt: start + 9_000_000 },
    { timestamp: start + 9_000_000 },
    { receivedAt: start + 4_000_001 },
    { importedAt: start + 3_610_000 },
    { sourceFile: 'historical-export.csv' },
    { mmolL: NaN },
  ])('does not end waiting for unrelated, future or backfilled observations: %j', (overrides) => {
    expect(readingConfirmsSensorResumed(event, { ...reading, ...overrides }, start + 7_200_000)).toBe(false);
  });

  it('rejects recording a future sensor change', () => {
    expect(() => createManualContextEvent({ kind: 'sensor-start', timestamp: Date.now() + 60_000 })).toThrow(/future/);
  });
});
