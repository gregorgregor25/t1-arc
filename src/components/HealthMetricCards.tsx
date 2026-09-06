import Ionicons from "@expo/vector-icons/Ionicons";
import { LinearGradient } from "expo-linear-gradient";
import { useEffect, useMemo, useState } from "react";
import {
  LayoutChangeEvent,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Svg, { Circle, Line, Path } from "react-native-svg";

import { observeStepGoal, saveStepGoal } from "@/data/healthGoals";
import type { HealthTrendDay } from "@/data/healthConnect/dailyHealthMetrics";
import { readHealthMetricSnapshot } from "@/data/healthMetricReader";
import { useDataContext } from "@/providers/DataProvider";
import { DemoModeNotice } from "./DemoModeNotice";
import type {
  DailyHealthMetrics,
  DailyMetricRecord,
} from "@/domain/dailyHealthMetrics";
import type { ActivityEvent, HealthContextEvent } from "@/domain/models";
import { contextNoteDisplayTitle } from "@/domain/contextNotes";
import { formatStrengthWorkoutSet } from "@/domain/strengthWorkoutPresentation";
import { dayRange, formatDate } from "@/domain/time";
import { summarizeWorkoutHeartRate } from "@/domain/workoutHeartRate";
import { mealNutritionSummary } from "@/domain/mealNutrition";
import { nutritionCoverageNeedsReview } from "@/domain/healthTrendContext";
import {
  formatDistance,
  formatElevation,
  formatEnergy,
  formatGlucose,
  formatHeight,
  formatRegionalFixedNumber,
  formatRegionalNumber,
  formatSpeed,
  formatTemperature,
  formatVolumeLitres,
  formatWeight,
} from "@/domain/regionalFormat";
import {
  formatRegionalNumberInput,
  normalizeRegionalNumberInput,
} from "@/domain/regionalNumberInput";
import { getRuntimeRegionalDefaults } from "@/domain/regionalProfileRuntime";
import { useRegionalProfile } from "@/providers/RegionalProfileProvider";
import { useAppTheme } from "@/theme/theme";

import { SectionCard } from "./SectionCard";
import {
  buildMetricChartGeometry,
  healthMetricIntervalPresentation,
  healthMetricTrendWindowLabel,
  resolveDailyMetricDisplay,
  selectedTrendIndex,
  stepProgressStatus,
} from "./healthMetrics/presentation";

type ChartKind = "bar" | "line";
interface MetricDetail {
  label: string;
  value: string;
}

interface MetricDefinition {
  id: string;
  available: boolean;
  chart: ChartKind;
  color: string;
  detail: string;
  format(value: number): string;
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  primary: string;
  secondary: MetricDetail[];
  status: string;
  summary: "average" | "latest" | "total";
  values: (number | undefined)[];
}

const METRIC_RECORD_KINDS: Record<string, DailyMetricRecord["kind"][]> = {
  weight: ["weight"],
  "blood-pressure": ["blood_pressure_systolic", "blood_pressure_diastolic"],
  "heart-rate": ["heart_rate", "resting_heart_rate"],
  steps: ["steps"],
  hydration: ["hydration"],
  distance: ["distance", "elevation_gained", "floors_climbed"],
  energy: ["active_calories", "total_calories"],
  workouts: [
    "workout_power",
    "workout_speed",
    "walking_cadence",
    "cycling_cadence",
    "heart_rate",
  ],
  "body-composition": [
    "body_fat",
    "lean_body_mass",
    "body_water_mass",
    "bone_mass",
    "height",
    "basal_metabolic_rate",
  ],
  "health-glucose": ["blood_glucose"],
  oxygen: ["oxygen_saturation"],
  "respiratory-rate": ["respiratory_rate"],
  hrv: ["heart_rate_variability_rmssd"],
  "vo2-max": ["vo2_max"],
  temperature: ["body_temperature"],
};

function contextForMetric(metricId: string, event: HealthContextEvent) {
  if (metricId === "nutrition") return event.kind === "meal";
  if (metricId === "workouts") return event.kind === "activity";
  if (metricId === "sleep") return event.kind === "sleep";
  return (
    metricId === "cycle-context" &&
    event.kind === "note" &&
    event.category === "hormones"
  );
}

function metricRecordValue(record: DailyMetricRecord) {
  const regional = getRuntimeRegionalDefaults();
  const labels: Partial<Record<DailyMetricRecord["kind"], string>> = {
    steps: "Steps",
    distance: "Distance",
    blood_pressure_systolic: "Systolic",
    blood_pressure_diastolic: "Diastolic",
    resting_heart_rate: "Resting heart rate",
    heart_rate: "Heart rate",
    active_calories: "Active energy",
    total_calories: "Total energy",
    elevation_gained: "Elevation",
    floors_climbed: "Floors",
    lean_body_mass: "Lean mass",
    body_water_mass: "Body water",
    bone_mass: "Bone mass",
    basal_metabolic_rate: "Basal metabolic rate",
    hydration: "Hydration",
    oxygen_saturation: "Blood oxygen",
    respiratory_rate: "Respiratory rate",
    heart_rate_variability_rmssd: "HRV",
    vo2_max: "VO₂ max",
    body_temperature: "Body temperature",
    blood_glucose: "Glucose",
    weight: "Weight",
    body_fat: "Body fat",
    workout_power: "Workout power",
    workout_speed: "Workout speed",
    walking_cadence: "Walking cadence",
    cycling_cadence: "Cycling cadence",
  };
  const value =
    record.kind === "steps"
      ? `${formatRegionalNumber(Math.round(record.value), regional.locale, { maximumFractionDigits: 0 })} steps`
      : record.kind === "distance"
        ? formatDistance(record.value, regional)
        : record.kind === "height"
          ? regional.measurementSystem === "imperial"
            ? `${formatRegionalNumber(record.value * 39.37007874, regional.locale, { maximumFractionDigits: 2 })} in`
            : `${formatRegionalNumber(record.value * 100, regional.locale, { maximumFractionDigits: 2 })} cm`
          : record.kind === "workout_speed"
            ? formatSpeed(record.value, regional)
            : record.kind === "weight"
              ? formatWeight(record.value, regional)
              : record.kind === "blood_glucose"
                ? formatGlucose(record.value, regional)
                : record.kind === "body_temperature"
                  ? formatTemperature(record.value, regional)
                  : `${
                      Number.isInteger(record.value)
                        ? formatRegionalNumber(record.value, regional.locale, {
                            maximumFractionDigits: 0,
                          })
                        : formatRegionalFixedNumber(
                            record.value,
                            regional.locale,
                            1,
                          )
                    } ${record.unit}`;
  return `${labels[record.kind] ?? "Measurement"} · ${value}`;
}

function contextEventDetail(event: HealthContextEvent) {
  const regional = getRuntimeRegionalDefaults();
  if (event.kind === "meal") {
    return mealNutritionSummary(event, { includeItems: true });
  }
  if (event.kind === "activity") {
    return [
      `${formatRegionalNumber(Math.round(event.durationMinutes), regional.locale, { maximumFractionDigits: 0 })} min`,
      event.intensity === "unspecified" ? undefined : event.intensity,
      event.caloriesBurned === undefined
        ? undefined
        : formatEnergy(event.caloriesBurned, regional),
    ]
      .filter(Boolean)
      .join(" · ");
  }
  if (event.kind === "sleep") {
    return `${formatRegionalNumber(Math.round(event.durationMinutes), regional.locale, { maximumFractionDigits: 0 })} min`;
  }
  return event.kind === "note"
    ? (event.detail ?? "Recorded context")
    : "Recorded event";
}

function contextEventTitle(event: HealthContextEvent) {
  return event.kind === "note"
    ? contextNoteDisplayTitle(event, getRuntimeRegionalDefaults())
    : event.title;
}

function StrengthWorkoutTimelineRow({
  color,
  event,
  expanded,
  heartRateRecords,
  onToggle,
  selectedDate,
}: {
  color: string;
  event: ActivityEvent;
  expanded: boolean;
  heartRateRecords: DailyMetricRecord[];
  onToggle(): void;
  selectedDate: HealthTrendDay["date"];
}) {
  const { colors, radius } = useAppTheme();
  const { defaults: regional } = useRegionalProfile();
  const workout = event.strengthWorkout;
  if (!workout) return null;
  const end = event.end ?? event.start + event.durationMinutes * 60_000;
  const setCount = workout.exercises.reduce(
    (count, exercise) => count + exercise.sets.length,
    0,
  );
  const exerciseCount = workout.exercises.length;
  const description = workout.description?.trim();
  const heartRate = summarizeWorkoutHeartRate(
    { start: event.start, end },
    heartRateRecords,
  );
  const interval = healthMetricIntervalPresentation({
    end,
    selectedDate,
    start: event.start,
  });

  return (
    <View
      style={[
        styles.intradayWorkoutGroup,
        { borderBottomColor: colors.divider },
      ]}
    >
      <Pressable
        accessibilityHint={`${formatRegionalNumber(exerciseCount, regional.locale, { maximumFractionDigits: 0 })} ${
          exerciseCount === 1 ? "exercise" : "exercises"
        } and ${formatRegionalNumber(setCount, regional.locale, { maximumFractionDigits: 0 })} ${setCount === 1 ? "set" : "sets"}`}
        accessibilityLabel={`${contextEventTitle(event)}, ${contextEventDetail(event)}, ${interval.accessibilityLabel}. ${
          expanded ? "Hide" : "Show"
        } workout details`}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        onPress={onToggle}
        style={({ pressed }) => [
          styles.intradayWorkoutTrigger,
          pressed && { backgroundColor: `${color}0A` },
        ]}
      >
        <View style={styles.intradayTimeBlock}>
          <Text style={[styles.intradayTime, { color }]}>
            {interval.startLabel}
          </Text>
          {interval.endLabel ? (
            <Text
              style={[
                styles.intradayEnd,
                styles.workoutTimelineEnd,
                { color: colors.textTertiary },
              ]}
            >
              to {interval.endLabel}
            </Text>
          ) : null}
        </View>
        <View style={styles.intradayCopy}>
          <Text style={[styles.intradayLabel, { color: colors.text }]}>
            {contextEventTitle(event)}
          </Text>
          <Text
            style={[
              styles.intradayDetail,
              styles.workoutTimelineDetail,
              { color: colors.textSecondary },
            ]}
          >
            {contextEventDetail(event)}
          </Text>
          <View style={styles.workoutMetaRow}>
            <Text
              style={[styles.workoutSource, { color: colors.textTertiary }]}
            >
              Hevy
            </Text>
            <View
              style={[
                styles.workoutAffordance,
                {
                  backgroundColor: `${color}12`,
                  borderColor: `${color}2F`,
                  borderRadius: radius.pill,
                },
              ]}
            >
              <Text style={[styles.workoutAffordanceText, { color }]}>
                Workout details
              </Text>
              <Ionicons
                accessibilityElementsHidden
                color={color}
                name={expanded ? "chevron-up" : "chevron-down"}
                size={13}
              />
            </View>
          </View>
        </View>
      </Pressable>

      {expanded ? (
        <View
          style={[
            styles.workoutDetailPanel,
            {
              backgroundColor: colors.surfaceMuted,
              borderColor: colors.surfaceBorder,
              borderRadius: radius.lg,
            },
          ]}
        >
          <View style={styles.workoutDetailHeader}>
            <View>
              <Text style={[styles.workoutDetailTitle, { color: colors.text }]}>
                Workout
              </Text>
              <Text
                style={[
                  styles.workoutDetailCount,
                  { color: colors.textSecondary },
                ]}
              >
                {formatRegionalNumber(exerciseCount, regional.locale, {
                  maximumFractionDigits: 0,
                })}{" "}
                {exerciseCount === 1 ? "exercise" : "exercises"} ·{" "}
                {formatRegionalNumber(setCount, regional.locale, {
                  maximumFractionDigits: 0,
                })}{" "}
                {setCount === 1 ? "set" : "sets"}
              </Text>
            </View>
            <Ionicons
              accessibilityElementsHidden
              color={color}
              name="barbell-outline"
              size={20}
            />
          </View>

          {description ? (
            <Text
              style={[
                styles.workoutDescription,
                { color: colors.textSecondary },
              ]}
            >
              {description}
            </Text>
          ) : null}

          {heartRate ? (
            <View
              style={[
                styles.workoutHeartRate,
                {
                  backgroundColor: colors.surfaceElevated,
                  borderColor: colors.surfaceBorder,
                  borderRadius: radius.md,
                },
              ]}
            >
              <View style={styles.workoutHeartRateHeading}>
                <Ionicons
                  accessibilityElementsHidden
                  color={colors.low}
                  name="heart-outline"
                  size={18}
                />
                <Text
                  style={[styles.workoutHeartRateTitle, { color: colors.text }]}
                >
                  Heart rate
                </Text>
              </View>
              <View style={styles.workoutHeartRateValues}>
                <View style={styles.workoutHeartRateReading}>
                  <Text
                    style={[
                      styles.workoutHeartRateValue,
                      { color: colors.text },
                    ]}
                  >
                    {formatRegionalNumber(
                      Math.round(heartRate.averageBpm),
                      getRuntimeRegionalDefaults().locale,
                      { maximumFractionDigits: 0 },
                    )}{" "}
                    bpm
                  </Text>
                  <Text
                    style={[
                      styles.workoutHeartRateLabel,
                      { color: colors.textTertiary },
                    ]}
                  >
                    Average
                  </Text>
                </View>
                <View style={styles.workoutHeartRateReading}>
                  <Text
                    style={[
                      styles.workoutHeartRateValue,
                      { color: colors.text },
                    ]}
                  >
                    {formatRegionalNumber(
                      Math.round(heartRate.minimumBpm),
                      getRuntimeRegionalDefaults().locale,
                      { maximumFractionDigits: 0 },
                    )}
                    –
                    {formatRegionalNumber(
                      Math.round(heartRate.maximumBpm),
                      getRuntimeRegionalDefaults().locale,
                      { maximumFractionDigits: 0 },
                    )}{" "}
                    bpm
                  </Text>
                  <Text
                    style={[
                      styles.workoutHeartRateLabel,
                      { color: colors.textTertiary },
                    ]}
                  >
                    Range
                  </Text>
                </View>
              </View>
              <Text
                style={[
                  styles.workoutHeartRateSource,
                  { color: colors.textSecondary },
                ]}
              >
                Heart rate from Health Connect
              </Text>
              <Text
                style={[
                  styles.workoutHeartRateProvenance,
                  { color: colors.textTertiary },
                ]}
              >
                Source · {heartRate.sourceLabels.join(", ")}
              </Text>
            </View>
          ) : null}

          {workout.exercises.length ? (
            <View style={styles.workoutExerciseList}>
              {workout.exercises.map((exercise, exercisePosition) => {
                const notes = exercise.notes?.trim();
                return (
                  <View
                    key={`${exercise.index}:${exercise.title}:${exercisePosition}`}
                    style={[
                      styles.workoutExercise,
                      exercisePosition > 0 && {
                        borderTopColor: colors.divider,
                        borderTopWidth: StyleSheet.hairlineWidth,
                      },
                    ]}
                  >
                    <View style={styles.workoutExerciseHeading}>
                      <View
                        style={[
                          styles.workoutExerciseNumber,
                          {
                            backgroundColor: `${color}16`,
                            borderRadius: radius.pill,
                          },
                        ]}
                      >
                        <Text
                          style={[styles.workoutExerciseNumberText, { color }]}
                        >
                          {exercisePosition + 1}
                        </Text>
                      </View>
                      <Text
                        style={[
                          styles.workoutExerciseTitle,
                          { color: colors.text },
                        ]}
                      >
                        {exercise.title}
                      </Text>
                    </View>
                    {notes ? (
                      <Text
                        style={[
                          styles.workoutExerciseNotes,
                          { color: colors.textSecondary },
                        ]}
                      >
                        {notes}
                      </Text>
                    ) : null}
                    {exercise.sets.length ? (
                      <View style={styles.workoutSetList}>
                        {exercise.sets.map((set, setPosition) => (
                          <View
                            key={`${exercise.index}:${set.index}:${setPosition}`}
                            style={styles.workoutSetRow}
                          >
                            <Text
                              style={[
                                styles.workoutSetLabel,
                                { color: colors.textTertiary },
                              ]}
                            >
                              Set {setPosition + 1}
                            </Text>
                            <Text
                              style={[
                                styles.workoutSetValue,
                                { color: colors.textSecondary },
                              ]}
                            >
                              {formatStrengthWorkoutSet(set)}
                            </Text>
                          </View>
                        ))}
                      </View>
                    ) : (
                      <Text
                        style={[
                          styles.workoutEmptySets,
                          { color: colors.textTertiary },
                        ]}
                      >
                        No set detail was supplied.
                      </Text>
                    )}
                  </View>
                );
              })}
            </View>
          ) : (
            <Text
              style={[styles.workoutEmptySets, { color: colors.textTertiary }]}
            >
              Hevy did not supply exercise detail for this workout.
            </Text>
          )}

          <View
            style={[
              styles.workoutProvenance,
              { borderTopColor: colors.divider },
            ]}
          >
            <Ionicons
              accessibilityElementsHidden
              color={colors.textTertiary}
              name="cloud-download-outline"
              size={14}
            />
            <Text
              style={[
                styles.workoutProvenanceText,
                { color: colors.textTertiary },
              ]}
            >
              Completed workout imported from Hevy
            </Text>
          </View>
        </View>
      ) : null}
    </View>
  );
}

function present(values: (number | undefined)[]) {
  return values.filter(
    (value): value is number => value !== undefined && Number.isFinite(value),
  );
}

function latest(values: (number | undefined)[]) {
  const recorded = present(values);
  return recorded[recorded.length - 1];
}

function average(values: (number | undefined)[]) {
  const recorded = present(values);
  return recorded.length
    ? recorded.reduce((sum, value) => sum + value, 0) / recorded.length
    : undefined;
}

function duration(minutes?: number) {
  if (!minutes) return "—";
  const rounded = Math.round(minutes);
  const locale = getRuntimeRegionalDefaults().locale;
  const hours = Math.floor(rounded / 60);
  const remainder = rounded % 60;
  const hoursLabel = formatRegionalNumber(hours, locale, {
    maximumFractionDigits: 0,
  });
  const remainderLabel = formatRegionalNumber(remainder, locale, {
    maximumFractionDigits: 0,
  });
  return hours
    ? `${hoursLabel}h ${remainder ? `${remainderLabel}m` : ""}`.trim()
    : `${remainderLabel}m`;
}

function available(...values: (number | undefined)[]) {
  return values.some((value) => value !== undefined && Number.isFinite(value));
}

function compactNumber(value?: number) {
  return value === undefined
    ? "—"
    : formatRegionalNumber(
        Math.round(value),
        getRuntimeRegionalDefaults().locale,
      );
}

function MetricChart({
  color,
  formatValue,
  height,
  kind,
  onSelect,
  selectedIndex,
  trend,
  values,
}: {
  color: string;
  formatValue(value: number): string;
  height: number;
  kind: ChartKind;
  onSelect?(index: number): void;
  selectedIndex?: number;
  trend: HealthTrendDay[];
  values: (number | undefined)[];
}) {
  const { colors, radius } = useAppTheme();
  const [width, setWidth] = useState(0);
  const maximum = Math.max(1, ...present(values));
  const { path, points } = useMemo(
    () => buildMetricChartGeometry(values, width, height - 18),
    [height, values, width],
  );
  const fallbackIndex = values.reduce<number>(
    (found, value, index) => (value === undefined ? found : index),
    0,
  );
  const highlightedIndex = selectedIndex ?? fallbackIndex;
  const highlightedPoint = points[highlightedIndex];
  const onLayout = (event: LayoutChangeEvent) =>
    setWidth(Math.round(event.nativeEvent.layout.width));

  return (
    <View onLayout={onLayout} style={[styles.chart, { height }]}>
      <View style={[styles.chartPlot, { height: height - 18 }]}>
        {kind === "bar" ? (
          <View style={styles.bars}>
            {values.map((value, index) => {
              const dateLabel = trend[index]
                ? formatDate(trend[index]!.date, {
                    weekday: "long",
                    day: "numeric",
                    month: "short",
                  })
                : `Day ${index + 1}`;
              const bar = (
                <View
                  style={[
                    styles.bar,
                    {
                      backgroundColor:
                        index === highlightedIndex ? color : `${color}72`,
                      borderRadius: radius.pill,
                      height: value
                        ? Math.max(
                            4,
                            Math.round((value / maximum) * (height - 22)),
                          )
                        : 3,
                    },
                  ]}
                />
              );
              return onSelect ? (
                <Pressable
                  accessibilityLabel={`${dateLabel}, ${
                    value === undefined ? "no record" : formatValue(value)
                  }`}
                  accessibilityRole="button"
                  accessibilityState={{ selected: index === selectedIndex }}
                  key={`${trend[index]?.date ?? index}-bar`}
                  onPress={() => onSelect(index)}
                  style={({ pressed }) => [
                    styles.barSlot,
                    pressed && { opacity: 0.66 },
                  ]}
                >
                  {bar}
                </Pressable>
              ) : (
                <View
                  key={`${trend[index]?.date ?? index}-bar`}
                  style={styles.barSlot}
                >
                  {bar}
                </View>
              );
            })}
          </View>
        ) : width ? (
          <Svg height={height - 18} width={width}>
            <Line
              stroke={colors.grid}
              strokeDasharray="3 5"
              strokeWidth={1}
              x1={0}
              x2={width}
              y1={(height - 18) / 2}
              y2={(height - 18) / 2}
            />
            {path ? (
              <Path
                d={path}
                fill="none"
                stroke={color}
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2.4}
              />
            ) : null}
            {highlightedPoint ? (
              <>
                {selectedIndex !== undefined ? (
                  <Line
                    stroke={`${color}68`}
                    strokeDasharray="3 4"
                    strokeWidth={1}
                    x1={highlightedPoint.x}
                    x2={highlightedPoint.x}
                    y1={0}
                    y2={height - 18}
                  />
                ) : null}
                <Circle
                  cx={highlightedPoint.x}
                  cy={highlightedPoint.y}
                  fill={color}
                  r={selectedIndex === undefined ? 3.5 : 5}
                  stroke={colors.surfaceElevated}
                  strokeWidth={2}
                />
              </>
            ) : null}
          </Svg>
        ) : null}
        {kind === "line" && onSelect ? (
          <View style={styles.lineHitTargets}>
            {values.map((value, index) => {
              const dateLabel = trend[index]
                ? formatDate(trend[index]!.date, {
                    weekday: "long",
                    day: "numeric",
                    month: "short",
                  })
                : `Day ${index + 1}`;
              return (
                <Pressable
                  accessibilityLabel={`${dateLabel}, ${
                    value === undefined ? "no record" : formatValue(value)
                  }`}
                  accessibilityRole="button"
                  accessibilityState={{ selected: index === selectedIndex }}
                  key={`${trend[index]?.date ?? index}-point`}
                  onPress={() => onSelect(index)}
                  style={({ pressed }) => [
                    styles.lineHitTarget,
                    pressed && { backgroundColor: `${color}12` },
                  ]}
                />
              );
            })}
          </View>
        ) : null}
      </View>
      <View style={styles.dayLabels}>
        {trend.map((day) => (
          <Text
            key={`${day.date}-label`}
            style={[styles.dayLabel, { color: colors.textTertiary }]}
          >
            {formatDate(day.date, { weekday: "narrow" })}
          </Text>
        ))}
      </View>
    </View>
  );
}

function MetricCard({
  definition,
  onPress,
  trend,
}: {
  definition: MetricDefinition;
  onPress(): void;
  trend: HealthTrendDay[];
}) {
  const { colors, radius } = useAppTheme();
  const { width, fontScale } = useWindowDimensions();
  const stackChart = width < 360 || fontScale > 1.3;
  return (
    <SectionCard style={styles.cardShell}>
      <Pressable
        accessibilityHint={`Opens daily and seven-day ${definition.label} details`}
        accessibilityLabel={`${definition.label}, ${definition.primary}, ${definition.status}`}
        accessibilityRole="button"
        onPress={onPress}
        style={({ pressed }) => [
          styles.card,
          stackChart && styles.cardStacked,
          pressed && { opacity: 0.68 },
        ]}
      >
        <View style={styles.cardCopy}>
          <View style={styles.labelRow}>
            <View
              style={[
                styles.icon,
                {
                  backgroundColor: `${definition.color}16`,
                  borderRadius: radius.sm,
                },
              ]}
            >
              <Ionicons
                accessibilityElementsHidden
                color={definition.color}
                name={definition.icon}
                size={17}
              />
            </View>
            <Text style={[styles.label, { color: colors.textSecondary }]}>
              {definition.label}
            </Text>
          </View>
          <Text style={[styles.primary, { color: colors.text }]}>
            {definition.primary}
          </Text>
          <Text style={[styles.status, { color: colors.textTertiary }]}>
            {definition.status}
          </Text>
        </View>
        <View style={[styles.cardTrend, stackChart && styles.cardTrendStacked]}>
          <Ionicons
            accessibilityElementsHidden
            color={colors.textTertiary}
            name="chevron-forward"
            size={16}
            style={styles.chevron}
          />
          <MetricChart
            color={definition.color}
            formatValue={definition.format}
            height={62}
            kind={definition.chart}
            trend={trend}
            values={definition.values}
          />
        </View>
      </Pressable>
    </SectionCard>
  );
}

function StepGoalEditor({
  goal,
  onChange,
}: {
  goal?: number;
  onChange(goal?: number): void;
}) {
  const { colors, radius } = useAppTheme();
  const { defaults: regional } = useRegionalProfile();
  const [draft, setDraft] = useState(() =>
    goal ? formatRegionalNumberInput(goal, regional.locale, 0) : "",
  );
  const [error, setError] = useState<string>();
  async function save() {
    const next = normalizeRegionalNumberInput(draft, regional.locale)?.value;
    if (next === undefined || next < 500 || next > 100_000) {
      setError("Choose between 500 and 100,000 steps.");
      return;
    }
    await saveStepGoal(next);
    setError(undefined);
    onChange(Math.round(next));
  }

  return (
    <SectionCard>
      <Text style={[styles.goalTitle, { color: colors.text }]}>Daily goal</Text>
      <Text style={[styles.goalDetail, { color: colors.textSecondary }]}>
        Health Connect supplies the step count, while this private goal is kept
        in T1 Arc.
      </Text>
      <View style={styles.goalRow}>
        <TextInput
          accessibilityLabel="Daily step goal"
          keyboardType="number-pad"
          onChangeText={setDraft}
          placeholder="e.g. 8,000"
          placeholderTextColor={colors.textTertiary}
          style={[
            styles.goalInput,
            {
              backgroundColor: colors.surfaceMuted,
              borderColor: colors.border,
              borderRadius: radius.md,
              color: colors.text,
            },
          ]}
          value={draft}
        />
        <Pressable
          accessibilityRole="button"
          onPress={() => void save()}
          style={({ pressed }) => [
            styles.goalSave,
            {
              backgroundColor: colors.primary,
              borderRadius: radius.md,
              opacity: pressed ? 0.72 : 1,
            },
          ]}
        >
          <Text style={[styles.goalSaveText, { color: colors.onPrimary }]}>
            Save
          </Text>
        </Pressable>
      </View>
      {error ? (
        <Text style={[styles.goalError, { color: colors.danger }]}>
          {error}
        </Text>
      ) : null}
      {goal ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            void saveStepGoal(undefined).then(() => onChange(undefined));
          }}
          style={styles.goalRemove}
        >
          <Text
            style={[styles.goalRemoveText, { color: colors.textSecondary }]}
          >
            Remove goal
          </Text>
        </Pressable>
      ) : null}
    </SectionCard>
  );
}

function MetricDetailModal({
  definition,
  goal,
  now,
  onClose,
  onGoalChange,
  trend,
}: {
  definition?: MetricDefinition;
  goal?: number;
  now: number;
  onClose(): void;
  onGoalChange(goal?: number): void;
  trend: HealthTrendDay[];
}) {
  const { colors, radius } = useAppTheme();
  const { defaults: regional } = useRegionalProfile();
  const { dataMode, revision } = useDataContext();
  const [selectedDayIndex, setSelectedDayIndex] = useState(() =>
    selectedTrendIndex(trend.length),
  );
  const [intradayResult, setIntradayResult] = useState<{
    key: string;
    records: DailyMetricRecord[];
    context: HealthContextEvent[];
    error?: string;
  }>();
  const [expandedWorkout, setExpandedWorkout] = useState<{
    id: string;
    key: string;
  }>();
  const selectedDay = trend[selectedDayIndex];
  const intradayKey =
    definition && selectedDay
      ? `${dataMode}:${revision}:${definition.id}:${selectedDay.date}`
      : undefined;
  const intradayResultIsCurrent =
    intradayKey !== undefined && intradayResult?.key === intradayKey;
  const intradayRecords = intradayResultIsCurrent ? intradayResult.records : [];
  const intradayContext = intradayResultIsCurrent ? intradayResult.context : [];
  const intradayError = intradayResultIsCurrent
    ? intradayResult.error
    : undefined;
  const intradayLoading = Boolean(intradayKey && !intradayResultIsCurrent);
  const expandedWorkoutId =
    expandedWorkout && expandedWorkout.key === intradayKey
      ? expandedWorkout.id
      : undefined;
  useEffect(() => {
    if (!definition || !selectedDay) return;
    let active = true;
    const requestKey = `${dataMode}:${revision}:${definition.id}:${selectedDay.date}`;
    const range = dayRange(selectedDay.date, now);
    void readHealthMetricSnapshot(dataMode, range, now)
      .then((snapshot) => {
        if (!active) return;
        const selectedIds = new Set(snapshot.metrics.selectedRecordIds);
        const kinds = new Set(METRIC_RECORD_KINDS[definition.id] ?? []);
        setIntradayResult({
          key: requestKey,
          records: snapshot.records.filter(
            (record) => selectedIds.has(record.id) && kinds.has(record.kind),
          ),
          context: snapshot.context.filter((event) =>
            contextForMetric(definition.id, event),
          ),
        });
      })
      .catch((error: unknown) => {
        if (active) {
          setIntradayResult({
            key: requestKey,
            records: [],
            context: [],
            error:
              error instanceof Error
                ? error.message
                : "Could not load this day.",
          });
        }
      });
    return () => {
      active = false;
    };
  }, [dataMode, definition, now, revision, selectedDay]);
  if (!definition || !selectedDay) return null;
  const recorded = present(definition.values);
  const selectedDayValue = definition.values[selectedDayIndex];
  const overviewDayIndex = Math.max(0, trend.length - 1);
  const inspectingOverviewDay = selectedDayIndex === overviewDayIndex;
  const selectedDayLabel = selectedDay
    ? formatDate(selectedDay.date, {
        weekday: "long",
        day: "numeric",
        month: "short",
      })
    : "Selected day";
  const summaryValue =
    definition.summary === "latest"
      ? latest(definition.values)
      : definition.summary === "total"
        ? recorded.reduce((sum, value) => sum + value, 0)
        : average(definition.values);
  const trendWindowLabel = healthMetricTrendWindowLabel(
    trend[trend.length - 1]?.date,
    now,
  );

  return (
    <Modal
      animationType="slide"
      onRequestClose={onClose}
      presentationStyle="fullScreen"
      statusBarTranslucent
      visible
    >
      <SafeAreaView
        edges={["top", "bottom"]}
        style={[styles.modalSafe, { backgroundColor: colors.background }]}
      >
        <LinearGradient
          colors={[colors.backgroundGlow, colors.background, colors.background]}
          end={{ x: 0.82, y: 0.72 }}
          locations={[0, 0.42, 1]}
          pointerEvents="none"
          start={{ x: 0.02, y: 0 }}
          style={StyleSheet.absoluteFill}
        />
        <View style={styles.modalHeader}>
          <View style={styles.modalHeading}>
            <Text
              accessibilityRole="header"
              style={[styles.modalTitle, { color: colors.text }]}
            >
              {definition.label}
            </Text>
          </View>
          <Pressable
            accessibilityLabel={`Close ${definition.label}`}
            accessibilityRole="button"
            onPress={onClose}
            style={({ pressed }) => [
              styles.close,
              {
                backgroundColor: colors.surfaceElevated,
                borderColor: colors.surfaceBorder,
                borderRadius: radius.pill,
                opacity: pressed ? 0.68 : 1,
              },
            ]}
          >
            <Ionicons color={colors.textSecondary} name="close" size={24} />
          </Pressable>
        </View>
        <DemoModeNotice />
        <ScrollView
          contentContainerStyle={styles.modalContent}
          showsVerticalScrollIndicator={false}
        >
          <SectionCard style={styles.detailHero}>
            <View style={styles.detailHeadingRow}>
              <View
                style={[
                  styles.detailIcon,
                  {
                    backgroundColor: `${definition.color}16`,
                    borderRadius: radius.md,
                  },
                ]}
              >
                <Ionicons
                  color={definition.color}
                  name={definition.icon}
                  size={24}
                />
              </View>
              <Text
                style={[styles.detailStatus, { color: colors.textSecondary }]}
              >
                {inspectingOverviewDay
                  ? `${definition.status} · ${selectedDayLabel}`
                  : selectedDayLabel}
              </Text>
            </View>
            <Text style={[styles.detailValue, { color: colors.text }]}>
              {selectedDayValue === undefined
                ? "No record"
                : definition.format(selectedDayValue)}
            </Text>
            <Text
              style={[
                styles.detailDescription,
                { color: colors.textSecondary },
              ]}
            >
              {inspectingOverviewDay
                ? definition.detail
                : `Showing ${definition.label.toLowerCase()} records for ${selectedDayLabel}.`}
            </Text>
            {definition.id === "steps" &&
            goal &&
            selectedDayValue !== undefined ? (
              <View style={styles.progressBlock}>
                <View style={styles.progressLabels}>
                  <Text
                    style={[
                      styles.progressText,
                      { color: colors.textSecondary },
                    ]}
                  >
                    Goal progress
                  </Text>
                  <Text
                    style={[
                      styles.progressText,
                      { color: colors.textSecondary },
                    ]}
                  >
                    {formatRegionalNumber(
                      Math.min(
                        100,
                        Math.round((selectedDayValue / goal) * 100),
                      ),
                      getRuntimeRegionalDefaults().locale,
                      { maximumFractionDigits: 0 },
                    )}
                    %
                  </Text>
                </View>
                <View
                  style={[
                    styles.progressTrack,
                    {
                      backgroundColor: colors.surfaceMuted,
                      borderRadius: radius.pill,
                    },
                  ]}
                >
                  <View
                    style={[
                      styles.progressFill,
                      {
                        backgroundColor: definition.color,
                        borderRadius: radius.pill,
                        width: `${Math.min(100, (selectedDayValue / goal) * 100)}%`,
                      },
                    ]}
                  />
                </View>
              </View>
            ) : null}
            {inspectingOverviewDay && definition.secondary.length ? (
              <View style={styles.secondaryGrid}>
                {definition.secondary.map((item) => (
                  <View key={item.label} style={styles.secondaryReading}>
                    <Text
                      style={[
                        styles.secondaryLabel,
                        { color: colors.textTertiary },
                      ]}
                    >
                      {item.label}
                    </Text>
                    <Text
                      style={[styles.secondaryValue, { color: colors.text }]}
                    >
                      {item.value}
                    </Text>
                  </View>
                ))}
              </View>
            ) : null}
          </SectionCard>

          <SectionCard>
            <View style={styles.weekHeader}>
              <View>
                <Text
                  style={[styles.weekLabel, { color: colors.textSecondary }]}
                >
                  {trendWindowLabel}
                </Text>
                <Text style={[styles.weekValue, { color: colors.text }]}>
                  {summaryValue === undefined
                    ? "—"
                    : definition.format(summaryValue)}
                </Text>
                <Text
                  style={[
                    styles.weekSummaryKind,
                    { color: colors.textTertiary },
                  ]}
                >
                  {definition.summary === "latest"
                    ? "latest recorded value"
                    : definition.summary === "total"
                      ? "seven-day total"
                      : "daily average"}
                </Text>
              </View>
              <Text style={[styles.recordedDays, { color: definition.color }]}>
                {formatRegionalNumber(recorded.length, regional.locale, {
                  maximumFractionDigits: 0,
                })}
                /
                {formatRegionalNumber(7, regional.locale, {
                  maximumFractionDigits: 0,
                })}{" "}
                recorded
              </Text>
            </View>
            <View
              accessibilityLiveRegion="polite"
              style={[
                styles.selectedDay,
                {
                  backgroundColor: `${definition.color}12`,
                  borderColor: `${definition.color}38`,
                  borderRadius: radius.md,
                },
              ]}
            >
              <View style={styles.selectedDayCopy}>
                <Text
                  style={[
                    styles.selectedDayDate,
                    { color: colors.textSecondary },
                  ]}
                >
                  {selectedDay
                    ? formatDate(selectedDay.date, {
                        weekday: "long",
                        day: "numeric",
                        month: "short",
                      })
                    : "Selected day"}
                </Text>
                <Text
                  style={[
                    styles.selectedDayHint,
                    { color: colors.textTertiary },
                  ]}
                >
                  Selected on the chart
                </Text>
              </View>
              <Text
                style={[styles.selectedDayValue, { color: definition.color }]}
              >
                {selectedDayValue === undefined
                  ? "No record"
                  : definition.format(selectedDayValue)}
              </Text>
            </View>
            <MetricChart
              color={definition.color}
              formatValue={definition.format}
              height={170}
              kind={definition.chart}
              onSelect={setSelectedDayIndex}
              selectedIndex={selectedDayIndex}
              trend={trend}
              values={definition.values}
            />
            <View
              style={[styles.exactList, { borderTopColor: colors.divider }]}
            >
              {trend.map((day, index) => {
                const value = definition.values[index];
                const selected = selectedDayIndex === index;
                return (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    key={`${definition.id}:${day.date}`}
                    onPress={() => setSelectedDayIndex(index)}
                    style={({ pressed }) => [
                      styles.exactRow,
                      index > 0 && {
                        borderTopColor: colors.divider,
                        borderTopWidth: StyleSheet.hairlineWidth,
                      },
                      selected && { backgroundColor: `${definition.color}0F` },
                      pressed && { opacity: 0.66 },
                    ]}
                  >
                    <View style={styles.exactDateRow}>
                      <View
                        style={[
                          styles.exactMarker,
                          {
                            backgroundColor: selected
                              ? definition.color
                              : colors.border,
                          },
                        ]}
                      />
                      <Text
                        style={[
                          styles.exactDate,
                          { color: colors.textSecondary },
                        ]}
                      >
                        {formatDate(day.date, {
                          weekday: "short",
                          day: "numeric",
                          month: "short",
                        })}
                      </Text>
                    </View>
                    <Text
                      style={[
                        styles.exactValue,
                        {
                          color:
                            value === undefined
                              ? colors.textTertiary
                              : colors.text,
                        },
                      ]}
                    >
                      {value === undefined
                        ? "No record"
                        : definition.format(value)}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </SectionCard>

          <SectionCard>
            <Text style={[styles.intradayTitle, { color: colors.text }]}>
              During this day
            </Text>
            <Text
              style={[styles.intradayIntro, { color: colors.textSecondary }]}
            >
              {definition.id === "steps"
                ? "See when the source recorded each block of steps. These are source intervals—not the timestamp of every individual step."
                : definition.id === "nutrition"
                  ? "Meals keep their logged time and available carbohydrate, energy, protein and fat context."
                  : "Exact source times are retained so this day can be compared with glucose and insulin later."}
            </Text>
            {intradayLoading ? (
              <View style={styles.intradayState}>
                <Text
                  style={[
                    styles.intradayStateText,
                    { color: colors.textTertiary },
                  ]}
                >
                  Loading this day…
                </Text>
              </View>
            ) : intradayError ? (
              <View style={styles.intradayState}>
                <Text
                  style={[styles.intradayStateText, { color: colors.danger }]}
                >
                  {intradayError}
                </Text>
              </View>
            ) : intradayRecords.length === 0 && intradayContext.length === 0 ? (
              <View style={styles.intradayState}>
                <Text
                  style={[
                    styles.intradayStateText,
                    { color: colors.textTertiary },
                  ]}
                >
                  No timestamped detail was supplied for this day.
                </Text>
              </View>
            ) : (
              <View
                style={[
                  styles.intradayList,
                  { borderTopColor: colors.divider },
                ]}
              >
                {intradayContext.map((event) => {
                  const end =
                    event.end ??
                    ("durationMinutes" in event
                      ? event.start + event.durationMinutes * 60_000
                      : event.start);
                  const interval = healthMetricIntervalPresentation({
                    end,
                    selectedDate: selectedDay.date,
                    start: event.start,
                  });
                  if (event.kind === "activity" && event.strengthWorkout) {
                    return (
                      <StrengthWorkoutTimelineRow
                        color={definition.color}
                        event={event}
                        expanded={expandedWorkoutId === event.id}
                        heartRateRecords={intradayRecords}
                        key={event.id}
                        onToggle={() =>
                          setExpandedWorkout((current) =>
                            current &&
                            current.key === intradayKey &&
                            current.id === event.id
                              ? undefined
                              : { id: event.id, key: intradayKey! },
                          )
                        }
                        selectedDate={selectedDay.date}
                      />
                    );
                  }
                  return (
                    <View
                      accessibilityLabel={`${contextEventTitle(event)}, ${contextEventDetail(event)}, ${interval.accessibilityLabel}, source ${event.sourceLabel ?? event.sourceId}`}
                      accessible
                      key={event.id}
                      style={[
                        styles.intradayRow,
                        { borderBottomColor: colors.divider },
                      ]}
                    >
                      <View style={styles.intradayTimeBlock}>
                        <Text
                          style={[
                            styles.intradayTime,
                            { color: definition.color },
                          ]}
                        >
                          {interval.startLabel}
                        </Text>
                        {interval.endLabel ? (
                          <Text
                            style={[
                              styles.intradayEnd,
                              { color: colors.textTertiary },
                            ]}
                          >
                            to {interval.endLabel}
                          </Text>
                        ) : null}
                      </View>
                      <View style={styles.intradayCopy}>
                        <Text
                          style={[styles.intradayLabel, { color: colors.text }]}
                        >
                          {contextEventTitle(event)}
                        </Text>
                        <Text
                          style={[
                            styles.intradayDetail,
                            { color: colors.textSecondary },
                          ]}
                        >
                          {contextEventDetail(event)}
                        </Text>
                        <Text
                          style={[
                            styles.intradaySource,
                            { color: colors.textTertiary },
                          ]}
                        >
                          {event.sourceId}
                        </Text>
                      </View>
                    </View>
                  );
                })}
                {intradayRecords
                  .filter(
                    (record) =>
                      definition.id !== "workouts" ||
                      record.kind !== "heart_rate",
                  )
                  .map((record) => {
                    const interval = healthMetricIntervalPresentation({
                      end: record.end,
                      selectedDate: selectedDay.date,
                      start: record.start,
                    });
                    return (
                      <View
                        accessibilityLabel={`${metricRecordValue(record)}, ${interval.accessibilityLabel}, source ${record.sourceLabel}`}
                        accessible
                        key={record.id}
                        style={[
                          styles.intradayRow,
                          { borderBottomColor: colors.divider },
                        ]}
                      >
                        <View style={styles.intradayTimeBlock}>
                          <Text
                            style={[
                              styles.intradayTime,
                              { color: definition.color },
                            ]}
                          >
                            {interval.startLabel}
                          </Text>
                          {interval.endLabel ? (
                            <Text
                              style={[
                                styles.intradayEnd,
                                { color: colors.textTertiary },
                              ]}
                            >
                              to {interval.endLabel}
                            </Text>
                          ) : null}
                        </View>
                        <View style={styles.intradayCopy}>
                          <Text
                            style={[
                              styles.intradayLabel,
                              { color: colors.text },
                            ]}
                          >
                            {metricRecordValue(record)}
                          </Text>
                          <Text
                            style={[
                              styles.intradaySource,
                              { color: colors.textTertiary },
                            ]}
                          >
                            {record.sourceLabel}
                          </Text>
                        </View>
                      </View>
                    );
                  })}
                {definition.id === "steps" &&
                intradayRecords.some(
                  (record) => record.end - record.start >= 20 * 3_600_000,
                ) ? (
                  <Text
                    style={[
                      styles.intradayCaveat,
                      { color: colors.textTertiary },
                    ]}
                  >
                    This source supplied a daily step total, so a more exact
                    within-day time is not available for that row.
                  </Text>
                ) : null}
              </View>
            )}
          </SectionCard>

          {definition.id === "steps" && dataMode === "live" ? (
            <StepGoalEditor
              goal={goal}
              key={`${goal ?? "unset"}:${regional.locale}`}
              onChange={onGoalChange}
            />
          ) : null}
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

export function HealthMetricCards({
  isToday,
  metrics,
  now,
  trend,
}: {
  isToday: boolean;
  metrics?: DailyHealthMetrics;
  now: number;
  trend: HealthTrendDay[];
}) {
  const { colors } = useAppTheme();
  const { defaults: regional } = useRegionalProfile();
  const { dataMode } = useDataContext();
  const [selectedId, setSelectedId] = useState<string>();
  const [stepGoal, setStepGoal] = useState<number>();
  useEffect(() => {
    if (dataMode === "live") return observeStepGoal(setStepGoal);
  }, [dataMode]);
  const current = metrics ?? trend[trend.length - 1]?.metrics;
  const latestDay = trend[trend.length - 1];
  const definitions = useMemo<MetricDefinition[]>(() => {
    const values = <K extends keyof DailyHealthMetrics>(key: K) =>
      trend.map((day) => {
        const value = day.metrics[key];
        return typeof value === "number" ? value : undefined;
      });
    const stepValues = values("steps");
    const distanceValues = values("distanceKilometres");
    const energyValues = values("activeCaloriesKcal");
    const workoutValues = trend.map((day) => day.workoutMinutes || undefined);
    const heartValues = trend.map(
      (day) =>
        day.metrics.restingHeartRateBpm ?? day.metrics.averageHeartRateBpm,
    );
    const sleepValues = trend.map((day) =>
      day.sleepMinutes ? day.sleepMinutes / 60 : undefined,
    );
    const weightValues = values("weightKilograms");
    const bodyValues = values("bodyFatPercent");
    const pressureValues = values("bloodPressureSystolic");
    const glucoseValues = values("bloodGlucoseMmolL");
    const oxygenValues = values("oxygenSaturationPercent");
    const respiratoryValues = values("respiratoryRatePerMinute");
    const hrvValues = values("heartRateVariabilityRmssdMs");
    const vo2Values = values("vo2MaxMillilitresPerKilogramMinute");
    const temperatureValues = values("bodyTemperatureCelsius");
    const hydrationValues = values("hydrationLitres");
    const latestNutritionDay = [...trend]
      .reverse()
      .find((day) => day.mealCount > 0);
    const selectedNutritionDay = latestDay?.mealCount ? latestDay : undefined;
    const nutritionSeries =
      latestNutritionDay?.mealCarbsGrams !== undefined
        ? "carbs"
        : latestNutritionDay?.mealEnergyKcal !== undefined
          ? "energy"
          : "meals";
    const nutritionValues = trend.map((day) =>
      day.mealCount
        ? nutritionSeries === "carbs"
          ? day.mealCarbsGrams
          : nutritionSeries === "energy"
            ? day.mealEnergyKcal
            : day.mealCount
        : undefined,
    );
    const nutritionSeriesPartial = trend.some((day) => {
      if (!day.mealCount) return false;
      if (day.nutritionPossibleDuplicatePairs > 0) return true;
      if (nutritionSeries === "meals") return false;
      const coverage =
        day.mealNutrientCoverage[
          nutritionSeries === "carbs" ? "carbsGrams" : "energyKcal"
        ];
      return nutritionCoverageNeedsReview(coverage);
    });
    const selectedNutritionCoverage =
      selectedNutritionDay && nutritionSeries !== "meals"
        ? selectedNutritionDay.mealNutrientCoverage[
            nutritionSeries === "carbs" ? "carbsGrams" : "energyKcal"
          ]
        : undefined;
    const selectedNutritionNeedsReview = Boolean(
      selectedNutritionDay &&
      ((selectedNutritionCoverage &&
        nutritionCoverageNeedsReview(selectedNutritionCoverage)) ||
        selectedNutritionDay.nutritionPossibleDuplicatePairs > 0),
    );
    const nutritionStatus = selectedNutritionDay
      ? selectedNutritionDay.nutritionPossibleDuplicatePairs > 0
        ? "Possible cross-source overlap"
        : (selectedNutritionCoverage?.partialCount ?? 0) > 0
          ? `Partial nutrient subtotal · ${formatRegionalNumber(selectedNutritionCoverage!.partialCount ?? 0, regional.locale, { maximumFractionDigits: 0 })} ${selectedNutritionCoverage!.partialCount === 1 ? "meal" : "meals"}`
          : selectedNutritionCoverage && selectedNutritionNeedsReview
            ? `Partial · ${formatRegionalNumber(selectedNutritionCoverage.knownCount, regional.locale, { maximumFractionDigits: 0 })} of ${formatRegionalNumber(selectedNutritionCoverage.recordCount, regional.locale, { maximumFractionDigits: 0 })} meals`
            : `${formatRegionalNumber(selectedNutritionDay.mealCount, regional.locale, { maximumFractionDigits: 0 })} ${selectedNutritionDay.mealCount === 1 ? "meal" : "meals"} logged`
      : undefined;
    const nutrientValue = (
      value: number | undefined,
      nutrient: "energyKcal" | "proteinGrams" | "fatGrams",
      unit: string,
    ) => {
      if (value === undefined || !selectedNutritionDay) return undefined;
      const coverage = selectedNutritionDay.mealNutrientCoverage[nutrient];
      const needsReview =
        nutritionCoverageNeedsReview(coverage) ||
        selectedNutritionDay.nutritionPossibleDuplicatePairs > 0;
      const formatted =
        nutrient === "energyKcal"
          ? formatEnergy(value, regional)
          : `${formatRegionalNumber(Math.round(value), regional.locale, { maximumFractionDigits: 0 })} ${unit}`;
      return `${formatted}${needsReview ? " known subtotal" : ""}`;
    };
    const cycleValues = trend.map((day) =>
      day.hormoneRecordCount ? day.hormoneRecordCount : undefined,
    );
    const currentSteps = current?.steps;
    const stepStatus = stepProgressStatus({
      goal: stepGoal,
      isToday,
      locale: regional.locale,
      now,
      steps: currentSteps,
      timeZone: regional.timeZone,
    });
    const displayedWeight = resolveDailyMetricDisplay({
      history: weightValues,
      selected: current?.weightKilograms,
    }).value;
    const displayedSystolic = resolveDailyMetricDisplay({
      history: pressureValues,
      selected: current?.bloodPressureSystolic,
    }).value;
    const diastolicValues = values("bloodPressureDiastolic");
    const displayedDiastolic = resolveDailyMetricDisplay({
      history: diastolicValues,
      selected: current?.bloodPressureDiastolic,
    }).value;
    const displayedHeart = resolveDailyMetricDisplay({
      history: heartValues,
      selected: current?.restingHeartRateBpm ?? current?.averageHeartRateBpm,
    }).value;
    const displayedSleepHours = latestDay?.sleepMinutes
      ? latestDay.sleepMinutes / 60
      : undefined;
    const displayedHydration = current?.hydrationLitres;
    const displayedDistance = current?.distanceKilometres;
    const displayedEnergy = current?.activeCaloriesKcal;
    const displayedWorkout = latestDay?.workoutMinutes || undefined;
    const displayedBodyFat = current?.bodyFatPercent;
    const displayedGlucose = current?.bloodGlucoseMmolL;
    const displayedOxygen = current?.oxygenSaturationPercent;
    const displayedRespiratory = current?.respiratoryRatePerMinute;
    const displayedHrv = current?.heartRateVariabilityRmssdMs;
    const displayedVo2 = current?.vo2MaxMillilitresPerKilogramMinute;
    const displayedTemperature = current?.bodyTemperatureCelsius;
    return [
      {
        id: "weight",
        label: "Weight",
        icon: "scale-outline",
        color: colors.high,
        values: weightValues,
        available: available(current?.weightKilograms, ...weightValues),
        primary:
          displayedWeight === undefined
            ? "No record"
            : formatWeight(displayedWeight, regional),
        status:
          displayedWeight === undefined
            ? "No measurement for this day"
            : isToday
              ? "Measured today"
              : "Measured on selected day",
        detail:
          displayedWeight === undefined
            ? "No weight measurement is available for the selected day. Earlier measurements remain in the seven-day chart."
            : "The latest weight from your selected connected source, or your latest manual log when no selected-source weight is available that day.",
        chart: "line",
        summary: "latest",
        format: (value) => formatWeight(value, regional),
        secondary: [],
      },
      {
        id: "blood-pressure",
        label: "Blood pressure",
        icon: "water-outline",
        color: colors.insulin,
        values: pressureValues,
        available: available(
          current?.bloodPressureSystolic,
          current?.bloodPressureDiastolic,
          ...pressureValues,
        ),
        primary:
          displayedSystolic === undefined && displayedDiastolic === undefined
            ? "No record"
            : `${displayedSystolic === undefined ? "—" : formatRegionalFixedNumber(displayedSystolic, regional.locale, 0)}/${displayedDiastolic === undefined ? "—" : formatRegionalFixedNumber(displayedDiastolic, regional.locale, 0)} mmHg`,
        status:
          displayedSystolic === undefined && displayedDiastolic === undefined
            ? "No reading for this day"
            : isToday
              ? "Recorded today"
              : "Recorded on selected day",
        detail:
          displayedSystolic === undefined && displayedDiastolic === undefined
            ? "No blood-pressure reading is available for the selected day. Earlier readings remain in the seven-day chart."
            : "The latest blood-pressure reading supplied for this day.",
        chart: "line",
        summary: "latest",
        format: (value) =>
          `${formatRegionalNumber(Math.round(value), regional.locale, { maximumFractionDigits: 0 })} mmHg`,
        secondary:
          displayedDiastolic === undefined
            ? []
            : [
                {
                  label: "Diastolic",
                  value: `${formatRegionalNumber(Math.round(displayedDiastolic), regional.locale, { maximumFractionDigits: 0 })} mmHg`,
                },
              ],
      },
      {
        id: "heart-rate",
        label: "Heart rate",
        icon: "heart-outline",
        color: colors.low,
        values: heartValues,
        available: available(
          current?.restingHeartRateBpm,
          current?.averageHeartRateBpm,
          ...heartValues,
        ),
        primary:
          displayedHeart === undefined
            ? "No record"
            : `${formatRegionalNumber(Math.round(displayedHeart), regional.locale, { maximumFractionDigits: 0 })} bpm`,
        status:
          displayedHeart === undefined
            ? "No heart-rate data for this day"
            : current?.restingHeartRateBpm !== undefined
              ? "Resting rate"
              : isToday
                ? "Today’s average"
                : "Selected-day average",
        detail:
          "Resting heart rate is preferred when available; otherwise the daily average is shown.",
        chart: "line",
        summary: "average",
        format: (value) =>
          `${formatRegionalNumber(Math.round(value), regional.locale, { maximumFractionDigits: 0 })} bpm`,
        secondary: [
          ...(current?.minimumHeartRateBpm === undefined
            ? []
            : [
                {
                  label: "Minimum",
                  value: `${formatRegionalNumber(Math.round(current.minimumHeartRateBpm), regional.locale, { maximumFractionDigits: 0 })} bpm`,
                },
              ]),
          ...(current?.maximumHeartRateBpm === undefined
            ? []
            : [
                {
                  label: "Maximum",
                  value: `${formatRegionalNumber(Math.round(current.maximumHeartRateBpm), regional.locale, { maximumFractionDigits: 0 })} bpm`,
                },
              ]),
        ],
      },
      {
        id: "sleep",
        label: "Sleep",
        icon: "moon-outline",
        color: colors.insulin,
        values: sleepValues,
        available: available(
          latestDay?.sleepMinutes || undefined,
          ...sleepValues,
        ),
        primary:
          displayedSleepHours === undefined
            ? "No record"
            : duration(displayedSleepHours * 60),
        status:
          displayedSleepHours === undefined
            ? "No sleep record for this day"
            : "Sleep overlapping this day",
        detail:
          displayedSleepHours === undefined
            ? "No sleep session overlaps the selected day. Earlier sleep remains in the seven-day chart."
            : "The total duration of sleep sessions overlapping this day.",
        chart: "bar",
        summary: "average",
        format: (value) =>
          `${formatRegionalFixedNumber(value, regional.locale, 1)} h`,
        secondary: [],
      },
      {
        id: "nutrition",
        label: "Nutrition",
        icon: "restaurant-outline",
        color: colors.warning,
        values: nutritionValues,
        available: trend.some((day) => day.mealCount > 0),
        primary: selectedNutritionDay
          ? selectedNutritionDay.mealCarbsGrams !== undefined
            ? `${formatRegionalNumber(Math.round(selectedNutritionDay.mealCarbsGrams), regional.locale, { maximumFractionDigits: 0 })} g ${selectedNutritionNeedsReview ? "known " : ""}carbs`
            : selectedNutritionDay.mealEnergyKcal !== undefined
              ? `${formatEnergy(selectedNutritionDay.mealEnergyKcal, regional)}${selectedNutritionNeedsReview ? " known" : ""}`
              : `${formatRegionalNumber(selectedNutritionDay.mealCount, regional.locale, { maximumFractionDigits: 0 })} meal ${selectedNutritionDay.mealCount === 1 ? "record" : "records"}`
          : "No record",
        status: nutritionStatus ?? "No meals for this day",
        detail: selectedNutritionDay
          ? [
              "Available nutrients and exact meal times stored for the selected day.",
              selectedNutritionDay.nutritionSourceLabels.length > 1
                ? `Sources: ${selectedNutritionDay.nutritionSourceLabels.join(", ")}.`
                : undefined,
              selectedNutritionDay.nutritionPossibleDuplicatePairs > 0
                ? "Close cross-source records are kept separately; totals may overlap."
                : undefined,
            ]
              .filter(Boolean)
              .join(" ")
          : "No meal records are available for the selected day. Earlier meals remain in the seven-day chart.",
        chart: "bar",
        summary: "total",
        format: (value) =>
          nutritionSeries === "carbs"
            ? `${formatRegionalNumber(Math.round(value), regional.locale, { maximumFractionDigits: 0 })} g${nutritionSeriesPartial ? " known" : ""}`
            : nutritionSeries === "energy"
              ? `${formatEnergy(value, regional)}${nutritionSeriesPartial ? " known" : ""}`
              : `${formatRegionalNumber(Math.round(value), regional.locale, { maximumFractionDigits: 0 })} meal ${Math.round(value) === 1 ? "record" : "records"}`,
        secondary: selectedNutritionDay
          ? [
              {
                label: "Meal records",
                value: formatRegionalNumber(
                  selectedNutritionDay.mealCount,
                  regional.locale,
                  { maximumFractionDigits: 0 },
                ),
              },
              ...(nutrientValue(
                selectedNutritionDay.mealEnergyKcal,
                "energyKcal",
                "kcal",
              ) === undefined
                ? []
                : [
                    {
                      label: "Energy",
                      value: nutrientValue(
                        selectedNutritionDay.mealEnergyKcal,
                        "energyKcal",
                        "kcal",
                      )!,
                    },
                  ]),
              ...(nutrientValue(
                selectedNutritionDay.mealProteinGrams,
                "proteinGrams",
                "g",
              ) === undefined
                ? []
                : [
                    {
                      label: "Protein",
                      value: nutrientValue(
                        selectedNutritionDay.mealProteinGrams,
                        "proteinGrams",
                        "g",
                      )!,
                    },
                  ]),
              ...(nutrientValue(
                selectedNutritionDay.mealFatGrams,
                "fatGrams",
                "g",
              ) === undefined
                ? []
                : [
                    {
                      label: "Fat",
                      value: nutrientValue(
                        selectedNutritionDay.mealFatGrams,
                        "fatGrams",
                        "g",
                      )!,
                    },
                  ]),
            ]
          : [],
      },
      {
        id: "steps",
        label: "Steps",
        icon: "footsteps-outline",
        color: colors.primary,
        values: stepValues,
        available: available(currentSteps, ...stepValues),
        primary:
          currentSteps === undefined
            ? "No record"
            : compactNumber(currentSteps),
        status: stepStatus,
        detail:
          currentSteps === undefined
            ? "No step record is available for the selected day."
            : stepGoal
              ? `${compactNumber(currentSteps)} of ${formatRegionalNumber(stepGoal, regional.locale)} steps.`
              : "Set an optional private goal to see progress at a glance.",
        chart: "bar",
        summary: "average",
        format: (value) => `${compactNumber(value)} steps`,
        secondary: stepGoal
          ? [
              {
                label: "Daily goal",
                value: formatRegionalNumber(stepGoal, regional.locale),
              },
            ]
          : [],
      },
      {
        id: "hydration",
        label: "Hydration",
        icon: "water-outline",
        color: colors.primary,
        values: hydrationValues,
        available: available(current?.hydrationLitres, ...hydrationValues),
        primary:
          displayedHydration === undefined
            ? "No record"
            : formatVolumeLitres(displayedHydration, regional),
        status:
          displayedHydration === undefined
            ? "No hydration for this day"
            : isToday
              ? "Today so far"
              : "Selected-day total",
        detail:
          displayedHydration === undefined
            ? "No hydration is recorded for the selected day. Earlier totals remain in the seven-day chart."
            : "Hydration records supplied for this day.",
        chart: "bar",
        summary: "average",
        format: (value) => formatVolumeLitres(value, regional),
        secondary: [],
      },
      {
        id: "distance",
        label: "Distance and climbing",
        icon: "navigate-outline",
        color: colors.primary,
        values: distanceValues,
        available: available(
          current?.distanceKilometres,
          current?.elevationGainedMetres,
          current?.floorsClimbed,
          ...distanceValues,
        ),
        primary:
          displayedDistance === undefined
            ? "No record"
            : formatDistance(displayedDistance * 1_000, regional),
        status:
          displayedDistance === undefined
            ? "No distance for this day"
            : isToday
              ? "Today so far"
              : "Selected-day total",
        detail:
          displayedDistance === undefined
            ? "No distance is recorded for the selected day. Earlier movement remains in the seven-day chart."
            : "Distance, elevation and floor totals recorded for this day.",
        chart: "bar",
        summary: "average",
        format: (value) => formatDistance(value * 1_000, regional),
        secondary: [
          ...(current?.elevationGainedMetres === undefined
            ? []
            : [
                {
                  label: "Elevation",
                  value: formatElevation(
                    current.elevationGainedMetres,
                    regional,
                  ),
                },
              ]),
          ...(current?.floorsClimbed === undefined
            ? []
            : [
                {
                  label: "Floors",
                  value: compactNumber(current.floorsClimbed),
                },
              ]),
        ],
      },
      {
        id: "energy",
        label: "Activity energy",
        icon: "flame-outline",
        color: colors.warning,
        values: energyValues,
        available: available(
          current?.activeCaloriesKcal,
          current?.totalCaloriesKcal,
          ...energyValues,
        ),
        primary:
          displayedEnergy === undefined
            ? "No record"
            : formatEnergy(displayedEnergy, regional),
        status:
          displayedEnergy === undefined
            ? "No active energy for this day"
            : isToday
              ? "Today so far"
              : "Selected-day total",
        detail:
          displayedEnergy === undefined
            ? "No active-energy record is available for the selected day. Earlier totals remain in the seven-day chart."
            : "Active energy excludes basal energy; total energy appears below when supplied.",
        chart: "bar",
        summary: "average",
        format: (value) => formatEnergy(value, regional),
        secondary:
          current?.totalCaloriesKcal === undefined
            ? []
            : [
                {
                  label: "Total energy",
                  value: formatEnergy(current.totalCaloriesKcal, regional),
                },
              ],
      },
      {
        id: "workouts",
        label: "Workouts",
        icon: "barbell-outline",
        color: colors.accent,
        values: workoutValues,
        available: available(
          latestDay?.workoutMinutes || undefined,
          current?.averageWorkoutPowerWatts,
          current?.averageWorkoutSpeedMetresPerSecond,
          current?.averageWalkingCadencePerMinute,
          current?.averageCyclingCadenceRpm,
          ...workoutValues,
        ),
        primary:
          displayedWorkout === undefined
            ? "No record"
            : duration(displayedWorkout),
        status:
          displayedWorkout === undefined
            ? "No workout for this day"
            : isToday
              ? "Today so far"
              : "Selected-day activity",
        detail:
          displayedWorkout === undefined
            ? "No workout overlaps the selected day. Earlier workouts remain in the seven-day chart."
            : "Workout duration and available performance measurements for this day.",
        chart: "bar",
        summary: "total",
        format: (value) =>
          `${formatRegionalNumber(Math.round(value), regional.locale, { maximumFractionDigits: 0 })} min`,
        secondary: [
          ...(current?.averageWorkoutPowerWatts === undefined
            ? []
            : [
                {
                  label: "Power",
                  value: `${formatRegionalNumber(Math.round(current.averageWorkoutPowerWatts), regional.locale, { maximumFractionDigits: 0 })} W`,
                },
              ]),
          ...(current?.averageWorkoutSpeedMetresPerSecond === undefined
            ? []
            : [
                {
                  label: "Speed",
                  value: formatSpeed(
                    current.averageWorkoutSpeedMetresPerSecond,
                    regional,
                  ),
                },
              ]),
          ...(current?.averageWalkingCadencePerMinute === undefined
            ? []
            : [
                {
                  label: "Walking cadence",
                  value: `${formatRegionalNumber(Math.round(current.averageWalkingCadencePerMinute), regional.locale, { maximumFractionDigits: 0 })}/min`,
                },
              ]),
          ...(current?.averageCyclingCadenceRpm === undefined
            ? []
            : [
                {
                  label: "Cycling cadence",
                  value: `${formatRegionalNumber(Math.round(current.averageCyclingCadenceRpm), regional.locale, { maximumFractionDigits: 0 })} rpm`,
                },
              ]),
        ],
      },
      {
        id: "body-composition",
        label: "Body composition",
        icon: "body-outline",
        color: colors.high,
        values: bodyValues,
        available: available(
          current?.bodyFatPercent,
          current?.leanBodyMassKilograms,
          current?.bodyWaterMassKilograms,
          current?.boneMassKilograms,
          current?.heightMetres,
          current?.basalMetabolicRateKcalPerDay,
          ...bodyValues,
        ),
        primary:
          displayedBodyFat === undefined
            ? "No record"
            : `${formatRegionalFixedNumber(displayedBodyFat, regional.locale, 1)}% body fat`,
        status:
          displayedBodyFat === undefined
            ? "No body composition for this day"
            : isToday
              ? "Measured today"
              : "Measured on selected day",
        detail:
          displayedBodyFat === undefined
            ? "No body-composition measurement is available for the selected day. Earlier measurements remain in the seven-day chart."
            : "Selected-source body composition measurements for this day.",
        chart: "line",
        summary: "latest",
        format: (value) =>
          `${formatRegionalFixedNumber(value, regional.locale, 1)}%`,
        secondary: [
          ...(current?.leanBodyMassKilograms === undefined
            ? []
            : [
                {
                  label: "Lean mass",
                  value: formatWeight(current.leanBodyMassKilograms, regional),
                },
              ]),
          ...(current?.bodyWaterMassKilograms === undefined
            ? []
            : [
                {
                  label: "Body water",
                  value: formatWeight(current.bodyWaterMassKilograms, regional),
                },
              ]),
          ...(current?.boneMassKilograms === undefined
            ? []
            : [
                {
                  label: "Bone mass",
                  value: formatWeight(current.boneMassKilograms, regional),
                },
              ]),
          ...(current?.heightMetres === undefined
            ? []
            : [
                {
                  label: "Height",
                  value: formatHeight(current.heightMetres, regional),
                },
              ]),
          ...(current?.basalMetabolicRateKcalPerDay === undefined
            ? []
            : [
                {
                  label: "BMR",
                  value: `${formatEnergy(current.basalMetabolicRateKcalPerDay, regional)}/day`,
                },
              ]),
        ],
      },
      {
        id: "health-glucose",
        label: "Health Connect glucose",
        icon: "analytics-outline",
        color: colors.glucose,
        values: glucoseValues,
        available: available(current?.bloodGlucoseMmolL, ...glucoseValues),
        primary:
          displayedGlucose === undefined
            ? "No record"
            : formatGlucose(displayedGlucose, regional),
        status:
          displayedGlucose === undefined
            ? "No Health Connect value for this day"
            : isToday
              ? "Recorded today"
              : "Recorded on selected day",
        detail:
          displayedGlucose === undefined
            ? "No Health Connect blood-glucose value is available for the selected day. Earlier values remain in the seven-day chart."
            : "A blood-glucose record from Health Connect, kept separate from your live CGM display.",
        chart: "line",
        summary: "latest",
        format: (value) => formatGlucose(value, regional),
        secondary: [],
      },
      {
        id: "oxygen",
        label: "Blood oxygen",
        icon: "pulse-outline",
        color: colors.primary,
        values: oxygenValues,
        available: available(current?.oxygenSaturationPercent, ...oxygenValues),
        primary:
          displayedOxygen === undefined
            ? "No record"
            : `${formatRegionalFixedNumber(displayedOxygen, regional.locale, 1)}%`,
        status:
          displayedOxygen === undefined
            ? "No blood-oxygen record for this day"
            : isToday
              ? "Measured today"
              : "Measured on selected day",
        detail:
          displayedOxygen === undefined
            ? "No oxygen-saturation measurement is available for the selected day. Earlier measurements remain in the seven-day chart."
            : "The latest oxygen-saturation measurement supplied for this day.",
        chart: "line",
        summary: "latest",
        format: (value) =>
          `${formatRegionalFixedNumber(value, regional.locale, 1)}%`,
        secondary: [],
      },
      {
        id: "respiratory-rate",
        label: "Respiratory rate",
        icon: "cloud-outline",
        color: colors.insulin,
        values: respiratoryValues,
        available: available(
          current?.respiratoryRatePerMinute,
          ...respiratoryValues,
        ),
        primary:
          displayedRespiratory === undefined
            ? "No record"
            : `${formatRegionalFixedNumber(displayedRespiratory, regional.locale, 1)}/min`,
        status:
          displayedRespiratory === undefined
            ? "No respiratory record for this day"
            : isToday
              ? "Measured today"
              : "Measured on selected day",
        detail:
          displayedRespiratory === undefined
            ? "No respiratory-rate measurement is available for the selected day. Earlier measurements remain in the seven-day chart."
            : "The latest recorded breathing rate for this day.",
        chart: "line",
        summary: "average",
        format: (value) =>
          `${formatRegionalFixedNumber(value, regional.locale, 1)}/min`,
        secondary: [],
      },
      {
        id: "hrv",
        label: "Heart-rate variability",
        icon: "pulse-outline",
        color: colors.insulin,
        values: hrvValues,
        available: available(
          current?.heartRateVariabilityRmssdMs,
          ...hrvValues,
        ),
        primary:
          displayedHrv === undefined
            ? "No record"
            : `${formatRegionalNumber(Math.round(displayedHrv), regional.locale, { maximumFractionDigits: 0 })} ms`,
        status:
          displayedHrv === undefined
            ? "No HRV record for this day"
            : isToday
              ? "RMSSD measured today"
              : "RMSSD on selected day",
        detail:
          displayedHrv === undefined
            ? "No RMSSD heart-rate variability measurement is available for the selected day. Earlier measurements remain in the seven-day chart."
            : "The latest RMSSD heart-rate variability measurement for this day.",
        chart: "line",
        summary: "average",
        format: (value) =>
          `${formatRegionalNumber(Math.round(value), regional.locale, { maximumFractionDigits: 0 })} ms`,
        secondary: [],
      },
      {
        id: "vo2-max",
        label: "VO₂ max",
        icon: "fitness-outline",
        color: colors.accent,
        values: vo2Values,
        available: available(
          current?.vo2MaxMillilitresPerKilogramMinute,
          ...vo2Values,
        ),
        primary:
          displayedVo2 === undefined
            ? "No record"
            : `${formatRegionalFixedNumber(displayedVo2, regional.locale, 1)} ml/kg/min`,
        status:
          displayedVo2 === undefined
            ? "No VO₂ max estimate for this day"
            : isToday
              ? "Estimated today"
              : "Estimated on selected day",
        detail:
          displayedVo2 === undefined
            ? "No VO₂ max estimate is available for the selected day. Earlier estimates remain in the seven-day chart."
            : "The latest VO₂ max estimate supplied for this day.",
        chart: "line",
        summary: "latest",
        format: (value) =>
          `${formatRegionalFixedNumber(value, regional.locale, 1)} ml/kg/min`,
        secondary: [],
      },
      {
        id: "temperature",
        label: "Body temperature",
        icon: "thermometer-outline",
        color: colors.warning,
        values: temperatureValues,
        available: available(
          current?.bodyTemperatureCelsius,
          ...temperatureValues,
        ),
        primary:
          displayedTemperature === undefined
            ? "No record"
            : formatTemperature(displayedTemperature, regional),
        status:
          displayedTemperature === undefined
            ? "No temperature record for this day"
            : isToday
              ? "Measured today"
              : "Measured on selected day",
        detail:
          displayedTemperature === undefined
            ? "No body-temperature measurement is available for the selected day. Earlier measurements remain in the seven-day chart."
            : "The latest body-temperature measurement supplied for this day.",
        chart: "line",
        summary: "latest",
        format: (value) => formatTemperature(value, regional),
        secondary: [],
      },
      {
        id: "cycle-context",
        label: "Cycle context",
        icon: "calendar-outline",
        color: colors.accent,
        values: cycleValues,
        available: available(...cycleValues),
        primary: latestDay?.hormoneRecordCount
          ? `${formatRegionalNumber(latestDay.hormoneRecordCount, regional.locale, { maximumFractionDigits: 0 })} ${latestDay.hormoneRecordCount === 1 ? "record" : "records"}`
          : "No record",
        status: latestDay?.hormoneRecordCount
          ? isToday
            ? "Recorded today"
            : "Recorded on selected day"
          : "No cycle context for this day",
        detail: latestDay?.hormoneRecordCount
          ? "Menstrual and hormone context stored for this day."
          : "No menstrual or hormone context is available for the selected day. Earlier records remain in the seven-day chart.",
        chart: "bar",
        summary: "total",
        format: (value) =>
          `${formatRegionalNumber(Math.round(value), regional.locale, { maximumFractionDigits: 0 })} records`,
        secondary: [],
      },
    ];
  }, [colors, current, isToday, latestDay, now, regional, stepGoal, trend]);

  const visible = definitions.filter((definition) => definition.available);
  const selected = visible.find((definition) => definition.id === selectedId);

  return (
    <>
      <View style={styles.cards}>
        {visible.map((definition) => (
          <MetricCard
            definition={definition}
            key={definition.id}
            onPress={() => setSelectedId(definition.id)}
            trend={trend}
          />
        ))}
      </View>
      <MetricDetailModal
        definition={selected}
        goal={stepGoal}
        key={selected?.id ?? "closed"}
        now={now}
        onClose={() => setSelectedId(undefined)}
        onGoalChange={setStepGoal}
        trend={trend}
      />
    </>
  );
}

const styles = StyleSheet.create({
  cards: { gap: 9 },
  cardShell: { padding: 0, overflow: "hidden" },
  card: {
    minHeight: 108,
    paddingHorizontal: 14,
    paddingVertical: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  cardCopy: { flex: 1, minWidth: 0 },
  cardStacked: { flexDirection: "column", alignItems: "stretch" },
  cardTrendStacked: { width: "100%" },
  labelRow: { flexDirection: "row", alignItems: "center", gap: 7 },
  icon: {
    width: 28,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
  },
  label: { flex: 1, fontSize: 14, lineHeight: 20, fontWeight: "700" },
  primary: {
    marginTop: 8,
    fontSize: 22,
    lineHeight: 27,
    fontWeight: "800",
    letterSpacing: -0.35,
  },
  status: { marginTop: 2, fontSize: 12, lineHeight: 18 },
  cardTrend: { width: 116, paddingTop: 15 },
  chevron: { position: "absolute", right: 0, top: 0 },
  chart: { width: "100%" },
  chartPlot: { width: "100%", justifyContent: "flex-end" },
  lineHitTargets: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    flexDirection: "row",
  },
  lineHitTarget: { flex: 1 },
  bars: { flex: 1, flexDirection: "row", alignItems: "flex-end", gap: 5 },
  barSlot: { flex: 1, height: "100%", justifyContent: "flex-end" },
  bar: { minHeight: 3, width: "100%" },
  dayLabels: { height: 18, flexDirection: "row", alignItems: "flex-end" },
  dayLabel: {
    flex: 1,
    fontSize: 7,
    lineHeight: 10,
    fontWeight: "700",
    textAlign: "center",
  },
  modalSafe: { flex: 1 },
  modalHeader: {
    width: "100%",
    maxWidth: 760,
    minHeight: 82,
    alignSelf: "center",
    paddingHorizontal: 18,
    paddingTop: 15,
    paddingBottom: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
  },
  modalHeading: { flex: 1 },
  modalTitle: {
    fontSize: 28,
    lineHeight: 35,
    fontWeight: "800",
    letterSpacing: -0.65,
  },
  close: {
    width: 44,
    height: 44,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
  },
  modalContent: {
    width: "100%",
    maxWidth: 760,
    alignSelf: "center",
    paddingHorizontal: 18,
    paddingTop: 4,
    paddingBottom: 36,
    gap: 12,
  },
  detailHero: { minHeight: 220 },
  detailHeadingRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  detailIcon: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  detailStatus: { flex: 1, fontSize: 13, lineHeight: 19, fontWeight: "700" },
  detailValue: {
    marginTop: 22,
    fontSize: 42,
    lineHeight: 49,
    fontWeight: "800",
    letterSpacing: -1,
  },
  detailDescription: { marginTop: 7, fontSize: 12, lineHeight: 19 },
  secondaryGrid: {
    marginTop: 22,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  secondaryReading: { minWidth: "45%", flexGrow: 1 },
  secondaryLabel: { fontSize: 10, lineHeight: 15 },
  secondaryValue: {
    marginTop: 2,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: "700",
  },
  weekHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
    marginBottom: 22,
  },
  weekLabel: { fontSize: 11, lineHeight: 16, textTransform: "capitalize" },
  weekValue: { marginTop: 3, fontSize: 25, lineHeight: 31, fontWeight: "800" },
  weekSummaryKind: { marginTop: 1, fontSize: 9, lineHeight: 13 },
  recordedDays: { fontSize: 12, lineHeight: 18, fontWeight: "800" },
  selectedDay: {
    minHeight: 68,
    borderWidth: StyleSheet.hairlineWidth,
    marginBottom: 18,
    paddingHorizontal: 13,
    paddingVertical: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  selectedDayCopy: { flex: 1, minWidth: 0 },
  selectedDayDate: { fontSize: 12, lineHeight: 17, fontWeight: "800" },
  selectedDayHint: { marginTop: 2, fontSize: 9, lineHeight: 13 },
  selectedDayValue: {
    fontSize: 17,
    lineHeight: 22,
    fontWeight: "800",
    textAlign: "right",
  },
  exactList: {
    marginTop: 16,
    paddingTop: 4,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  exactRow: {
    minHeight: 50,
    paddingHorizontal: 8,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  exactDateRow: { flex: 1, flexDirection: "row", alignItems: "center", gap: 9 },
  exactMarker: { width: 6, height: 6, borderRadius: 3 },
  exactDate: { fontSize: 11, lineHeight: 16, fontWeight: "700" },
  exactValue: {
    fontSize: 12,
    lineHeight: 17,
    fontWeight: "800",
    textAlign: "right",
  },
  intradayTitle: { fontSize: 16, lineHeight: 22, fontWeight: "800" },
  intradayIntro: { marginTop: 4, fontSize: 11, lineHeight: 17 },
  intradayState: {
    minHeight: 76,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 12,
  },
  intradayStateText: { fontSize: 11, lineHeight: 17, textAlign: "center" },
  intradayList: { marginTop: 16, borderTopWidth: StyleSheet.hairlineWidth },
  intradayRow: {
    minHeight: 68,
    paddingVertical: 11,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    gap: 13,
  },
  intradayTimeBlock: { width: 52, paddingTop: 1 },
  intradayTime: {
    fontSize: 12,
    lineHeight: 17,
    fontWeight: "800",
    fontVariant: ["tabular-nums"],
  },
  intradayEnd: {
    marginTop: 1,
    fontSize: 9,
    lineHeight: 13,
    fontVariant: ["tabular-nums"],
  },
  intradayCopy: { flex: 1, minWidth: 0 },
  intradayLabel: { fontSize: 12, lineHeight: 17, fontWeight: "700" },
  intradayDetail: { marginTop: 2, fontSize: 10, lineHeight: 15 },
  intradaySource: { marginTop: 3, fontSize: 9, lineHeight: 13 },
  intradayCaveat: { paddingTop: 11, fontSize: 10, lineHeight: 15 },
  intradayWorkoutGroup: { borderBottomWidth: StyleSheet.hairlineWidth },
  intradayWorkoutTrigger: {
    minHeight: 76,
    marginHorizontal: -4,
    paddingHorizontal: 4,
    paddingVertical: 11,
    flexDirection: "row",
    gap: 13,
  },
  workoutMetaRow: {
    marginTop: 5,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    flexWrap: "wrap",
    gap: 7,
  },
  workoutTimelineEnd: { fontSize: 11, lineHeight: 16 },
  workoutTimelineDetail: { fontSize: 11, lineHeight: 17 },
  workoutSource: { fontSize: 11, lineHeight: 16 },
  workoutAffordance: {
    minHeight: 30,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 9,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  workoutAffordanceText: { fontSize: 11, lineHeight: 15, fontWeight: "800" },
  workoutDetailPanel: {
    marginBottom: 14,
    width: "100%",
    borderWidth: StyleSheet.hairlineWidth,
    padding: 13,
  },
  workoutDetailHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
  },
  workoutDetailTitle: { fontSize: 14, lineHeight: 19, fontWeight: "800" },
  workoutDetailCount: { marginTop: 1, fontSize: 11, lineHeight: 16 },
  workoutDescription: { marginTop: 10, fontSize: 12, lineHeight: 18 },
  workoutHeartRate: {
    marginTop: 12,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 11,
  },
  workoutHeartRateHeading: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
  },
  workoutHeartRateTitle: { fontSize: 12, lineHeight: 18, fontWeight: "800" },
  workoutHeartRateValues: {
    marginTop: 10,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
  },
  workoutHeartRateReading: { minWidth: 105, flexGrow: 1 },
  workoutHeartRateValue: { fontSize: 16, lineHeight: 22, fontWeight: "800" },
  workoutHeartRateLabel: { marginTop: 1, fontSize: 11, lineHeight: 16 },
  workoutHeartRateSource: {
    marginTop: 10,
    fontSize: 11,
    lineHeight: 17,
    fontWeight: "700",
  },
  workoutHeartRateProvenance: { marginTop: 1, fontSize: 11, lineHeight: 16 },
  workoutExerciseList: { marginTop: 11 },
  workoutExercise: { paddingVertical: 11 },
  workoutExerciseHeading: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  workoutExerciseNumber: {
    width: 22,
    height: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  workoutExerciseNumberText: {
    fontSize: 11,
    lineHeight: 15,
    fontWeight: "800",
  },
  workoutExerciseTitle: {
    flex: 1,
    fontSize: 12,
    lineHeight: 18,
    fontWeight: "800",
  },
  workoutExerciseNotes: { marginTop: 6, fontSize: 11, lineHeight: 17 },
  workoutSetList: { marginTop: 7, gap: 5 },
  workoutSetRow: {
    minHeight: 30,
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "flex-start",
    columnGap: 8,
    rowGap: 1,
  },
  workoutSetLabel: {
    minWidth: 44,
    paddingTop: 1,
    fontSize: 11,
    lineHeight: 16,
    fontWeight: "700",
  },
  workoutSetValue: {
    minWidth: 0,
    flexBasis: 180,
    flexGrow: 1,
    flexShrink: 1,
    fontSize: 12,
    lineHeight: 18,
  },
  workoutEmptySets: { marginTop: 7, fontSize: 11, lineHeight: 17 },
  workoutProvenance: {
    marginTop: 6,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  workoutProvenanceText: { flex: 1, fontSize: 11, lineHeight: 16 },
  progressBlock: { marginTop: 20 },
  progressLabels: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 7,
  },
  progressText: { fontSize: 10, lineHeight: 15, fontWeight: "700" },
  progressTrack: { height: 8, overflow: "hidden" },
  progressFill: { height: 8 },
  goalTitle: { fontSize: 16, lineHeight: 22, fontWeight: "800" },
  goalDetail: { marginTop: 4, fontSize: 11, lineHeight: 17 },
  goalRow: { marginTop: 16, flexDirection: "row", gap: 9 },
  goalInput: {
    flex: 1,
    minHeight: 48,
    borderWidth: 1,
    paddingHorizontal: 13,
    fontSize: 16,
  },
  goalSave: {
    minWidth: 86,
    minHeight: 48,
    paddingHorizontal: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  goalSaveText: { fontSize: 13, lineHeight: 18, fontWeight: "800" },
  goalError: { marginTop: 8, fontSize: 11, lineHeight: 16 },
  goalRemove: {
    alignSelf: "flex-start",
    minHeight: 40,
    justifyContent: "center",
    marginTop: 6,
  },
  goalRemoveText: { fontSize: 12, lineHeight: 17, fontWeight: "700" },
});
