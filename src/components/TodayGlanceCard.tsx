import Ionicons from "@expo/vector-icons/Ionicons";
import { useState } from "react";
import {
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";

import { DailyHealthMetrics } from "@/domain/dailyHealthMetrics";
import {
  GlucoseStats,
  HealthContextEvent,
  InsulinStats,
  TimeRange,
} from "@/domain/models";
import {
  nutritionCoverageNeedsReview,
  summarizeHealthTrendContext,
} from "@/domain/healthTrendContext";
import {
  formatEnergy,
  formatRegionalFixedNumber,
  formatRegionalNumber,
  formatWeight,
} from "@/domain/regionalFormat";
import { useRegionalProfile } from "@/providers/RegionalProfileProvider";
import { useAppTheme } from "@/theme/theme";
import { DEFAULT_DISPLAY_PREFERENCES, GLANCE_METRIC_IDS, prioritiseGlanceMetrics } from "@/domain/displayPreferences";
import { useDisplayPreferences } from "@/hooks/useDisplayPreferences";
import { presentGlanceGlucose } from '@/domain/glanceGlucosePresentation';

import { SectionCard } from "./SectionCard";
import { MetricPreferencesSheet } from "./MetricPreferencesSheet";

const GLANCE_OPTIONS = [
  { id: "time-in-range", label: "Time in range" },
  { id: "insulin", label: "Insulin" },
  { id: "nutrition", label: "Nutrition" },
  { id: "sleep", label: "Sleep" },
  { id: "blood-pressure", label: "Blood pressure" },
  { id: "heart-rate", label: "Heart rate" },
  { id: "steps", label: "Steps" },
  { id: "activity", label: "Activity" },
  { id: "weight", label: "Weight" },
];

interface GlanceMetric {
  id: string;
  label: string;
  value: string;
  detail?: string;
  icon: keyof typeof Ionicons.glyphMap;
  tone: string;
  segments?: { color: string; value: number }[];
  stackValue?: boolean;
  onPress?(): void;
}

function overlapMinutes(start: number, end: number, range: TimeRange) {
  return Math.max(
    0,
    (Math.min(end, range.end) - Math.max(start, range.start)) / 60_000,
  );
}

function formatDuration(value: number, locale: string) {
  const minutes = Math.round(value);
  if (minutes < 60) {
    return `${formatRegionalNumber(minutes, locale, { maximumFractionDigits: 0 })} min`;
  }
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  const hoursLabel = formatRegionalNumber(hours, locale, {
    maximumFractionDigits: 0,
  });
  const remainderLabel = formatRegionalNumber(remainder, locale, {
    maximumFractionDigits: 0,
  });
  return remainder ? `${hoursLabel}h ${remainderLabel}m` : `${hoursLabel}h`;
}

function MetricRow({ metric, last }: { metric: GlanceMetric; last: boolean }) {
  const { colors, radius } = useAppTheme();
  const { fontScale } = useWindowDimensions();
  const stackedValue = fontScale > 1.3 || metric.stackValue;
  const segmentTotal =
    metric.segments?.reduce((total, segment) => total + segment.value, 0) ?? 0;

  return (
    <Pressable
      accessible
      accessibilityLabel={`${metric.label}, ${metric.value}${
        metric.detail ? `, ${metric.detail}` : ""
      }`}
      accessibilityHint={
        metric.onPress ? `Opens ${metric.label} history` : undefined
      }
      accessibilityRole={metric.onPress ? "button" : undefined}
      disabled={!metric.onPress}
      onPress={metric.onPress}
      style={({ pressed }) => [
        !last && {
          borderBottomWidth: StyleSheet.hairlineWidth,
          borderBottomColor: colors.divider,
        },
        pressed && { opacity: 0.7 },
      ]}
    >
      <View style={styles.metric}>
        <View
          accessibilityElementsHidden
          style={[
            styles.icon,
            {
              backgroundColor: `${metric.tone}18`,
              borderColor: `${metric.tone}32`,
              borderRadius: radius.md,
            },
          ]}
        >
          <Ionicons color={metric.tone} name={metric.icon} size={21} />
        </View>
        <View style={styles.metricCopy}>
          <Text style={[styles.metricLabel, { color: colors.textSecondary }]}>
            {metric.label}
          </Text>
          {stackedValue ? (
            <Text
              style={[
                styles.metricValue,
                styles.stackedValue,
                { color: colors.text },
              ]}
            >
              {metric.value}
            </Text>
          ) : null}
          {metric.detail ? (
            <Text style={[styles.metricDetail, { color: colors.textTertiary }]}>
              {metric.detail}
            </Text>
          ) : null}
          {segmentTotal > 0 ? (
            <View
              accessibilityElementsHidden
              style={[
                styles.track,
                {
                  backgroundColor: colors.surfaceMuted,
                  borderRadius: radius.pill,
                },
              ]}
            >
              {metric.segments!.map((segment, index) => (
                <View
                  key={`${metric.id}:${index}`}
                  style={{
                    backgroundColor: segment.color,
                    flex: segment.value,
                    opacity: index === 0 ? 0.72 : 1,
                  }}
                />
              ))}
            </View>
          ) : null}
        </View>
        {!stackedValue ? (
          <Text style={[styles.metricValue, { color: colors.text }]}>
            {metric.value}
          </Text>
        ) : null}
        {metric.onPress ? (
          <Ionicons
            accessibilityElementsHidden
            color={colors.textTertiary}
            name="chevron-forward"
            size={17}
          />
        ) : null}
      </View>
    </Pressable>
  );
}

export function TodayGlanceCard({
  glucose,
  glucoseLabel,
  health,
  insulin,
  insulinAvailable,
  events,
  range,
  onOpenInsulin,
  onOpenTimeInRange,
}: {
  glucose?: GlucoseStats;
  glucoseLabel: string;
  health?: DailyHealthMetrics;
  insulin?: InsulinStats;
  insulinAvailable: boolean;
  events: HealthContextEvent[];
  range: TimeRange;
  onOpenInsulin?(): void;
  onOpenTimeInRange?(): void;
}) {
  const { colors } = useAppTheme();
  const { defaults: regional } = useRegionalProfile();
  const display = useDisplayPreferences();
  const [editingPriorities, setEditingPriorities] = useState(false);
  const [draftOrder, setDraftOrder] = useState<string[]>([]);
  const meals = events.filter(
    (event) =>
      event.kind === "meal" &&
      event.start >= range.start &&
      event.start < range.end,
  );
  const nutrition = summarizeHealthTrendContext(meals, range);
  const carbohydrates = nutrition.mealCarbsGrams;
  const nutritionEnergy = nutrition.mealEnergyKcal;
  const carbohydrateCoverage = nutrition.mealNutrientCoverage.carbsGrams;
  const sleepMinutes = events
    .filter((event) => event.kind === "sleep")
    .reduce(
      (total, event) =>
        total +
        overlapMinutes(
          event.start,
          event.end ??
            event.start +
              (event.kind === "sleep" ? event.durationMinutes : 0) * 60_000,
          range,
        ),
      0,
    );
  const activityMinutes = events
    .filter((event) => event.kind === "activity")
    .reduce(
      (total, event) =>
        total +
        overlapMinutes(
          event.start,
          event.end ??
            event.start +
              (event.kind === "activity" ? event.durationMinutes : 0) * 60_000,
          range,
        ),
      0,
    );
  const latestWeight = [...events]
    .filter(
      (event) =>
        event.kind === "weight" &&
        event.start >= range.start &&
        event.start < range.end,
    )
    .sort((left, right) => right.start - left.start)
    .at(0);

  const metrics: GlanceMetric[] = [];
  if (glucose && glucose.observedMinutes > 0) {
    const glucosePresentation = presentGlanceGlucose(glucose, glucoseLabel, regional.locale);
    metrics.push({
      id: "time-in-range",
      label: "Time in range",
      value: glucosePresentation.value,
      detail: glucosePresentation.detail,
      stackValue: glucosePresentation.limited,
      icon: "analytics-outline",
      tone: colors.glucose,
      segments: glucosePresentation.limited ? undefined : [
        { color: colors.low, value: glucose.timeBelowPercent },
        { color: colors.accent, value: glucose.timeInRangePercent },
        { color: colors.high, value: glucose.timeAbovePercent },
      ],
      onPress: onOpenTimeInRange,
    });
  }
  if (insulinAvailable && insulin) {
    metrics.push({
      id: "insulin",
      label: "Insulin",
      value: `${formatRegionalFixedNumber(insulin.totalUnits, regional.locale, 1)} U`,
      detail: `${formatRegionalFixedNumber(insulin.basalUnits, regional.locale, 1)} basal · ${formatRegionalFixedNumber(insulin.bolusUnits, regional.locale, 1)} bolus`,
      icon: "water-outline",
      tone: colors.insulin,
      segments: [
        { color: colors.insulin, value: insulin.basalUnits },
        { color: colors.primary, value: insulin.bolusUnits },
      ],
      onPress: onOpenInsulin,
    });
  }
  if (meals.length > 0) {
    metrics.push({
      id: "nutrition",
      label: "Nutrition",
      value:
        carbohydrates !== undefined
          ? `${formatRegionalNumber(Math.round(carbohydrates), regional.locale, { maximumFractionDigits: 0 })} g${
              nutritionCoverageNeedsReview(carbohydrateCoverage) ||
              nutrition.nutritionPossibleDuplicatePairs > 0
                ? " known"
                : ""
            }`
          : nutritionEnergy !== undefined
            ? formatEnergy(nutritionEnergy, regional)
            : formatRegionalNumber(meals.length, regional.locale, {
                maximumFractionDigits: 0,
              }),
      detail: [
        `${formatRegionalNumber(meals.length, regional.locale, { maximumFractionDigits: 0 })} ${meals.length === 1 ? "meal" : "meals"} logged`,
        carbohydrates === undefined
          ? "carbohydrate not supplied"
          : carbohydrateCoverage.knownCount < carbohydrateCoverage.recordCount
            ? `carbs known for ${formatRegionalNumber(carbohydrateCoverage.knownCount, regional.locale, { maximumFractionDigits: 0 })} of ${formatRegionalNumber(carbohydrateCoverage.recordCount, regional.locale, { maximumFractionDigits: 0 })}`
            : undefined,
        (carbohydrateCoverage.partialCount ?? 0) > 0
          ? `${formatRegionalNumber(carbohydrateCoverage.partialCount ?? 0, regional.locale, { maximumFractionDigits: 0 })} meal nutrient subtotal`
          : undefined,
        nutrition.nutritionPossibleDuplicatePairs > 0
          ? "possible cross-source overlap"
          : undefined,
      ]
        .filter(Boolean)
        .join(" · "),
      icon: "restaurant-outline",
      tone: colors.high,
    });
  }
  if (sleepMinutes > 0) {
    metrics.push({
      id: "sleep",
      label: "Sleep",
      value: formatDuration(sleepMinutes, regional.locale),
      icon: "moon-outline",
      tone: colors.insulin,
    });
  }
  if (
    health?.bloodPressureSystolic !== undefined &&
    health.bloodPressureDiastolic !== undefined
  ) {
    metrics.push({
      id: "blood-pressure",
      label: "Blood pressure",
      value: `${formatRegionalNumber(Math.round(health.bloodPressureSystolic), regional.locale, { maximumFractionDigits: 0 })}/${formatRegionalNumber(Math.round(health.bloodPressureDiastolic), regional.locale, { maximumFractionDigits: 0 })}`,
      detail: "mmHg",
      icon: "heart-circle-outline",
      tone: colors.low,
    });
  }
  if (
    health?.restingHeartRateBpm !== undefined ||
    health?.averageHeartRateBpm !== undefined
  ) {
    const heartRate =
      health.restingHeartRateBpm ?? health.averageHeartRateBpm ?? 0;
    metrics.push({
      id: "heart-rate",
      label:
        health.restingHeartRateBpm !== undefined
          ? "Resting heart rate"
          : "Heart rate",
      value: `${formatRegionalNumber(Math.round(heartRate), regional.locale, { maximumFractionDigits: 0 })} bpm`,
      icon: "heart-outline",
      tone: colors.low,
    });
  }
  if (health?.steps !== undefined) {
    metrics.push({
      id: "steps",
      label: "Steps",
      value: formatRegionalNumber(health.steps, regional.locale),
      icon: "footsteps-outline",
      tone: colors.accent,
    });
  }
  if (activityMinutes > 0) {
    metrics.push({
      id: "activity",
      label: "Activity",
      value: formatDuration(activityMinutes, regional.locale),
      icon: "walk-outline",
      tone: colors.accent,
    });
  }
  if (
    health?.weightKilograms !== undefined ||
    latestWeight?.kind === "weight"
  ) {
    const weight =
      health?.weightKilograms ??
      (latestWeight?.kind === "weight" ? latestWeight.kilograms : undefined);
    if (weight !== undefined) {
      metrics.push({
        id: "weight",
        label: "Weight",
        value: formatWeight(weight, regional),
        icon: "scale-outline",
        tone: colors.primary,
      });
    }
  }

  if (!metrics.length) return null;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text accessibilityRole="header" style={[styles.title, { color: colors.text }]}>At a glance</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Edit your at a glance priorities"
          accessibilityState={{ disabled: display.loading }}
          disabled={display.loading}
          onPress={() => {
            setDraftOrder([...new Set([...display.preferences.glanceOrder, ...GLANCE_METRIC_IDS])]);
            setEditingPriorities(true);
          }}
          style={({ pressed }) => [styles.edit, { opacity: pressed || display.loading ? 0.5 : 1 }]}
        >
          <Text style={[styles.editText, { color: colors.primary }]}>Edit</Text>
        </Pressable>
      </View>
      {display.error && !editingPriorities ? (
        <Pressable accessibilityRole="button" accessibilityLabel="Retry loading display choices" onPress={() => void display.retry()} style={styles.retry}>
          <Text style={[styles.metricDetail, { color: colors.warning }]}>{display.error} Tap to retry.</Text>
        </Pressable>
      ) : null}
      <SectionCard style={styles.metrics}>
        {prioritiseGlanceMetrics(metrics, display.preferences.glanceOrder).map((metric, index, visible) => (
          <MetricRow
            key={metric.id}
            last={index === visible.length - 1}
            metric={metric}
          />
        ))}
      </SectionCard>
      <MetricPreferencesSheet
        visible={editingPriorities}
        mode="priorities"
        options={GLANCE_OPTIONS}
        selected={draftOrder}
        onChange={setDraftOrder}
        onClose={() => setEditingPriorities(false)}
        onReset={() => setDraftOrder([...DEFAULT_DISPLAY_PREFERENCES.glanceOrder])}
        onSave={() => { void display.save({ glanceOrder: draftOrder }).then(saved => { if (saved) setEditingPriorities(false); }); }}
        saving={display.saving}
        error={display.error}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginTop: 24,
  },
  title: {
    flex: 1,
    fontSize: 18,
    lineHeight: 24,
    fontWeight: "600",
    letterSpacing: -0.2,
  },
  header: { flexDirection: "row", alignItems: "center", gap: 12 },
  edit: { minWidth: 48, minHeight: 48, alignItems: "center", justifyContent: "center" },
  editText: { fontSize: 14, lineHeight: 21, fontWeight: "600" },
  retry: { minHeight: 48, justifyContent: "center" },
  metrics: {
    marginTop: 11,
    padding: 0,
    overflow: "hidden",
  },
  metric: {
    minHeight: 70,
    paddingHorizontal: 14,
    paddingVertical: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 11,
  },
  icon: {
    width: 42,
    height: 42,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
  },
  metricCopy: {
    flex: 1,
    minWidth: 0,
  },
  metricLabel: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "600",
  },
  metricDetail: {
    fontSize: 12,
    lineHeight: 17,
    marginTop: 1,
  },
  metricValue: {
    fontSize: 20,
    lineHeight: 26,
    fontWeight: "700",
    fontVariant: ["tabular-nums"],
    letterSpacing: -0.35,
    textAlign: "right",
  },
  stackedValue: { textAlign: "left", marginTop: 4 },
  track: {
    height: 4,
    maxWidth: 112,
    marginTop: 6,
    flexDirection: "row",
    overflow: "hidden",
  },
});
