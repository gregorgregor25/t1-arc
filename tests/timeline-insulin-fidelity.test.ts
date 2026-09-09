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
  it('does not call daily basal totals timed basal intervals when only boluses are detailed', () => {
    const result = describeInsulinTimelineFidelity(timeline({
      boluses: [{ id: 'bolus', timestamp: 500, units: 3.5, sourceId: 'glooko-export' }],
      dailyInsulinTotals: [{ id: 'daily', timestamp: 0, dateKey: '2026-09-08', totalUnits: 22.2, basalUnits: 18.7, sourceId: 'glooko-export' }],
    }));
    expect(result.detail).toContain('Boluses are timed delivery records');
    expect(result.detail).toContain('daily totals, not timed basal intervals');
  });

  it('describes basal-only and bolus-only records without inventing the missing delivery type', () => {
    expect(describeInsulinTimelineFidelity(timeline({ basal: [{ id: 'basal', start: 0, end: 1000, units: 1, rateUnitsPerHour: 1, sourceId: 'test' }] })).detail).toContain('No timed boluses');
    expect(describeInsulinTimelineFidelity(timeline({ boluses: [{ id: 'bolus', timestamp: 500, units: 1, sourceId: 'test' }] })).detail).toContain('No timed basal intervals');
  });

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
