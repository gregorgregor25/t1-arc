import { useState } from 'react';
import { Keyboard, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { SENSOR_MODELS, sensorModel, validSensorWarmupMinutes } from '@/domain/sensorModels';
import { normalizeRegionalNumberInput } from '@/domain/regionalNumberInput';
import { formatDate, formatTime, toDateKey } from '@/domain/time';
import { useRegionalProfile } from '@/providers/RegionalProfileProvider';
import { useAppTheme } from '@/theme/theme';

export function SensorWarmupFields({ modelId, customMinutes, timestamp, onModelChange, onMinutesChange }: {
  modelId?: string;
  customMinutes: string;
  timestamp: number;
  onModelChange(id: string): void;
  onMinutesChange(value: string): void;
}) {
  const { colors, radius } = useAppTheme();
  const { defaults: regional } = useRegionalProfile();
  const [choosing, setChoosing] = useState(false);
  const [query, setQuery] = useState('');
  const selected = sensorModel(modelId);
  const minutes = selected?.warmupMinutes ?? (modelId === 'other'
    ? normalizeRegionalNumberInput(customMinutes, regional.locale)?.value : undefined);
  const valid = validSensorWarmupMinutes(minutes);
  const end = valid ? timestamp + minutes * 60_000 : undefined;
  const inputStyle = [styles.input, { color: colors.text, backgroundColor: colors.surfaceMuted, borderColor: colors.border, borderRadius: radius.md }];

  return <View style={styles.container}>
    <Text style={[styles.label, { color: colors.text }]}>Sensor model</Text>
    <Pressable accessibilityRole="button" accessibilityLabel={`Sensor model: ${selected?.label ?? 'Choose your sensor'}`}
      accessibilityState={{ expanded: choosing }} onPress={() => setChoosing(!choosing)} style={inputStyle}>
      <Text style={{ color: colors.text }}>{selected?.label ?? 'Choose your sensor'} ▾</Text>
    </Pressable>
    {choosing ? <View style={styles.choices}>
      <TextInput accessibilityLabel="Search sensor models" placeholder="Search sensor models" placeholderTextColor={colors.textTertiary}
        value={query} onChangeText={setQuery} style={inputStyle} autoCorrect={false} />
      {SENSOR_MODELS.filter((model) => model.id === 'other' || model.label.toLowerCase().includes(query.trim().toLowerCase())).map((model) =>
        <Pressable key={model.id} accessibilityRole="radio" accessibilityState={{ checked: model.id === modelId }}
          onPress={() => { onModelChange(model.id); setChoosing(false); setQuery(''); Keyboard.dismiss(); }}
          style={[styles.choice, { borderColor: model.id === modelId ? colors.primary : colors.border, borderRadius: radius.md }]}>
          <Text style={{ color: colors.text, flexShrink: 1 }}>{model.label}</Text>
          <Text style={{ color: colors.textSecondary }}>{model.warmupMinutes === undefined ? 'Unknown' : `${model.warmupMinutes} min`}</Text>
        </Pressable>)}
    </View> : null}
    {modelId === 'other' ? <>
      <Text style={[styles.label, { color: colors.text }]}>Warm-up time in minutes (optional)</Text>
      <TextInput accessibilityLabel="Warm-up time in minutes" keyboardType="number-pad" value={customMinutes}
        onChangeText={onMinutesChange} placeholder="Leave blank if you’re not sure" placeholderTextColor={colors.textTertiary} style={inputStyle} />
    </> : null}
    {selected ? <View accessibilityLiveRegion="polite" style={styles.preview}>
      <Text style={{ color: colors.text }}>Warm-up: {valid ? `${minutes} minutes` : 'Unknown'}</Text>
      <Text style={{ color: colors.text }}>{end === undefined ? 'No expected reading time set.'
        : `Readings expected from: ${toDateKey(end) !== toDateKey(timestamp) ? `${formatDate(toDateKey(end))}, ` : ''}${formatTime(end)}`}</Text>
    </View> : null}
    <Text style={[styles.helper, { color: colors.textSecondary }]}>
      {modelId === 'dexcom-g7' || modelId === 'dexcom-g7-15-day' || modelId === 'dexcom-one-plus'
        ? 'Enter when you inserted the sensor; that is when warm-up begins.'
        : 'Enter when warm-up began in your sensor app.'} We’ll remember your saved choice.
    </Text>
    <Text style={[styles.helper, { color: colors.textSecondary }]}>
      Records expected warm-up in your history. Follow your sensor app for live status.
    </Text>
  </View>;
}

const styles = StyleSheet.create({
  container: { gap: 10 }, label: { fontSize: 13, fontWeight: '800' },
  input: { minHeight: 52, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 12, justifyContent: 'center', fontSize: 16 },
  choices: { gap: 8 }, choice: { minHeight: 48, padding: 12, borderWidth: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  preview: { gap: 6, paddingVertical: 6 }, helper: { fontSize: 13, lineHeight: 20 },
});
