import { useState } from 'react';
import { Image, Keyboard, Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { KeyboardFormScrollView } from '@/components/KeyboardFormScrollView';
import type { FoodLabelDraft } from '@/data/food/foodLabelCapture';
import type { LabelConvention } from '@/data/food/labelConvention';
import { getRuntimeRegionalDefaults } from '@/domain/regionalProfileRuntime';
import { useAppTheme } from '@/theme/theme';
import { LabelConventionPicker } from './LabelConventionPicker';
import { checkedLabelDraft, LABEL_REVIEW_FIELDS, labelReviewValues } from './labelReview';

export function FoodLabelReview({ draft, preview, convention, onConvention, onResult, onRetake }: {
  draft: FoodLabelDraft; preview?: string; convention?: LabelConvention;
  onConvention(value: LabelConvention): void; onResult(value: FoodLabelDraft): void; onRetake(): void;
}) {
  const { colors } = useAppTheme();
  const regional = getRuntimeRegionalDefaults();
  const { width } = useWindowDimensions();
  const [values, setValues] = useState(() => labelReviewValues(draft, regional));
  const [unit, setUnit] = useState<'g' | 'ml'>(draft.fields.unit ?? draft.suggestions?.unit ?? 'g');
  const [checked, setChecked] = useState(false);
  const [enlarged, setEnlarged] = useState(false);
  const [error, setError] = useState<string>();
  const readable = LABEL_REVIEW_FIELDS.some(([field]) => field !== 'serving' && values[field] !== '');
  const text = { color: colors.text };
  const secondary = { color: colors.textSecondary };
  function submit() {
    const result = checkedLabelDraft(values, unit, convention, checked, regional, draft);
    setError(result.error);
    if (result.draft) { Keyboard.dismiss(); onResult(result.draft); }
  }
  return <KeyboardFormScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
    <Text accessibilityRole="header" style={[styles.title, text]}>{readable ? 'Check the label values' : 'We couldn’t match the label values'}</Text>
    {preview && <>
      {enlarged ? <View style={styles.enlarged}>
        <ScrollView nestedScrollEnabled><ScrollView horizontal nestedScrollEnabled>
          <Image accessible accessibilityLabel="Enlarged label photo; scroll to inspect" source={{ uri: preview }}
            resizeMode="contain" style={{ width: Math.max(240, width - 40) * 2, height: Math.max(320, width - 40) * 2.7 }} />
        </ScrollView></ScrollView>
      </View> : <Image accessible accessibilityLabel="Photographed nutrition label for comparison" source={{ uri: preview }} resizeMode="contain" style={styles.photo} />}
      <Pressable accessibilityRole="button" onPress={() => { Keyboard.dismiss(); setEnlarged(value => !value); }} style={styles.button}>
        <Text style={[styles.copy, { color: colors.primary }]}>{enlarged ? 'Reduce photo' : 'Enlarge photo'}</Text>
      </Pressable>
    </>}
    <Text style={[styles.copy, secondary]}>{readable
      ? 'Use one column from the pack. Values marked “Check” are uncertain. Correct any decimal points and leave unreadable values blank.'
      : 'We couldn’t reliably match the numbers to their rows and amount heading. You can retake the whole nutrition table or enter the values below.'}</Text>
    {!readable && <Pressable accessibilityRole="button" onPress={onRetake} style={[styles.button, { backgroundColor: colors.primary }]}>
      <Text style={[styles.buttonText, { color: colors.onPrimary }]}>Retake label</Text>
    </Pressable>}
    <LabelConventionPicker value={convention} onChange={value => { onConvention(value); setChecked(false); }} />
    <Text style={[styles.copy, secondary]}>Enter the amount the label describes, such as 100 g. Choose how much you ate on the next screen.</Text>
    <View style={styles.units}>{(['g', 'ml'] as const).map(value => <Pressable key={value} accessibilityRole="radio"
      accessibilityState={{ selected: unit === value }} onPress={() => { setUnit(value); setChecked(false); }}
      style={[styles.unit, { backgroundColor: unit === value ? colors.primary : colors.surface }]}>
      <Text style={[styles.copy, { color: unit === value ? colors.onPrimary : colors.text }]}>{value}</Text>
    </Pressable>)}</View>
    {LABEL_REVIEW_FIELDS.map(([field, label]) => <View key={field} style={styles.field}>
      <View style={styles.row}><Text style={[styles.copy, text]}>{label} ({field === 'serving' ? unit : field === 'energyKcal' ? regional.energyUnit : 'g'})</Text>
        {draft.suggestions?.[field] !== undefined && <Text style={[styles.copy, { color: colors.primary }]}>Check</Text>}
      </View>
      <TextInput accessibilityLabel={`Label ${label.toLowerCase()}`} value={values[field]} keyboardType="decimal-pad"
        placeholder="Enter from label" placeholderTextColor={colors.textSecondary} maxLength={12}
        onChangeText={value => { setValues(current => ({ ...current, [field]: value })); setChecked(false); setError(undefined); }}
        style={[styles.input, text, { backgroundColor: colors.surface, borderColor: colors.border }]} />
    </View>)}
    <Pressable accessibilityRole="checkbox" accessibilityState={{ checked }}
      accessibilityLabel="I checked the amount and values against the label" onPress={() => { Keyboard.dismiss(); setChecked(value => !value); }}
      style={[styles.confirm, { borderColor: checked ? colors.primary : colors.border }]}>
      <Text style={[styles.copy, { color: checked ? colors.primary : colors.text }]}>{checked ? '✓ ' : '○ '}I checked the amount and values against the label</Text>
    </Pressable>
    {error && <Text accessibilityRole="alert" style={[styles.copy, text]}>{error}</Text>}
    <Pressable accessibilityRole="button" onPress={submit} style={[styles.button, { backgroundColor: colors.primary }]}>
      <Text style={[styles.buttonText, { color: colors.onPrimary }]}>Use checked values</Text>
    </Pressable>
    <Pressable accessibilityRole="button" onPress={onRetake} style={styles.button}>
      <Text style={[styles.copy, { color: colors.primary }]}>Retake photo</Text>
    </Pressable>
    <Pressable accessibilityRole="button" onPress={() => {
      if (!convention) { setError('Choose the label format on this pack.'); return; }
      Keyboard.dismiss();
      onResult({ ...draft, fields: {}, suggestions: undefined, labelConvention: convention,
        confidence: { basis: 'missing', carbs: 'missing' }, basisLabel: 'Enter the label amount', warnings: [] });
    }} style={styles.button}><Text style={[styles.copy, { color: colors.primary }]}>Enter manually instead</Text></Pressable>
    <Text style={[styles.note, secondary]}>The photo is discarded when you close this review. Nothing is saved until you save the food.</Text>
  </KeyboardFormScrollView>;
}

const styles = StyleSheet.create({
  body: { padding: 20, gap: 14, paddingBottom: 32 }, title: { fontSize: 21, fontWeight: '700' },
  copy: { fontSize: 16, lineHeight: 23, flexShrink: 1 }, note: { fontSize: 13, lineHeight: 19 },
  photo: { width: '100%', height: 270 }, enlarged: { height: 360, overflow: 'hidden', borderRadius: 14 },
  button: { minHeight: 48, borderRadius: 14, padding: 12, alignItems: 'center', justifyContent: 'center' },
  buttonText: { fontSize: 16, fontWeight: '700', textAlign: 'center' },
  field: { gap: 6 }, row: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  input: { minHeight: 50, borderRadius: 12, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 10, fontSize: 17 },
  units: { flexDirection: 'row', gap: 10 }, unit: { minWidth: 64, minHeight: 48, padding: 12, borderRadius: 12, alignItems: 'center' },
  confirm: { minHeight: 56, borderWidth: 1, borderRadius: 12, padding: 12 },
});
