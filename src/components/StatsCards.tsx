import { StyleSheet, Text, View } from 'react-native';

import { GlucoseStats, InsulinStats } from '@/domain/models';
import { InsulinReconciliation } from '@/domain/dataCompleteness';
import { presentInsulinRangeSummary } from '@/domain/insulinSummaryPresentation';
import { InsulinRangeSummary } from '@/domain/timelineInsulinSummary';
import { useAppTheme } from '@/theme/theme';

import { EmptyState } from './EmptyState';
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
  if (
    stats.observedMinutes <= 0 ||
    stats.averageMmolL === null
  ) {
    return (
      <SectionCard accessibilityLabel="Glucose statistics unavailable because this range contains no observed glucose time.">
        <EmptyState
          title="No glucose statistics"
          detail="There is no observed glucose time in this range. Time in range is unavailable—not 0%."
        />
      </SectionCard>
    );
  }
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
  summary,
  reconciliation,
  label = 'Today so far',
}: {
  stats: InsulinStats;
  summary?: InsulinRangeSummary;
  reconciliation?: InsulinReconciliation;
  label?: string;
}) {
  const { colors } = useAppTheme();
  const presentation = presentInsulinRangeSummary(summary, label);
  const unsplitUnits = Math.max(0, presentation.sourceMinusBreakdownUnits);
  const componentTotal = stats.basalUnits + stats.bolusUnits;
  const breakdownScale = Math.max(stats.totalUnits, componentTotal);
  const basalShare = breakdownScale > 0 ? stats.basalUnits / breakdownScale : 0;
  const bolusShare = breakdownScale > 0 ? stats.bolusUnits / breakdownScale : 0;
  const unsplitShare = breakdownScale > 0 ? unsplitUnits / breakdownScale : 0;
  return (
    <SectionCard
      accessibilityLabel={`Insulin total ${stats.totalUnits.toFixed(1)} units. ${presentation.separateBreakdown ? 'Available component records, shown separately from that total:' : ''} Basal ${stats.basalUnits.toFixed(1)} units. Bolus ${stats.bolusUnits.toFixed(1)} units.${unsplitUnits >= 0.05 ? ` ${unsplitUnits.toFixed(1)} units are not split into basal or bolus.` : ''}${presentation.sourceDetail ? ` ${presentation.sourceDetail}.` : ''}`}
    >
      <View style={styles.cardHeader}>
        <View>
          <Text style={[styles.cardEyebrow, { color: colors.insulin }]}>INSULIN</Text>
          <Text style={[styles.cardTitle, { color: colors.text }]}>Delivered total</Text>
        </View>
        <Text style={[styles.rangeLabel, { color: colors.textSecondary }]}>
          {presentation.rangeLabel}
        </Text>
      </View>
      <View style={styles.insulinTotalRow}>
        <Text style={[styles.insulinTotal, { color: colors.text }]}>
          {stats.totalUnits.toFixed(1)}
        </Text>
        <Text style={[styles.insulinUnit, { color: colors.textSecondary }]}>units</Text>
      </View>
      {presentation.sourceDetail ? (
        <Text style={[styles.sourceBasis, { color: colors.textTertiary }]}>
          {presentation.sourceDetail}
        </Text>
      ) : null}
      {breakdownScale > 0 && !presentation.separateBreakdown ? (
        <View
          accessibilityElementsHidden
          style={[styles.rangeBar, { backgroundColor: colors.surfaceMuted }]}
        >
          <View
            style={{
              backgroundColor: colors.insulin,
              flex: basalShare,
            }}
          />
          <View
            style={{
              backgroundColor: colors.primary,
              flex: bolusShare,
            }}
          />
          {unsplitShare > 0 ? (
            <View
              style={{
                backgroundColor: colors.textTertiary,
                flex: unsplitShare,
              }}
            />
          ) : null}
        </View>
      ) : null}
      {presentation.separateBreakdown ? (
        <Text style={[styles.breakdownNotice, { color: colors.warning }]}>
          Available component records · not a split of the source total
        </Text>
      ) : null}
      <View style={styles.insulinBreakdown}>
        <View style={styles.breakdownItem}>
          <View style={[styles.legendDot, { backgroundColor: colors.insulin }]} />
          <View>
            <Text style={[styles.breakdownLabel, { color: colors.textSecondary }]}>
              {presentation.separateBreakdown ? 'Basal records' : 'Basal'}
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
              {presentation.separateBreakdown ? 'Bolus records' : 'Bolus'}
            </Text>
            <Text style={[styles.breakdownValue, { color: colors.text }]}>
              {stats.bolusUnits.toFixed(1)} U
            </Text>
          </View>
        </View>
        {unsplitUnits >= 0.05 ? (
          <View style={styles.breakdownItem}>
            <View
              style={[
                styles.legendDot,
                { backgroundColor: colors.textTertiary },
              ]}
            />
            <View>
              <Text
                style={[
                  styles.breakdownLabel,
                  { color: colors.textSecondary },
                ]}
              >
                Not split
              </Text>
              <Text style={[styles.breakdownValue, { color: colors.text }]}>
                {unsplitUnits.toFixed(1)} U
              </Text>
            </View>
          </View>
        ) : null}
      </View>
      {reconciliation ? (
        <View
          style={[
            styles.sourceTotal,
            {
              backgroundColor: colors.surfaceMuted,
              borderColor: colors.divider,
            },
          ]}
        >
          <View style={styles.sourceTotalTop}>
            <Text
              style={[styles.sourceTotalLabel, { color: colors.textSecondary }]}
            >
              Glooko source total
            </Text>
            <Text style={[styles.sourceTotalValue, { color: colors.text }]}>
              {reconciliation.reportedTotalUnits.toFixed(1)} U
            </Text>
          </View>
          <Text
            style={[
              styles.sourceTotalDetail,
              {
                color:
                  Math.abs(reconciliation.differenceUnits) < 0.11
                    ? colors.textTertiary
                    : colors.warning,
              },
            ]}
          >
            Source minus detailed rows{' '}
            {reconciliation.differenceUnits > 0 ? '+' : ''}
            {reconciliation.differenceUnits.toFixed(1)} U
          </Text>
        </View>
      ) : null}
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
  sourceBasis: {
    marginTop: 3,
    fontSize: 12,
    lineHeight: 17,
  },
  breakdownNotice: {
    marginTop: 16,
    fontSize: 12,
    fontWeight: '700',
    lineHeight: 17,
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
    flexWrap: 'wrap',
    gap: 20,
    marginTop: 18,
  },
  sourceTotal: {
    marginTop: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    padding: 11,
  },
  sourceTotalTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    gap: 10,
  },
  sourceTotalLabel: {
    fontSize: 11,
    lineHeight: 16,
    fontWeight: '700',
  },
  sourceTotalValue: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  sourceTotalDetail: {
    fontSize: 10,
    lineHeight: 15,
    marginTop: 2,
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
});
