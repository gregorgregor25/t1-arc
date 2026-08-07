import Ionicons from '@expo/vector-icons/Ionicons';
import { useMemo, useState } from 'react';
import {
  LayoutChangeEvent,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import Svg, { Circle, Line, Path } from 'react-native-svg';

import { SectionCard } from '@/components/SectionCard';
import { HealthTrendDay } from '@/data/healthConnect/dailyHealthMetrics';
import { formatShortDate } from '@/domain/time';
import { useAppTheme } from '@/theme/theme';

import {
  ChartExpandButton,
  FullscreenChartModal,
} from './FullscreenChart';

type TrendValue = number | undefined;
type TrendGroup = 'activity' | 'recovery' | 'body' | 'vitals' | 'context';

interface TrendDefinition {
  id: string;
  group: TrendGroup;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  values: TrendValue[];
  summary: 'average' | 'latest' | 'total';
  format(value: number): string;
  color: string;
}

const TREND_GROUPS: Array<{
  id: TrendGroup;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  emptyDetail: string;
}> = [
  {
    id: 'activity',
    label: 'Activity',
    icon: 'walk-outline',
    emptyDetail:
      'No selected-source movement, energy or workout records were received in this period.',
  },
  {
    id: 'recovery',
    label: 'Recovery',
    icon: 'moon-outline',
    emptyDetail:
      'No sleep, heart-rate or hydration records were received in this period.',
  },
  {
    id: 'body',
    label: 'Body',
    icon: 'body-outline',
    emptyDetail:
      'No weight or body-composition measurements were received in this period.',
  },
  {
    id: 'vitals',
    label: 'Vitals',
    icon: 'pulse-outline',
    emptyDetail:
      'No Health Connect blood-glucose or vital-sign measurements were received in this period.',
  },
  {
    id: 'context',
    label: 'Context',
    icon: 'layers-outline',
    emptyDetail:
      'No meals, medication or hormone context was logged in this period.',
  },
];

function sourceConflictLabel(value: string) {
  if (value === 'active_calories') return 'active energy';
  if (value === 'heart_rate') return 'heart rate';
  if (value === 'body_composition') return 'body composition';
  if (value === 'blood_glucose') return 'Health Connect glucose';
  if (value === 'nutrition') return 'meals';
  if (value === 'cycle') return 'cycle context';
  return value;
}

function hasRecordedValue(definition: TrendDefinition) {
  return definition.values.some(
    (value) => value !== undefined && Number.isFinite(value),
  );
}

function presentValue(
  values: TrendValue[],
  summary: TrendDefinition['summary'],
) {
  const present = values.filter(
    (value): value is number =>
      value !== undefined && Number.isFinite(value),
  );
  if (!present.length) return undefined;
  if (summary === 'latest') return present[present.length - 1];
  const total = present.reduce((sum, value) => sum + value, 0);
  return summary === 'total' ? total : total / present.length;
}

function chartPaths(values: TrendValue[], width: number, height: number) {
  const present = values.filter(
    (value): value is number =>
      value !== undefined && Number.isFinite(value),
  );
  if (!present.length || width <= 0) {
    return { paths: [] as string[], lastPoint: undefined };
  }
  const rawMinimum = Math.min(...present);
  const rawMaximum = Math.max(...present);
  const padding = Math.max((rawMaximum - rawMinimum) * 0.12, 0.5);
  const minimum = rawMinimum - padding;
  const maximum = rawMaximum + padding;
  const span = Math.max(1, maximum - minimum);
  const xFor = (index: number) =>
    values.length <= 1 ? width / 2 : (index / (values.length - 1)) * width;
  const yFor = (value: number) =>
    height - ((value - minimum) / span) * height;
  const paths: string[] = [];
  let current = '';
  let lastPoint: { x: number; y: number } | undefined;

  values.forEach((value, index) => {
    if (value === undefined || !Number.isFinite(value)) {
      if (current) paths.push(current);
      current = '';
      return;
    }
    const x = xFor(index);
    const y = yFor(value);
    current += `${current ? ' L' : 'M'} ${x.toFixed(1)} ${y.toFixed(1)}`;
    lastPoint = { x, y };
  });
  if (current) paths.push(current);
  return { lastPoint, paths };
}

function MiniTrend({
  color,
  height = 62,
  label,
  values,
}: {
  color: string;
  height?: number;
  label: string;
  values: TrendValue[];
}) {
  const { colors } = useAppTheme();
  const [width, setWidth] = useState(0);
  const { lastPoint, paths } = useMemo(
    () => chartPaths(values, width, height),
    [height, values, width],
  );
  function measure(event: LayoutChangeEvent) {
    setWidth(Math.round(event.nativeEvent.layout.width));
  }

  return (
    <View
      accessibilityLabel={`${label} trend chart`}
      onLayout={measure}
      style={[styles.chart, { height }]}
    >
      {width ? (
        <Svg height={height} width={width}>
          <Line
            stroke={colors.grid}
            strokeDasharray="3 5"
            strokeWidth={1}
            x1={0}
            x2={width}
            y1={height / 2}
            y2={height / 2}
          />
          {paths.map((path, index) => (
            <Path
              d={path}
              fill="none"
              key={`${path}-${index}`}
              stroke={color}
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2.5}
            />
          ))}
          {lastPoint ? (
            <Circle
              cx={lastPoint.x}
              cy={lastPoint.y}
              fill={color}
              r={4}
              stroke={colors.surfaceElevated}
              strokeWidth={2}
            />
          ) : null}
        </Svg>
      ) : null}
    </View>
  );
}

function TrendTile({
  definition,
  expanded = false,
}: {
  definition: TrendDefinition;
  expanded?: boolean;
}) {
  const { colors, radius } = useAppTheme();
  const window = useWindowDimensions();
  const [showExpanded, setShowExpanded] = useState(false);
  const summary = presentValue(definition.values, definition.summary);
  const recorded = definition.values.filter(
    (value) => value !== undefined,
  ).length;

  return (
    <>
      <View
      style={[
        styles.tile,
        expanded && styles.expandedTile,
        {
          backgroundColor: colors.surfaceMuted,
          borderColor: colors.border,
          borderRadius: radius.lg,
        },
      ]}
      >
      <View style={styles.tileHeader}>
        <View
          style={[
            styles.tileIcon,
            {
              backgroundColor: `${definition.color}18`,
              borderRadius: radius.sm,
            },
          ]}
        >
          <Ionicons
            accessibilityElementsHidden
            color={definition.color}
            name={definition.icon}
            size={18}
          />
        </View>
        <View style={styles.tileHeading}>
          <Text style={[styles.tileLabel, { color: colors.textSecondary }]}>
            {definition.label}
          </Text>
          <Text style={[styles.tileValue, { color: colors.text }]}>
            {summary === undefined ? '—' : definition.format(summary)}
          </Text>
        </View>
        {!expanded ? (
          <ChartExpandButton
            label={`Open ${definition.label} trend full screen`}
            onPress={() => setShowExpanded(true)}
          />
        ) : null}
      </View>
      <MiniTrend
        color={definition.color}
          height={
            expanded
              ? Math.max(190, Math.min(250, window.height - 210))
              : 62
        }
        label={definition.label}
        values={definition.values}
      />
      <Text style={[styles.tileMeta, { color: colors.textTertiary }]}>
        {recorded
          ? `${definition.summary === 'average' ? 'Average' : definition.summary === 'total' ? 'Total' : 'Latest'} · ${recorded} recorded ${recorded === 1 ? 'day' : 'days'}`
          : 'No records in this period'}
      </Text>
      </View>
      {!expanded ? (
        <FullscreenChartModal
          detail={`${recorded} recorded ${recorded === 1 ? 'day' : 'days'} in the selected range`}
          onClose={() => setShowExpanded(false)}
          title={definition.label}
          visible={showExpanded}
        >
          <TrendTile definition={definition} expanded />
        </FullscreenChartModal>
      ) : null}
    </>
  );
}

export function HealthTrendsCard({
  days,
  trend,
}: {
  days: number;
  trend: HealthTrendDay[];
}) {
  const { colors, radius } = useAppTheme();
  const recordedDays = trend.filter(
    (day) =>
      day.metrics.recordCount ||
      day.sleepMinutes > 0 ||
      day.workoutMinutes > 0 ||
      day.mealCount > 0 ||
      day.medicationCount > 0 ||
      day.hormoneRecordCount > 0,
  ).length;
  const sourceConflicts = [
    ...new Set(
      trend.flatMap((day) => [
        ...day.metrics.needsSource,
        ...day.contextNeedsSource,
      ]),
    ),
  ];
  const definitions: TrendDefinition[] = [
    {
      id: 'steps',
      group: 'activity',
      label: 'Daily steps',
      icon: 'footsteps-outline',
      values: trend.map((day) => day.metrics.steps),
      summary: 'average',
      format: (value) => Math.round(value).toLocaleString('en-GB'),
      color: colors.primary,
    },
    {
      id: 'distance',
      group: 'activity',
      label: 'Distance',
      icon: 'map-outline',
      values: trend.map((day) => day.metrics.distanceKilometres),
      summary: 'average',
      format: (value) => `${value.toFixed(1)} km`,
      color: colors.primary,
    },
    {
      id: 'workouts',
      group: 'activity',
      label: 'Workout time',
      icon: 'barbell-outline',
      values: trend.map((day) =>
        day.workoutMinutes ? day.workoutMinutes : undefined,
      ),
      summary: 'total',
      format: (value) => `${Math.round(value)} min`,
      color: colors.accent,
    },
    {
      id: 'active-energy',
      group: 'activity',
      label: 'Active energy',
      icon: 'flame-outline',
      values: trend.map((day) => day.metrics.activeCaloriesKcal),
      summary: 'average',
      format: (value) => `${Math.round(value)} kcal`,
      color: colors.warning,
    },
    {
      id: 'total-energy',
      group: 'activity',
      label: 'Total energy',
      icon: 'flash-outline',
      values: trend.map((day) => day.metrics.totalCaloriesKcal),
      summary: 'average',
      format: (value) => `${Math.round(value)} kcal`,
      color: colors.warning,
    },
    {
      id: 'elevation',
      group: 'activity',
      label: 'Elevation gained',
      icon: 'trending-up-outline',
      values: trend.map((day) => day.metrics.elevationGainedMetres),
      summary: 'total',
      format: (value) => `${Math.round(value)} m`,
      color: colors.primary,
    },
    {
      id: 'floors',
      group: 'activity',
      label: 'Floors climbed',
      icon: 'business-outline',
      values: trend.map((day) => day.metrics.floorsClimbed),
      summary: 'total',
      format: (value) => `${Math.round(value)} floors`,
      color: colors.primary,
    },
    {
      id: 'workout-power',
      group: 'activity',
      label: 'Workout power',
      icon: 'speedometer-outline',
      values: trend.map((day) => day.metrics.averageWorkoutPowerWatts),
      summary: 'average',
      format: (value) => `${Math.round(value)} W`,
      color: colors.accent,
    },
    {
      id: 'workout-speed',
      group: 'activity',
      label: 'Workout speed',
      icon: 'navigate-outline',
      values: trend.map((day) =>
        day.metrics.averageWorkoutSpeedMetresPerSecond === undefined
          ? undefined
          : day.metrics.averageWorkoutSpeedMetresPerSecond * 3.6,
      ),
      summary: 'average',
      format: (value) => `${value.toFixed(1)} km/h`,
      color: colors.accent,
    },
    {
      id: 'walking-cadence',
      group: 'activity',
      label: 'Walking cadence',
      icon: 'footsteps-outline',
      values: trend.map(
        (day) => day.metrics.averageWalkingCadencePerMinute,
      ),
      summary: 'average',
      format: (value) => `${Math.round(value)} steps/min`,
      color: colors.primary,
    },
    {
      id: 'cycling-cadence',
      group: 'activity',
      label: 'Cycling cadence',
      icon: 'bicycle-outline',
      values: trend.map((day) => day.metrics.averageCyclingCadenceRpm),
      summary: 'average',
      format: (value) => `${Math.round(value)} rpm`,
      color: colors.primary,
    },
    {
      id: 'sleep',
      group: 'recovery',
      label: 'Sleep',
      icon: 'moon-outline',
      values: trend.map((day) =>
        day.sleepMinutes ? day.sleepMinutes / 60 : undefined,
      ),
      summary: 'average',
      format: (value) => `${value.toFixed(1)} h`,
      color: colors.insulin,
    },
    {
      id: 'average-heart-rate',
      group: 'recovery',
      label: 'Average heart rate',
      icon: 'heart-outline',
      values: trend.map((day) => day.metrics.averageHeartRateBpm),
      summary: 'average',
      format: (value) => `${Math.round(value)} bpm`,
      color: colors.low,
    },
    {
      id: 'resting-heart-rate',
      group: 'recovery',
      label: 'Resting heart rate',
      icon: 'heart-outline',
      values: trend.map((day) => day.metrics.restingHeartRateBpm),
      summary: 'average',
      format: (value) => `${Math.round(value)} bpm`,
      color: colors.low,
    },
    {
      id: 'hrv',
      group: 'recovery',
      label: 'Heart-rate variability',
      icon: 'pulse-outline',
      values: trend.map(
        (day) => day.metrics.heartRateVariabilityRmssdMs,
      ),
      summary: 'average',
      format: (value) => `${Math.round(value)} ms`,
      color: colors.insulin,
    },
    {
      id: 'respiratory-rate',
      group: 'recovery',
      label: 'Respiratory rate',
      icon: 'cloud-outline',
      values: trend.map((day) => day.metrics.respiratoryRatePerMinute),
      summary: 'average',
      format: (value) => `${value.toFixed(1)} /min`,
      color: colors.insulin,
    },
    {
      id: 'hydration',
      group: 'recovery',
      label: 'Logged hydration',
      icon: 'water-outline',
      values: trend.map((day) => day.metrics.hydrationLitres),
      summary: 'average',
      format: (value) => `${value.toFixed(2)} L`,
      color: colors.primary,
    },
    {
      id: 'weight',
      group: 'body',
      label: 'Weight',
      icon: 'scale-outline',
      values: trend.map((day) => day.metrics.weightKilograms),
      summary: 'latest',
      format: (value) => `${value.toFixed(1)} kg`,
      color: colors.high,
    },
    {
      id: 'body-fat',
      group: 'body',
      label: 'Body fat',
      icon: 'body-outline',
      values: trend.map((day) => day.metrics.bodyFatPercent),
      summary: 'latest',
      format: (value) => `${value.toFixed(1)}%`,
      color: colors.high,
    },
    {
      id: 'lean-mass',
      group: 'body',
      label: 'Lean body mass',
      icon: 'fitness-outline',
      values: trend.map((day) => day.metrics.leanBodyMassKilograms),
      summary: 'latest',
      format: (value) => `${value.toFixed(1)} kg`,
      color: colors.accent,
    },
    {
      id: 'body-water',
      group: 'body',
      label: 'Body water',
      icon: 'water-outline',
      values: trend.map((day) => day.metrics.bodyWaterMassKilograms),
      summary: 'latest',
      format: (value) => `${value.toFixed(1)} kg`,
      color: colors.primary,
    },
    {
      id: 'bone-mass',
      group: 'body',
      label: 'Bone mass',
      icon: 'accessibility-outline',
      values: trend.map((day) => day.metrics.boneMassKilograms),
      summary: 'latest',
      format: (value) => `${value.toFixed(1)} kg`,
      color: colors.textSecondary,
    },
    {
      id: 'bmr',
      group: 'body',
      label: 'Basal metabolic rate',
      icon: 'flame-outline',
      values: trend.map(
        (day) => day.metrics.basalMetabolicRateKcalPerDay,
      ),
      summary: 'latest',
      format: (value) => `${Math.round(value)} kcal/day`,
      color: colors.warning,
    },
    {
      id: 'health-glucose',
      group: 'vitals',
      label: 'Health Connect glucose',
      icon: 'water-outline',
      values: trend.map((day) => day.metrics.bloodGlucoseMmolL),
      summary: 'latest',
      format: (value) => `${value.toFixed(1)} mmol/L`,
      color: colors.glucose,
    },
    {
      id: 'systolic',
      group: 'vitals',
      label: 'Systolic pressure',
      icon: 'heart-outline',
      values: trend.map((day) => day.metrics.bloodPressureSystolic),
      summary: 'latest',
      format: (value) => `${Math.round(value)} mmHg`,
      color: colors.low,
    },
    {
      id: 'diastolic',
      group: 'vitals',
      label: 'Diastolic pressure',
      icon: 'heart-outline',
      values: trend.map((day) => day.metrics.bloodPressureDiastolic),
      summary: 'latest',
      format: (value) => `${Math.round(value)} mmHg`,
      color: colors.low,
    },
    {
      id: 'oxygen',
      group: 'vitals',
      label: 'Blood oxygen',
      icon: 'pulse-outline',
      values: trend.map((day) => day.metrics.oxygenSaturationPercent),
      summary: 'latest',
      format: (value) => `${value.toFixed(1)}%`,
      color: colors.primary,
    },
    {
      id: 'vo2-max',
      group: 'vitals',
      label: 'VO₂ max',
      icon: 'fitness-outline',
      values: trend.map(
        (day) => day.metrics.vo2MaxMillilitresPerKilogramMinute,
      ),
      summary: 'latest',
      format: (value) => `${value.toFixed(1)} ml/kg/min`,
      color: colors.accent,
    },
    {
      id: 'body-temperature',
      group: 'vitals',
      label: 'Body temperature',
      icon: 'thermometer-outline',
      values: trend.map((day) => day.metrics.bodyTemperatureCelsius),
      summary: 'latest',
      format: (value) => `${value.toFixed(1)} °C`,
      color: colors.warning,
    },
    {
      id: 'carbs',
      group: 'context',
      label: 'Carbohydrate logged',
      icon: 'restaurant-outline',
      values: trend.map((day) =>
        day.mealCount ? day.mealCarbsGrams : undefined,
      ),
      summary: 'total',
      format: (value) => `${Math.round(value)} g`,
      color: colors.warning,
    },
    {
      id: 'meals',
      group: 'context',
      label: 'Meals logged',
      icon: 'fast-food-outline',
      values: trend.map((day) =>
        day.mealCount ? day.mealCount : undefined,
      ),
      summary: 'total',
      format: (value) =>
        `${Math.round(value)} ${Math.round(value) === 1 ? 'meal' : 'meals'}`,
      color: colors.warning,
    },
    {
      id: 'medications',
      group: 'context',
      label: 'Medication records',
      icon: 'medical-outline',
      values: trend.map((day) =>
        day.medicationCount ? day.medicationCount : undefined,
      ),
      summary: 'total',
      format: (value) =>
        `${Math.round(value)} ${Math.round(value) === 1 ? 'record' : 'records'}`,
      color: colors.insulin,
    },
    {
      id: 'hormones',
      group: 'context',
      label: 'Hormone context days',
      icon: 'calendar-outline',
      values: trend.map((day) =>
        day.hormoneRecordCount ? 1 : undefined,
      ),
      summary: 'total',
      format: (value) =>
        `${Math.round(value)} ${Math.round(value) === 1 ? 'day' : 'days'}`,
      color: colors.accent,
    },
  ];
  const [selectedGroup, setSelectedGroup] = useState<TrendGroup>(() =>
    TREND_GROUPS.reduce(
      (best, group) => {
        const recorded = definitions.filter(
          (definition) =>
            definition.group === group.id &&
            hasRecordedValue(definition),
        ).length;
        return recorded > best.recorded
          ? { group: group.id, recorded }
          : best;
      },
      { group: 'activity' as TrendGroup, recorded: 0 },
    ).group,
  );
  const selectedDefinitions = definitions.filter(
    (definition) =>
      definition.group === selectedGroup &&
      hasRecordedValue(definition),
  );
  const selectedGroupDefinition = TREND_GROUPS.find(
    (group) => group.id === selectedGroup,
  )!;
  const supportedInGroup = definitions.filter(
    (definition) => definition.group === selectedGroup,
  ).length;

  return (
    <SectionCard>
      <View style={styles.header}>
        <View>
          <Text style={[styles.eyebrow, { color: colors.accent }]}>
            HEALTH HISTORY
          </Text>
          <Text style={[styles.title, { color: colors.text }]}>
            {days}-day trends
          </Text>
          {trend.length ? (
            <Text style={[styles.range, { color: colors.textSecondary }]}>
              {formatShortDate(trend[0]!.date)}–{formatShortDate(
                trend[trend.length - 1]!.date,
              )}
            </Text>
          ) : null}
        </View>
        <View
          style={[
            styles.coverage,
            {
              backgroundColor: `${colors.accent}14`,
              borderRadius: radius.pill,
            },
          ]}
        >
          <Text style={[styles.coverageValue, { color: colors.accent }]}>
            {recordedDays}/{trend.length || days}
          </Text>
          <Text style={[styles.coverageLabel, { color: colors.textSecondary }]}>
            days
          </Text>
        </View>
      </View>

      {sourceConflicts.length ? (
        <View
          style={[
            styles.warning,
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
            size={18}
          />
          <Text style={[styles.warningText, { color: colors.textSecondary }]}>
            Choose one source for{' '}
            {sourceConflicts.map(sourceConflictLabel).join(', ')} before
            these totals can be calculated without double counting.
          </Text>
        </View>
      ) : null}

      <View
        accessibilityLabel="Health trend category"
        style={styles.groupSelector}
      >
        {TREND_GROUPS.map((group) => {
          const selected = group.id === selectedGroup;
          const available = definitions.filter(
            (definition) =>
              definition.group === group.id &&
              hasRecordedValue(definition),
          ).length;
          return (
            <Pressable
              accessibilityLabel={`${group.label}, ${available} recorded metrics`}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              key={group.id}
              onPress={() => setSelectedGroup(group.id)}
              style={({ pressed }) => [
                styles.groupButton,
                {
                  backgroundColor: selected
                    ? `${colors.primary}18`
                    : colors.surfaceMuted,
                  borderColor: selected
                    ? `${colors.primary}88`
                    : colors.border,
                  borderRadius: radius.md,
                  opacity: pressed ? 0.68 : 1,
                },
              ]}
            >
              <Ionicons
                accessibilityElementsHidden
                color={selected ? colors.primary : colors.textSecondary}
                name={group.icon}
                size={17}
              />
              <Text
                style={[
                  styles.groupLabel,
                  {
                    color: selected ? colors.text : colors.textSecondary,
                  },
                ]}
              >
                {group.label}
              </Text>
              <Text
                style={[
                  styles.groupCount,
                  {
                    color: selected ? colors.primary : colors.textTertiary,
                  },
                ]}
              >
                {available}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <View style={styles.tiles}>
        {selectedDefinitions.map((definition) => (
          <TrendTile definition={definition} key={definition.id} />
        ))}
      </View>

      {!selectedDefinitions.length ? (
        <View
          style={[
            styles.emptyGroup,
            {
              backgroundColor: colors.surfaceMuted,
              borderColor: colors.border,
              borderRadius: radius.lg,
            },
          ]}
        >
          <Ionicons
            accessibilityElementsHidden
            color={colors.textTertiary}
            name={selectedGroupDefinition.icon}
            size={22}
          />
          <View style={styles.emptyGroupCopy}>
            <Text style={[styles.emptyGroupTitle, { color: colors.text }]}>
              No {selectedGroupDefinition.label.toLowerCase()} history
            </Text>
            <Text
              style={[
                styles.emptyGroupDetail,
                { color: colors.textSecondary },
              ]}
            >
              {selectedGroupDefinition.emptyDetail}
            </Text>
          </View>
        </View>
      ) : supportedInGroup > selectedDefinitions.length ? (
        <Text style={[styles.hiddenMetrics, { color: colors.textTertiary }]}>
          {supportedInGroup - selectedDefinitions.length} other supported{' '}
          {selectedGroupDefinition.label.toLowerCase()}{' '}
          {supportedInGroup - selectedDefinitions.length === 1
            ? 'metric has'
            : 'metrics have'}{' '}
          no record in this period.
        </Text>
      ) : null}

      <Text style={[styles.note, { color: colors.textTertiary }]}>
        Gaps mean no selected-source record was available. Values are
        deterministic summaries of the underlying records stored on this
        phone.
      </Text>
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
    letterSpacing: 1.1,
  },
  title: {
    marginTop: 3,
    fontSize: 21,
    lineHeight: 27,
    fontWeight: '800',
    letterSpacing: -0.35,
  },
  range: {
    marginTop: 3,
    fontSize: 12,
    lineHeight: 17,
  },
  coverage: {
    minWidth: 58,
    minHeight: 48,
    paddingHorizontal: 12,
    paddingVertical: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  coverageValue: {
    fontSize: 14,
    lineHeight: 18,
    fontWeight: '800',
  },
  coverageLabel: {
    fontSize: 10,
    lineHeight: 13,
    fontWeight: '700',
  },
  warning: {
    marginTop: 15,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 9,
  },
  warningText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 18,
  },
  groupSelector: {
    marginTop: 16,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  groupButton: {
    minHeight: 40,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  groupLabel: {
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '700',
  },
  groupCount: {
    minWidth: 17,
    fontSize: 10,
    lineHeight: 14,
    fontWeight: '800',
    textAlign: 'right',
    fontVariant: ['tabular-nums'],
  },
  tiles: {
    marginTop: 16,
    gap: 12,
  },
  tile: {
    borderWidth: StyleSheet.hairlineWidth,
    padding: 14,
  },
  expandedTile: {
    flex: 1,
    padding: 16,
  },
  tileHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  tileIcon: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tileHeading: {
    flex: 1,
  },
  tileLabel: {
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '700',
  },
  tileValue: {
    marginTop: 1,
    fontSize: 20,
    lineHeight: 25,
    fontWeight: '800',
    letterSpacing: -0.25,
  },
  chart: {
    height: 62,
    marginTop: 12,
  },
  tileMeta: {
    marginTop: 6,
    fontSize: 10,
    lineHeight: 14,
    fontWeight: '600',
  },
  emptyGroup: {
    marginTop: 16,
    minHeight: 92,
    padding: 15,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 11,
  },
  emptyGroupCopy: {
    flex: 1,
  },
  emptyGroupTitle: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '700',
  },
  emptyGroupDetail: {
    marginTop: 3,
    fontSize: 11,
    lineHeight: 17,
  },
  hiddenMetrics: {
    marginTop: 10,
    fontSize: 10,
    lineHeight: 15,
  },
  note: {
    marginTop: 14,
    fontSize: 11,
    lineHeight: 17,
  },
});
