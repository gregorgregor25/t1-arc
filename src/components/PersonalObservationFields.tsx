import { Pressable, Text, TextInput, View } from 'react-native';
import { useAppTheme } from '@/theme/theme';
import { normalizeRegionalNumberInput, formatRegionalNumberInput } from '@/domain/regionalNumberInput';
import { type PersonalObservation, type BodyLocation, validatePersonalObservation } from '@/domain/personalObservations';
import { BodyLocationPicker } from './BodyLocationPicker';

export interface ObservationFields {
  food: string; quantity: string; unit: string; carbs: string;
  test: string; value: string; laboratory: string;
  device: 'pump' | 'sensor'; location?: BodyLocation;
}
export const EMPTY_OBSERVATION_FIELDS: ObservationFields = { food: '', quantity: '', unit: '', carbs: '', test: 'HbA1c', value: '', laboratory: '', device: 'pump' };
export function fieldsFromObservation(observation: PersonalObservation, locale: string): ObservationFields {
  const fields = { ...EMPTY_OBSERVATION_FIELDS };
  switch (observation.kind) {
    case 'hypo-treatment': return { ...fields, food: observation.food, quantity: formatRegionalNumberInput(observation.quantity, locale), unit: observation.unit, carbs: formatRegionalNumberInput(observation.carbsGrams, locale) };
    case 'lab-result': return { ...fields, test: observation.test, value: formatRegionalNumberInput(observation.value, locale), unit: observation.unit, laboratory: observation.laboratory ?? '' };
    case 'site-change': return { ...fields, device: observation.device, location: observation.location };
    default: return fields;
  }
}
export function observationFromFields(kind: PersonalObservation['kind'], fields: ObservationFields, locale: string): PersonalObservation {
  const number = (text: string) => normalizeRegionalNumberInput(text, locale)?.value;
  return validatePersonalObservation(kind === 'hypo-treatment' ? { kind, food: fields.food, quantity: number(fields.quantity), unit: fields.unit, carbsGrams: number(fields.carbs) }
    : kind === 'lab-result' ? { kind, test: fields.test, value: number(fields.value), unit: fields.unit || (fields.test === 'HbA1c' ? 'mmol/mol' : ''), laboratory: fields.laboratory || undefined }
      : kind === 'site-change' ? { kind, device: fields.device, location: fields.location } : { kind });
}
export function PersonalObservationFields({ kind, value, onChange, recentSites }: {
  kind: PersonalObservation['kind']; value: ObservationFields; onChange(value: ObservationFields): void;
  recentSites?: { location: BodyLocation; date: string }[];
}) {
  const { colors } = useAppTheme();
  const field = (key: keyof ObservationFields, label: string, numeric = false, placeholder?: string) => <View key={key} style={{ gap: 7 }}>
    <Text style={{ color: colors.text, fontWeight: '600' }}>{label}</Text>
    <TextInput accessibilityLabel={label} placeholder={placeholder} placeholderTextColor={colors.textTertiary} keyboardType={numeric ? 'decimal-pad' : 'default'} value={String(value[key] ?? '')} maxLength={120} onChangeText={text => onChange({ ...value, [key]: text })} style={{ color: colors.text, backgroundColor: colors.surfaceMuted, padding: 14, borderRadius: 12, minHeight: 52 }} />
  </View>;
  return <View style={{ gap: 18 }}>
    {kind === 'hypo-treatment' ? <>
      <Text style={{ color: colors.textSecondary }}>Record what you took to treat a hypo. This does not record or suggest an insulin dose.</Text>
      {field('food', 'What did you take?', false, 'Glucose tablets, juice…')}
      {field('quantity', 'Amount', true)}{field('unit', 'Amount unit', false, 'tablets, ml, sweets…')}
      {field('carbs', 'Total carbohydrate taken (g)', true)}
      <Text style={{ color: colors.textSecondary }}>Use the product label for the amount you took. You can change this later.</Text>
    </> : null}
    {kind === 'lab-result' ? <>
      <Text style={{ color: colors.textSecondary }}>Copy a measured result from your check-up. The date above is the sample date.</Text>
      {field('test', 'Test name', false, 'HbA1c, cholesterol, eGFR…')}
      {field('value', 'Laboratory result', true)}
      {value.test === 'HbA1c' ? <View style={{ flexDirection: 'row', gap: 12 }}>{['mmol/mol', '%'].map(unit => <Pressable key={unit} accessibilityRole="radio" accessibilityState={{ checked: (value.unit || 'mmol/mol') === unit }} onPress={() => onChange({ ...value, unit })} style={{ padding: 14, minHeight: 48, backgroundColor: (value.unit || 'mmol/mol') === unit ? colors.primary : colors.surfaceMuted, borderRadius: 12 }}><Text style={{ color: (value.unit || 'mmol/mol') === unit ? colors.background : colors.text }}>{unit}</Text></Pressable>)}</View> : field('unit', 'Units shown on your result')}
      {field('laboratory', 'Laboratory or clinic (optional)')}
    </> : null}
    {kind === 'food-incomplete' ? <Text style={{ color: colors.textSecondary }}>Some food was not logged on this date. Your entries stay visible, and Tarv1s will treat this day’s nutrition as incomplete. Remove this note later if you finish logging.</Text> : null}
    {kind === 'site-change' ? <>
      <View style={{ flexDirection: 'row', gap: 12 }}>{(['pump', 'sensor'] as const).map(device => <Pressable key={device} accessibilityRole="radio" accessibilityState={{ checked: value.device === device }} onPress={() => onChange({ ...value, device })} style={{ padding: 14, minHeight: 48, borderRadius: 12, backgroundColor: value.device === device ? colors.primary : colors.surfaceMuted }}><Text style={{ color: value.device === device ? colors.background : colors.text }}>{device === 'pump' ? 'Pump / Pod' : 'Sensor'}</Text></Pressable>)}</View>
      <BodyLocationPicker optional={false} value={value.location} onChange={location => onChange({ ...value, location })} recent={recentSites} />
    </> : null}
  </View>;
}
