import {
  aggregateDailyHealthMetrics,
  nutritionMetricsFromContextSummary,
  type DailyHealthMetrics,
  type DailyMetricCategory,
  type DailyMetricRecord,
} from '@/domain/dailyHealthMetrics';
import {
  healthContextEventOverlapsRange,
  summarizeHealthTrendContext,
  type HealthTrendContextSummary,
} from '@/domain/healthTrendContext';
import type { HealthContextEvent, TimeRange } from '@/domain/models';
import { addDays, dayRange, type DateKey } from '@/domain/time';
import type { HealthConnectContextCategory } from './healthConnectContextSelection';

// Read-time identities only. A manual weight stays in context_events, so edits,
// deletions and backups still have one authoritative record to operate on.
export const MANUAL_WEIGHT_METRIC_PREFIX = 'context-weight:';

export function manualWeightMetricRecords(
  context: readonly HealthContextEvent[],
) {
  return context.flatMap((event): DailyMetricRecord[] =>
    event.kind === 'weight' &&
    event.origin === 'manual' &&
    Number.isFinite(event.kilograms) &&
    event.kilograms > 0
      ? [
          {
            id: `${MANUAL_WEIGHT_METRIC_PREFIX}${event.id}`,
            kind: 'weight',
            sourcePackage: 't1arc.manual-weight',
            sourceLabel: 'Manual log',
            start: event.start,
            end: event.start,
            value: event.kilograms,
            unit: 'kg',
          },
        ]
      : [],
  );
}

export interface HealthMetricInput {
  records: DailyMetricRecord[];
  context: HealthContextEvent[];
  preferredSources?: Partial<Record<DailyMetricCategory, string>>;
  contextNeedsSource?: HealthConnectContextCategory[];
}

export function buildHealthMetricSnapshot(
  input: HealthMetricInput,
  range: TimeRange,
) {
  const { records, context, preferredSources, contextNeedsSource = [] } = input;
  const metrics = aggregateDailyHealthMetrics(records, range, preferredSources);
  const manual = manualWeightMetricRecords(context).filter(
    (record) => record.start >= range.start && record.start < range.end,
  );
  // Match Today's established rule: a selected connected measurement wins;
  // otherwise use the latest manual entry that day. Do not resolve a connected
  // source conflict by pretending the manual record came from that source.
  if (metrics.weightKilograms === undefined && manual.length) {
    const fallback = aggregateDailyHealthMetrics(manual, range);
    metrics.weightKilograms = fallback.weightKilograms;
    metrics.selectedRecordIds.push(...fallback.selectedRecordIds);
    metrics.sourceLabels = [
      ...new Set([...metrics.sourceLabels, ...fallback.sourceLabels]),
    ];
    metrics.recordCount += fallback.recordCount;
  }
  return {
    metrics: {
      ...metrics,
      ...nutritionMetricsFromContextSummary(
        summarizeHealthTrendContext(context, range),
      ),
    },
    records: [...records, ...manual],
    context,
    contextNeedsSource,
  };
}

export interface HealthTrendDay extends HealthTrendContextSummary {
  date: DateKey;
  metrics: DailyHealthMetrics;
  sleepMinutes: number;
  workoutMinutes: number;
  contextNeedsSource: HealthConnectContextCategory[];
}

function overlapMinutes(event: HealthContextEvent, range: TimeRange) {
  const end =
    event.end ??
    ('durationMinutes' in event
      ? event.start + event.durationMinutes * 60_000
      : event.start);
  return Math.max(
    0,
    (Math.min(end, range.end) - Math.max(event.start, range.start)) / 60_000,
  );
}

export function buildHealthTrendSnapshot(
  input: HealthMetricInput,
  endDate: DateKey,
  days: number,
  now: number,
): HealthTrendDay[] {
  const safeDays = Math.max(1, Math.min(90, Math.floor(days)));
  return Array.from({ length: safeDays }, (_, index) => {
    const date = addDays(endDate, index - (safeDays - 1));
    const range = dayRange(date, now);
    const context = input.context.filter((event) =>
      healthContextEventOverlapsRange(event, range),
    );
    return {
      date,
      metrics: buildHealthMetricSnapshot({ ...input, context }, range).metrics,
      sleepMinutes: context
        .filter((event) => event.kind === 'sleep')
        .reduce((total, event) => total + overlapMinutes(event, range), 0),
      workoutMinutes: context
        .filter((event) => event.kind === 'activity')
        .reduce((total, event) => total + overlapMinutes(event, range), 0),
      contextNeedsSource: input.contextNeedsSource ?? [],
      ...summarizeHealthTrendContext(context, range),
    };
  });
}
