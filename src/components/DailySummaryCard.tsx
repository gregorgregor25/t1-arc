import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import {
  buildDailyTimelineSummaries,
  DailyTimelineSummary,
} from '@/domain/dailyTimelineSummary';
import { TimelineData } from '@/domain/models';
import { DateKey, formatShortDate } from '@/domain/time';
import { useAppTheme } from '@/theme/theme';

import { SectionCard } from './SectionCard';

function metric(value: number | null, suffix: string) {
  return value === null ? '—' : `${value}${suffix}`;
}

function DayRow({
  summary,
  onSelect,
}: {
  summary: DailyTimelineSummary;
  onSelect(date: DateKey): void;
}) {
  const { colors, radius } = useAppTheme();
  const incomplete = summary.glucose.coveragePercent < 70;
  return (
    <Pressable
      accessibilityLabel={`${formatShortDate(summary.date)}. Time in range ${summary.glucose.timeInRangePercent} percent. Average ${summary.glucose.averageMmolL ?? 'unavailable'} millimoles per litre. Coverage ${summary.glucose.coveragePercent} percent. Open day.`}
      accessibilityRole="button"
      onPress={() => onSelect(summary.date)}
      style={({ pressed }) => [
        styles.row,
        {
          backgroundColor: colors.surfaceMuted,
          borderColor: incomplete ? `${colors.warning}55` : colors.border,
          borderRadius: radius.md,
          opacity: pressed ? 0.68 : 1,
        },
      ]}
    >
      <View style={styles.rowTop}>
        <View style={styles.dateCopy}>
          <Text style={[styles.date, { color: colors.text }]}>
            {formatShortDate(summary.date)}
          </Text>
          <Text
            style={[
              styles.coverage,
              { color: incomplete ? colors.warning : colors.textTertiary },
            ]}
          >
            {summary.glucose.coveragePercent}% glucose coverage
          </Text>
        </View>
        <View style={styles.tirCopy}>
          <Text style={[styles.tir, { color: colors.text }]}>
            {summary.glucose.timeInRangePercent}%
          </Text>
          <Text style={[styles.tirLabel, { color: colors.textTertiary }]}>
            IN RANGE
          </Text>
        </View>
        <Ionicons
          accessibilityElementsHidden
          color={colors.textTertiary}
          name="chevron-forward"
          size={18}
        />
      </View>
      <View
        accessibilityLabel={`Below ${summary.glucose.timeBelowPercent} percent, in range ${summary.glucose.timeInRangePercent} percent, above ${summary.glucose.timeAbovePercent} percent`}
        style={[
          styles.rangeBar,
          { backgroundColor: colors.border, borderRadius: radius.pill },
        ]}
      >
        {summary.glucose.timeBelowPercent > 0 ? (
          <View
            style={{
              backgroundColor: colors.low,
              flex: summary.glucose.timeBelowPercent,
            }}
          />
        ) : null}
        {summary.glucose.timeInRangePercent > 0 ? (
          <View
            style={{
              backgroundColor: colors.accent,
              flex: summary.glucose.timeInRangePercent,
            }}
          />
        ) : null}
        {summary.glucose.timeAbovePercent > 0 ? (
          <View
            style={{
              backgroundColor: colors.high,
              flex: summary.glucose.timeAbovePercent,
            }}
          />
        ) : null}
      </View>
      <View style={styles.metrics}>
        <View style={styles.metric}>
          <Text style={[styles.metricValue, { color: colors.text }]}>
            {metric(summary.glucose.averageMmolL, '')}
          </Text>
          <Text style={[styles.metricLabel, { color: colors.textTertiary }]}>
            AVG MMOL/L
          </Text>
        </View>
        <View style={styles.metric}>
          <Text style={[styles.metricValue, { color: colors.text }]}>
            {(summary.sourceReportedInsulinUnits ??
              summary.insulin.totalUnits) > 0
              ? `${(
                  summary.sourceReportedInsulinUnits ??
                  summary.insulin.totalUnits
                ).toFixed(1)} U`
              : '—'}
          </Text>
          <Text style={[styles.metricLabel, { color: colors.textTertiary }]}>
            {summary.sourceReportedInsulinUnits === undefined
              ? 'INSULIN'
              : 'INSULIN · SOURCE'}
          </Text>
        </View>
        <View style={styles.metric}>
          <Text style={[styles.metricValue, { color: colors.text }]}>
            {summary.mealCount > 0
              ? `${Math.round(summary.carbohydrateGrams)} g`
              : '—'}
          </Text>
          <Text style={[styles.metricLabel, { color: colors.textTertiary }]}>
            CARBS
          </Text>
        </View>
        <View style={styles.metric}>
          <Text style={[styles.metricValue, { color: colors.text }]}>
            {summary.glucoseReadings}
          </Text>
          <Text style={[styles.metricLabel, { color: colors.textTertiary }]}>
            READINGS
          </Text>
        </View>
      </View>
    </Pressable>
  );
}

export function DailySummaryCard({
  data,
  onSelect,
}: {
  data: TimelineData;
  onSelect(date: DateKey): void;
}) {
  const { colors, radius } = useAppTheme();
  const [visibleCount, setVisibleCount] = useState(10);
  const summaries = buildDailyTimelineSummaries(data);
  const visible = summaries.slice(0, visibleCount);
  if (summaries.length < 2) return null;

  return (
    <SectionCard
      accessibilityLabel={`${summaries.length} daily glucose, insulin and food summaries`}
    >
      <View style={styles.header}>
        <View>
          <Text style={[styles.eyebrow, { color: colors.primary }]}>
            DAY BY DAY
          </Text>
          <Text style={[styles.title, { color: colors.text }]}>
            Daily summaries
          </Text>
          <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
            Compare the days, then tap one to inspect it.
          </Text>
        </View>
        <Ionicons
          accessibilityElementsHidden
          color={colors.primary}
          name="calendar-outline"
          size={23}
        />
      </View>
      <View style={styles.rows}>
        {visible.map((summary) => (
          <DayRow
            key={summary.date}
            summary={summary}
            onSelect={onSelect}
          />
        ))}
      </View>
      {visible.length < summaries.length ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => setVisibleCount((count) => count + 10)}
          style={({ pressed }) => [
            styles.showMore,
            {
              borderColor: colors.border,
              borderRadius: radius.sm,
              opacity: pressed ? 0.68 : 1,
            },
          ]}
        >
          <Text style={[styles.showMoreText, { color: colors.primary }]}>
            Show {Math.min(10, summaries.length - visible.length)} more days
          </Text>
        </Pressable>
      ) : null}
      <Text style={[styles.footnote, { color: colors.textTertiary }]}>
        Percentages use observed glucose time only. Low coverage is highlighted
        so a quiet sensor day is never mistaken for a stable day.
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
    fontSize: 10,
    lineHeight: 14,
    fontWeight: '800',
    letterSpacing: 0.9,
  },
  title: {
    fontSize: 18,
    lineHeight: 24,
    fontWeight: '700',
    marginTop: 2,
  },
  subtitle: {
    fontSize: 12,
    lineHeight: 18,
    marginTop: 2,
  },
  rows: {
    gap: 8,
    marginTop: 14,
  },
  row: {
    borderWidth: StyleSheet.hairlineWidth,
    padding: 12,
  },
  rowTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  dateCopy: {
    flex: 1,
  },
  date: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '700',
  },
  coverage: {
    fontSize: 9,
    lineHeight: 14,
    marginTop: 1,
  },
  tirCopy: {
    alignItems: 'flex-end',
  },
  tir: {
    fontSize: 17,
    lineHeight: 20,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  tirLabel: {
    fontSize: 7,
    lineHeight: 10,
    fontWeight: '800',
    letterSpacing: 0.55,
  },
  rangeBar: {
    height: 5,
    flexDirection: 'row',
    overflow: 'hidden',
    marginTop: 10,
  },
  metrics: {
    flexDirection: 'row',
    marginTop: 10,
  },
  metric: {
    flex: 1,
  },
  metricValue: {
    fontSize: 11,
    lineHeight: 16,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  metricLabel: {
    fontSize: 7,
    lineHeight: 10,
    fontWeight: '800',
    letterSpacing: 0.4,
  },
  showMore: {
    minHeight: 44,
    borderWidth: StyleSheet.hairlineWidth,
    marginTop: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  showMoreText: {
    fontSize: 11,
    lineHeight: 16,
    fontWeight: '700',
  },
  footnote: {
    fontSize: 10,
    lineHeight: 16,
    marginTop: 12,
  },
});
