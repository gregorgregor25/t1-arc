import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import {
  buildDailyTimelineSummaries,
  DailyTimelineSummary,
} from '@/domain/dailyTimelineSummary';
import { TimelineData } from '@/domain/models';
import { DateKey, formatShortDate, formatTime } from '@/domain/time';
import {
  formatGlucose,
  formatRegionalFixedNumber,
  formatRegionalNumber,
} from '@/domain/regionalFormat';
import {
  getRuntimeRegionalDefaults,
} from '@/domain/regionalProfileRuntime';
import type { T1ArcRegionalDefaults } from '@/domain/regionalProfile';
import { useRegionalProfile } from '@/providers/RegionalProfileProvider';
import { useAppTheme } from '@/theme/theme';

import { SectionCard } from './SectionCard';

export function presentDailySummaryInsulin(
  summary: DailyTimelineSummary,
  regional: T1ArcRegionalDefaults = getRuntimeRegionalDefaults(),
) {
  const hasSourceTotal = summary.sourceReportedInsulinUnits !== undefined;
  const units =
    summary.sourceReportedInsulinUnits ?? summary.insulin.totalUnits;
  const qualifier =
    summary.sourceReportedInsulinUnits === undefined
      ? 'INSULIN'
      : summary.insulinPartial
        ? `INSULIN · AS OF ${
            summary.insulinSourceAsOf === undefined
              ? 'PARTIAL'
              : formatTime(summary.insulinSourceAsOf)
          }`
        : summary.insulinSourceConflictCount
          ? 'INSULIN · LATEST SOURCE'
          : 'INSULIN · SOURCE';
  return {
    qualifier,
    spokenValue:
      units > 0 || hasSourceTotal
        ? `${formatRegionalFixedNumber(units, regional.locale, 1)} units`
        : 'unavailable',
    value:
      units > 0 || hasSourceTotal
        ? `${formatRegionalFixedNumber(units, regional.locale, 1)} U`
        : '—',
  };
}

export function presentDailySummaryGlucose(
  summary: DailyTimelineSummary,
  regional: T1ArcRegionalDefaults = getRuntimeRegionalDefaults(),
) {
  const hasGlucose = summary.glucoseReadings > 0;
  const timeBelow = formatRegionalNumber(summary.glucose.timeBelowPercent, regional.locale);
  const timeInRange = formatRegionalNumber(summary.glucose.timeInRangePercent, regional.locale);
  const timeAbove = formatRegionalNumber(summary.glucose.timeAbovePercent, regional.locale);
  const coverage = formatRegionalNumber(summary.glucose.coveragePercent, regional.locale);
  const average =
    summary.glucose.averageMmolL === null
      ? 'unavailable'
      : formatGlucose(summary.glucose.averageMmolL, regional);
  return {
    hasGlucose,
    accessibilitySummary: hasGlucose
      ? `Time in range ${timeInRange} percent. Average ${average}. Coverage ${coverage} percent.`
      : 'No glucose data.',
    coverage: hasGlucose
      ? `${coverage}% glucose coverage`
      : 'No glucose data',
    rangeAccessibilityLabel: hasGlucose
      ? `Below ${timeBelow} percent, in range ${timeInRange} percent, above ${timeAbove} percent`
      : 'No glucose data',
    readings: hasGlucose
      ? formatRegionalNumber(summary.glucoseReadings, regional.locale, {
          maximumFractionDigits: 0,
        })
      : '—',
    readingsLabel: hasGlucose ? 'READINGS' : 'NO READINGS',
    timeInRange: hasGlucose ? `${timeInRange}%` : '—',
    timeInRangeLabel: hasGlucose ? 'IN RANGE' : 'NO GLUCOSE DATA',
  };
}

export function dailySummaryAccessibilityLabel(
  summary: DailyTimelineSummary,
  regional: T1ArcRegionalDefaults = getRuntimeRegionalDefaults(),
) {
  const insulin = presentDailySummaryInsulin(summary, regional);
  const glucose = presentDailySummaryGlucose(summary, regional);
  return `${formatShortDate(summary.date)}. ${glucose.accessibilitySummary} ${insulin.qualifier}, ${insulin.spokenValue}. Open day.`;
}

function DayRow({
  summary,
  onSelect,
}: {
  summary: DailyTimelineSummary;
  onSelect(date: DateKey): void;
}) {
  const { colors, radius } = useAppTheme();
  const { defaults: regional } = useRegionalProfile();
  const incomplete = summary.glucose.coveragePercent < 70;
  const insulin = presentDailySummaryInsulin(summary, regional);
  const glucose = presentDailySummaryGlucose(summary, regional);
  return (
    <Pressable
      accessibilityLabel={dailySummaryAccessibilityLabel(summary, regional)}
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
            {glucose.coverage}
          </Text>
        </View>
        <View style={styles.tirCopy}>
          <Text style={[styles.tir, { color: colors.text }]}>
            {glucose.timeInRange}
          </Text>
          <Text style={[styles.tirLabel, { color: colors.textTertiary }]}>
            {glucose.timeInRangeLabel}
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
        accessibilityLabel={glucose.rangeAccessibilityLabel}
        style={[
          styles.rangeBar,
          { backgroundColor: colors.border, borderRadius: radius.pill },
        ]}
      >
        {glucose.hasGlucose && summary.glucose.timeBelowPercent > 0 ? (
          <View
            style={{
              backgroundColor: colors.low,
              flex: summary.glucose.timeBelowPercent,
            }}
          />
        ) : null}
        {glucose.hasGlucose && summary.glucose.timeInRangePercent > 0 ? (
          <View
            style={{
              backgroundColor: colors.accent,
              flex: summary.glucose.timeInRangePercent,
            }}
          />
        ) : null}
        {glucose.hasGlucose && summary.glucose.timeAbovePercent > 0 ? (
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
            {glucose.hasGlucose
              ? formatGlucose(summary.glucose.averageMmolL ?? 0, regional, {
                  withUnit: false,
                })
              : '—'}
          </Text>
          <Text style={[styles.metricLabel, { color: colors.textTertiary }]}>
            AVG {regional.glucoseUnit === 'mgDl' ? 'MG/DL' : 'MMOL/L'}
          </Text>
        </View>
        <View style={styles.metric}>
          <Text style={[styles.metricValue, { color: colors.text }]}>
            {insulin.value}
          </Text>
          <Text style={[styles.metricLabel, { color: colors.textTertiary }]}>
            {insulin.qualifier}
          </Text>
        </View>
        <View style={styles.metric}>
          <Text style={[styles.metricValue, { color: colors.text }]}>
            {summary.carbohydrateGrams !== undefined
              ? `${formatRegionalNumber(Math.round(summary.carbohydrateGrams), regional.locale, { maximumFractionDigits: 0 })} g`
              : '—'}
          </Text>
          <Text style={[styles.metricLabel, { color: colors.textTertiary }]}>
            {summary.carbohydrateKnownCount < summary.mealCount ||
            summary.carbohydratePartialCount > 0 ||
            summary.nutritionPossibleDuplicatePairs > 0
              ? 'KNOWN CARBS'
              : 'CARBS'}
          </Text>
        </View>
        <View style={styles.metric}>
          <Text style={[styles.metricValue, { color: colors.text }]}>
            {glucose.readings}
          </Text>
          <Text style={[styles.metricLabel, { color: colors.textTertiary }]}>
            {glucose.readingsLabel}
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
  const { defaults: regional } = useRegionalProfile();
  const [visibleCount, setVisibleCount] = useState(10);
  const summaries = buildDailyTimelineSummaries(data);
  const visible = summaries.slice(0, visibleCount);
  if (summaries.length < 2) return null;

  return (
    <SectionCard
      accessibilityLabel={`${formatRegionalNumber(summaries.length, regional.locale, { maximumFractionDigits: 0 })} daily glucose, insulin and food summaries`}
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
          <DayRow key={summary.date} summary={summary} onSelect={onSelect} />
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
            Show{" "}
            {formatRegionalNumber(
              Math.min(10, summaries.length - visible.length),
              regional.locale,
              { maximumFractionDigits: 0 },
            )}{" "}
            more days
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
