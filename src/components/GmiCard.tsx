import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTimeline } from '@/hooks/useTimeline';
import { useDataContext } from '@/providers/DataProvider';
import { useRegionalProfile } from '@/providers/RegionalProfileProvider';
import { useAppTheme } from '@/theme/theme';
import { gmiSummary } from '@/domain/gmiSummary';
import { formatRegionalNumber } from '@/domain/regionalFormat';
import { formatDate, toDateKey } from '@/domain/time';
import { SectionCard } from './SectionCard';

/** A rolling estimate recalculated from saved readings on repository revisions. */
export function GmiCard() {
  const { now, today } = useDataContext();
  const { colors } = useAppTheme();
  const { defaults } = useRegionalProfile();
  const range = useMemo(() => ({ start: now - 14 * 86_400_000, end: now }), [now]);
  const timeline = useTimeline(range, `gmi:${today}`);
  const summary = timeline.data ? gmiSummary(timeline.data.glucose, timeline.data.range) : undefined;
  const number = (value: number, digits = 0) => formatRegionalNumber(value, defaults.locale, { maximumFractionDigits: digits, minimumFractionDigits: digits });
  return (
    <SectionCard style={{ marginTop: 14 }}>
      <Text accessibilityRole="header" style={{ color: colors.text, fontSize: 20, fontWeight: '700' }}>Glucose estimate · GMI</Text>
      <Text style={[styles.detail, { color: colors.textSecondary }]}>Your last 14 days of sensor glucose</Text>
      {timeline.error ? <Text style={{ color: colors.warning }}>Unable to update this estimate. Pull down to retry.</Text> : null}
      {summary?.percent !== null && summary?.percent !== undefined ? (
        <View style={styles.values}>
          <Text style={[styles.value, { color: colors.primary }]}>{number(summary.percent, 1)}%</Text>
          <Text style={[styles.units, { color: colors.textSecondary }]}>{number(summary.mmolMol!)} mmol/mol</Text>
        </View>
      ) : <Text style={{ color: colors.text }}>{timeline.loading ? 'Loading saved readings…' : 'An estimate will appear when glucose readings are available.'}</Text>}
      {summary && timeline.data ? <Text style={[styles.detail, { color: colors.textSecondary }]}>
        {formatDate(toDateKey(timeline.data.range.start))} – {formatDate(toDateKey(timeline.data.range.end))} · {number(summary.coveragePercent)}% sensor coverage
      </Text> : null}
      {summary?.percent !== null && summary?.percent !== undefined && !summary.representative ? <Text style={[styles.detail, { color: colors.warning }]}>Limited data: aim for at least 14 days with 70% sensor coverage before comparing this estimate.</Text> : null}
      <Text style={[styles.detail, { color: colors.textSecondary }]}>GMI is a sensor-based estimate expressed like HbA1c. It can differ from a measured laboratory result. Updates as readings are saved.</Text>
    </SectionCard>
  );
}

const styles = StyleSheet.create({
  values: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', gap: 12 },
  value: { fontSize: 32, fontWeight: '800' },
  units: { fontSize: 17, fontWeight: '600' },
  detail: { fontSize: 14, lineHeight: 21, marginTop: 8 },
});
