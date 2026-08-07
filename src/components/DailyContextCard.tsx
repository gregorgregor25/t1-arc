import Ionicons from '@expo/vector-icons/Ionicons';
import { StyleSheet, Text, View } from 'react-native';

import {
  DailyHealthMetrics,
  DailyMetricCategory,
} from '@/domain/dailyHealthMetrics';
import { contextNoteCategoryLabel } from '@/domain/contextNotes';
import { HealthContextEvent, TimeRange } from '@/domain/models';
import { useAppTheme } from '@/theme/theme';

import { SectionCard } from './SectionCard';
import type { HealthConnectContextCategory } from '@/data/healthConnect/healthConnectContextSelection';

interface ContextMetric {
  id: string;
  label: string;
  value: string;
  detail?: string;
  icon: keyof typeof Ionicons.glyphMap;
}

const categoryLabels: Record<DailyMetricCategory, string> = {
  steps: 'steps',
  distance: 'distance',
  active_calories: 'active energy',
  workouts: 'workout detail',
  heart_rate: 'heart rate',
  weight: 'weight',
  body_composition: 'body composition',
  blood_glucose: 'Health Connect glucose',
  vitals: 'vitals',
  hydration: 'hydration',
};

const contextCategoryLabels: Record<HealthConnectContextCategory, string> = {
  workouts: 'workouts',
  sleep: 'sleep',
  weight: 'weight',
  nutrition: 'meals',
  cycle: 'cycle context',
};

function overlapMinutes(
  start: number,
  end: number,
  range: TimeRange,
) {
  return Math.max(
    0,
    (Math.min(end, range.end) - Math.max(start, range.start)) / 60_000,
  );
}

function duration(value: number) {
  const minutes = Math.round(value);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder ? `${hours}h ${remainder}m` : `${hours}h`;
}

export function DailyContextCard({
  events,
  health,
  contextNeedsSource = [],
  range,
}: {
  events: HealthContextEvent[];
  health?: DailyHealthMetrics;
  contextNeedsSource?: HealthConnectContextCategory[];
  range: TimeRange;
}) {
  const { colors, radius } = useAppTheme();
  const mealCarbs = events
    .filter(
      (event) =>
        event.kind === 'meal' &&
        event.start >= range.start &&
        event.start < range.end,
    )
    .reduce(
      (total, event) =>
        total + (event.kind === 'meal' ? event.carbsGrams : 0),
      0,
    );
  const activityMinutes = events
    .filter((event) => event.kind === 'activity')
    .reduce(
      (total, event) =>
        total +
        overlapMinutes(
          event.start,
          event.end ??
            event.start +
              (event.kind === 'activity' ? event.durationMinutes : 0) *
                60_000,
          range,
        ),
      0,
    );
  const sleepMinutes = events
    .filter((event) => event.kind === 'sleep')
    .reduce(
      (total, event) =>
        total +
        overlapMinutes(
          event.start,
          event.end ??
            event.start +
              (event.kind === 'sleep' ? event.durationMinutes : 0) * 60_000,
          range,
        ),
      0,
    );
  const notes = events.filter(
    (event) =>
      event.kind === 'note' &&
      event.start >= range.start &&
      event.start < range.end,
  );
  const noteCategories = [
    ...new Set(
      notes.map((event) =>
        event.kind === 'note'
          ? contextNoteCategoryLabel(event.category)
          : '',
      ),
    ),
  ].filter(Boolean);
  const metrics: ContextMetric[] = [
    ...(mealCarbs > 0
      ? [
          {
            id: 'carbs',
            label: 'Carbs logged',
            value: `${Math.round(mealCarbs)} g`,
            icon: 'restaurant-outline' as const,
          },
        ]
      : []),
    ...(health?.steps !== undefined
      ? [
          {
            id: 'steps',
            label: 'Steps',
            value: health.steps.toLocaleString('en-GB'),
            icon: 'footsteps-outline' as const,
          },
        ]
      : []),
    ...(activityMinutes > 0
      ? [
          {
            id: 'activity',
            label: 'Activity',
            value: duration(activityMinutes),
            icon: 'walk-outline' as const,
          },
        ]
      : []),
    ...(sleepMinutes > 0
      ? [
          {
            id: 'sleep',
            label: 'Sleep in range',
            value: duration(sleepMinutes),
            icon: 'moon-outline' as const,
          },
        ]
      : []),
    ...(notes.length
      ? [
          {
            id: 'context-notes',
            label: notes.length === 1 ? 'Context note' : 'Context notes',
            value: notes.length.toString(),
            detail: noteCategories.join(' · '),
            icon: 'document-text-outline' as const,
          },
        ]
      : []),
    ...(health?.distanceKilometres !== undefined
      ? [
          {
            id: 'distance',
            label: 'Distance',
            value: `${health.distanceKilometres.toFixed(1)} km`,
            icon: 'navigate-outline' as const,
          },
        ]
      : []),
    ...(health?.activeCaloriesKcal !== undefined
      ? [
          {
            id: 'energy',
            label: 'Active energy',
            value: `${health.activeCaloriesKcal} kcal`,
            icon: 'flame-outline' as const,
          },
        ]
      : []),
    ...(health?.restingHeartRateBpm !== undefined
      ? [
          {
            id: 'resting-heart-rate',
            label: 'Resting heart rate',
            value: `${health.restingHeartRateBpm} bpm`,
            icon: 'heart-outline' as const,
          },
        ]
      : health?.averageHeartRateBpm !== undefined
        ? [
            {
              id: 'heart-rate',
              label: 'Average heart rate',
              value: `${health.averageHeartRateBpm} bpm`,
              detail:
                health.minimumHeartRateBpm !== undefined &&
                health.maximumHeartRateBpm !== undefined
                  ? `${health.minimumHeartRateBpm}–${health.maximumHeartRateBpm} bpm`
                  : undefined,
              icon: 'heart-outline' as const,
            },
          ]
        : []),
  ];

  const sourceConflicts = [
    ...(health?.needsSource.map((category) => categoryLabels[category]) ?? []),
    ...contextNeedsSource.map((category) => contextCategoryLabels[category]),
  ].filter((value, index, all) => all.indexOf(value) === index);

  if (!metrics.length && !sourceConflicts.length) return null;

  return (
    <SectionCard
      accessibilityLabel={`${metrics
        .map((metric) => `${metric.label} ${metric.value}`)
        .join('. ')}.`}
    >
      <View style={styles.header}>
        <View>
          <Text style={[styles.eyebrow, { color: colors.accent }]}>CONTEXT</Text>
          <Text style={[styles.title, { color: colors.text }]}>Daily context</Text>
        </View>
        <Text style={[styles.range, { color: colors.textSecondary }]}>
          Today so far
        </Text>
      </View>
      <View style={styles.grid}>
        {metrics.map((metric) => (
          <View
            key={metric.id}
            style={[
              styles.metric,
              {
                backgroundColor: colors.surfaceMuted,
                borderRadius: radius.md,
              },
            ]}
          >
            <Ionicons
              accessibilityElementsHidden
              color={colors.accent}
              name={metric.icon}
              size={19}
            />
            <Text style={[styles.metricValue, { color: colors.text }]}>
              {metric.value}
            </Text>
            <Text style={[styles.metricLabel, { color: colors.textSecondary }]}>
              {metric.label}
            </Text>
            {metric.detail ? (
              <Text style={[styles.metricDetail, { color: colors.textTertiary }]}>
                {metric.detail}
              </Text>
            ) : null}
          </View>
        ))}
      </View>
      {sourceConflicts.length ? (
        <Text style={[styles.sourceHint, { color: colors.textSecondary }]}>
          Choose one source for{' '}
          {sourceConflicts.join(', ')}{' '}
          in Sources to prevent double counting.
        </Text>
      ) : health?.sourceLabels.length ? (
        <Text style={[styles.sourceHint, { color: colors.textTertiary }]}>
          From {health.sourceLabels.join(', ')} via Health Connect
        </Text>
      ) : null}
    </SectionCard>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  eyebrow: {
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '800',
    letterSpacing: 1,
  },
  title: {
    fontSize: 18,
    lineHeight: 24,
    fontWeight: '700',
    marginTop: 2,
  },
  range: {
    fontSize: 12,
    lineHeight: 18,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 18,
  },
  metric: {
    width: '48%',
    minHeight: 104,
    padding: 13,
  },
  metricValue: {
    fontSize: 21,
    lineHeight: 27,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
    marginTop: 8,
  },
  metricLabel: {
    fontSize: 11,
    lineHeight: 16,
  },
  metricDetail: {
    fontSize: 10,
    lineHeight: 14,
    marginTop: 1,
  },
  sourceHint: {
    fontSize: 11,
    lineHeight: 17,
    marginTop: 14,
  },
});
