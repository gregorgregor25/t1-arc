import Ionicons from '@expo/vector-icons/Ionicons';
import { StyleSheet, Text, View } from 'react-native';

import {
  buildDataCompletenessReport,
  CoverageSummary,
} from '@/domain/dataCompleteness';
import { TimelineData } from '@/domain/models';
import { formatTime } from '@/domain/time';
import { useAppTheme } from '@/theme/theme';

import { SectionCard } from './SectionCard';

function countLabel(value: number, singular: string, plural = `${singular}s`) {
  return `${value} ${value === 1 ? singular : plural}`;
}

function minutesLabel(minutes: number) {
  if (minutes < 60) return `${Math.round(minutes)} min`;
  const hours = Math.floor(minutes / 60);
  const remainder = Math.round(minutes % 60);
  return remainder ? `${hours}h ${remainder}m` : `${hours}h`;
}

function sourceLabel(sourceId: string) {
  if (sourceId.startsWith('demo-')) return 'Demo fixture';
  if (sourceId === 'glooko-cgm') return 'Glooko history';
  if (sourceId === 'nightscout') return 'Nightscout';
  if (sourceId === 'xdrip-local') return 'xDrip endpoint';
  if (sourceId.includes('notification')) return 'Phone notification';
  if (sourceId.includes('libre')) return 'LibreLinkUp';
  return sourceId;
}

function CoverageRow({
  icon,
  title,
  summary,
}: {
  icon: 'pulse-outline' | 'analytics-outline';
  title: string;
  summary: CoverageSummary;
}) {
  const { colors, radius } = useAppTheme();
  const tone =
    summary.recordCount === 0
      ? colors.textTertiary
      : summary.coveragePercent >= 90
      ? colors.accent
      : colors.warning;
  const longest = summary.gaps.reduce(
    (selected, gap) => (gap.minutes > selected.minutes ? gap : selected),
    { start: 0, end: 0, minutes: 0 },
  );

  return (
    <View style={styles.coverageRow}>
      <View
        style={[
          styles.icon,
          { backgroundColor: `${tone}16`, borderRadius: radius.md },
        ]}
      >
        <Ionicons
          accessibilityElementsHidden
          color={tone}
          name={icon}
          size={20}
        />
      </View>
      <View style={styles.coverageCopy}>
        <View style={styles.coverageTop}>
          <Text style={[styles.rowTitle, { color: colors.text }]}>{title}</Text>
          <Text style={[styles.percent, { color: tone }]}>
            {summary.coveragePercent}%
          </Text>
        </View>
        <Text style={[styles.rowDetail, { color: colors.textSecondary }]}>
          {countLabel(summary.recordCount, 'record')} ·{' '}
          {minutesLabel(summary.missingMinutes)} not represented
        </Text>
        {longest.minutes > 0 ? (
          <Text style={[styles.gapDetail, { color: colors.textTertiary }]}>
            Longest gap {formatTime(longest.start)}–{formatTime(longest.end)} (
            {minutesLabel(longest.minutes)})
          </Text>
        ) : (
          <Text style={[styles.gapDetail, { color: colors.textTertiary }]}>
            No uncovered interval in this view
          </Text>
        )}
      </View>
    </View>
  );
}

export function DataCompletenessCard({
  data,
  healthRecordCount,
}: {
  data: TimelineData;
  healthRecordCount: number;
}) {
  const { colors, radius } = useAppTheme();
  const report = buildDataCompletenessReport(data);

  return (
    <SectionCard style={styles.card}>
      <View style={styles.header}>
        <View style={styles.headerCopy}>
          <Text style={[styles.title, { color: colors.text }]}>Data map</Text>
          <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
            Shows what T1 Arc can actually see for this date.
          </Text>
        </View>
        <View
          style={[
            styles.localBadge,
            {
              backgroundColor: colors.surfaceMuted,
              borderColor: colors.border,
              borderRadius: radius.pill,
            },
          ]}
        >
          <Ionicons
            accessibilityElementsHidden
            color={colors.accent}
            name="phone-portrait-outline"
            size={13}
          />
          <Text style={[styles.localText, { color: colors.textSecondary }]}>
            LOCAL
          </Text>
        </View>
      </View>

      <CoverageRow
        icon="pulse-outline"
        summary={report.glucose}
        title="Glucose coverage"
      />
      <View style={[styles.divider, { backgroundColor: colors.divider }]} />
      <CoverageRow
        icon="analytics-outline"
        summary={report.basal}
        title="Basal timeline"
      />

      {report.insulinReconciliation ? (
        <View
          style={[
            styles.reconciliation,
            {
              backgroundColor: `${colors.insulin}0D`,
              borderColor: `${colors.insulin}35`,
              borderRadius: radius.md,
            },
          ]}
        >
          <Ionicons
            accessibilityElementsHidden
            color={colors.insulin}
            name="git-compare-outline"
            size={19}
          />
          <View style={styles.eventsCopy}>
            <Text style={[styles.eventsTitle, { color: colors.text }]}>
              Glooko total {report.insulinReconciliation.reportedTotalUnits.toFixed(1)} U
              {' · '}organised deliveries{' '}
              {report.insulinReconciliation.organisedTotalUnits.toFixed(1)} U
            </Text>
            <Text
              style={[
                styles.reconciliationDifference,
                {
                  color:
                    Math.abs(report.insulinReconciliation.differenceUnits) <
                    0.11
                      ? colors.accent
                      : colors.warning,
                },
              ]}
            >
              Difference{' '}
              {report.insulinReconciliation.differenceUnits > 0 ? '+' : ''}
              {report.insulinReconciliation.differenceUnits.toFixed(1)} U
            </Text>
            <Text style={[styles.eventsDetail, { color: colors.textTertiary }]}>
              Source-reported daily total compared with the basal and bolus
              rows T1 Arc could organise. A difference flags export coverage,
              not a dosing conclusion.
            </Text>
          </View>
        </View>
      ) : null}

      {report.glucose.sourceCounts.length ? (
        <View style={styles.sources}>
          <Text style={[styles.sourcesLabel, { color: colors.textTertiary }]}>
            GLUCOSE SOURCES
          </Text>
          <View style={styles.sourceChips}>
            {report.glucose.sourceCounts.map((source) => (
              <View
                key={source.sourceId}
                style={[
                  styles.sourceChip,
                  {
                    backgroundColor: colors.surfaceMuted,
                    borderColor: colors.border,
                    borderRadius: radius.pill,
                  },
                ]}
              >
                <Text
                  style={[styles.sourceChipText, { color: colors.textSecondary }]}
                >
                  {sourceLabel(source.sourceId)} · {source.count}
                </Text>
              </View>
            ))}
          </View>
        </View>
      ) : null}

      <View
        style={[
          styles.events,
          {
            backgroundColor: colors.surfaceMuted,
            borderColor: colors.border,
            borderRadius: radius.md,
          },
        ]}
      >
        <Ionicons
          accessibilityElementsHidden
          color={colors.insulin}
          name="list-outline"
          size={19}
        />
        <View style={styles.eventsCopy}>
          <Text style={[styles.eventsTitle, { color: colors.text }]}>
            {countLabel(report.bolusCount, 'bolus', 'boluses')} ·{' '}
            {countLabel(report.contextCount, 'context event')} ·{' '}
            {countLabel(healthRecordCount, 'health record')}
          </Text>
          <Text style={[styles.eventsDetail, { color: colors.textTertiary }]}>
            A zero here means no record was received; it does not prove nothing
            happened.
          </Text>
        </View>
      </View>
    </SectionCard>
  );
}

const styles = StyleSheet.create({
  card: {
    paddingHorizontal: 16,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    marginBottom: 8,
  },
  headerCopy: {
    flex: 1,
  },
  title: {
    fontSize: 18,
    lineHeight: 24,
    fontWeight: '800',
  },
  subtitle: {
    fontSize: 12,
    lineHeight: 18,
    marginTop: 2,
  },
  localBadge: {
    minHeight: 28,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 9,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  localText: {
    fontSize: 8,
    lineHeight: 12,
    fontWeight: '800',
    letterSpacing: 0.7,
  },
  coverageRow: {
    minHeight: 94,
    paddingVertical: 13,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 11,
  },
  icon: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  coverageCopy: {
    flex: 1,
    minWidth: 0,
  },
  coverageTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    gap: 10,
  },
  rowTitle: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '700',
  },
  percent: {
    fontSize: 16,
    lineHeight: 21,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  rowDetail: {
    fontSize: 11,
    lineHeight: 16,
    marginTop: 2,
  },
  gapDetail: {
    fontSize: 10,
    lineHeight: 15,
    marginTop: 2,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
  },
  sources: {
    marginTop: 6,
  },
  sourcesLabel: {
    fontSize: 8,
    lineHeight: 12,
    fontWeight: '800',
    letterSpacing: 0.7,
  },
  sourceChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 6,
  },
  sourceChip: {
    minHeight: 28,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 9,
    justifyContent: 'center',
  },
  sourceChipText: {
    fontSize: 10,
    lineHeight: 14,
    fontWeight: '600',
  },
  events: {
    borderWidth: StyleSheet.hairlineWidth,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    marginTop: 14,
  },
  reconciliation: {
    borderWidth: StyleSheet.hairlineWidth,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    marginTop: 14,
  },
  reconciliationDifference: {
    fontSize: 11,
    lineHeight: 16,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
    marginTop: 2,
  },
  eventsCopy: {
    flex: 1,
  },
  eventsTitle: {
    fontSize: 11,
    lineHeight: 16,
    fontWeight: '700',
  },
  eventsDetail: {
    fontSize: 10,
    lineHeight: 15,
    marginTop: 2,
  },
});
