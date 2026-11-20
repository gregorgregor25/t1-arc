import { describe, expect, it } from 'vitest';

import { containsTreatmentDirective } from '@/data/tarvis/guardrails';
import { coordinateTarvisRequest } from '@/data/tarvis/requestCoordinator';
import { buildTarvisShortAnswer } from '@/data/tarvis/shortAnswer';
import {
  buildTherapyStateAnswer,
  parseTherapyStateQuestion,
  type TherapyStateQuery,
} from '@/data/tarvis/therapyStateEvidence';
import type { TimelineData, TimeRange } from '@/domain/models';
import type { TherapyStateInterval } from '@/domain/therapyStates';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

// Synthetic records only.
function timeline(range: TimeRange, therapyStates: TherapyStateInterval[]): TimelineData {
  return { range, glucose: [], basal: [], boluses: [], dailyInsulinTotals: [], pumpStates: [], context: [], sources: [], therapyStates };
}

function state(partial: Partial<TherapyStateInterval> & Pick<TherapyStateInterval, 'start' | 'end'>): TherapyStateInterval {
  const id = partial.id ?? `raw-${partial.start}`;
  return {
    id: `therapy-state:${id}`,
    kind: 'temporary-target',
    endBasis: 'programmed',
    baseline: false,
    source: { rawRecordId: id, sourceId: 'nightscout', sourceFile: 'treatments.json' },
    duplicateSources: [],
    ...partial,
  };
}

describe('therapy-state list questions', () => {
  it.each([
    ['Did I use any temp targets in the past week?', { family: 'temporary-target', reason: undefined, mode: 'list' }],
    ['Any activity temp targets yesterday?', { family: 'temporary-target', reason: 'activity', mode: 'list' }],
    ['Were there any profile switches in the last 3 days?', { family: 'profile-switch', mode: 'list' }],
    ['Was my pump suspended yesterday?', { family: 'loop-mode', group: 'suspended', mode: 'list' }],
    ['Show my temp targets this week', { family: 'temporary-target', reason: undefined, mode: 'list' }],
  ])('lists records for "%s"', (question, expected) => {
    expect(parseTherapyStateQuestion(question)).toEqual(expected);
  });

  it('keeps glucose questions on the comparison answer', () => {
    expect(parseTherapyStateQuestion('How did my glucose go during my Activity temp target yesterday?')).toEqual({
      family: 'temporary-target',
      reason: 'activity',
    });
    expect(parseTherapyStateQuestion('Any lows during my temp targets this week?')?.mode).toBeUndefined();
  });

  it('marks a question about the most recent state as latest, and keeps periods and counts as they were', () => {
    expect(parseTherapyStateQuestion('What was my glucose during my last temporary target?')).toEqual({
      family: 'temporary-target', reason: undefined, latest: true,
    });
    expect(parseTherapyStateQuestion('When was my most recent activity temp target?')).toEqual({
      family: 'temporary-target', reason: 'activity', mode: 'list', latest: true,
    });
    expect(parseTherapyStateQuestion('When did I last use a temp target?')?.latest).toBe(true);
    expect(parseTherapyStateQuestion('When was the last time I used a temp target?')?.latest).toBe(true);
    expect(parseTherapyStateQuestion('How did my glucose go during my last activity mode?')).toEqual({
      family: 'temporary-target', reason: 'activity', latest: true,
    });
    expect(parseTherapyStateQuestion('How was my glucose during my temp targets last week?')?.latest).toBeUndefined();
    // Phone keyboards autocorrect "my last temporary target" to "targets".
    expect(parseTherapyStateQuestion('What was my glucose during my last temporary targets?')).toEqual({
      family: 'temporary-target', reason: undefined, latest: true,
    });
    expect(parseTherapyStateQuestion('Were there any profile switches in the last 3 days?')?.latest).toBeUndefined();
    expect(parseTherapyStateQuestion('Show my last 3 temp targets')?.latest).toBeUndefined();
    expect(parseTherapyStateQuestion('Show my last few temp targets')?.latest).toBeUndefined();
    expect(parseTherapyStateQuestion('Any temp targets in the last 3 days?')?.latest).toBeUndefined();
  });

  it.each([
    'What was my glucose during my last temporary target?',
    'What was my glucose during my last temporary targets?',
    'When did I last use a temp target?',
  ])('reads "%s" as a record, not as last week', (question) => {
    const asOf = Date.parse('2030-11-19T15:00:00Z');
    const plan = coordinateTarvisRequest({ question, asOf });
    expect(plan.kind).toBe('therapy-state');
    if (plan.kind === 'therapy-state') {
      expect(plan.query.latest).toBe(true);
      expect(plan.range.end).toBe(asOf);
      expect(plan.range.end - plan.range.start).toBeGreaterThan(28 * DAY);
    }
  });

  it('keeps an explicit period alongside "my last"', () => {
    const asOf = Date.parse('2030-11-19T15:00:00Z');
    const plan = coordinateTarvisRequest({ question: 'What was my glucose during my last temp target yesterday?', asOf });
    expect(plan.kind).toBe('therapy-state');
    if (plan.kind === 'therapy-state') {
      expect(plan.query.latest).toBe(true);
      expect(plan.range.end - plan.range.start).toBeLessThanOrEqual(DAY);
    }
  });

  it('does not claim setting requests', () => {
    expect(parseTherapyStateQuestion('What percentage should I use?')).toBeUndefined();
    expect(parseTherapyStateQuestion('Should I set any temp target tonight?')).toBeUndefined();
  });

  it('routes a list question to the local therapy-state answer for the asked period', () => {
    const asOf = Date.parse('2030-11-19T15:00:00Z');
    const plan = coordinateTarvisRequest({ question: 'Did I use any temp targets in the past week?', asOf });
    expect(plan.kind).toBe('therapy-state');
    if (plan.kind === 'therapy-state') {
      expect(plan.query.mode).toBe('list');
      expect(plan.range.end).toBe(asOf);
      expect(plan.range.start).toBe(Date.parse('2030-11-13T00:00:00Z'));
    }
  });
});

describe('therapy-state list answers', () => {
  const asOf = Date.parse('2030-11-19T15:00:00Z');
  const range = { start: Date.parse('2030-11-16T00:00:00Z'), end: asOf };
  const loaded = { start: asOf - 30 * DAY, end: asOf };

  it('lists each record with time, setting, length and how it ended, and no glucose text', () => {
    const query: TherapyStateQuery = { family: 'temporary-target', mode: 'list' };
    const data = timeline(loaded, [
      state({ id: 'tt-1', targetReason: 'activity', targetLowMmolL: 8, targetHighMmolL: 8, start: Date.parse('2030-11-17T17:00:00Z'), end: Date.parse('2030-11-17T18:00:00Z'), programmedDurationMs: HOUR }),
      state({ id: 'tt-2', targetReason: 'eating-soon', targetLowMmolL: 4.5, targetHighMmolL: 4.5, start: Date.parse('2030-11-18T11:30:00Z'), end: Date.parse('2030-11-18T11:50:00Z'), endBasis: 'cancelled', programmedDurationMs: HOUR }),
      // Still running: programmed end is after now.
      state({ id: 'tt-3', targetReason: 'activity', targetLowMmolL: 8, targetHighMmolL: 8, start: asOf - 30 * MINUTE, end: asOf + 30 * MINUTE, programmedDurationMs: HOUR }),
      // Outside the asked period.
      state({ id: 'tt-old', start: Date.parse('2030-11-04T10:00:00Z'), end: Date.parse('2030-11-04T11:00:00Z') }),
    ]);
    const { answer, evidence } = buildTherapyStateAnswer({ query, range, timeline: data, asOf });
    expect(answer.headline).toBe('Temporary targets, 16 Nov 2030 to 19 Nov 2030, through 15:00');
    expect(answer.answer).toContain('3 recorded in');
    expect(answer.answer).toContain('Sun 17 Nov 17:00: Activity temporary target (target 8.0 mmol/L) recorded, 1 h, ran for its programmed time');
    expect(answer.answer).toContain('Mon 18 Nov 11:30: Eating soon temporary target (target 4.5 mmol/L) recorded, 20 min, ended early by a later record');
    expect(answer.answer).toContain('programmed for 1 h; still active');
    expect(answer.answer).not.toMatch(/glucose|average|in range/i);
    expect(evidence).toHaveLength(1);
    expect(evidence[0]!.range).toEqual(range);
    expect(evidence[0]!.recordIds).toEqual(['tt-1', 'tt-2', 'tt-3']);
    for (const line of answer.answer.split('\n').filter((text) => !text.includes('Eating soon'))) {
      expect(containsTreatmentDirective(line)).toBe(false);
    }
  });

  it('describes sub-minute suspensions in seconds and permanent profile switches as until changed', () => {
    const suspend = state({
      id: 'suspend-1', kind: 'loop-mode', loopMode: 'suspended-by-pump', endBasis: 'cancelled',
      start: Date.parse('2030-11-18T03:00:00Z'), end: Date.parse('2030-11-18T03:00:02Z'),
    });
    const suspended = buildTherapyStateAnswer({
      query: { family: 'loop-mode', group: 'suspended', mode: 'list' },
      range, timeline: timeline(loaded, [suspend]), asOf,
    });
    expect(suspended.answer.answer).toContain('under 1 minute (about 2 seconds)');
    expect(suspended.answer.answer).not.toContain('0 min');
    expect(containsTreatmentDirective(suspended.answer.answer)).toBe(false);

    const profiles = timeline(loaded, [
      state({ id: 'p-base', kind: 'profile-switch', baseline: true, percentage: 100, endBasis: 'next-record', start: loaded.start, end: Date.parse('2030-11-17T08:00:00Z') }),
      state({ id: 'p-80', kind: 'profile-switch', percentage: 80, profileName: 'Default', programmedDurationMs: 2 * HOUR, start: Date.parse('2030-11-17T08:00:00Z'), end: Date.parse('2030-11-17T10:00:00Z') }),
      state({ id: 'p-90', kind: 'profile-switch', percentage: 90, profileName: 'Default', endBasis: 'open', start: Date.parse('2030-11-18T09:00:00Z'), end: asOf + DAY }),
    ]);
    const listed = buildTherapyStateAnswer({ query: { family: 'profile-switch', mode: 'list' }, range, timeline: profiles, asOf });
    expect(listed.answer.answer).toContain('Profile at 80% (profile "Default") recorded, 2 h, ran for its programmed time');
    expect(listed.answer.answer).toContain('Profile at 90% (profile "Default") recorded, until changed; still active');
    expect(containsTreatmentDirective(listed.answer.answer)).toBe(false);
    expect(listed.answer.answer).toContain('usual 100% profile');
    expect(listed.answer.answer).not.toMatch(/Profile switch,/);
  });

  it('totals the time within the period, counting overlapping records once', () => {
    const suspensions = timeline(loaded, [
      // Starts before the period: only the hour inside it counts.
      state({ id: 's-early', kind: 'loop-mode', loopMode: 'suspended-by-user', endBasis: 'cancelled', start: range.start - HOUR, end: range.start + HOUR }),
      // Two records of the same 30 minutes, e.g. from two sources.
      state({ id: 's-a', kind: 'loop-mode', loopMode: 'suspended-by-user', endBasis: 'cancelled', start: Date.parse('2030-11-18T03:00:00Z'), end: Date.parse('2030-11-18T03:30:00Z') }),
      state({ id: 's-b', kind: 'loop-mode', loopMode: 'suspended-by-pump', endBasis: 'cancelled', start: Date.parse('2030-11-18T03:10:00Z'), end: Date.parse('2030-11-18T03:30:00Z') }),
    ]);
    const { answer } = buildTherapyStateAnswer({
      query: { family: 'loop-mode', group: 'suspended', mode: 'list' }, range, timeline: suspensions, asOf,
    });
    expect(answer.answer.split('\n')[0]).toBe('3 recorded in 16 Nov 2030 to 19 Nov 2030, through 15:00, 1 h 30 min in total:');
  });

  it('describes only the most recent record when the question names one', () => {
    const data = timeline(loaded, [
      state({ id: 'tt-1', targetReason: 'activity', targetLowMmolL: 8, targetHighMmolL: 8, start: Date.parse('2030-11-17T17:00:00Z'), end: Date.parse('2030-11-17T18:00:00Z'), programmedDurationMs: HOUR }),
      state({ id: 'tt-2', targetReason: 'eating-soon', targetLowMmolL: 4.5, targetHighMmolL: 4.5, start: Date.parse('2030-11-18T11:30:00Z'), end: Date.parse('2030-11-18T12:30:00Z'), programmedDurationMs: HOUR }),
    ]);
    const listed = buildTherapyStateAnswer({ query: { family: 'temporary-target', mode: 'list', latest: true }, range, timeline: data, asOf });
    const lines = listed.answer.answer.split('\n');
    expect(lines[0]).toBe('The most recent of 2 recorded in 16 Nov 2030 to 19 Nov 2030, through 15:00:');
    expect(lines.filter((line) => line.startsWith('• '))).toHaveLength(1);
    expect(listed.answer.answer).toContain('Mon 18 Nov 11:30: Eating soon temporary target');
    expect(listed.evidence[0]!.recordIds).toEqual(['tt-2']);

    // Glucose question: the result leads, the record follows, the label names it.
    const glucose = buildTherapyStateAnswer({ query: { family: 'temporary-target', latest: true }, range, timeline: data, asOf });
    const glucoseLines = glucose.answer.answer.split('\n');
    expect(glucose.answer.headline).toBe('Glucose during Eating soon temporary target (target 4.5 mmol/L), Mon 18 Nov 11:30–12:30');
    expect(glucoseLines[0]).toBe('Glucose readings covered 0% of that time, so T1 Arc is not summarising glucose during it.');
    expect(glucoseLines[1]).toBe(
      'The most recent of 2 temporary targets AAPS recorded in the requested period (16 Nov 2030 to 19 Nov 2030, through 15:00): Eating soon temporary target (target 4.5 mmol/L), recorded Mon 18 Nov 11:30–12:30.',
    );
    expect(glucose.answer.answer).not.toContain('17 Nov');
    expect(glucose.answer.answer).not.toContain('• ');
    expect(glucose.evidence[0]!.recordIds).toEqual(['tt-2']);

    // One record in the period: no "most recent of 1".
    const single = timeline(loaded, [data.therapyStates![1]!]);
    const one = buildTherapyStateAnswer({ query: { family: 'temporary-target', mode: 'list', latest: true }, range, timeline: single, asOf });
    expect(one.answer.answer.split('\n')[0]).toBe('1 recorded in 16 Nov 2030 to 19 Nov 2030, through 15:00, 1 h in total:');
    const oneGlucose = buildTherapyStateAnswer({ query: { family: 'temporary-target', latest: true }, range, timeline: single, asOf });
    expect(oneGlucose.answer.answer.split('\n')[1]).toMatch(/^AAPS recorded only this one in the requested period \(.*\): Eating soon temporary target/);
    expect(oneGlucose.answer.answer).not.toMatch(/most recent of|glucose during these periods/);
  });

  it('keeps the glucose result for one record on the card, not under Details', () => {
    const target = state({
      id: 'tt-1', targetReason: 'activity', targetLowMmolL: 8, targetHighMmolL: 8,
      start: Date.parse('2030-11-18T10:00:00Z'), end: Date.parse('2030-11-18T11:00:00Z'), programmedDurationMs: HOUR,
    });
    const glucose = Array.from({ length: (loaded.end - loaded.start) / (5 * MINUTE) }, (_, index) => {
      const at = loaded.start + index * 5 * MINUTE;
      return { id: `g-${at}`, sourceId: 'synthetic-cgm', timestamp: at, receivedAt: at, mmolL: 7, trend: 'unknown' as const, quality: 'measured' as const };
    });
    const { answer } = buildTherapyStateAnswer({
      query: { family: 'temporary-target', latest: true }, range, timeline: { ...timeline(loaded, [target]), glucose }, asOf,
    });
    const card = buildTarvisShortAnswer({
      answer, asOf, answerSource: 'local', modelRequestSent: false,
      settings: { locale: 'en-GB', timeZone: 'UTC', glucoseUnit: 'mmolL' },
    });
    expect(card.label).toBe('Glucose during Activity temporary target (target 8.0 mmol/L), Mon 18 Nov 10:00–11:00');
    expect(card.headline).toMatch(/^While it was active, glucose averaged 7\.0 mmol\/L; 100% of the observed time was /);
    expect(card.listItems).toEqual([]);
    expect(card.detailText.join(' ')).toContain('AAPS recorded only this one');
    expect(card.detailText.join(' ')).toContain('This is an observation from recorded data.');
  });

  it('keeps the full list when a plural asks for several', () => {
    expect(parseTherapyStateQuestion('Show all my last temp targets')?.latest).toBeUndefined();
    expect(parseTherapyStateQuestion('Compare my glucose during my last temp targets')?.latest).toBeUndefined();
    expect(parseTherapyStateQuestion('Compare my glucose during my last temp target with other days')?.latest).toBe(true);
  });

  it('says when a listed total includes a record with no recorded end', () => {
    const open = state({
      id: 's-open', kind: 'loop-mode', loopMode: 'suspended-by-user', endBasis: 'open',
      start: Date.parse('2030-11-19T12:00:00Z'), end: asOf + DAY,
    });
    const { answer } = buildTherapyStateAnswer({
      query: { family: 'loop-mode', group: 'suspended', mode: 'list' }, range, timeline: timeline(loaded, [open]), asOf,
    });
    expect(answer.answer.split('\n')[0]).toContain('3 h in total');
    expect(answer.answer).toContain('It had no recorded end');
  });

  it('marks a record that started before the period', () => {
    const early = state({ id: 'tt-early', start: range.start - HOUR, end: range.start + HOUR });
    const { answer } = buildTherapyStateAnswer({
      query: { family: 'temporary-target', mode: 'list' }, range, timeline: timeline(loaded, [early]), asOf,
    });
    expect(answer.answer).toContain('(started before this period)');
  });

  it('says nothing is recorded, and where stored records start, without a count of zero', () => {
    const later = state({ id: 'tt-later', kind: 'profile-switch', percentage: 80, programmedDurationMs: HOUR, start: Date.parse('2030-11-18T08:00:00Z'), end: Date.parse('2030-11-18T09:00:00Z') });
    const { answer } = buildTherapyStateAnswer({
      query: { family: 'temporary-target', mode: 'list' }, range, timeline: timeline(loaded, [later]), asOf,
    });
    expect(answer.headline).toMatch(/^Temporary targets/);
    expect(answer.answer).toContain('No temporary targets are recorded for');
    expect(answer.answer).toContain('start on Mon 18 Nov 08:00');
    expect(answer.answer).not.toMatch(/\b0\b/);

    const empty = buildTherapyStateAnswer({
      query: { family: 'temporary-target', mode: 'list' }, range, timeline: timeline(loaded, []), asOf,
    });
    expect(empty.answer.answer).toContain('no record either way');
  });

  it('stops at 20 lines and says how many more', () => {
    const many = Array.from({ length: 23 }, (_, index) =>
      state({ id: `tt-${index}`, start: range.start + index * 2 * HOUR, end: range.start + index * 2 * HOUR + HOUR, programmedDurationMs: HOUR }),
    );
    const { answer } = buildTherapyStateAnswer({
      query: { family: 'temporary-target', mode: 'list' }, range, timeline: timeline(loaded, many), asOf,
    });
    expect(answer.answer.split('\n').filter((line) => line.startsWith('• ') && !line.startsWith('• and'))).toHaveLength(20);
    expect(answer.answer).toContain('and 3 more, listed in the evidence.');
  });
});
