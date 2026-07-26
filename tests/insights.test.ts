import { describe, expect, it } from 'vitest';

import { createDemoRepository } from '@/data/demoRepository';
import {
  answerInsightQuestion,
  buildInsightReport,
  detectGlucoseEpisodes,
} from '@/domain/insights';
import { GlucoseReading, TimelineData } from '@/domain/models';
import { addDays, dayRange, toDateKey } from '@/domain/time';

describe('evidence-backed insights', () => {
  it('compares two complete weeks and links every finding to records', async () => {
    const now = Date.parse('2026-07-26T10:00:00+01:00');
    const today = toDateKey(now);
    const todayStart = dayRange(today, now).start;
    const currentStart = dayRange(addDays(today, -7), now).start;
    const previousStart = dayRange(addDays(today, -14), now).start;
    const repository = createDemoRepository(now);
    const [current, previous] = await Promise.all([
      repository.getTimeline({ start: currentStart, end: todayStart }),
      repository.getTimeline({ start: previousStart, end: currentStart }),
    ]);

    const report = buildInsightReport(current, previous, now);

    expect(report.ready).toBe(true);
    expect(report.findings.length).toBeGreaterThanOrEqual(4);
    expect(report.findings.some((finding) => finding.category === 'food')).toBe(
      true,
    );
    expect(report.findings.some((finding) => finding.category === 'sleep')).toBe(
      true,
    );
    expect(
      report.findings.some((finding) => finding.id === 'glucose-variability'),
    ).toBe(true);
    expect(
      report.findings.some((finding) => finding.id === 'post-meal-pattern'),
    ).toBe(true);
    for (const finding of report.findings) {
      expect(finding.evidence.length).toBeGreaterThan(0);
      expect(
        finding.evidence.every((item) => item.recordIds.length > 0),
      ).toBe(true);
    }

    const answer = answerInsightQuestion(
      'Why was my glucose worse?',
      report,
    );
    expect(answer.findingIds.length).toBeGreaterThan(0);
    expect(answer.answer).toContain('not proven causes');
  });

  it('groups only consecutive threshold readings into sustained runs', () => {
    const start = Date.parse('2026-07-26T10:00:00+01:00');
    const reading = (
      minute: number,
      mmolL: number,
    ): GlucoseReading => ({
      id: `reading-${minute}`,
      timestamp: start + minute * 60_000,
      receivedAt: start + minute * 60_000,
      mmolL,
      trend: 'flat',
      quality: 'measured',
      sourceId: 'test',
    });
    const readings = [
      reading(0, 9.8),
      reading(5, 10.4),
      reading(10, 11.2),
      reading(15, 9.9),
      reading(40, 11.5),
      reading(60, 11.7),
      reading(65, 3.7),
      reading(70, 3.5),
    ];

    const highs = detectGlucoseEpisodes(readings, 'high');
    const lows = detectGlucoseEpisodes(readings, 'low');

    expect(highs).toHaveLength(1);
    expect(highs[0]?.readings.map((item) => item.id)).toEqual([
      'reading-5',
      'reading-10',
    ]);
    expect(highs[0]?.extremeMmolL).toBe(11.2);
    expect(lows).toHaveLength(1);
    expect(lows[0]?.extremeMmolL).toBe(3.5);
  });

  it('withholds comparisons when personal history coverage is insufficient', () => {
    const emptyWindow = (
      start: number,
      end: number,
    ): TimelineData => ({
      range: { start, end },
      glucose: [],
      basal: [],
      boluses: [],
      context: [],
      sources: [
        {
          id: 'daymark-librelinkup',
          label: 'Glucose',
          detail: 'Collecting',
          freshness: 'missing',
          origin: 'live',
          isLive: true,
        },
        {
          id: 'insulin-not-connected',
          label: 'Insulin',
          detail: 'Not connected',
          freshness: 'missing',
          origin: 'delayed',
          isLive: false,
        },
      ],
    });
    const now = Date.parse('2026-07-26T10:00:00+01:00');
    const report = buildInsightReport(
      emptyWindow(now - 7 * 86_400_000, now),
      emptyWindow(now - 14 * 86_400_000, now - 7 * 86_400_000),
      now,
    );

    expect(report.ready).toBe(false);
    expect(report.headline).toBe('Building a trustworthy baseline');
    expect(report.findings).toHaveLength(1);
    expect(
      answerInsightQuestion('Why was glucose worse?', report).answer,
    ).toContain('not enough comparable coverage');
  });
});
