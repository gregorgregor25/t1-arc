import { StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import { useRegionalProfile } from '@/providers/RegionalProfileProvider';
import { useAppTheme } from '@/theme/theme';
import { aapsEstimatePresentation, type AapsEstimateInput } from './aapsEstimatePresentation';

/** A compact part of the glucose card, never an independently fetched health view. */
export function AapsEstimateSummary({ estimates, now }: { estimates: AapsEstimateInput; now: number }) {
  const { colors } = useAppTheme();
  const { defaults } = useRegionalProfile();
  const { fontScale, width } = useWindowDimensions();
  const stacked = fontScale > 1.3 || width < 360;
  const presentation = aapsEstimatePresentation(estimates, now, defaults.locale);
  return (
    <View accessible accessibilityLabel={presentation.accessibilityLabel}
      style={[styles.summary, { borderTopColor: colors.divider }]}>
      <View style={styles.headingRow}>
        <Text style={[styles.heading, { color: colors.text }]}>AAPS estimates</Text>
        <Text style={[styles.age, { color: presentation.stale ? colors.warning : colors.textSecondary }]}>
          {presentation.age}
        </Text>
      </View>
      <View style={[styles.values, stacked && styles.valuesStacked]}>
        <View style={[styles.value, stacked && styles.valueStacked]}>
          <Text style={[styles.label, { color: colors.textSecondary }]}>Insulin on board</Text>
          <Text style={[styles.measure, { color: colors.text }]}>{presentation.iob}</Text>
        </View>
        <View style={[styles.value, stacked && styles.valueStacked]}>
          <Text style={[styles.label, { color: colors.textSecondary }]}>Carbs on board</Text>
          <Text style={[styles.measure, { color: colors.text }]}>{presentation.cob}</Text>
        </View>
      </View>
      <Text style={[styles.note, { color: colors.textSecondary }]}>{presentation.note}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  summary: { borderTopWidth: StyleSheet.hairlineWidth, marginTop: 18, paddingTop: 15 },
  headingRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', gap: 6, justifyContent: 'space-between' },
  heading: { fontSize: 13, fontWeight: '700', lineHeight: 19 },
  age: { flexShrink: 1, fontSize: 12, lineHeight: 18 },
  values: { flexDirection: 'row', flexWrap: 'wrap', gap: 14, marginTop: 12 },
  valuesStacked: { flexDirection: 'column' },
  value: { flexBasis: 126, flexGrow: 1, flexShrink: 1, gap: 2 },
  valueStacked: { flexBasis: 'auto', flexGrow: 0 },
  label: { fontSize: 13, lineHeight: 19 },
  measure: { fontSize: 22, fontWeight: '700', lineHeight: 29, fontVariant: ['tabular-nums'] },
  note: { fontSize: 12, lineHeight: 18, marginTop: 10 },
});
