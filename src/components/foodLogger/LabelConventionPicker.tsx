import { Pressable, Text, View } from 'react-native';
import { LABEL_CONVENTIONS, type LabelConvention } from '@/data/food/labelConvention';
import { useAppTheme } from '@/theme/theme';

export function LabelConventionPicker({ value, onChange }: { value?: LabelConvention; onChange(value: LabelConvention): void }) {
  const { colors } = useAppTheme();
  return <View style={{ gap: 10 }}>
    <Text style={{ color: colors.text, fontWeight: '700' }}>Which label is on this pack?</Text>
    <Text style={{ color: colors.textSecondary }}>Choose the pack’s format, including for imported foods.</Text>
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
      {LABEL_CONVENTIONS.map(item => <Pressable key={item.value} accessibilityRole="radio" accessibilityState={{ checked: value === item.value }} onPress={() => onChange(item.value)} style={{ padding: 14, minHeight: 48, borderRadius: 12, backgroundColor: value === item.value ? colors.primary : colors.surfaceMuted }}><Text style={{ color: value === item.value ? colors.onPrimary : colors.text }}>{item.label}</Text></Pressable>)}
    </View>
    {value ? <Text style={{ color: colors.textSecondary }}>{LABEL_CONVENTIONS.find(item => item.value === value)?.detail}</Text> : null}
  </View>;
}
