import { afterEach, describe, expect, it, vi } from 'vitest';

import { normalizeNightscoutTreatments } from '@/data/nightscout/NightscoutTreatmentImporter';
import { contextNoteDisplayDetail } from '@/domain/contextNotes';
import { buildContextEventEvidence } from '@/domain/insights';
import { MG_DL_PER_MMOL_L, type ContextNoteEvent, type TimelineData } from '@/domain/models';
import { DEFAULT_REGIONAL_PROFILE } from '@/domain/regionalProfile';
import { setRuntimeRegionalProfile } from '@/domain/regionalProfileRuntime';
import { therapyStateEventFromTreatment } from '@/domain/therapyStates';
import { formatTherapyTarget } from '@/domain/therapyStatePresentation';

vi.mock('expo-crypto', () => ({
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  digestStringAsync: vi.fn(async () => '0'.repeat(64)),
}));

const mmol = { locale: 'en-GB', glucoseUnit: 'mmolL' as const };
const mgdl = { locale: 'en-US', glucoseUnit: 'mgDl' as const };
const time = Date.parse('2030-01-03T12:00:00Z');

function note(detail: string, sourceId = 'nightscout'): ContextNoteEvent {
  return { id: 'target', sourceId, origin: 'imported', kind: 'note',
    title: 'Temporary Target', category: 'pump', start: time, detail };
}

afterEach(() => setRuntimeRegionalProfile({ ...DEFAULT_REGIONAL_PROFILE }));

describe('temporary target presentation', () => {
  it('reformats an older stored target after switching units without changing its source text', () => {
    const event = note('Activity · target 144.144 mg/dl as recorded · Original source note');
    expect(contextNoteDisplayDetail(event, mmol)).toBe('Activity · recorded target 8.0 mmol/L · Original source note');
    expect(contextNoteDisplayDetail(event, mgdl)).toBe('Activity · recorded target 144 mg/dL · Original source note');
    expect(event.detail).toBe('Activity · target 144.144 mg/dl as recorded · Original source note');
  });

  it.each(['nightscout', 'aaps-local'])('formats imported ranges in both units and a decimal-comma locale from %s', (source) => {
    const event = note('Custom · target 6.333333 to 8.444444 mmol/L as recorded', source);
    expect(contextNoteDisplayDetail(event, mmol)).toBe('Custom · recorded target 6.3–8.4 mmol/L');
    expect(contextNoteDisplayDetail(event, mgdl)).toBe('Custom · recorded target 114–152 mg/dL');
    expect(contextNoteDisplayDetail(event, { ...mmol, locale: 'de-DE' })).toBe('Custom · recorded target 6,3–8,4 mmol/L');
  });

  it('leaves handwritten, unrecognised and malformed source details intact', () => {
    const detail = 'target 144.144 mg/dL as recorded';
    expect(contextNoteDisplayDetail({ ...note(detail), origin: 'manual' }, mmol)).toBe(detail);
    expect(contextNoteDisplayDetail(note(detail, 'other-source'), mmol)).toBe(detail);
    expect(contextNoteDisplayDetail({ ...note(detail), title: 'Other note' }, mmol)).toBe(detail);
    for (const part of ['target 144 as recorded', 'My recorded target 144 mg/dL']) {
      expect(contextNoteDisplayDetail(note(part), mmol)).toBe(part);
    }
  });

  it('withholds invalid old target values without guessing their original unit', () => {
    expect(contextNoteDisplayDetail(note('target 8.3333 mg/dL as recorded', 'aaps-local'), mmol)).toBe('target value unavailable');
    expect(contextNoteDisplayDetail(note('target 8 to 6 mmol/L as recorded'), mmol)).toBe('target value unavailable');
    const old = note('Activity · target 144.144 g as recorded');
    expect(contextNoteDisplayDetail(old, mmol)).toBe('Activity · target value unavailable');
    expect(old.detail).toContain('144.144 g as recorded');
  });

  it('withholds a target when the incoming unit field has an invalid type', () => {
    const treatment = { date: time, eventType: 'Temporary Target', targetBottom: 144, targetTop: 144, units: 42 };
    const raw = JSON.parse(JSON.stringify(treatment));
    const imported = normalizeNightscoutTreatments([raw], [], time);
    expect(contextNoteDisplayDetail(imported.context[0] as ContextNoteEvent, mmol)).toBe('target value unavailable');
    const typed = therapyStateEventFromTreatment(treatment, { sourceId: 'nightscout', sourceFile: 'synthetic.json', rawRecordId: 'raw-target' });
    expect(typed?.targetLowMmolL).toBeUndefined();
    expect(typed?.isEnd).toBe(false);
  });

  it.each([
    ['nightscout', undefined, 144.144, 'recorded target 8.0 mmol/L', 144.144 / MG_DL_PER_MMOL_L],
    ['aaps-local', 'mmol', 8, 'recorded target 8.0 mmol/L', 8],
    ['aaps-local', 'MMOL/L', 8, 'recorded target 8.0 mmol/L', 8],
    ['aaps-local', 'mg/dL', 144.144, 'recorded target 8.0 mmol/L', 144.144 / MG_DL_PER_MMOL_L],
    ['aaps-local', undefined, 8, 'target value unavailable', undefined],
    ['aaps-local', 'unknown', 8, 'target value unavailable', undefined],
    ['nightscout', 'unknown', 144.144, 'target value unavailable', undefined],
  ] as const)('uses the same source unit rules for imported details and typed states (%s, %s)', (sourceId, units, target, expected, canonical) => {
    const treatment = { _id: 'target', eventType: 'Temporary Target', date: time,
      targetBottom: target, targetTop: target, units, duration: 45 };
    const imported = normalizeNightscoutTreatments([treatment], [], time,
      { sourceId, sourceFile: 'synthetic.json', rawRecordKind: 'test-treatment' });
    const event = imported.context[0] as ContextNoteEvent;
    expect(contextNoteDisplayDetail(event, mmol)).toBe(expected);
    const typed = therapyStateEventFromTreatment(treatment,
      { sourceId, sourceFile: 'synthetic.json', rawRecordId: 'raw-target' });
    expect(typed?.targetLowMmolL).toBe(canonical);
    expect(typed?.isEnd).toBe(false);
  });

  it('handles the local AAPS mmol unit and collapses ranges that round to the same label', () => {
    const event = note('Activity · target 8.0000001 to 8.0000002 mmol as recorded', 'aaps-local');
    expect(contextNoteDisplayDetail(event, mmol)).toBe('Activity · recorded target 8.0 mmol/L');
    expect(contextNoteDisplayDetail(event, mgdl)).toBe('Activity · recorded target 144 mg/dL');
    expect(contextNoteDisplayDetail(note('target 8.33333 MMOL/L as recorded', 'aaps-local'), mmol)).toBe('recorded target 8.3 mmol/L');
  });

  it.each([
    [6.349, 6.349, '6.3 mmol/L'],
    [6.349, undefined, '6.3 mmol/L'],
    [undefined, 6.349, '6.3 mmol/L'],
    [8, 6, undefined],
    [8, 26, undefined],
    [1, 8, undefined],
    [8, 'malformed', undefined],
    ['', 8, undefined],
  ] as const)('agrees across typed and note views for supplied endpoints %s, %s', (bottom, top, expected) => {
    const treatment = {
      _id: 'bounds', eventType: 'Temporary Target', date: time,
      targetBottom: bottom, targetTop: top, units: 'mmol', duration: 45,
      reason: 'Activity',
    };
    const origin = { sourceId: 'aaps-local', sourceFile: 'synthetic.json', rawRecordKind: 'test-treatment' };
    const imported = normalizeNightscoutTreatments([treatment], [], time, origin);
    const typed = therapyStateEventFromTreatment(treatment, { ...origin, rawRecordId: 'raw-bounds' })!;
    expect(typed.start).toBe(time);
    expect(typed.reasonText).toBe('Activity');
    expect(typed.isEnd).toBe(false);
    expect(formatTherapyTarget(typed, mmol)).toBe(expected);
    expect(contextNoteDisplayDetail(imported.context[0] as ContextNoteEvent, mmol)).toBe(
      expected ? `Activity · recorded target ${expected}` : 'Activity · target value unavailable',
    );
    if (expected) expect(typed.targetLowMmolL).toBe(6.349);
    else {
      expect(typed.targetLowMmolL).toBeUndefined();
      expect(typed.targetHighMmolL).toBeUndefined();
    }
    expect(imported.rawRecords[0]!.payloadJson).toBe(JSON.stringify(treatment));
  });

  it('uses the current unit in inspection evidence from a freshly imported target and retains the raw value', () => {
    setRuntimeRegionalProfile({ ...DEFAULT_REGIONAL_PROFILE, glucoseUnit: 'mmolL' });
    const record = { _id: 'target', eventType: 'Temporary Target',
      created_at: new Date(time).toISOString(), reason: 'Activity',
      targetBottom: 144.144, targetTop: 144.144, duration: 45 };
    const imported = normalizeNightscoutTreatments([record], [], time);
    const event = imported.context[0] as ContextNoteEvent;
    const data: TimelineData = { range: { start: time - 60_000, end: time + 3_600_000 },
      glucose: [], basal: [], boluses: [], context: imported.context, sources: [] };
    expect(buildContextEventEvidence(event, data).examples[0]?.secondary).toContain('recorded target 8.0 mmol/L');
    expect(event.detail).toContain('144.144 mg/dL');
    expect(JSON.parse(imported.rawRecords[0]!.payloadJson)).toMatchObject({ targetBottom: 144.144, targetTop: 144.144 });
  });
});
