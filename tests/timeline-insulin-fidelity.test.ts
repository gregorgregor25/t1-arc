import { TimelineData } from '@/domain/models';
import { describeInsulinTimelineFidelity } from '@/domain/timelineInsulinSummary';
import { describe, expect, it } from 'vitest';

function timeline(overrides: Partial<TimelineData> = {}): TimelineData {
  return {
    range: { start: 0, end: 1000 },
    glucose: [],
    basal: [],
    boluses: [],
    context: [],
    sources: [],
    ...overrides,
  };
}

describe('insulin timeline fidelity', () => {
  it('only claims detailed data when individual delivery records exist', () => {
    expect(
      describeInsulinTimelineFidelity(
        timeline({
          boluses: [
            { id: 'b', timestamp: 500, units: 2, sourceId: 'glooko-export' },
          ],
        }),
      ).kind,
    ).toBe('detailed-events');
  });

  it('distinguishes daily summaries and report-derived pump events', () => {
    const result = describeInsulinTimelineFidelity(
      timeline({
        dailyInsulinTotals: [
          {
            id: 'd',
            timestamp: 0,
            dateKey: '2026-08-01',
            totalUnits: 18,
            sourceId: 'glooko-export',
          },
        ],
        pumpStates: [
          {
            id: 'p',
            start: 100,
            end: 200,
            kind: 'activity-mode',
            sourceId: 'glooko-export',
          },
        ],
      }),
    );

    expect(result.kind).toBe('daily-totals-and-report-events');
    expect(result.detail).toMatch(/report-derived/);
  });

  it('reports a connected source with no records without implying an import', () => {
    expect(
      describeInsulinTimelineFidelity(
        timeline({
          sources: [
            {
              id: 'glooko-export',
              label: 'Insulin',
              detail: 'Glooko',
              freshness: 'stale',
              origin: 'imported',
              isLive: false,
            },
          ],
        }),
      ).kind,
    ).toBe('no-records');
  });
});
