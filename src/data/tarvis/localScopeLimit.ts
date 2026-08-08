import type { TarvisIntentV1, TarvisTemporalScope } from './intent';

export const MAX_LOCAL_GLUCOSE_SCOPE_DAYS = 90;

const MILLISECONDS_PER_DAY = 24 * 60 * 60_000;

function calendarDateRangeDays(
  scope: Extract<TarvisTemporalScope, { kind: 'calendar_date_range' }>,
) {
  const start = Date.parse(`${scope.startDate}T00:00:00.000Z`);
  const end = Date.parse(`${scope.endDate}T00:00:00.000Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) {
    return Number.POSITIVE_INFINITY;
  }
  return (end - start) / MILLISECONDS_PER_DAY + 1;
}

function baseScopeDays(scope: TarvisTemporalScope) {
  switch (scope.kind) {
    case 'rolling': {
      const units = {
        minute: 1 / (24 * 60),
        hour: 1 / 24,
        day: 1,
        week: 7,
      } as const;
      return scope.amount * units[scope.unit];
    }
    case 'recent_local_days':
      return scope.count;
    case 'calendar_period':
      if (scope.period === 'today' || scope.period === 'yesterday') return 1;
      if (scope.period === 'this_week' || scope.period === 'last_week') return 7;
      // A named local month is never longer than 31 calendar days.
      return 31;
    case 'calendar_date':
      return 1;
    case 'calendar_date_range':
      return calendarDateRangeDays(scope);
  }
}

/**
 * Deterministic upper bound checked before repository access. A previous-period
 * comparison consumes two equal scopes and therefore shares the same 90-day
 * total budget rather than silently doubling the phone workload.
 */
export function localGlucoseScopeBudgetDays(intent: TarvisIntentV1) {
  const base = baseScopeDays(intent.temporalScope.value);
  const comparisonMultiplier =
    intent.comparison?.value.kind === 'previous_equal_period' ? 2 : 1;
  return base * comparisonMultiplier;
}

export function isLocalGlucoseScopeWithinLimit(intent: TarvisIntentV1) {
  const days = localGlucoseScopeBudgetDays(intent);
  return (
    Number.isFinite(days) &&
    days > 0 &&
    days <= MAX_LOCAL_GLUCOSE_SCOPE_DAYS
  );
}
