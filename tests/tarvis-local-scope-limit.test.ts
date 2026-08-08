import { describe, expect, it } from 'vitest';

import {
  isLocalGlucoseScopeWithinLimit,
  localGlucoseScopeBudgetDays,
} from '@/data/tarvis/localScopeLimit';
import { isReadyTarvisIntent, resolveTarvisIntent } from '@/data/tarvis/intent';
import type {
  TarvisIntentV1,
  TarvisTemporalScope,
} from '@/data/tarvis/intent';

const NOW = Date.parse('2026-08-07T20:14:00+01:00');

function intent(
  scope: TarvisTemporalScope,
  comparison = false,
): TarvisIntentV1 {
  const resolution = resolveTarvisIntent('What was my average glucose today?', {
    now: NOW,
    timezone: 'Europe/London',
  });
  if (!isReadyTarvisIntent(resolution)) throw new Error(resolution.outcome.code);
  return {
    ...resolution.intent,
    temporalScope: {
      ...resolution.intent.temporalScope,
      value: scope,
    },
    comparison: comparison
      ? {
          value: { kind: 'previous_equal_period' },
          provenance: {
            kind: 'explicit',
            sourceText: 'previous period',
            sourceStart: 0,
            sourceEnd: 15,
            turnId: null,
            note: null,
          },
        }
      : null,
  };
}

describe('local glucose query scope budget', () => {
  it('accepts exactly 90 local days and rejects 91', () => {
    expect(
      isLocalGlucoseScopeWithinLimit(
        intent({ kind: 'recent_local_days', count: 90, include: 'through_now' }),
      ),
    ).toBe(true);
    expect(
      isLocalGlucoseScopeWithinLimit(
        intent({ kind: 'recent_local_days', count: 91, include: 'through_now' }),
      ),
    ).toBe(false);
  });

  it('uses equivalent elapsed duration for rolling units', () => {
    expect(
      localGlucoseScopeBudgetDays(
        intent({ kind: 'rolling', amount: 2_160, unit: 'hour', anchor: 'now' }),
      ),
    ).toBe(90);
    expect(
      isLocalGlucoseScopeWithinLimit(
        intent({ kind: 'rolling', amount: 13, unit: 'week', anchor: 'now' }),
      ),
    ).toBe(false);
  });

  it('counts inclusive explicit dates and both comparison periods', () => {
    expect(
      localGlucoseScopeBudgetDays(
        intent({
          kind: 'calendar_date_range',
          startDate: '2026-04-01',
          endDate: '2026-06-29',
          inclusiveEndDate: true,
        }),
      ),
    ).toBe(90);
    expect(
      isLocalGlucoseScopeWithinLimit(
        intent({
          kind: 'calendar_date_range',
          startDate: '2026-04-01',
          endDate: '2026-06-30',
          inclusiveEndDate: true,
        }),
      ),
    ).toBe(false);
    expect(
      isLocalGlucoseScopeWithinLimit(
        intent(
          { kind: 'recent_local_days', count: 45, include: 'completed_days' },
          true,
        ),
      ),
    ).toBe(true);
    expect(
      isLocalGlucoseScopeWithinLimit(
        intent(
          { kind: 'recent_local_days', count: 46, include: 'completed_days' },
          true,
        ),
      ),
    ).toBe(false);
  });
});
