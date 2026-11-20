import { describe, expect, it, vi } from 'vitest';

import { serializeTarvisConversation, validateSerializedTarvisConversation } from '@/data/tarvis/conversationStore';
import { buildTherapyStateAnswer, type TherapyStateQuery } from '@/data/tarvis/therapyStateEvidence';
import type { GlucoseReading, TimelineData, TimeRange } from '@/domain/models';
import type { TherapyStateInterval } from '@/domain/therapyStates';

vi.mock('@/data/persistence/t1arcDatabase', () => ({}));
vi.mock('expo-sqlite', () => ({}));
vi.mock('expo-crypto', () => ({}));
vi.mock('expo-secure-store', () => ({}));

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const start = Date.parse('2030-01-10T10:00:00Z');
const query: TherapyStateQuery = { family: 'loop-mode', group: 'suspended' };

function suspension(
  id: string,
  kind: 'loop-mode' | 'pump-suspend',
  begin: number,
  end: number,
): TherapyStateInterval {
  return {
    id, kind, start: begin, end, baseline: false, endBasis: 'programmed',
    loopMode: kind === 'loop-mode' ? 'suspended-by-user' : undefined,
    source: { rawRecordId: `raw-${id}`, sourceId: 'nightscout', sourceFile: 'synthetic.json' },
    duplicateSources: [],
  };
}

function readings(range: TimeRange, valueAt: (at: number) => number, step = 5 * MINUTE): GlucoseReading[] {
  const result: GlucoseReading[] = [];
  for (let at = range.start; at < range.end; at += step) {
    result.push({
      id: `glucose-${at}`, sourceId: 'synthetic-cgm', timestamp: at, receivedAt: at,
      mmolL: valueAt(at), trend: 'unknown', quality: 'measured',
    });
  }
  return result;
}

function answerFor(states: TherapyStateInterval[], glucose: GlucoseReading[], loadRange: TimeRange, range: TimeRange, asOf = range.end) {
  const timeline: TimelineData = {
    range: loadRange, glucose, therapyStates: states, context: [], basal: [], boluses: [], sources: [],
  };
  return buildTherapyStateAnswer({ query, timeline, range, asOf });
}

describe('overlapping recorded pump and loop suspensions', () => {
  it('counts identical intervals once while retaining both source records', () => {
    const range = { start, end: start + HOUR };
    const states = [
      suspension('pump', 'pump-suspend', start, range.end),
      suspension('loop', 'loop-mode', start, range.end),
    ];
    const { answer, evidence } = answerFor(states, readings(range, () => 6), range, range);
    expect(answer.answer).toContain('AAPS recorded 2 loop or pump suspensions');
    expect(answer.answer).toContain('1 h in total');
    expect(answer.answer).toContain('Glucose coverage: 100% of 1 h.');
    expect(evidence[0]?.recordIds).toEqual(['raw-pump', 'raw-loop']);
    expect(evidence.find(({ id }) => id === 'therapy-state-glucose-during')?.recordIds)
      .toEqual(readings(range, () => 6).map(({ id }) => id));
  });

  it('pools a partial overlap once for duration, mean and time in range', () => {
    const range = { start, end: start + 90 * MINUTE };
    // Reverse time order deliberately; the original evidence retains its order.
    const states = [
      suspension('pump', 'pump-suspend', start + 30 * MINUTE, range.end),
      suspension('loop', 'loop-mode', start, start + HOUR),
    ];
    const before = structuredClone(states);
    const glucose = readings(range, (at) =>
      at < start + 30 * MINUTE ? 4 : at < start + HOUR ? 12 : 8,
    );
    const { answer, evidence } = answerFor(states, glucose, range, range);
    expect(answer.answer).toContain('1 h 30 min in total');
    expect(answer.answer).toContain('glucose averaged 8.0 mmol/L; 67%');
    expect(answer.answer).toContain('33% above');
    expect(evidence[0]?.recordIds).toEqual(['raw-pump', 'raw-loop']);
    expect(states).toEqual(before);
  });

  it('withholds a short glucose summary even when duplicated intervals exceed the observation minimum together', () => {
    const range = { start, end: start + 20 * MINUTE };
    const states = [
      suspension('pump', 'pump-suspend', start, range.end),
      suspension('loop', 'loop-mode', start, range.end),
    ];
    const { answer, evidence } = answerFor(states, readings(range, () => 6), range, range);
    expect(answer.answer).toContain('20 min in total');
    expect(answer.answer).toContain('not summarising glucose');
    expect(answer.answer).not.toContain('glucose averaged');
    expect(evidence.map(({ id }) => id)).toEqual(['therapy-state-intervals']);
  });

  it.each([
    ['overlapping', 60, 30],
    ['adjacent', 45, 45],
  ])('matches the full continuous %s period on other days', (_label, firstMinutes, nextMinutes) => {
    const range = { start, end: start + 90 * MINUTE };
    const loadRange = { start: start - 4 * DAY, end: range.end };
    const states = [
      suspension('loop', 'loop-mode', start, start + firstMinutes * MINUTE),
      suspension('pump', 'pump-suspend', start + nextMinutes * MINUTE, range.end),
    ];
    const glucose = readings(loadRange, (at) => {
      if (at >= start) return 8;
      const clockOffset = (at - loadRange.start) % DAY;
      return clockOffset >= HOUR && clockOffset < 90 * MINUTE ? 9 : 6;
    });
    const { answer } = answerFor(states, glucose, loadRange, range);
    expect(answer.answer).toContain('1 h 30 min in total');
    expect(answer.answer).toMatch(/same clock times on 4 other days[^\n]+glucose averaged 7\.0 mmol\/L/);
  });

  it('clips unioned time to the requested period and the answer time', () => {
    const range = { start, end: start + 3 * HOUR };
    const asOf = start + 90 * MINUTE;
    const states = [
      suspension('loop', 'loop-mode', start - HOUR, start + HOUR),
      suspension('pump', 'pump-suspend', start + 30 * MINUTE, range.end),
    ];
    const glucose = readings(range, (at) => at < asOf ? 6 : 18);
    const { answer, evidence } = answerFor(states, glucose, range, range, asOf);
    expect(answer.answer).toContain('1 h 30 min in total');
    expect(answer.answer).toContain('glucose averaged 6.0 mmol/L');
    const during = evidence.find(({ id }) => id === 'therapy-state-glucose-during');
    expect(during?.recordIds).toEqual(glucose.filter(({ timestamp }) => timestamp < asOf).map(({ id }) => id));
  });

  it('excludes gaps between separate periods and counts comparison days once', () => {
    const range = { start, end: start + 90 * MINUTE };
    const loadRange = { start: start - 4 * DAY, end: range.end };
    const states = [
      suspension('loop', 'loop-mode', start, start + 30 * MINUTE),
      suspension('pump', 'pump-suspend', start + HOUR, range.end),
    ];
    const glucose = readings(loadRange, (at) => {
      const offset = (at - loadRange.start) % DAY;
      return offset < 30 * MINUTE ? 6 : offset >= HOUR && offset < 90 * MINUTE ? 8 : 18;
    });
    const { answer, evidence } = answerFor(states, glucose, loadRange, range);
    expect(answer.answer).toContain('1 h in total');
    expect(answer.answer).toContain('glucose averaged 7.0 mmol/L');
    expect(answer.answer).toMatch(/same clock times on 4 other days[^\n]+glucose averaged 7\.0 mmol\/L/);
    expect(evidence.find(({ id }) => id === 'therapy-state-glucose-matched')?.description)
      .toContain('8 same-clock-time windows');
    expect(evidence.find(({ id }) => id === 'therapy-state-glucose-during')?.recordIds)
      .toEqual(glucose.filter(({ timestamp }) =>
        (timestamp >= start && timestamp < start + 30 * MINUTE) ||
        (timestamp >= start + HOUR && timestamp < range.end),
      ).map(({ id }) => id));
  });

  it('measures sparse coverage over unique time even when a well-covered interval is repeated', () => {
    const range = { start, end: start + 2 * HOUR };
    const covered = { start, end: start + HOUR };
    const states = [
      suspension('loop', 'loop-mode', start, range.end),
      suspension('pump-a', 'pump-suspend', start, covered.end),
      suspension('pump-b', 'pump-suspend', start, covered.end),
    ];
    const { answer, evidence } = answerFor(states, readings(covered, () => 6), range, range);
    expect(answer.answer).toContain('2 h in total');
    expect(answer.answer).toContain('Glucose readings covered 56%');
    expect(answer.answer).toContain('not summarising glucose');
    expect(evidence.map(({ id }) => id)).toEqual(['therapy-state-intervals']);
  });

  it('retains every active, matched and source record beyond the old caps through conversation storage', () => {
    const range = { start, end: start + 12 * HOUR };
    const loadRange = { start: start - 4 * DAY, end: range.end };
    const states = Array.from({ length: 205 }, (_, index) =>
      suspension(`overlap-${index}`, index % 2 ? 'pump-suspend' : 'loop-mode', start, range.end),
    );
    states[0]!.duplicateSources.push({
      rawRecordId: 'duplicate-source', sourceId: 'aaps-local', sourceFile: 'Synthetic confirmed sender',
    });
    const glucose = readings(loadRange, () => 6, MINUTE);
    const result = answerFor(states, glucose, loadRange, range);
    const byId = new Map(result.evidence.map((reference) => [reference.id, reference]));
    expect(byId.get('therapy-state-intervals')?.recordIds)
      .toEqual(['raw-overlap-0', 'duplicate-source', ...states.slice(1).map((item) => item.source.rawRecordId)]);
    expect(byId.get('therapy-state-glucose-during')?.recordIds)
      .toEqual(glucose.filter(({ timestamp }) => timestamp >= start).map(({ id }) => id));
    expect(byId.get('therapy-state-glucose-matched')?.recordIds).toEqual(
      [1, 2, 3, 4].flatMap((daysAgo) => glucose.filter(({ timestamp }) =>
        timestamp >= start - daysAgo * DAY && timestamp < range.end - daysAgo * DAY,
      )).sort((left, right) => left.timestamp - right.timestamp).map(({ id }) => id),
    );
    expect(byId.get('therapy-state-glucose-during')?.recordIds).toHaveLength(720);
    expect(byId.get('therapy-state-glucose-matched')?.recordIds).toHaveLength(2880);
    const serialized = serializeTarvisConversation([{
      ...result, id: 'synthetic-suspension', question: 'What were the recorded suspension periods?',
      answerSource: 'local', modelRequestSent: false,
    }], range.end);
    expect(validateSerializedTarvisConversation(serialized)).toBeDefined();
    expect(JSON.parse(serialized).exchanges[0].evidence).toEqual(result.evidence);
  });

  it('keeps three disjoint matched windows on one other day and excludes a rejected low-coverage window', () => {
    const range = { start, end: start + 150 * MINUTE };
    const loadRange = { start: start - 2 * DAY, end: range.end };
    const states = [0, 1, 2].map((hours) =>
      suspension(`separate-${hours}`, 'pump-suspend', start + hours * HOUR, start + hours * HOUR + 30 * MINUTE),
    );
    const glucose = readings(loadRange, () => 6).filter(({ timestamp }) => timestamp >= start - DAY);
    // The oldest comparison day has one isolated record and inadequate coverage.
    glucose.unshift({
      ...glucose[0]!, id: 'rejected-low-coverage', timestamp: start - 2 * DAY, receivedAt: start - 2 * DAY,
    });
    const { answer, evidence } = answerFor(states, glucose, loadRange, range);
    expect(answer.answer).toContain('same clock times on 1 other day with');
    expect(answer.answer).not.toContain('1 other days');
    const matched = evidence.find(({ id }) => id === 'therapy-state-glucose-matched');
    expect(matched?.description).toContain('3 same-clock-time windows');
    expect(matched?.recordIds).toEqual(glucose.filter(({ timestamp }) =>
      states.some((item) => timestamp >= item.start - DAY && timestamp < item.end - DAY),
    ).map(({ id }) => id));
    expect(matched?.recordIds).not.toContain('rejected-low-coverage');
  });

  it('retains source timestamps outside the query so the evidence can be saved and reopened', () => {
    const range = { start, end: start + HOUR };
    const states = [suspension('earlier', 'loop-mode', start - DAY, range.end)];
    const result = answerFor(states, readings(range, () => 6), range, range);
    expect(result.evidence[0]?.range.start).toBe(start - DAY);
    const serialized = serializeTarvisConversation([{
      ...result, id: 'earlier-suspension', question: 'What were the recorded suspension periods?',
      answerSource: 'local', modelRequestSent: false,
    }], range.end);
    expect(JSON.parse(serialized).exchanges[0].evidence[0].recordIds).toEqual(['raw-earlier']);
  });
});
