import { StyleSheet, Text, View } from 'react-native';

import { GlucoseStats, InsulinStats } from '@/domain/models';
import { useAppTheme } from '@/theme/theme';

import { SectionCard } from './SectionCard';

function Metric({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail?: string;
}) {
  const { colors } = useAppTheme();
  return (
    <View style={styles.metric}>
      <Text style={[styles.metricLabel, { color: colors.textSecondary }]}>{label}</Text>
      <Text style={[styles.metricValue, { color: colors.text }]}>{value}</Text>
      {detail ? (
        <Text style={[styles.metricDetail, { color: colors.textTertiary }]}>
          {detail}
        </Text>
      ) : null}
    </View>
  );
}

export function GlucoseStatsCard({
  stats,
  label = 'Selected range',
}: {
  stats: GlucoseStats;
  label?: string;
}) {
  const { colors } = useAppTheme();
  const total =
    stats.timeBelowPercent + stats.timeInRangePercent + stats.timeAbovePercent || 1;
  return (
    <SectionCard
      accessibilityLabel={`Time in range ${stats.timeInRangePercent} percent. Below range ${stats.timeBelowPercent} percent. Above range ${stats.timeAbovePercent} percent. Average ${stats.averageMmolL ?? 'unavailable'} millimoles per litre. Coefficient of variation ${stats.coefficientOfVariationPercent ?? 'unavailable'} percent. Data coverage ${stats.coveragePercent} percent.`}
    >
      <View style={styles.cardHeader}>
        <View>
          <Text style={[styles.cardEyebrow, { color: colors.primary }]}>GLUCOSE</Text>
          <Text style={[styles.cardTitle, { color: colors.text }]}>Time in range</Text>
        </View>
        <Text style={[styles.rangeLabel, { color: colors.textSecondary }]}>{label}</Text>
      </View>
      <View style={styles.tirRow}>
        <Text style={[styles.tirValue, { color: colors.text }]}>
          {stats.timeInRangePercent}
          <Text style={styles.tirPercent}>%</Text>
        </Text>
        <Text style={[styles.tirTarget, { color: colors.textSecondary }]}>
          3.9–10.0 mmol/L
        </Text>
      </View>
      <View
        accessibilityElementsHidden
        style={[styles.rangeBar, { backgroundColor: colors.surfaceMuted }]}
      >
        {stats.timeBelowPercent > 0 ? (
          <View
            style={{
              backgroundColor: colors.low,
              flex: stats.timeBelowPercent / total,
            }}
          />
        ) : null}
        {stats.timeInRangePercent > 0 ? (
          <View
            style={{
              backgroundColor: colors.accent,
              flex: stats.timeInRangePercent / total,
            }}
          />
        ) : null}
        {stats.timeAbovePercent > 0 ? (
          <View
            style={{
              backgroundColor: colors.high,
              flex: stats.timeAbovePercent / total,
            }}
          />
        ) : null}
      </View>
      <View style={styles.legend}>
        <Text style={[styles.legendText, { color: colors.low }]}>
          Below {stats.timeBelowPercent}%
        </Text>
        <Text style={[styles.legendText, { color: colors.accent }]}>
          In range {stats.timeInRangePercent}%
        </Text>
        <Text style={[styles.legendText, { color: colors.high }]}>
          Above {stats.timeAbovePercent}%
        </Text>
      </View>
      <View style={[styles.metricsRow, { borderTopColor: colors.divider }]}>
        <Metric
          label="Average"
          value={
            stats.averageMmolL === null ? '—' : `${stats.averageMmolL.toFixed(1)}`
          }
          detail="mmol/L"
        />
        <Metric
          label="Variability"
          value={
            stats.coefficientOfVariationPercent === null
              ? '—'
              : `${stats.coefficientOfVariationPercent}%`
          }
          detail={
            stats.standardDeviationMmolL === null
              ? 'No data'
              : `CV · SD ${stats.standardDeviationMmolL.toFixed(1)}`
          }
        />
        <Metric
          label="Coverage"
          value={`${stats.coveragePercent}%`}
          detail={`${stats.observedMinutes} min observed`}
        />
      </View>
    </SectionCard>
  );
}

export function InsulinStatsCard({
  stats,
  label = 'Today so far',
}: {
  stats: InsulinStats;
  label?: string;
}) {
  const { colors } = useAppTheme();
  const basalShare = stats.totalUnits > 0 ? stats.basalUnits / stats.totalUnits : 0;
  return (
    <SectionCard
      accessibilityLabel={`Insulin total ${stats.totalUnits.toFixed(1)} units. Basal ${stats.basalUnits.toFixed(1)} units. Bolus ${stats.bolusUnits.toFixed(1)} units. Delayed cloud data.`}
    >
      <View style={styles.cardHeader}>
        <View>
          <Text style={[styles.cardEyebrow, { color: colors.insulin }]}>INSULIN</Text>
          <Text style={[styles.cardTitle, { color: colors.text }]}>Delivered total</Text>
        </View>
        <Text style={[styles.rangeLabel, { color: colors.textSecondary }]}>{label}</Text>
      </View>
      <View style={styles.insulinTotalRow}>
        <Text style={[styles.insulinTotal, { color: colors.text }]}>
          {stats.totalUnits.toFixed(1)}
        </Text>
        <Text style={[styles.insulinUnit, { color: colors.textSecondary }]}>units</Text>
      </View>
      <View
        accessibilityElementsHidden
        style={[styles.rangeBar, { backgroundColor: colors.surfaceMuted }]}
      >
        {stats.totalUnits > 0 ? (
          <>
            <View
              style={{
                backgroundColor: colors.insulin,
                flex: basalShare,
              }}
            />
            <View
              style={{
                backgroundColor: colors.primary,
                flex: 1 - basalShare,
              }}
            />
          </>
        ) : null}
      </View>
      <View style={styles.insulinBreakdown}>
        <View style={styles.breakdownItem}>
          <View style={[styles.legendDot, { backgroundColor: colors.insulin }]} />
          <View>
            <Text style={[styles.breakdownLabel, { color: colors.textSecondary }]}>
              Basal
            </Text>
            <Text style={[styles.breakdownValue, { color: colors.text }]}>
              {stats.basalUnits.toFixed(1)} U
            </Text>
          </View>
        </View>
        <View style={styles.breakdownItem}>
          <View style={[styles.legendDot, { backgroundColor: colors.primary }]} />
          <View>
            <Text style={[styles.breakdownLabel, { color: colors.textSecondary }]}>
              Bolus
            </Text>
            <Text style={[styles.breakdownValue, { color: colors.text }]}>
              {stats.bolusUnits.toFixed(1)} U
            </Text>
          </View>
        </View>
      </View>
      <Text style={[styles.delayedNote, { color: colors.textSecondary }]}>
        From the latest delayed export—not live pump status.
      </Text>
    </SectionCard>
  );
}

const styles = StyleSheet.create({
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  cardEyebrow: {
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '800',
    letterSpacing: 1,
    marginBottom: 2,
  },
  cardTitle: {
    fontSize: 18,
    lineHeight: 24,
    fontWeight: '700',
  },
  rangeLabel: {
    fontSize: 12,
    lineHeight: 18,
    textAlign: 'right',
  },
  tirRow: {
    marginTop: 22,
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
  },
  tirValue: {
    fontSize: 48,
    lineHeight: 52,
    fontWeight: '700',
    letterSpacing: -2,
    fontVariant: ['tabular-nums'],
  },
  tirPercent: {
    fontSize: 26,
    letterSpacing: -1,
  },
  tirTarget: {
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '600',
    marginBottom: 4,
  },
  rangeBar: {
    height: 10,
    borderRadius: 99,
    overflow: 'hidden',
    flexDirection: 'row',
    marginTop: 14,
  },
  legend: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginTop: 9,
  },
  legendText: {
    fontSize: 11,
    lineHeight: 16,
    fontWeight: '700',
  },
  metricsRow: {
    borderTopWidth: StyleSheet.hairlineWidth,
    marginTop: 18,
    paddingTop: 18,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 24,
  },
  metric: {
    flex: 1,
    minWidth: 82,
  },
  metricLabel: {
    fontSize: 12,
    lineHeight: 16,
  },
  metricValue: {
    fontSize: 21,
    lineHeight: 28,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
    marginTop: 1,
  },
  metricDetail: {
    fontSize: 11,
    lineHeight: 16,
  },
  insulinTotalRow: {
    marginTop: 20,
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 8,
  },
  insulinTotal: {
    fontSize: 45,
    lineHeight: 50,
    fontWeight: '700',
    letterSpacing: -1.8,
    fontVariant: ['tabular-nums'],
  },
  insulinUnit: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '600',
  },
  insulinBreakdown: {
    flexDirection: 'row',
    gap: 28,
    marginTop: 18,
  },
  breakdownItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
  },
  legendDot: {
    width: 9,
    height: 9,
    borderRadius: 99,
  },
  breakdownLabel: {
    fontSize: 11,
    lineHeight: 15,
  },
  breakdownValue: {
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  delayedNote: {
    fontSize: 12,
    lineHeight: 18,
    marginTop: 16,
  },
});
