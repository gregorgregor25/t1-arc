import Ionicons from '@expo/vector-icons/Ionicons';
import { type ReactNode, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import {
  GLUCOSE_COLOR_PALETTE,
  type GlucoseRange,
} from '@/domain/glucoseAppearance';
import type { ConsensusGlucoseBand, GlucoseRangeSummary } from '@/domain/glucoseRanges';
import { presentGlucoseRangeStatistics } from '@/domain/glucoseRangePresentation';
import { useGlucoseAppearance } from '@/providers/GlucoseAppearanceProvider';
import { useRegionalProfile } from '@/providers/RegionalProfileProvider';
import { useAppTheme } from '@/theme/theme';

import { SectionCard } from './SectionCard';

const BAND_COLOUR_RANGE: Record<ConsensusGlucoseBand, Exclude<GlucoseRange, 'stale'>> = {
  veryLow: 'veryLow',
  low: 'low',
  inRange: 'target',
  high: 'high',
  veryHigh: 'veryHigh',
};

export function GlucoseRangeStatisticsCard({
  compareLabel,
  label,
  moreStatistics,
  onCompare,
  summary,
}: {
  compareLabel?: string;
  label: string;
  /** Extra rows shown inside "More statistics", for example GMI. */
  moreStatistics?: ReactNode;
  onCompare?: () => void;
  summary: GlucoseRangeSummary;
}) {
  const { colors, dark, radius } = useAppTheme();
  const { defaults: regional } = useRegionalProfile();
  const { settings: appearance } = useGlucoseAppearance();
  const [moreVisible, setMoreVisible] = useState(false);
  const presentation = useMemo(
    () => presentGlucoseRangeStatistics(summary, regional),
    [regional, summary],
  );
  const bandColour = (band: ConsensusGlucoseBand) => {
    const palette = GLUCOSE_COLOR_PALETTE[appearance.colors[BAND_COLOUR_RANGE[band]]];
    return dark ? palette.dark : palette.light;
  };
  const barTotal = presentation.bands.reduce((total, row) => total + (row.percent ?? 0), 0);
  const canCompare = Boolean(onCompare && compareLabel);
  const moreStatisticsContents = [
    presentation.observed ? 'the Glycemia Risk Index' : undefined,
    presentation.observed && moreStatistics ? 'GMI' : undefined,
    canCompare ? 'a comparison with the previous period' : undefined,
  ].filter(Boolean).join(', ');

  return (
    <SectionCard>
      <View style={styles.header}>
        <View style={styles.headerCopy}>
          <Text accessibilityRole="header" style={[styles.title, { color: colors.text }]}>
            Time in ranges
          </Text>
          <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
            {label} · {presentation.coverage} sensor coverage
          </Text>
        </View>
      </View>

      {presentation.coverageNotice ? (
        <Text style={[styles.notice, { color: colors.textSecondary, backgroundColor: colors.surfaceMuted, borderRadius: radius.md }]}>
          {presentation.coverageNotice}
        </Text>
      ) : null}

      {presentation.observed ? (
        <>
          {barTotal > 0 ? (
            <View
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
              style={[styles.bar, { backgroundColor: colors.surfaceMuted, borderRadius: radius.pill }]}
            >
              {presentation.bands.map((row) =>
                row.percent ? (
                  <View key={row.band} style={{ backgroundColor: bandColour(row.band), flex: row.percent / barTotal }} />
                ) : null,
              )}
            </View>
          ) : null}
          <View style={styles.rows}>
            {presentation.bands.map((row) => (
              <View accessible accessibilityLabel={row.accessibilityLabel} key={row.band} style={styles.row}>
                <View style={[styles.swatch, { backgroundColor: bandColour(row.band) }]} />
                <Text style={[styles.rowName, { color: colors.text }]}>{row.name}</Text>
                <Text style={[styles.rowBounds, { color: colors.textTertiary }]}>{row.bounds}</Text>
                <Text style={[styles.rowValue, { color: colors.text }]}>{row.value}</Text>
              </View>
            ))}
          </View>
          <View style={[styles.ranges, { borderTopColor: colors.divider }]}>
            {presentation.ranges.map((row) => (
              <View accessible accessibilityLabel={row.accessibilityLabel} key={row.kind} style={styles.rangeRow}>
                <View style={styles.rangeCopy}>
                  <Text style={[styles.rangeLabel, { color: colors.text }]}>{row.label}</Text>
                  <Text style={[styles.rangeDetail, { color: colors.textTertiary }]}>{row.detail}</Text>
                </View>
                <Text style={[styles.rangeValue, { color: colors.text }]}>{row.value}</Text>
              </View>
            ))}
          </View>
        </>
      ) : null}

      {presentation.observed || canCompare ? (
        <>
          <Pressable
            accessibilityHint={`Shows ${moreStatisticsContents}`}
            accessibilityRole="button"
            accessibilityState={{ expanded: moreVisible }}
            onPress={() => setMoreVisible((visible) => !visible)}
            style={styles.moreToggle}
          >
            <Text style={[styles.moreLabel, { color: colors.primary }]}>More statistics</Text>
            <Ionicons accessibilityElementsHidden color={colors.primary} name={moreVisible ? 'chevron-up' : 'chevron-down'} size={16} />
          </Pressable>
          {moreVisible && presentation.observed ? (
            <View style={[styles.more, { backgroundColor: colors.surfaceMuted, borderRadius: radius.md }]}>
              <View style={styles.rangeRow}>
                <Text style={[styles.rangeLabel, styles.rangeCopy, { color: colors.text }]}>Glycemia Risk Index</Text>
                <Text style={[styles.rangeValue, { color: colors.text }]}>
                  {presentation.riskIndex.status === 'available' ? presentation.riskIndex.value : '—'}
                </Text>
              </View>
              <Text style={[styles.rangeDetail, { color: colors.textSecondary }]}>{presentation.riskIndex.detail}</Text>
              <Text style={[styles.rangeDetail, { color: colors.textSecondary }]}>{presentation.riskIndex.explanation}</Text>
              {moreStatistics}
            </View>
          ) : null}
        </>
      ) : null}

      {moreVisible && onCompare && compareLabel ? (
        <Pressable
          accessibilityHint="Opens Insights with this period compared with the one before it."
          accessibilityRole="button"
          onPress={onCompare}
          style={({ pressed }) => [
            styles.compare,
            { borderColor: colors.border, borderRadius: radius.md, opacity: pressed ? 0.72 : 1 },
          ]}
        >
          <Ionicons accessibilityElementsHidden color={colors.primary} name="git-compare-outline" size={18} />
          <View style={styles.rangeCopy}>
            <Text style={[styles.compareTitle, { color: colors.primary }]}>Compare with previous period</Text>
            <Text style={[styles.rangeDetail, { color: colors.textSecondary }]}>{compareLabel}</Text>
          </View>
          <Ionicons accessibilityElementsHidden color={colors.textTertiary} name="chevron-forward" size={16} />
        </Pressable>
      ) : null}
    </SectionCard>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  headerCopy: { flex: 1, minWidth: 0 },
  title: { fontSize: 17, lineHeight: 22, fontWeight: '800' },
  subtitle: { marginTop: 1, fontSize: 13, lineHeight: 18 },
  notice: { marginTop: 12, paddingHorizontal: 12, paddingVertical: 9, fontSize: 12, lineHeight: 18 },
  bar: { height: 8, marginTop: 14, flexDirection: 'row', overflow: 'hidden' },
  rows: { marginTop: 12, gap: 6 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 24 },
  swatch: { width: 10, height: 10, borderRadius: 5 },
  rowName: { fontSize: 13, lineHeight: 18, fontWeight: '600', minWidth: 72 },
  rowBounds: { flex: 1, fontSize: 12, lineHeight: 17 },
  rowValue: { fontSize: 14, lineHeight: 19, fontWeight: '700', fontVariant: ['tabular-nums'] },
  ranges: { marginTop: 12, paddingTop: 12, borderTopWidth: StyleSheet.hairlineWidth, gap: 10 },
  rangeRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  rangeCopy: { flex: 1, minWidth: 0 },
  rangeLabel: { fontSize: 13, lineHeight: 18, fontWeight: '600' },
  rangeDetail: { fontSize: 13, lineHeight: 18 },
  rangeValue: { fontSize: 18, lineHeight: 24, fontWeight: '800', fontVariant: ['tabular-nums'] },
  moreToggle: { marginTop: 10, minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 6 },
  moreLabel: { fontSize: 13, fontWeight: '600' },
  more: { paddingHorizontal: 12, paddingVertical: 10, gap: 4 },
  compare: {
    marginTop: 12,
    minHeight: 52,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  compareTitle: { fontSize: 14, lineHeight: 19, fontWeight: '700' },
});
