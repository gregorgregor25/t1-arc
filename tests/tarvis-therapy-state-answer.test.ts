import { describe, expect, it } from 'vitest';

import { containsTreatmentDirective } from '@/data/tarvis/guardrails';
import { loadPlannedGlucoseEpisodeEvidence } from '@/data/tarvis/plannedGlucoseEpisodeEvidence';
import { coordinateTarvisRequest } from '@/data/tarvis/requestCoordinator';
import {
  buildTherapyStateAnswer,
  parseTherapyStateQuestion,
  rangeForTherapyStateQuestion,
  therapyStateEpisodeFinding,
  therapyStateLoadRange,
  type TherapyStateQuery,
} from '@/data/tarvis/therapyStateEvidence';
import type { GlucoseReading, TimelineData, TimeRange } from '@/domain/models';
import type { TherapyStateInterval } from '@/domain/therapyStates';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function reading(timestamp: number, mmolL: number, id = `g:${timestamp}`): GlucoseReading {
  return { id, timestamp, receivedAt: timestamp, mmolL, trend: 'unknown', quality: 'measured', sourceId: 'libre' };
}

function readings(range: TimeRange, valueAt: (timestamp: number) => number | undefined) {
  const result: GlucoseReading[] = [];
  for (let timestamp = range.start; timestamp < range.end; timestamp += 5 * MINUTE) {
    const value = valueAt(timestamp);
    if (value !== undefined) result.push(reading(timestamp, value));
  }
  return result;
}

function timeline(range: TimeRange, glucose: GlucoseReading[], therapyStates: TherapyStateInterval[]): TimelineData {
  return { range, glucose, basal: [], boluses: [], dailyInsulinTotals: [], pumpStates: [], context: [], sources: [], therapyStates };
}

function state(partial: Partial<TherapyStateInterval> & Pick<TherapyStateInterval, 'start' | 'end'>): TherapyStateInterval {
  const id = partial.id ?? `raw-${partial.start}`;
  return {
    id: `therapy-state:${id}`,
    kind: 'temporary-target',
    endBasis: 'programmed',
    baseline: false,
    targetReason: 'activity',
    targetLowMmolL: 7.8,
    targetHighMmolL: 7.8,
    source: { rawRecordId: id, sourceId: 'nightscout', sourceFile: 'treatments.json' },
    duplicateSources: [],
    ...partial,
  };
}

describe('Tarv1s therapy-state questions', () => {
  it.each([
    ['How did my glucose go during activity mode?', { family: 'temporary-target', reason: 'activity' }],
    ['How did my glucose go during my 80% profile last week?', { family: 'profile-switch', percentage: 80 }],
    ['What were my levels when the profile was at 80%?', { family: 'profile-switch', percentage: 80 }],
    ['What was my time in range during eating soon targets?', { family: 'temporary-target', reason: 'eating-soon' }],
    ['How were my readings while the loop was suspended?', { family: 'loop-mode', group: 'suspended' }],
    ['How did my glucose look during open loop?', { family: 'loop-mode', group: 'open-loop' }],
    ['When did I use temp targets this month?', { family: 'temporary-target', reason: undefined }],
  ])('recognises "%s"', (question, expected) => {
    expect(parseTherapyStateQuestion(question)).toEqual(expected);
  });

  it.each([
    'Should I use an 80% profile when I exercise?',
    'What temp target should I set for running?',
    'Is my activity target too low?',
    'Recommend a profile percentage for tomorrow',
    'Tell me about activity mode',
  ])('leaves "%s" to the safety and scope rules', (question) => {
    expect(parseTherapyStateQuestion(question)).toBeUndefined();
  });

  it('routes recorded-state questions to the local answer and setting requests elsewhere', () => {
    const asOf = Date.parse('2026-11-12T20:00:00Z');
    const routed = coordinateTarvisRequest({ question: 'How did my glucose go during my activity temp target yesterday?', asOf });
    expect(routed.kind).toBe('therapy-state');
    if (routed.kind === 'therapy-state') {
      expect(routed.range).toEqual({ start: Date.parse('2026-11-11T00:00:00Z'), end: Date.parse('2026-11-12T00:00:00Z') });
    }
    for (const question of ['Should I use an 80% profile when I exercise?', 'What temp target should I set for running?']) {
      expect(coordinateTarvisRequest({ question, asOf }).kind).not.toBe('therapy-state');
    }
  });

  it('uses the last 30 days without a time in the question and refuses future periods', () => {
    const asOf = Date.parse('2026-11-12T20:00:00Z');
    const bare = rangeForTherapyStateQuestion('How did my glucose go during activity mode?', asOf);
    expect('range' in bare && bare.range.end).toBe(asOf);
    expect('range' in bare && Math.round((bare.range.end - bare.range.start) / DAY)).toBe(30);
    expect(therapyStateLoadRange({ start: asOf - DAY, end: asOf }).start).toBe(asOf - 30 * DAY);
    expect('issue' in rangeForTherapyStateQuestion('How did my glucose go during activity mode next week?', asOf)).toBe(true);
  });
});

describe('Tarv1s therapy-state answers', () => {
  const asOf = Date.parse('2026-11-12T20:00:00Z');
  const loadRange = { start: Date.parse('2026-10-13T00:00:00Z'), end: asOf };
  const period = { start: Date.parse('2026-11-06T00:00:00Z'), end: asOf };
  const activityDays = ['2026-11-07', '2026-11-09', '2026-11-11'];
  const activityStates = activityDays.map((day) =>
    state({ id: `tt-${day}`, start: Date.parse(`${day}T17:00:00Z`), end: Date.parse(`${day}T18:30:00Z`) }),
  );
  const inState = (timestamp: number) => activityStates.some(({ start, end }) => timestamp >= start && timestamp < end);
  const query: TherapyStateQuery = { family: 'temporary-target', reason: 'activity' };

  it('lists the states, summarises glucose with coverage and compares matched times with the caveat', () => {
    const data = timeline(loadRange, readings(loadRange, (timestamp) => (inState(timestamp) ? 8 : 6)), [
      ...activityStates,
      // The ordinary closed loop is not something to describe.
      state({ id: 'closed', kind: 'loop-mode', loopMode: 'closed-loop', baseline: true, targetReason: undefined, start: loadRange.start, end: asOf }),
    ]);
    const { answer, evidence } = buildTherapyStateAnswer({ query, range: period, timeline: data, asOf });
    expect(answer.answer).toContain('AAPS recorded 3 Activity temporary targets in the requested period (6 Nov 2026 to 12 Nov 2026, through 20:00), 4 h 30 min in total:');
    expect(answer.answer).toContain('Activity temporary target (target 7.8 mmol/L), recorded Sat 7 Nov 17:00–18:30');
    expect(answer.answer).toContain('While they were active, glucose averaged 8.0 mmol/L');
    expect(answer.answer).toContain('Glucose coverage: 100% of 4 h 30 min.');
    expect(answer.answer).toMatch(/At the same clock times on \d+ other days with no temporary target recorded, glucose averaged 6\.0 mmol\/L/);
    expect(answer.answer).toContain('It does not show that the recorded setting made the difference.');
    expect(answer.confidence).toBe('moderate');
    expect(answer.answer).not.toMatch(/caused (?:your|the)/i);
    // Local answers use wording that also passes the model-answer directive check.
    expect(containsTreatmentDirective(answer.answer)).toBe(false);
    expect(containsTreatmentDirective(answer.limitations?.join(' ') ?? '')).toBe(false);
    expect(evidence.map(({ id }) => id)).toEqual([
      'therapy-state-intervals',
      'therapy-state-glucose-during',
      'therapy-state-glucose-matched',
    ]);
    expect(evidence[0]!.recordIds).toEqual(activityDays.map((day) => `tt-${day}`));
  });

  it('withholds the glucose summary when readings cover too little of the states', () => {
    const data = timeline(loadRange, readings(loadRange, (timestamp) => (inState(timestamp) ? undefined : 6)), activityStates);
    const { answer, evidence } = buildTherapyStateAnswer({ query, range: period, timeline: data, asOf });
    expect(answer.answer).toContain('Glucose readings covered 0% of that time, so T1 Arc is not summarising glucose');
    expect(answer.answer).not.toContain('glucose averaged');
    expect(answer.confidence).toBe('limited');
    expect(evidence.map(({ id }) => id)).toEqual(['therapy-state-intervals']);
  });

  it('withholds the comparison when too few matched windows have glucose data', () => {
    const data = timeline(loadRange, readings(loadRange, (timestamp) => (inState(timestamp) ? 8 : undefined)), activityStates);
    const { answer } = buildTherapyStateAnswer({ query, range: period, timeline: data, asOf });
    expect(answer.answer).toContain('glucose averaged 8.0 mmol/L');
    expect(answer.answer).toContain('so T1 Arc is not comparing them');
    expect(answer.answer).not.toContain('At the same clock times');
    expect(answer.answer).toContain('It does not show that the recorded setting made the difference.');
    expect(containsTreatmentDirective(answer.answer)).toBe(false);
  });

  it('says when no AAPS records were stored at all, and when only other states were', () => {
    const empty = buildTherapyStateAnswer({ query, range: period, timeline: timeline(loadRange, [], []), asOf });
    expect(empty.answer.answer).toContain('No AAPS temporary targets, profile switches or loop modes were stored');
    expect(containsTreatmentDirective(empty.answer.answer)).toBe(false);
    const other = buildTherapyStateAnswer({
      query: { family: 'profile-switch', percentage: 80 },
      range: period,
      timeline: timeline(loadRange, [], activityStates),
      asOf,
    });
    expect(other.answer.answer).toContain('No profile switches at 80% were recorded');
    expect(other.answer.answer).toContain('this does not prove none were used');
    expect(containsTreatmentDirective(other.answer.answer)).toBe(false);
  });

  it('notes states with no recorded end and phone-only sources', () => {
    const open = state({
      id: 'phone-tt',
      start: Date.parse('2026-11-12T17:00:00Z'),
      end: asOf,
      endBasis: 'open',
      source: { rawRecordId: 'phone-tt', sourceId: 'aaps-local', sourceFile: 'Received on this phone; sender not verified' },
    });
    const { answer } = buildTherapyStateAnswer({ query, range: period, timeline: timeline(loadRange, [], [open]), asOf });
    expect(answer.answer).toContain('had no recorded end');
    expect(containsTreatmentDirective(answer.answer)).toBe(false);
    expect(answer.limitations?.join(' ')).toContain('Android did not confirm the sender');
  });

  it('skips matched windows at a local time that did not exist on the spring clock change', () => {
    // 29 March 2026, Europe/London: 01:00 GMT jumps to 02:00 BST, so 01:30 does not exist.
    const range = { start: Date.parse('2026-03-26T00:00:00Z'), end: Date.parse('2026-04-02T23:00:00Z') };
    const springState = state({
      id: 'spring',
      start: Date.parse('2026-04-02T00:30:00Z'), // 01:30 BST
      end: Date.parse('2026-04-02T01:30:00Z'),
    });
    const data = timeline(range, readings(range, () => 6), [springState]);
    const { answer } = buildTherapyStateAnswer({
      query,
      range: { start: Date.parse('2026-04-01T23:00:00Z'), end: range.end },
      timeline: data,
      asOf: range.end,
    });
    // 26, 27, 28, 30, 31 March and 1 April; 29 March is skipped, not shifted.
    expect(answer.answer).toContain('At the same clock times on 6 other days');
  });
});

describe('Tarv1s therapy states in glucose episodes', () => {
  const day = { start: Date.parse('2026-11-10T00:00:00Z'), end: Date.parse('2026-11-11T00:00:00Z') };
  const previous = { start: day.start - DAY, end: day.start };
  const highStart = Date.parse('2026-11-10T18:00:00Z');
  const activity = state({ id: 'ns-activity', start: highStart - HOUR, end: highStart + 30 * MINUTE });
  const profile = state({
    id: 'ns-profile',
    kind: 'profile-switch',
    targetReason: undefined,
    targetLowMmolL: undefined,
    targetHighMmolL: undefined,
    percentage: 80,
    profileName: 'Default',
    start: highStart - 5 * HOUR,
    end: highStart - 3 * HOUR,
    duplicateSources: [{ rawRecordId: 'aaps-profile', sourceId: 'aaps-local', sourceFile: 'Received on this phone; sender confirmed' }],
  });
  const all = timeline(
    { start: previous.start, end: day.end },
    readings({ start: previous.start, end: day.end }, (timestamp) =>
      timestamp >= highStart && timestamp < highStart + 30 * MINUTE ? 13 : 6,
    ),
    [activity, profile],
  );

  it('names the recorded states with their timing relative to the episode and the caveat', () => {
    const finding = therapyStateEpisodeFinding('high', all, { start: highStart, end: highStart + 25 * MINUTE });
    expect(finding?.title).toBe('AAPS settings recorded as active during the episode');
    expect(finding?.summary).toContain('Activity temporary target (target 7.8 mmol/L), recorded 17:00–18:30');
    expect(finding?.summary).toContain('active throughout the episode');
    expect(finding?.summary).toContain('Profile at 80% (profile "Default"), recorded 13:00–15:00');
    expect(containsTreatmentDirective(finding?.summary ?? '')).toBe(false);
    expect(finding?.summary).toContain('ended 3 h before the episode began');
    expect(finding?.summary).toContain('Nightscout; also AAPS on this phone, sender confirmed');
    expect(finding?.caveat).toBe('Timing is context, not proof that the recorded setting caused the high.');
    expect(finding?.evidence[0]?.recordIds).toEqual(['ns-activity', 'ns-profile', 'aaps-profile']);
    expect(therapyStateEpisodeFinding('high', { ...all, therapyStates: [] }, day)).toBeUndefined();
  });

  it('puts the states into the episode evidence packet as a required finding', async () => {
    const lookup = await loadPlannedGlucoseEpisodeEvidence({
      selectedEventKind: 'high',
      currentRange: day,
      previousRange: previous,
      selectedCategories: ['glucose'],
      generatedAt: day.end + HOUR,
      loadTimelineData: async (range) => ({
        ...all,
        range,
        glucose: all.glucose.filter(({ timestamp }) => timestamp >= range.start && timestamp < range.end),
      }),
    });
    const finding = lookup.packet.findings.find(({ id }) => id === 'planned-high-therapy-states');
    expect(finding).toBeDefined();
    expect(lookup.packet.requiredFindingIds).toContain('planned-high-therapy-states');
    expect(lookup.references.get('planned-high-therapy-state-records')?.recordIds).toContain('ns-activity');
  });
});
