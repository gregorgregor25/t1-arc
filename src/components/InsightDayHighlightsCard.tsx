import Ionicons from "@expo/vector-icons/Ionicons";
import { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import {
  dailyRangeSummaries,
  steadiestDay,
  steadiestDayText,
  yesterdayVsTodaySoFar,
  type DayComparisonWindow,
  type SteadiestDayResult,
  type YesterdayTodayComparison,
} from "@/domain/dailyRangeHighlights";
import { formatClock } from "@/domain/exportTime";
import { REPRESENTATIVE_COVERAGE_PERCENT } from "@/domain/glucoseRanges";
import type { GlucoseReading, TimeRange } from "@/domain/models";
import { formatRegionalNumber } from "@/domain/regionalFormat";
import { addDays, toDateKey, zonedDateTimeToTimestamp } from "@/domain/time";
import { useRegionalProfile } from "@/providers/RegionalProfileProvider";
import { useAppTheme } from "@/theme/theme";

import { SectionCard } from "./SectionCard";

/**
 * Locally calculated day-level observations for the review period. Days with
 * under 70% sensor coverage are never named, and the yesterday/today pair is
 * withheld when either side is under 70%.
 */
export function InsightDayHighlightsCard({
  loadGlucose,
  periodRange,
  now,
}: {
  loadGlucose(range: TimeRange): Promise<GlucoseReading[]>;
  periodRange: TimeRange;
  now: number;
}) {
  const { colors } = useAppTheme();
  const { defaults: regional } = useRegionalProfile();
  const [steadiestResult, setSteadiestResult] = useState<SteadiestDayResult>();
  const [comparison, setComparison] = useState<YesterdayTodayComparison | null>(null);
  const { timeZone } = regional;
  const periodStart = periodRange.start;
  const periodEnd = periodRange.end;
  // Re-read the recent pair every five minutes, not on every clock tick.
  const asOf = Math.floor(now / 300_000) * 300_000;

  useEffect(() => {
    let active = true;
    const range = { start: periodStart, end: periodEnd };
    loadGlucose(range)
      .then((readings) => {
        if (active) setSteadiestResult(steadiestDay(dailyRangeSummaries(readings, range, timeZone)));
      })
      .catch(() => {
        if (active) setSteadiestResult(undefined);
      });
    return () => { active = false; };
  }, [loadGlucose, periodEnd, periodStart, timeZone]);

  useEffect(() => {
    let active = true;
    const yesterdayStart = zonedDateTimeToTimestamp(addDays(toDateKey(asOf, timeZone), -1), 0, 0, 0, timeZone);
    loadGlucose({ start: yesterdayStart, end: asOf })
      .then((readings) => {
        if (active) setComparison(yesterdayVsTodaySoFar(readings, asOf, timeZone));
      })
      .catch(() => {
        if (active) setComparison(null);
      });
    return () => { active = false; };
  }, [asOf, loadGlucose, timeZone]);

  if (!steadiestResult && !comparison) return null;
  const steadiest = steadiestResult ? steadiestDayText(steadiestResult, regional) : undefined;
  const percent = (value: number | null) =>
    value === null ? "—" : `${formatRegionalNumber(value, regional.locale, { minimumFractionDigits: 0, maximumFractionDigits: 1 })}%`;
  const windowLine = (window: DayComparisonWindow) =>
    `${window.label} (${formatClock(window.range.start, regional)}–${formatClock(window.range.end, regional)}): ${percent(window.summary.standard.inRange.percent)} in range · ${percent(window.summary.coveragePercent)} coverage`;

  return (
    <SectionCard accessibilityLabel="Day highlights" style={styles.card}>
      {steadiest ? (
        <View style={styles.row}>
          <Ionicons accessibilityElementsHidden color={colors.accent} name="calendar-number-outline" size={19} />
          <View style={styles.copy}>
            <Text style={[styles.eyebrow, { color: colors.textSecondary }]}>STEADIEST DAY</Text>
            <Text style={[styles.title, { color: colors.text }]}>{steadiest.headline}</Text>
            <Text style={[styles.detail, { color: colors.textSecondary }]}>{steadiest.detail}</Text>
          </View>
        </View>
      ) : null}
      {comparison ? (
        <View style={[styles.row, steadiest ? styles.divided : null, { borderColor: colors.divider }]}>
          <Ionicons accessibilityElementsHidden color={colors.accent} name="swap-horizontal-outline" size={19} />
          <View style={styles.copy}>
            <Text style={[styles.eyebrow, { color: colors.textSecondary }]}>YESTERDAY VS TODAY SO FAR</Text>
            {comparison.comparable ? (
              <>
                <Text style={[styles.detail, { color: colors.text }]}>{windowLine(comparison.today)}</Text>
                <Text style={[styles.detail, { color: colors.text }]}>{windowLine(comparison.yesterday)}</Text>
                <Text style={[styles.note, { color: colors.textTertiary }]}>
                  Standard range, same clock hours on both days. This describes the records; it does not show why they differ.
                </Text>
              </>
            ) : (
              <Text style={[styles.detail, { color: colors.textSecondary }]}>
                {`Not enough sensor data to compare yet. Both windows need at least ${REPRESENTATIVE_COVERAGE_PERCENT}% coverage (today ${percent(comparison.today.summary.coveragePercent)}, yesterday ${percent(comparison.yesterday.summary.coveragePercent)}).`}
              </Text>
            )}
          </View>
        </View>
      ) : null}
    </SectionCard>
  );
}

const styles = StyleSheet.create({
  card: { gap: 14, marginBottom: 16 },
  row: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  divided: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 14 },
  copy: { flex: 1, gap: 4 },
  eyebrow: { fontSize: 11, fontWeight: "800", letterSpacing: 0.8 },
  title: { fontSize: 15, fontWeight: "800" },
  detail: { fontSize: 13, lineHeight: 19 },
  note: { fontSize: 12, lineHeight: 17 },
});
