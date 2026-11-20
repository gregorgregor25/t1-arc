import { describe, expect, it } from 'vitest';

import {
  evidenceInspectorRecordPresentation,
  referencedHealthRecordsForView,
} from '@/components/evidenceResolutionPresentation';
import type { DailyMetricRecord } from '@/domain/dailyHealthMetrics';
import { buildContextEventEvidence, type EvidenceReference } from '@/domain/insights';
import type { ContextNoteEvent, TimelineData, WeightEvent } from '@/domain/models';

const at = Date.parse('2026-10-20T10:00:00+01:00');
const note: ContextNoteEvent = {
  id: 'target-note', kind: 'note', category: 'pump', title: 'Temporary Target',
  start: at, sourceId: 'nightscout', origin: 'imported',
};
const weight: WeightEvent = {
  id: 'weight-source-a', kind: 'weight', kilograms: 73.2, title: 'Weight',
  start: at - 30 * 60_000, sourceId: 'health-connect', origin: 'imported',
};
const secondWeight = { ...weight, id: 'weight-source-b' };
const meal = {
  ...note, id: 'nearby-note', category: 'other' as const, title: 'Logged context',
};
const timeline: TimelineData = {
  range: { start: at - 60 * 60_000, end: at + 4 * 60 * 60_000 },
  glucose: [{
    id: 'glucose-a', timestamp: at, receivedAt: at, mmolL: 6.4,
    quality: 'measured', trend: 'unknown', sourceId: 'cgm',
  }],
  basal: [], boluses: [], sources: [], context: [note, weight, secondWeight, meal],
};

describe('records around a selected event', () => {
  it('leaves incidental weights out of a new target window and its counts', () => {
    const evidence = buildContextEventEvidence(note, timeline);
    expect(evidence.recordIds).toEqual(['target-note', 'glucose-a', 'nearby-note']);
    expect(evidence.description).toContain('1 other context record in the loaded time window');
    expect(evidence.examples.some(row => row.id.startsWith('weight-'))).toBe(false);
    // General History and its All records list retain the original source rows.
    expect(timeline.context).toEqual([note, weight, secondWeight, meal]);
  });

  it('preserves weight records when the person explicitly inspects weight', () => {
    const evidence = buildContextEventEvidence(weight, timeline);
    expect(evidence.recordIds[0]).toBe(weight.id);
    expect(evidence.recordIds).toContain(secondWeight.id);
    expect(evidence.examples[0]).toMatchObject({ id: weight.id, sourceId: weight.sourceId });
    expect(evidenceInspectorRecordPresentation(evidence, 'visual', 'weight').includeWeightRecords).toBe(true);
  });

  it('retains a legacy manifest while keeping incidental health rows in All records', () => {
    const saved: EvidenceReference = {
      ...buildContextEventEvidence(note, timeline),
      recordIds: [note.id, 'glucose-a', weight.id, secondWeight.id],
    };
    const before = structuredClone(saved);
    const visual = evidenceInspectorRecordPresentation(saved, 'visual', 'note');
    expect(visual.includeWeightRecords).toBe(false);
    expect(visual.heading).toBe('RECORDS AROUND THIS EVENT');
    expect(visual.totalLabel).toBe('IN WINDOW');
    expect(visual.resolvedLabel).toBe('LOADED');
    expect(evidenceInspectorRecordPresentation(saved, 'records', 'note').includeWeightRecords).toBe(true);
    expect(saved).toEqual(before);
  });

  it('keeps explicit health and association evidence visible', () => {
    const evidence = {
      ...buildContextEventEvidence(weight, timeline), id: 'weight-glucose-association',
    };
    expect(evidenceInspectorRecordPresentation(evidence, 'visual')).toMatchObject({
      includeWeightRecords: true, totalLabel: 'USED',
    });
  });

  it('hides only incidental weights from a legacy glucose chart, including on reopening', () => {
    const evidence = {
      ...buildContextEventEvidence(note, timeline),
      recordIds: [note.id, 'glucose-a', weight.id],
    };
    const measured: DailyMetricRecord = {
      id: 'glucose-a', kind: 'blood_glucose', value: 6.4, unit: 'mmol/L',
      start: at, end: at, sourcePackage: 'test-meter', sourceLabel: 'Test meter',
    };
    const measuredWeight: DailyMetricRecord = {
      ...measured, id: weight.id, kind: 'weight', value: weight.kilograms, unit: 'kg',
    };
    const rows = [measured, measuredWeight, { ...measured, id: 'unreferenced' }];
    function recordsIn(view: 'records' | 'visual') {
      const { includeWeightRecords } = evidenceInspectorRecordPresentation(evidence, view, 'note');
      return referencedHealthRecordsForView(rows, evidence.recordIds, includeWeightRecords);
    }
    expect(recordsIn('visual')).toEqual([measured]);
    expect(recordsIn('records')).toEqual([measured, measuredWeight]);
  });
});
