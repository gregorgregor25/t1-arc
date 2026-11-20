import Ionicons from '@expo/vector-icons/Ionicons';
import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Alert } from '@/components/appAlert';
import { useTimeline } from '@/hooks/useTimeline';
import { useDataContext } from '@/providers/DataProvider';
import { useRegionalProfile } from '@/providers/RegionalProfileProvider';
import { useAppTheme } from '@/theme/theme';
import { gmiSummary } from '@/domain/gmiSummary';
import { formatRegionalNumber } from '@/domain/regionalFormat';
import {
  glucoseTargetRangePhrase,
  STANDARD_GLUCOSE_RANGE,
  TIGHT_GLUCOSE_RANGE,
} from '@/domain/glucoseRanges';
import { formatDate, toDateKey } from '@/domain/time';
import { SectionCard } from './SectionCard';

const GMI_EXPLANATION = 'GMI is a sensor-based estimate expressed like HbA1c. It can differ from a measured laboratory result. Updates as readings are saved.';

/**
 * A rolling estimate recalculated from saved readings on repository revisions.
 * `inline` shows the same estimate inside the Today time-in-range tile, with
 * the explanation one tap away.
 */
export function GmiCard({ variant = 'card' }: { variant?: 'card' | 'inline' } = {}) {
  const { now, today } = useDataContext();
  const { colors } = useAppTheme();
  const { defaults } = useRegionalProfile();
  const range = useMemo(() => ({ start: now - 14 * 86_400_000, end: now }), [now]);
  const timeline = useTimeline(range, `gmi:${today}`);
  const summary = timeline.data ? gmiSummary(timeline.data.glucose, timeline.data.range) : undefined;
  const number = (value: number, digits = 0) => formatRegionalNumber(value, defaults.locale, { maximumFractionDigits: digits, minimumFractionDigits: digits });
  const hasValue = summary?.percent !== null && summary?.percent !== undefined;
  const coverageText = summary && timeline.data
    ? `${formatDate(toDateKey(timeline.data.range.start))} – ${formatDate(toDateKey(timeline.data.range.end))} · ${number(summary.coveragePercent)}% sensor coverage`
    : undefined;
  const samePeriodText = summary && summary.timeInRangePercent !== null && summary.timeInTightRangePercent !== null
    ? `Same period: ${number(summary.timeInRangePercent, 1)}% in ${glucoseTargetRangePhrase(STANDARD_GLUCOSE_RANGE, defaults)} · ${number(summary.timeInTightRangePercent, 1)}% in ${glucoseTargetRangePhrase(TIGHT_GLUCOSE_RANGE, defaults)}`
    : undefined;
  const limited = hasValue && summary && !summary.representative;
  const limitedText = 'Limited data: aim for at least 14 days with 70% sensor coverage before comparing this estimate.';

  if (variant === 'inline') {
    return (
      <View style={[styles.inline, { borderTopColor: colors.divider }]}>
        <View style={styles.inlineHeader}>
          <Text style={[styles.inlineLabel, { color: colors.textSecondary }]}>GMI · last 14 days</Text>
          <Pressable
            accessibilityHint="Explains the glucose management indicator and shows time in range for the same 14 days"
            accessibilityLabel="About GMI"
            accessibilityRole="button"
            onPress={() => Alert.alert('Glucose estimate · GMI', [
              'Your last 14 days of sensor glucose.',
              coverageText,
              samePeriodText,
              limited ? limitedText : undefined,
              GMI_EXPLANATION,
            ].filter(Boolean).join('\n\n'))}
            style={({ pressed }) => [styles.about, { opacity: pressed ? 0.6 : 1 }]}
          >
            <Ionicons accessibilityElementsHidden color={colors.primary} name="information-circle-outline" size={18} />
            <Text style={[styles.aboutText, { color: colors.primary }]}>About</Text>
          </Pressable>
        </View>
        {timeline.error ? <Text style={[styles.inlineDetail, { color: colors.warning }]}>Unable to update this estimate. Pull down to retry.</Text> : null}
        {hasValue ? (
          <Text style={[styles.inlineValue, { color: colors.text }]}>
            {number(summary!.percent!, 1)}%
            <Text style={[styles.inlineUnits, { color: colors.textSecondary }]}> · {number(summary!.mmolMol!)} mmol/mol</Text>
          </Text>
        ) : <Text style={[styles.inlineDetail, { color: colors.text }]}>{timeline.loading ? 'Loading saved readings…' : 'An estimate will appear when glucose readings are available.'}</Text>}
        {coverageText ? <Text style={[styles.inlineDetail, { color: colors.textSecondary }]}>{coverageText}</Text> : null}
        {limited ? <Text style={[styles.inlineDetail, { color: colors.warning }]}>{limitedText}</Text> : null}
      </View>
    );
  }

  return (
    <SectionCard style={styles.card}>
      <Text accessibilityRole="header" style={[styles.title, { color: colors.text }]}>Glucose estimate · GMI</Text>
      <Text style={[styles.detail, { color: colors.textSecondary }]}>Your last 14 days of sensor glucose</Text>
      {timeline.error ? <Text style={{ color: colors.warning }}>Unable to update this estimate. Pull down to retry.</Text> : null}
      {hasValue ? (
        <View style={styles.values}>
          <Text style={[styles.value, { color: colors.primary }]}>{number(summary!.percent!, 1)}%</Text>
          <Text style={[styles.units, { color: colors.textSecondary }]}>{number(summary!.mmolMol!)} mmol/mol</Text>
        </View>
      ) : <Text style={{ color: colors.text }}>{timeline.loading ? 'Loading saved readings…' : 'An estimate will appear when glucose readings are available.'}</Text>}
      {coverageText ? <Text style={[styles.detail, { color: colors.textSecondary }]}>{coverageText}</Text> : null}
      {samePeriodText ? <Text style={[styles.detail, { color: colors.textSecondary }]}>{samePeriodText}</Text> : null}
      {limited ? <Text style={[styles.detail, { color: colors.warning }]}>{limitedText}</Text> : null}
      <Text style={[styles.detail, { color: colors.textSecondary }]}>{GMI_EXPLANATION}</Text>
    </SectionCard>
  );
}

const styles = StyleSheet.create({
  card: { marginTop: 16 },
  title: { fontSize: 18, lineHeight: 24, fontWeight: '700' },
  values: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', gap: 12 },
  value: { fontSize: 32, fontWeight: '800' },
  units: { fontSize: 17, fontWeight: '600' },
  detail: { fontSize: 14, lineHeight: 21, marginTop: 8 },
  inline: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 10, gap: 4 },
  inlineHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 },
  inlineLabel: { flexShrink: 1, fontSize: 14, lineHeight: 19, fontWeight: '600' },
  about: { minHeight: 44, minWidth: 44, paddingHorizontal: 6, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4 },
  aboutText: { fontSize: 14, fontWeight: '600' },
  inlineValue: { fontSize: 20, lineHeight: 26, fontWeight: '700', fontVariant: ['tabular-nums'] },
  inlineUnits: { fontSize: 15, fontWeight: '600' },
  inlineDetail: { fontSize: 14, lineHeight: 20 },
});
