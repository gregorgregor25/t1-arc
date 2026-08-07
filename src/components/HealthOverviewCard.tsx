import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { HealthTrendDay } from '@/hooks/useHealthTrend';
import { DailyHealthMetrics } from '@/domain/dailyHealthMetrics';
import { HealthContextEvent, TimeRange } from '@/domain/models';
import { formatDate, toDateKey } from '@/domain/time';
import { useAppTheme } from '@/theme/theme';

import { SectionCard } from './SectionCard';
import type { HealthConnectContextCategory } from '@/data/healthConnect/healthConnectContextSelection';

function overlapMinutes(start: number, end: number, range: TimeRange) {
  return Math.max(
    0,
    (Math.min(end, range.end) - Math.max(start, range.start)) / 60_000,
  );
}

function durationLabel(minutes: number) {
  const rounded = Math.round(minutes);
  const hours = Math.floor(rounded / 60);
  const remainder = rounded % 60;
  if (!hours) return `${remainder} min`;
  return remainder ? `${hours}h ${remainder}m` : `${hours}h`;
}

function metricCategoryLabel(category: string) {
  if (category === 'active_calories') return 'active energy';
  if (category === 'heart_rate') return 'heart rate';
  if (category === 'body_composition') return 'body composition';
  if (category === 'nutrition') return 'meals';
  if (category === 'cycle') return 'cycle context';
  return category;
}

export function HealthOverviewCard({
  events,
  contextNeedsSource = [],
  isToday,
  metrics,
  range,
  trend,
}: {
  events: HealthContextEvent[];
  contextNeedsSource?: HealthConnectContextCategory[];
  isToday: boolean;
  metrics?: DailyHealthMetrics;
  range: TimeRange;
  trend: HealthTrendDay[];
}) {
  const { colors, radius } = useAppTheme();
  const [detailsExpanded, setDetailsExpanded] = useState(true);
  useEffect(() => {
    setDetailsExpanded(true);
  }, [range.start]);
  const sourceConflicts = [
    ...(metrics?.needsSource ?? []),
    ...contextNeedsSource,
  ].filter((value, index, all) => all.indexOf(value) === index);
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
  const weights = events
    .filter(
      (event): event is Extract<HealthContextEvent, { kind: 'weight' }> =>
        event.kind === 'weight',
    )
    .sort((left, right) => right.start - left.start);
  const medications = events.filter((event) => event.kind === 'medication');
  const weightKilograms =
    metrics?.weightKilograms ?? weights[0]?.kilograms;
  const hasBodyComposition =
    metrics?.bodyFatPercent !== undefined ||
    metrics?.leanBodyMassKilograms !== undefined ||
    metrics?.bodyWaterMassKilograms !== undefined ||
    metrics?.boneMassKilograms !== undefined ||
    metrics?.heightMetres !== undefined ||
    metrics?.basalMetabolicRateKcalPerDay !== undefined;
  const hasVitals =
    metrics?.bloodGlucoseMmolL !== undefined ||
    metrics?.bloodPressureSystolic !== undefined ||
    metrics?.bloodPressureDiastolic !== undefined ||
    metrics?.oxygenSaturationPercent !== undefined ||
    metrics?.respiratoryRatePerMinute !== undefined ||
    metrics?.heartRateVariabilityRmssdMs !== undefined ||
    metrics?.vo2MaxMillilitresPerKilogramMinute !== undefined ||
    metrics?.bodyTemperatureCelsius !== undefined;
  const hasDistance =
    metrics?.distanceKilometres !== undefined ||
    metrics?.elevationGainedMetres !== undefined ||
    metrics?.floorsClimbed !== undefined;
  const hasEnergy =
    metrics?.activeCaloriesKcal !== undefined ||
    metrics?.totalCaloriesKcal !== undefined;
  const hasHeart =
    metrics?.restingHeartRateBpm !== undefined ||
    metrics?.averageHeartRateBpm !== undefined;
  const hasWorkout =
    activityMinutes > 0 ||
    metrics?.averageWorkoutPowerWatts !== undefined ||
    metrics?.averageWorkoutSpeedMetresPerSecond !== undefined;
  const additionalDetailLabels = [
    hasDistance ? 'distance' : undefined,
    hasWorkout ? 'workouts' : undefined,
    metrics?.hydrationLitres !== undefined ? 'hydration' : undefined,
    hasBodyComposition ? 'body composition' : undefined,
    hasVitals ? 'vitals' : undefined,
  ].filter((value): value is string => value !== undefined);
  const hasAdditionalDetails = additionalDetailLabels.length > 0;
  const stepValues = trend.map((day) => day.metrics.steps ?? 0);
  const busiestSteps = Math.max(1, ...stepValues);
  const daysWithSteps = stepValues.filter((value) => value > 0);
  const averageSteps = daysWithSteps.length
    ? Math.round(
        daysWithSteps.reduce((total, value) => total + value, 0) /
          daysWithSteps.length,
      )
    : undefined;
  const hasHealth =
    metrics?.recordCount ||
    activityMinutes ||
    sleepMinutes ||
    weights.length ||
    medications.length;
  return (
    <SectionCard>
      <View style={styles.header}>
        <View>
          <Text style={[styles.eyebrow, { color: colors.accent }]}>
            HEALTH
          </Text>
          <Text style={[styles.title, { color: colors.text }]}>
            {isToday ? 'Your day so far' : 'Daily health'}
          </Text>
          <Text style={[styles.date, { color: colors.textSecondary }]}>
            {formatDate(toDateKey(range.start), {
              weekday: 'long',
              day: 'numeric',
              month: 'long',
            })}
          </Text>
        </View>
        <Ionicons
          accessibilityElementsHidden
          color={hasHealth ? colors.accent : colors.textTertiary}
          name="fitness-outline"
          size={25}
        />
      </View>

      <View
        style={[
          styles.stepsHero,
          {
            backgroundColor: `${colors.primary}10`,
            borderColor: `${colors.primary}2E`,
            borderRadius: radius.lg,
          },
        ]}
      >
        <View style={styles.stepsCopy}>
          <View style={styles.stepsLabelRow}>
            <Ionicons
              accessibilityElementsHidden
              color={colors.primary}
              name="footsteps-outline"
              size={19}
            />
            <Text style={[styles.stepsLabel, { color: colors.textSecondary }]}>
              Steps
            </Text>
          </View>
          <Text style={[styles.stepsValue, { color: colors.text }]}>
            {metrics?.steps?.toLocaleString('en-GB') ?? '—'}
          </Text>
          <Text style={[styles.stepsAverage, { color: colors.textTertiary }]}>
            {averageSteps === undefined
              ? 'Waiting for movement data'
              : `${averageSteps.toLocaleString('en-GB')} average on recorded days`}
          </Text>
        </View>

        <View style={styles.bars} accessibilityLabel="Seven day step history">
          {trend.map((day) => {
            const steps = day.metrics.steps ?? 0;
            const height = steps
              ? Math.max(7, Math.round((steps / busiestSteps) * 54))
              : 3;
            return (
              <View key={day.date} style={styles.barColumn}>
                <View
                  style={[
                    styles.barTrack,
                    {
                      backgroundColor: `${colors.primary}16`,
                      borderRadius: radius.pill,
                    },
                  ]}
                >
                  <View
                    style={[
                      styles.barFill,
                      {
                        backgroundColor:
                          day.date === trend[trend.length - 1]?.date
                            ? colors.primary
                            : `${colors.primary}8E`,
                        borderRadius: radius.pill,
                        height,
                      },
                    ]}
                  />
                </View>
                <Text style={[styles.dayLabel, { color: colors.textTertiary }]}>
                  {formatDate(day.date, { weekday: 'narrow' })}
                </Text>
              </View>
            );
          })}
        </View>
      </View>

      <View style={styles.metricGrid}>
        {detailsExpanded && hasDistance ? (
        <Metric
          icon="navigate-outline"
          label="Distance"
          value={
            metrics?.distanceKilometres === undefined
              ? '—'
              : `${metrics.distanceKilometres.toFixed(1)} km`
          }
          detail={[
            metrics?.elevationGainedMetres === undefined
              ? undefined
              : `${metrics.elevationGainedMetres} m climbed`,
            metrics?.floorsClimbed === undefined
              ? undefined
              : `${metrics.floorsClimbed.toLocaleString('en-GB')} floors`,
          ]
            .filter(Boolean)
            .join(' · ') || undefined}
        />
        ) : null}
        {hasEnergy ? (
        <Metric
          icon="flame-outline"
          label="Active energy"
          value={
            metrics?.activeCaloriesKcal === undefined
              ? '—'
              : `${metrics.activeCaloriesKcal} kcal`
          }
          detail={
            metrics?.totalCaloriesKcal === undefined
              ? undefined
              : `${metrics.totalCaloriesKcal} kcal total recorded`
          }
        />
        ) : null}
        {hasHeart ? (
        <Metric
          icon="heart-outline"
          label={
            metrics?.restingHeartRateBpm === undefined
              ? 'Average heart rate'
              : 'Resting heart rate'
          }
          value={
            metrics?.restingHeartRateBpm !== undefined
              ? `${metrics.restingHeartRateBpm} bpm`
              : metrics?.averageHeartRateBpm !== undefined
                ? `${metrics.averageHeartRateBpm} bpm`
                : '—'
          }
          detail={
            metrics?.minimumHeartRateBpm !== undefined &&
            metrics.maximumHeartRateBpm !== undefined
              ? `${metrics.minimumHeartRateBpm}–${metrics.maximumHeartRateBpm} bpm recorded`
              : undefined
          }
        />
        ) : null}
        {detailsExpanded && hasWorkout ? (
        <Metric
          icon="barbell-outline"
          label="Workout time"
          value={activityMinutes ? durationLabel(activityMinutes) : '—'}
          detail={[
            metrics?.averageWorkoutPowerWatts === undefined
              ? undefined
              : `${metrics.averageWorkoutPowerWatts} W average`,
            metrics?.averageWorkoutSpeedMetresPerSecond === undefined
              ? undefined
              : `${(
                  metrics.averageWorkoutSpeedMetresPerSecond * 3.6
                ).toFixed(1)} km/h average`,
          ]
            .filter(Boolean)
            .join(' · ') || undefined}
        />
        ) : null}
        {sleepMinutes ? (
        <Metric
          icon="moon-outline"
          label="Sleep in range"
          value={sleepMinutes ? durationLabel(sleepMinutes) : '—'}
        />
        ) : null}
        {weightKilograms !== undefined ? (
        <Metric
          icon="scale-outline"
          label="Weight"
          value={
            weightKilograms !== undefined
              ? `${weightKilograms.toFixed(1)} kg`
              : '—'
          }
        />
        ) : null}
        {detailsExpanded && metrics?.hydrationLitres !== undefined ? (
        <Metric
          icon="water-outline"
          label="Hydration"
          value={
            metrics?.hydrationLitres === undefined
              ? '—'
              : `${metrics.hydrationLitres.toFixed(2)} L`
          }
        />
        ) : null}
      </View>

      {hasAdditionalDetails ? (
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded: detailsExpanded }}
          onPress={() => setDetailsExpanded((expanded) => !expanded)}
          style={({ pressed }) => [
            styles.detailsToggle,
            {
              backgroundColor: colors.surfaceMuted,
              borderColor: colors.border,
              borderRadius: radius.md,
              opacity: pressed ? 0.72 : 1,
            },
          ]}
        >
          <View style={styles.detailsToggleCopy}>
            <Text
              style={[styles.detailsToggleTitle, { color: colors.text }]}
            >
              {detailsExpanded ? 'Hide health details' : 'More health details'}
            </Text>
            <Text
              numberOfLines={1}
              style={[
                styles.detailsToggleDetail,
                { color: colors.textSecondary },
              ]}
            >
              {additionalDetailLabels.join(' · ')}
            </Text>
          </View>
          <Ionicons
            accessibilityElementsHidden
            color={colors.textTertiary}
            name={detailsExpanded ? 'chevron-up' : 'chevron-down'}
            size={20}
          />
        </Pressable>
      ) : null}

      {detailsExpanded && hasBodyComposition ? (
        <View
          style={[
            styles.bodyCard,
            {
              backgroundColor: colors.surfaceMuted,
              borderColor: colors.border,
              borderRadius: radius.md,
            },
          ]}
        >
          <View style={styles.bodyHeader}>
            <View
              style={[
                styles.bodyIcon,
                {
                  backgroundColor: `${colors.accent}16`,
                  borderRadius: radius.sm,
                },
              ]}
            >
              <Ionicons
                accessibilityElementsHidden
                color={colors.accent}
                name="body-outline"
                size={19}
              />
            </View>
            <View style={styles.bodyHeaderCopy}>
              <Text style={[styles.bodyTitle, { color: colors.text }]}>
                Body composition
              </Text>
              <Text
                style={[
                  styles.bodyDescription,
                  { color: colors.textSecondary },
                ]}
              >
                Measurements recorded on this day
              </Text>
            </View>
          </View>
          <View style={styles.bodyGrid}>
            {metrics?.bodyFatPercent !== undefined ? (
              <BodyReading
                label="Body fat"
                value={`${metrics.bodyFatPercent.toFixed(1)}%`}
              />
            ) : null}
            {metrics?.leanBodyMassKilograms !== undefined ? (
              <BodyReading
                label="Lean mass"
                value={`${metrics.leanBodyMassKilograms.toFixed(1)} kg`}
              />
            ) : null}
            {metrics?.bodyWaterMassKilograms !== undefined ? (
              <BodyReading
                label="Body water"
                value={`${metrics.bodyWaterMassKilograms.toFixed(1)} kg`}
              />
            ) : null}
            {metrics?.boneMassKilograms !== undefined ? (
              <BodyReading
                label="Bone mass"
                value={`${metrics.boneMassKilograms.toFixed(1)} kg`}
              />
            ) : null}
            {metrics?.heightMetres !== undefined ? (
              <BodyReading
                label="Height"
                value={`${Math.round(metrics.heightMetres * 100)} cm`}
              />
            ) : null}
            {metrics?.basalMetabolicRateKcalPerDay !== undefined ? (
              <BodyReading
                label="Basal metabolism"
                value={`${Math.round(
                  metrics.basalMetabolicRateKcalPerDay,
                ).toLocaleString('en-GB')} kcal/day`}
              />
            ) : null}
          </View>
        </View>
      ) : null}

      {detailsExpanded && hasVitals ? (
        <View
          style={[
            styles.bodyCard,
            {
              backgroundColor: colors.surfaceMuted,
              borderColor: colors.border,
              borderRadius: radius.md,
            },
          ]}
        >
          <View style={styles.bodyHeader}>
            <View
              style={[
                styles.bodyIcon,
                {
                  backgroundColor: `${colors.primary}16`,
                  borderRadius: radius.sm,
                },
              ]}
            >
              <Ionicons
                accessibilityElementsHidden
                color={colors.primary}
                name="pulse-outline"
                size={19}
              />
            </View>
            <View style={styles.bodyHeaderCopy}>
              <Text style={[styles.bodyTitle, { color: colors.text }]}>
                Vitals
              </Text>
              <Text
                style={[
                  styles.bodyDescription,
                  { color: colors.textSecondary },
                ]}
              >
                Latest measurements recorded on this day
              </Text>
            </View>
          </View>
          <View style={styles.bodyGrid}>
            {metrics?.bloodGlucoseMmolL !== undefined ? (
              <BodyReading
                label="Health Connect glucose"
                value={`${metrics.bloodGlucoseMmolL.toFixed(1)} mmol/L`}
              />
            ) : null}
            {metrics?.bloodPressureSystolic !== undefined ||
            metrics?.bloodPressureDiastolic !== undefined ? (
              <BodyReading
                label="Blood pressure"
                value={`${metrics.bloodPressureSystolic?.toFixed(0) ?? '—'}/${metrics.bloodPressureDiastolic?.toFixed(0) ?? '—'} mmHg`}
              />
            ) : null}
            {metrics?.oxygenSaturationPercent !== undefined ? (
              <BodyReading
                label="Blood oxygen"
                value={`${metrics.oxygenSaturationPercent.toFixed(1)}%`}
              />
            ) : null}
            {metrics?.respiratoryRatePerMinute !== undefined ? (
              <BodyReading
                label="Breathing"
                value={`${metrics.respiratoryRatePerMinute.toFixed(1)}/min`}
              />
            ) : null}
            {metrics?.heartRateVariabilityRmssdMs !== undefined ? (
              <BodyReading
                label="HRV (RMSSD)"
                value={`${metrics.heartRateVariabilityRmssdMs.toFixed(0)} ms`}
              />
            ) : null}
            {metrics?.vo2MaxMillilitresPerKilogramMinute !== undefined ? (
              <BodyReading
                label="VO₂ max"
                value={`${metrics.vo2MaxMillilitresPerKilogramMinute.toFixed(1)}`}
              />
            ) : null}
            {metrics?.bodyTemperatureCelsius !== undefined ? (
              <BodyReading
                label="Temperature"
                value={`${metrics.bodyTemperatureCelsius.toFixed(1)} °C`}
              />
            ) : null}
          </View>
        </View>
      ) : null}

      {sourceConflicts.length ? (
        <View
          style={[
            styles.sourceWarning,
            {
              backgroundColor: `${colors.warning}12`,
              borderRadius: radius.md,
            },
          ]}
        >
          <Ionicons
            accessibilityElementsHidden
            color={colors.warning}
            name="git-compare-outline"
            size={17}
          />
          <Text style={[styles.sourceWarningText, { color: colors.textSecondary }]}>
            Choose a source in Sources for{' '}
            {sourceConflicts.map(metricCategoryLabel).join(', ')} to
            prevent double counting.
          </Text>
        </View>
      ) : metrics?.sourceLabels.length ? (
        <Text style={[styles.sourceText, { color: colors.textTertiary }]}>
          From {metrics.sourceLabels.join(', ')} through Health Connect
        </Text>
      ) : (
        <Text style={[styles.sourceText, { color: colors.textTertiary }]}>
          Connect Samsung Health or another Health Connect source to fill this
          view automatically.
        </Text>
      )}
    </SectionCard>
  );
}

function BodyReading({ label, value }: { label: string; value: string }) {
  const { colors } = useAppTheme();
  return (
    <View style={styles.bodyReading}>
      <Text style={[styles.bodyValue, { color: colors.text }]}>{value}</Text>
      <Text style={[styles.bodyLabel, { color: colors.textSecondary }]}>
        {label}
      </Text>
    </View>
  );
}

function Metric({
  detail,
  icon,
  label,
  value,
}: {
  detail?: string;
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value: string;
}) {
  const { colors, radius } = useAppTheme();
  return (
    <View
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
        name={icon}
        size={18}
      />
      <Text style={[styles.metricValue, { color: colors.text }]}>{value}</Text>
      <Text style={[styles.metricLabel, { color: colors.textSecondary }]}>
        {label}
      </Text>
      {detail ? (
        <Text style={[styles.metricDetail, { color: colors.textTertiary }]}>
          {detail}
        </Text>
      ) : null}
    </View>
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
    fontSize: 10,
    lineHeight: 14,
    fontWeight: '900',
    letterSpacing: 1,
  },
  title: {
    fontSize: 19,
    lineHeight: 25,
    fontWeight: '800',
    marginTop: 2,
  },
  date: {
    fontSize: 11,
    lineHeight: 16,
    marginTop: 1,
  },
  stepsHero: {
    borderWidth: StyleSheet.hairlineWidth,
    minHeight: 150,
    marginTop: 17,
    padding: 15,
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: 14,
  },
  stepsCopy: {
    flex: 1,
    justifyContent: 'center',
  },
  stepsLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  stepsLabel: {
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '700',
  },
  stepsValue: {
    fontSize: 33,
    lineHeight: 40,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
    letterSpacing: -1,
    marginTop: 5,
  },
  stepsAverage: {
    fontSize: 9,
    lineHeight: 14,
    marginTop: 3,
  },
  bars: {
    width: 125,
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: 4,
  },
  barColumn: {
    flex: 1,
    alignItems: 'center',
  },
  barTrack: {
    width: 9,
    height: 62,
    justifyContent: 'flex-end',
    overflow: 'hidden',
  },
  barFill: {
    width: '100%',
  },
  dayLabel: {
    fontSize: 8,
    lineHeight: 11,
    fontWeight: '700',
    marginTop: 4,
  },
  metricGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 9,
    marginTop: 11,
  },
  metric: {
    width: '48%',
    minHeight: 103,
    padding: 12,
  },
  metricValue: {
    fontSize: 18,
    lineHeight: 24,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
    marginTop: 7,
  },
  metricLabel: {
    fontSize: 10,
    lineHeight: 15,
  },
  metricDetail: {
    fontSize: 8,
    lineHeight: 12,
    marginTop: 1,
  },
  detailsToggle: {
    minHeight: 58,
    borderWidth: StyleSheet.hairlineWidth,
    marginTop: 11,
    paddingHorizontal: 13,
    paddingVertical: 9,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  detailsToggleCopy: {
    flex: 1,
  },
  detailsToggleTitle: {
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '800',
  },
  detailsToggleDetail: {
    fontSize: 9,
    lineHeight: 14,
    marginTop: 1,
    textTransform: 'capitalize',
  },
  bodyCard: {
    borderWidth: StyleSheet.hairlineWidth,
    marginTop: 11,
    padding: 13,
  },
  bodyHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  bodyIcon: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bodyHeaderCopy: {
    flex: 1,
  },
  bodyTitle: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '800',
  },
  bodyDescription: {
    fontSize: 9,
    lineHeight: 13,
    marginTop: 1,
  },
  bodyGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 12,
  },
  bodyReading: {
    minWidth: '30%',
    flexGrow: 1,
    paddingVertical: 4,
  },
  bodyValue: {
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  bodyLabel: {
    fontSize: 9,
    lineHeight: 13,
    marginTop: 1,
  },
  sourceWarning: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    padding: 11,
    marginTop: 13,
  },
  sourceWarningText: {
    flex: 1,
    fontSize: 10,
    lineHeight: 15,
  },
  sourceText: {
    fontSize: 10,
    lineHeight: 15,
    marginTop: 13,
  },
});
