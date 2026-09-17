import { describe, expect, it } from 'vitest';
import { createManualContextEvent, manualContextDraftFromEvent, reviseManualContextEvent } from '@/data/manualContext';
import { sensorWarmupEvidence } from '@/data/tarvis/sensorWarmupEvidence';
import type { ContextNoteEvent, TimelineData } from '@/domain/models';
import { sensorChangePresentation, sensorWarmupWindow } from '@/domain/sensorChange';
import { sensorSelection } from '@/domain/sensorModels';

const start = Date.parse('2026-08-01T23:30:00Z');
const minute = 60_000;
function event(model = 'libre-2', customMinutes?: number) {
  return createManualContextEvent({ kind: 'sensor-start', timestamp: start, glucoseSourceId: 'cgm', sensorModelId: model, sensorWarmupMinutes: customMinutes },
    { id: 'sensor', recordedAt: start + 5 * 60 * minute }) as ContextNoteEvent;
}
function data(note = event()): TimelineData {
  return { range: { start: start - 30 * minute, end: start + 90 * minute },
    glucose: [{ id: 'before', sourceId: 'cgm', timestamp: start - 30 * minute, receivedAt: start - 30 * minute, mmolL: 6, trend: 'flat', quality: 'measured' }],
    basal: [], boluses: [], context: [note], sources: [] };
}

describe('recorded sensor warm-up', () => {
  it.each([['libre-2', 60], ['libre-3-plus', 60], ['dexcom-g6', 120], ['dexcom-g7', 30], ['dexcom-g7-15-day', 60], ['dexcom-one-plus', 30]])('uses the exact model %s', (model, minutes) => {
    expect(event(model).sensorWarmupMinutes).toBe(minutes);
  });
  it('keeps unknown durations unknown and validates custom durations', () => {
    expect(sensorWarmupWindow(event('other'))).toBeUndefined();
    expect(event('other', 45).sensorWarmupMinutes).toBe(45);
    for (const value of [0, -1, 1.5, NaN, Infinity, 1441]) expect(() => event('other', value)).toThrow(/warm-up/);
    expect(() => sensorSelection('invented-model')).toThrow(/sensor model/);
  });
  it('backdates the complete expected window, round-trips edits, and crosses midnight', () => {
    const saved = event();
    expect(saved.recordedAt).toBe(start + 300 * minute);
    expect(sensorWarmupWindow(saved)).toEqual({ start, end: start + 60 * minute });
    const draft = manualContextDraftFromEvent(saved);
    expect(draft).toMatchObject({ sensorModelId: 'libre-2', sensorWarmupMinutes: 60 });
    const revised = reviseManualContextEvent(saved, { ...draft, timestamp: start - minute });
    expect(revised).toMatchObject({ id: saved.id, start: start - minute, end: start + 59 * minute });
  });
  it('shows an expected warm-up only until its end, then waits without extending it', () => {
    expect(sensorChangePresentation(event(), start + minute)).toMatchObject({ title: 'FreeStyle Libre 2 warming up', warmingUp: true });
    expect(sensorChangePresentation(event(), start + 60 * minute)).toMatchObject({ title: 'Waiting for readings', warmingUp: false });
  });
  it('explains only matching-source gaps within the window, retaining outside gaps and readings', () => {
    const timeline = data();
    const before = structuredClone(timeline);
    const evidence = sensorWarmupEvidence(timeline);
    expect(evidence.summary).toContain('consistent with the expected 60-minute warm-up');
    expect(evidence.summary).toContain('outside these windows remains unexplained');
    expect(evidence.recordIds).toEqual(['sensor']);
    expect(timeline).toEqual(before);
    expect(sensorWarmupEvidence(data({ ...event(), sensorGlucoseSourceId: 'different-cgm' })).summary).toBe('');
    expect(sensorWarmupEvidence(data(event('other'))).summary).toBe('');
    expect(sensorWarmupEvidence(data({ ...event(), sensorStarted: undefined })).summary).toBe('');
  });
  it('does not claim a gap when actual readings cover the expected warm-up', () => {
    const timeline = data();
    timeline.range = { start, end: start + 60 * minute };
    timeline.glucose = Array.from({ length: 12 }, (_, i) => ({ ...timeline.glucose[0]!, id: `r${i}`, timestamp: start + i * 5 * minute }));
    expect(sensorWarmupEvidence(timeline).summary).toBe('');
  });
  it('recognises a backdated warm-up overlapping the start of the requested period', () => {
    const timeline = data();
    timeline.range = { start: start + 30 * minute, end: start + 90 * minute };
    expect(sensorWarmupEvidence(timeline).recordIds).toEqual(['sensor']);
  });
});
