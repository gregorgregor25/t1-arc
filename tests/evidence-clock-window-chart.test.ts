import { describe, expect, it } from 'vitest';

import {
  buildEvidenceClockWindowAccessibilitySummary,
  buildEvidenceClockWindowTicks,
  evidenceClockWindowPath,
  normaliseEvidenceClockMinute,
  prepareEvidenceClockWindowSegments,
  projectEvidenceClockMinute,
  resolveEvidenceClockWindowDomain,
  segmentEvidenceClockWindowPoints,
} from '../src/domain/evidenceClockWindowChart';

describe('clock-window evidence chart geometry', () => {
  it('uses the exact explicit domain and unwraps cross-midnight minutes', () => {
    const domain = resolveEvidenceClockWindowDomain({
      startMinute: 22 * 60,
      endMinuteUnwrapped: 3 * 60,
    });

    expect(domain).toEqual({
      durationMinutes: 5 * 60,
      endMinute: 27 * 60,
      startMinute: 22 * 60,
    });
    expect(normaliseEvidenceClockMinute(60, domain)).toBe(25 * 60);
    expect(projectEvidenceClockMinute(22 * 60, domain, 300)).toBe(0);
    expect(projectEvidenceClockMinute(3 * 60, domain, 300)).toBe(300);
  });

  it('breaks a path across missing readings and excludes outside points', () => {
    const domain = resolveEvidenceClockWindowDomain({
      startMinute: 0,
      endMinuteUnwrapped: 7 * 60,
    });
    const segments = segmentEvidenceClockWindowPoints(
      [
        { minute: -30, mmolL: 9 },
        { minute: 0, mmolL: 6 },
        { minute: 5, mmolL: 6.2 },
        { minute: 35, mmolL: 6.8 },
        { minute: 40, mmolL: 7 },
        { minute: 8 * 60, mmolL: 10 },
      ],
      domain,
      20,
    );

    expect(segments.map((segment) => segment.map((point) => point.minute))).toEqual([
      [0, 5],
      [35, 40],
    ]);
    expect(
      segments.map((segment) =>
        evidenceClockWindowPath(segment, (minute) => minute, (value) => value),
      ),
    ).toEqual(['M 0 6 L 5 6.2', 'M 35 6.8 L 40 7']);
  });

  it('preserves authoritative evidence-segment boundaries', () => {
    const domain = resolveEvidenceClockWindowDomain({
      startMinute: 0,
      endMinuteUnwrapped: 60,
    });
    const segments = prepareEvidenceClockWindowSegments(
      {
        id: 'night-1',
        label: 'Thursday 6 August',
        points: [
          { minute: 0, mmolL: 6 },
          { minute: 10, mmolL: 6.2 },
        ],
        segments: [
          { points: [{ minute: 0, mmolL: 6 }] },
          { points: [{ minute: 10, mmolL: 6.2 }] },
        ],
        status: 'partial',
      },
      domain,
      20,
    );

    expect(segments).toHaveLength(2);
    expect(segments.map((segment) => segment[0]!.minute)).toEqual([0, 10]);
  });

  it('always includes the exact start and end ticks without extending the axis', () => {
    const domain = resolveEvidenceClockWindowDomain({
      startMinute: 15,
      endMinuteUnwrapped: 7 * 60 + 10,
    });
    const ticks = buildEvidenceClockWindowTicks(domain, 5);

    expect(ticks[0]).toBe(15);
    expect(ticks.at(-1)).toBe(7 * 60 + 10);
    expect(ticks.every((tick) => tick >= 15 && tick <= 7 * 60 + 10)).toBe(true);
  });
});

describe('clock-window accessible summary', () => {
  it('describes the exact window, missing occurrence, range, gaps, and contributors', () => {
    const summary = buildEvidenceClockWindowAccessibilitySummary({
      aggregatePoints: [
        { contributingWindowCount: 2, minute: 0, mmolL: 6.5 },
        { contributingWindowCount: 3, minute: 15, mmolL: 6.7 },
      ],
      coverageSummary: '2 of 3 requested nights contain readings',
      domain: { startMinute: 0, endMinuteUnwrapped: 7 * 60 },
      minimumAggregateContributors: 2,
      missingOccurrenceLabels: [],
      targetRange: { maximum: 10, minimum: 3.9 },
      title: 'Overnight glucose',
      units: 'mmol/L',
      windows: [
        {
          id: 'wed',
          label: 'Wednesday 5 August',
          points: [
            { minute: 0, mmolL: 5.1 },
            { minute: 5, mmolL: 5.4 },
            { minute: 45, mmolL: 7.2 },
          ],
          status: 'partial',
        },
        {
          id: 'thu',
          label: 'Thursday 6 August',
          points: [
            { minute: 0, mmolL: 6.1 },
            { minute: 5, mmolL: 8.4 },
          ],
          status: 'complete',
        },
        {
          id: 'tue',
          label: 'Tuesday 4 August',
          points: [],
          status: 'missing',
        },
      ],
    });

    expect(summary).toContain('Clock window 00:00 to 07:00.');
    expect(summary).toContain('2 of 3 requested occurrences contain readings.');
    expect(summary).toContain('5.1 to 8.4 mmol/L');
    expect(summary).toContain('No readings for Tuesday 4 August.');
    expect(summary).toContain('Complete occurrences: Thursday 6 August.');
    expect(summary).toContain('Partial readings for Wednesday 5 August.');
    expect(summary).toContain(
      'The shaded target range is 3.9 to 10.0 mmol/L.',
    );
    expect(summary).toContain('between 2 and 3 contributing occurrences');
    expect(summary).toContain('Lines stop where readings are missing.');
  });

  it('explains why a supplied aggregate is not drawn', () => {
    const summary = buildEvidenceClockWindowAccessibilitySummary({
      aggregatePoints: [
        { contributingWindowCount: 1, minute: 0, mmolL: 6.5 },
      ],
      coverageSummary: '1 of 3 nights contains readings',
      domain: { startMinute: 0, endMinuteUnwrapped: 7 * 60 },
      minimumAggregateContributors: 2,
      title: 'Overnight glucose',
      units: 'mmol/L',
      windows: [
        {
          id: 'thu',
          label: 'Thursday 6 August',
          points: [{ minute: 0, mmolL: 6.5 }],
          status: 'partial',
        },
      ],
    });

    expect(summary).toContain(
      'No average line is shown because fewer than 2 occurrences contribute',
    );
  });

  it('provides a useful empty-state summary without inventing dates', () => {
    const summary = buildEvidenceClockWindowAccessibilitySummary({
      aggregatePoints: [],
      coverageSummary: 'No sensor coverage',
      domain: { startMinute: 60, endMinuteUnwrapped: 180 },
      minimumAggregateContributors: 2,
      missingOccurrenceLabels: ['Requested occurrence 1'],
      title: 'Requested glucose window',
      units: 'mmol/L',
      windows: [],
    });

    expect(summary).toContain('Clock window 01:00 to 03:00.');
    expect(summary).toContain('No glucose readings are available');
    expect(summary).toContain('No readings for Requested occurrence 1.');
    expect(summary).not.toContain('recent');
    expect(summary).not.toContain('shaded target range');
  });

  it('bounds complete occurrence labels for a concise TalkBack summary', () => {
    const summary = buildEvidenceClockWindowAccessibilitySummary({
      aggregatePoints: [],
      coverageSummary: '5 of 5 nights contain readings',
      domain: { startMinute: 0, endMinuteUnwrapped: 60 },
      minimumAggregateContributors: 2,
      title: 'Overnight glucose',
      units: 'mmol/L',
      windows: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'].map(
        (label, index) => ({
          id: label,
          label,
          points: [{ minute: index, mmolL: 6 + index / 10 }],
          status: 'complete' as const,
        }),
      ),
    });

    expect(summary).toContain(
      'Complete occurrences: Monday, Tuesday, Wednesday, and 2 more.',
    );
  });
});
