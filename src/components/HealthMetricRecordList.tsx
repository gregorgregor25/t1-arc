import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { DailyMetricRecord } from '@/domain/dailyHealthMetrics';
import { formatTime } from '@/domain/time';
import { useAppTheme } from '@/theme/theme';

import { SectionCard } from './SectionCard';

function bloodGlucoseContext(record: DailyMetricRecord) {
  const specimen =
    record.specimenSource === 1
      ? 'interstitial fluid'
      : record.specimenSource === 2
        ? 'capillary blood'
        : record.specimenSource === 3
          ? 'plasma'
          : record.specimenSource === 4
            ? 'serum'
            : record.specimenSource === 5
              ? 'tears'
              : record.specimenSource === 6
                ? 'whole blood'
                : undefined;
  const meal =
    record.mealType === 1
      ? 'breakfast'
      : record.mealType === 2
        ? 'lunch'
        : record.mealType === 3
          ? 'dinner'
          : record.mealType === 4
            ? 'snack'
            : 'meal';
  const relation =
    record.relationToMeal === 2
      ? 'fasting'
      : record.relationToMeal === 3
        ? `before ${meal}`
        : record.relationToMeal === 4
          ? `after ${meal}`
          : record.relationToMeal === 1
            ? 'general'
            : undefined;
  return [specimen, relation].filter(Boolean).join(' · ');
}

function presentation(record: DailyMetricRecord) {
  switch (record.kind) {
    case 'steps':
      return {
        title: `${Math.round(record.value).toLocaleString('en-GB')} steps`,
        icon: 'footsteps-outline' as const,
      };
    case 'distance':
      return {
        title: `${(record.value / 1_000).toFixed(2)} km`,
        icon: 'navigate-outline' as const,
      };
    case 'elevation_gained':
      return {
        title: `${Math.round(record.value)} m elevation gained`,
        icon: 'trending-up-outline' as const,
      };
    case 'floors_climbed':
      return {
        title: `${record.value.toFixed(1)} floors climbed`,
        icon: 'trending-up-outline' as const,
      };
    case 'active_calories':
      return {
        title: `${Math.round(record.value)} kcal active energy`,
        icon: 'flame-outline' as const,
      };
    case 'total_calories':
      return {
        title: `${Math.round(record.value)} kcal total energy`,
        icon: 'flame-outline' as const,
      };
    case 'workout_power':
      return {
        title: `${Math.round(record.value)} W workout power`,
        icon: 'flash-outline' as const,
      };
    case 'workout_speed':
      return {
        title: `${(record.value * 3.6).toFixed(1)} km/h workout speed`,
        icon: 'speedometer-outline' as const,
      };
    case 'walking_cadence':
      return {
        title: `${Math.round(record.value)} steps/min cadence`,
        icon: 'footsteps-outline' as const,
      };
    case 'cycling_cadence':
      return {
        title: `${Math.round(record.value)} rpm cycling cadence`,
        icon: 'bicycle-outline' as const,
      };
    case 'resting_heart_rate':
      return {
        title: `${Math.round(record.value)} bpm resting`,
        icon: 'heart-outline' as const,
      };
    case 'heart_rate':
      return {
        title: `${Math.round(record.value)} bpm`,
        icon: 'heart-outline' as const,
      };
    case 'weight':
      return {
        title: `${record.value.toFixed(1)} kg weight`,
        icon: 'scale-outline' as const,
      };
    case 'body_fat':
      return {
        title: `${record.value.toFixed(1)}% body fat`,
        icon: 'body-outline' as const,
      };
    case 'lean_body_mass':
      return {
        title: `${record.value.toFixed(1)} kg lean mass`,
        icon: 'body-outline' as const,
      };
    case 'body_water_mass':
      return {
        title: `${record.value.toFixed(1)} kg body water`,
        icon: 'water-outline' as const,
      };
    case 'bone_mass':
      return {
        title: `${record.value.toFixed(1)} kg bone mass`,
        icon: 'body-outline' as const,
      };
    case 'height':
      return {
        title: `${Math.round(record.value * 100)} cm height`,
        icon: 'resize-outline' as const,
      };
    case 'basal_metabolic_rate':
      return {
        title: `${Math.round(record.value).toLocaleString(
          'en-GB',
        )} kcal/day basal metabolism`,
        icon: 'body-outline' as const,
      };
    case 'blood_glucose':
      return {
        title: `${record.value.toFixed(1)} mmol/L blood glucose`,
        icon: 'water-outline' as const,
      };
    case 'blood_pressure_systolic':
      return {
        title: `${Math.round(record.value)} mmHg systolic`,
        icon: 'pulse-outline' as const,
      };
    case 'blood_pressure_diastolic':
      return {
        title: `${Math.round(record.value)} mmHg diastolic`,
        icon: 'pulse-outline' as const,
      };
    case 'oxygen_saturation':
      return {
        title: `${record.value.toFixed(1)}% blood oxygen`,
        icon: 'pulse-outline' as const,
      };
    case 'respiratory_rate':
      return {
        title: `${record.value.toFixed(1)} breaths/min`,
        icon: 'fitness-outline' as const,
      };
    case 'heart_rate_variability_rmssd':
      return {
        title: `${record.value.toFixed(0)} ms HRV (RMSSD)`,
        icon: 'heart-outline' as const,
      };
    case 'vo2_max':
      return {
        title: `${record.value.toFixed(1)} ml/kg/min VO₂ max`,
        icon: 'speedometer-outline' as const,
      };
    case 'body_temperature':
      return {
        title: `${record.value.toFixed(1)} °C body temperature`,
        icon: 'thermometer-outline' as const,
      };
    case 'hydration':
      return {
        title: `${record.value.toFixed(2)} L hydration`,
        icon: 'water-outline' as const,
      };
  }
}

export function HealthMetricRecordList({
  initiallyExpanded = false,
  records,
}: {
  initiallyExpanded?: boolean;
  records: DailyMetricRecord[];
}) {
  const { colors, radius } = useAppTheme();
  const [expanded, setExpanded] = useState(initiallyExpanded);
  const [visibleCount, setVisibleCount] = useState(40);
  const sorted = [...records].sort((left, right) => right.start - left.start);
  const visible = sorted.slice(0, visibleCount);

  useEffect(() => {
    setExpanded(initiallyExpanded);
    setVisibleCount(40);
  }, [initiallyExpanded, records]);

  if (!records.length) return null;

  return (
    <SectionCard>
      <View style={styles.header}>
        <View>
          <Text style={[styles.eyebrow, { color: colors.accent }]}>
            HEALTH CONNECT
          </Text>
          <Text style={[styles.title, { color: colors.text }]}>
            Source health records
          </Text>
        </View>
        <Text style={[styles.count, { color: colors.textSecondary }]}>
          {records.length.toLocaleString('en-GB')}
        </Text>
      </View>
      <Text style={[styles.description, { color: colors.textSecondary }]}>
        Exact imported rows are retained here even when T1 Arc combines them
        into a daily total.
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        onPress={() => setExpanded((value) => !value)}
        style={({ pressed }) => [
          styles.toggle,
          {
            backgroundColor: colors.surfaceMuted,
            borderRadius: radius.md,
            opacity: pressed ? 0.7 : 1,
          },
        ]}
      >
        <Ionicons
          accessibilityElementsHidden
          color={colors.primary}
          name={expanded ? 'chevron-up' : 'list-outline'}
          size={18}
        />
        <Text style={[styles.toggleText, { color: colors.primary }]}>
          {expanded ? 'Hide exact records' : 'Inspect exact records'}
        </Text>
      </Pressable>
      {expanded ? (
        <View style={styles.rows}>
          {visible.map((record, index) => {
            const item = presentation(record);
            const measurementContext =
              record.kind === 'blood_glucose'
                ? bloodGlucoseContext(record)
                : '';
            return (
              <View
                key={record.id}
                style={[
                  styles.row,
                  index < visible.length - 1 && {
                    borderBottomColor: colors.divider,
                    borderBottomWidth: StyleSheet.hairlineWidth,
                  },
                ]}
              >
                <View
                  style={[
                    styles.icon,
                    {
                      backgroundColor: `${colors.accent}16`,
                      borderRadius: radius.sm,
                    },
                  ]}
                >
                  <Ionicons
                    accessibilityElementsHidden
                    color={colors.accent}
                    name={item.icon}
                    size={18}
                  />
                </View>
                <View style={styles.copy}>
                  <Text style={[styles.value, { color: colors.text }]}>
                    {item.title}
                  </Text>
                  <Text style={[styles.meta, { color: colors.textSecondary }]}>
                    {formatTime(record.start)}
                    {record.end > record.start
                      ? `–${formatTime(record.end)}`
                      : ''}{' '}
                    · {record.sourceLabel}
                    {measurementContext ? ` · ${measurementContext}` : ''}
                  </Text>
                  <Text
                    numberOfLines={1}
                    selectable
                    style={[styles.id, { color: colors.textTertiary }]}
                  >
                    ID {record.id}
                  </Text>
                </View>
              </View>
            );
          })}
          {visible.length < sorted.length ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => setVisibleCount((count) => count + 40)}
              style={({ pressed }) => [
                styles.more,
                { opacity: pressed ? 0.65 : 1 },
              ]}
            >
              <Text style={[styles.moreText, { color: colors.primary }]}>
                Show 40 more
              </Text>
            </Pressable>
          ) : null}
        </View>
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
    fontSize: 10,
    lineHeight: 14,
    fontWeight: '800',
    letterSpacing: 0.9,
  },
  title: {
    fontSize: 17,
    lineHeight: 23,
    fontWeight: '700',
    marginTop: 2,
  },
  count: {
    fontSize: 12,
    lineHeight: 18,
  },
  description: {
    fontSize: 12,
    lineHeight: 18,
    marginTop: 9,
  },
  toggle: {
    minHeight: 48,
    marginTop: 14,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  toggleText: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '700',
  },
  rows: {
    marginTop: 8,
  },
  row: {
    minHeight: 78,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 11,
  },
  icon: {
    width: 38,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
  },
  copy: {
    flex: 1,
    minWidth: 0,
  },
  value: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '700',
  },
  meta: {
    fontSize: 11,
    lineHeight: 16,
    marginTop: 1,
  },
  id: {
    fontSize: 9,
    lineHeight: 13,
    marginTop: 2,
  },
  more: {
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  moreText: {
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '700',
  },
});
