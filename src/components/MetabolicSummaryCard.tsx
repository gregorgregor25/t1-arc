import Ionicons from '@expo/vector-icons/Ionicons';
import { StyleSheet, Text, View } from 'react-native';

import type { InsulinReconciliation } from '@/domain/dataCompleteness';
import { presentInsulinRangeSummary } from '@/domain/insulinSummaryPresentation';
import type { GlucoseStats, InsulinStats } from '@/domain/models';
import {
  formatGlucose,
  formatGlucoseAccessible,
  formatRegionalFixedNumber,
  formatRegionalNumber,
} from '@/domain/regionalFormat';
import type { InsulinRangeSummary } from '@/domain/timelineInsulinSummary';
import { useRegionalProfile } from '@/providers/RegionalProfileProvider';
import { useAppTheme } from '@/theme/theme';

import { SectionCard } from './SectionCard';

export function MetabolicSummaryCard({
  glucose,
  insulin,
  insulinMissing,
  label,
  reconciliation,
  summary,
}: {
  glucose?: GlucoseStats;
  insulin?: InsulinStats;
  insulinMissing: boolean;
  label: string;
  reconciliation?: InsulinReconciliation;
  summary?: InsulinRangeSummary;
}) {
  const { colors, radius } = useAppTheme();
  const { defaults: regional } = useRegionalProfile();
  const observedGlucose = Boolean(
    glucose && glucose.observedMinutes > 0 && glucose.averageMmolL !== null,
  );
  const totalRange = glucose
    ? glucose.timeBelowPercent +
        glucose.timeInRangePercent +
        glucose.timeAbovePercent
    : 0;
  const insulinPresentation = presentInsulinRangeSummary(summary, label, regional);
  const discrepancy = reconciliation?.differenceUnits ?? 0;
  const timeBelow = glucose
    ? formatRegionalNumber(glucose.timeBelowPercent, regional.locale)
    : '0';
  const timeInRange = glucose
    ? formatRegionalNumber(glucose.timeInRangePercent, regional.locale)
    : '0';
  const timeAbove = glucose
    ? formatRegionalNumber(glucose.timeAbovePercent, regional.locale)
    : '0';
  const coverage = glucose
    ? formatRegionalNumber(glucose.coveragePercent, regional.locale)
    : '0';
  const totalInsulin = insulin
    ? formatRegionalFixedNumber(insulin.totalUnits, regional.locale, 1)
    : '0.0';
  const basalInsulin = insulin
    ? formatRegionalFixedNumber(insulin.basalUnits, regional.locale, 1)
    : '0.0';
  const bolusInsulin = insulin
    ? formatRegionalFixedNumber(insulin.bolusUnits, regional.locale, 1)
    : '0.0';

  return (
    <SectionCard
      accessibilityLabel={`Glucose and insulin summary for ${label}. ${
        observedGlucose && glucose
          ? `Time in range ${timeInRange} percent, average ${formatGlucoseAccessible(glucose.averageMmolL!, regional)}, coverage ${coverage} percent.`
          : 'No observed glucose.'
      } ${
        insulinMissing || !insulin
          ? 'No personal insulin history.'
          : `Delivered insulin ${totalInsulin} units, basal ${basalInsulin} units and bolus ${bolusInsulin} units.`
      }`}
    >
      <View style={styles.header}>
        <View style={styles.headingRow}>
          <View
            style={[
              styles.icon,
              {
                backgroundColor: `${colors.glucose}14`,
                borderRadius: radius.md,
              },
            ]}
          >
            <Ionicons color={colors.glucose} name="pulse-outline" size={20} />
          </View>
          <View>
            <Text style={[styles.title, { color: colors.text }]}>
              Glucose + insulin
            </Text>
            <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
              One view of the selected period
            </Text>
          </View>
        </View>
        <Text style={[styles.range, { color: colors.textTertiary }]}>{label}</Text>
      </View>

      <View style={[styles.columns, { borderTopColor: colors.divider }]}>
        <View style={styles.column}>
          <Text style={[styles.columnLabel, { color: colors.glucose }]}>Glucose</Text>
          <Text style={[styles.value, { color: colors.text }]}>
            {observedGlucose && glucose
              ? `${timeInRange}%`
              : '—'}
          </Text>
          <Text style={[styles.valueLabel, { color: colors.textSecondary }]}>
            {observedGlucose ? 'time in range' : 'no observed data'}
          </Text>
          {observedGlucose && glucose && totalRange > 0 ? (
            <View
              accessibilityElementsHidden
              style={[
                styles.rangeBar,
                { backgroundColor: colors.surfaceMuted, borderRadius: radius.pill },
              ]}
            >
              <View
                style={{
                  backgroundColor: colors.low,
                  flex: glucose.timeBelowPercent / totalRange,
                }}
              />
              <View
                style={{
                  backgroundColor: colors.accent,
                  flex: glucose.timeInRangePercent / totalRange,
                }}
              />
              <View
                style={{
                  backgroundColor: colors.high,
                  flex: glucose.timeAbovePercent / totalRange,
                }}
              />
            </View>
          ) : null}
          {observedGlucose && glucose ? (
            <Text style={[styles.detail, { color: colors.textTertiary }]}>
              Below {timeBelow}% · In range{' '}
              {timeInRange}% · Above {timeAbove}%
            </Text>
          ) : null}
        </View>

        <View style={[styles.column, styles.insulinColumn, { borderLeftColor: colors.divider }]}>
          <Text style={[styles.columnLabel, { color: colors.insulin }]}>Insulin</Text>
          <Text style={[styles.value, { color: colors.text }]}>
            {insulinMissing || !insulin ? '—' : totalInsulin}
            {!insulinMissing && insulin ? (
              <Text style={styles.unit}> U</Text>
            ) : null}
          </Text>
          <Text style={[styles.valueLabel, { color: colors.textSecondary }]}>
            {insulinMissing ? 'source not connected' : 'delivered total'}
          </Text>
          {!insulinMissing && insulin ? (
            <View style={styles.insulinRows}>
              <Text style={[styles.insulinDetail, { color: colors.textSecondary }]}>
                Basal <Text style={{ color: colors.text }}>{basalInsulin} U</Text>
              </Text>
              <Text style={[styles.insulinDetail, { color: colors.textSecondary }]}>
                Bolus <Text style={{ color: colors.text }}>{bolusInsulin} U</Text>
              </Text>
            </View>
          ) : null}
        </View>
      </View>

      <View style={[styles.footer, { backgroundColor: colors.surfaceMuted, borderRadius: radius.md }]}>
        <Text style={[styles.footerText, { color: colors.textSecondary }]}>
          {observedGlucose && glucose
            ? `Average ${formatGlucose(glucose.averageMmolL!, regional)} · ${coverage}% coverage`
            : 'Glucose statistics are unavailable for this period.'}
        </Text>
        {!insulinMissing && insulinPresentation.sourceDetail ? (
          <Text style={[styles.footerText, { color: colors.textTertiary }]}>
            {insulinPresentation.sourceDetail}
          </Text>
        ) : null}
        {Math.abs(discrepancy) >= 0.11 ? (
          <Text style={[styles.footerText, { color: colors.warning }]}>
            Source total differs from detailed insulin rows by{' '}
            {discrepancy > 0 ? '+' : ''}
            {formatRegionalFixedNumber(discrepancy, regional.locale, 1)} U.
          </Text>
        ) : null}
      </View>
    </SectionCard>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 },
  headingRow: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 },
  icon: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 17, lineHeight: 22, fontWeight: '800' },
  subtitle: { marginTop: 1, fontSize: 10, lineHeight: 15 },
  range: { maxWidth: 94, fontSize: 10, lineHeight: 15, textAlign: 'right' },
  columns: { marginTop: 16, paddingTop: 16, borderTopWidth: StyleSheet.hairlineWidth, flexDirection: 'row' },
  column: { flex: 1, minWidth: 0, paddingRight: 12 },
  insulinColumn: { borderLeftWidth: StyleSheet.hairlineWidth, paddingLeft: 16, paddingRight: 0 },
  columnLabel: { fontSize: 10, lineHeight: 15, fontWeight: '800' },
  value: { marginTop: 2, fontSize: 30, lineHeight: 36, fontWeight: '800', fontVariant: ['tabular-nums'], letterSpacing: -0.7 },
  unit: { fontSize: 15, fontWeight: '700' },
  valueLabel: { fontSize: 10, lineHeight: 15 },
  rangeBar: { height: 6, marginTop: 13, flexDirection: 'row', overflow: 'hidden' },
  detail: { marginTop: 7, fontSize: 8, lineHeight: 12 },
  insulinRows: { marginTop: 10, gap: 3 },
  insulinDetail: { fontSize: 10, lineHeight: 15 },
  footer: { marginTop: 16, paddingHorizontal: 12, paddingVertical: 10, gap: 3 },
  footerText: { fontSize: 9, lineHeight: 14 },
});
