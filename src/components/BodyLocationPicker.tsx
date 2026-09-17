import { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import type { BodyLocation } from '@/domain/personalObservations';
import { useAppTheme } from '@/theme/theme';

export function BodyLocationPicker({ value, onChange, recent = [], optional = true }: {
  value?: BodyLocation; onChange(value: BodyLocation | undefined): void;
  optional?: boolean;
  recent?: { location: BodyLocation; date: string }[];
}) {
  const { colors } = useAppTheme();
  const [width, setWidth] = useState(260);
  const side = value?.side ?? 'front';
  return <View style={{ gap: 12 }}>
    <Text style={{ color: colors.text, fontWeight: '700' }}>Body location{optional ? ' (optional)' : ''}</Text>
    <View style={{ flexDirection: 'row', gap: 12 }}>
      {(['front', 'back'] as const).map(item => <Pressable key={item} accessibilityRole="radio" accessibilityState={{ checked: side === item }} onPress={() => onChange({ side: item, label: value?.label })} style={{ minHeight: 48, padding: 14, backgroundColor: side === item ? colors.primary : colors.surfaceMuted, borderRadius: 12 }}><Text style={{ color: side === item ? colors.background : colors.text }}>{item === 'front' ? 'Front' : 'Back'}</Text></Pressable>)}
      <Pressable accessibilityRole="button" onPress={() => onChange(undefined)} style={{ minHeight: 48, padding: 14 }}><Text style={{ color: colors.primary }}>Clear</Text></Pressable>
    </View>
    <Pressable accessibilityRole="button" accessibilityLabel={`${side} body map. Tap where the device was placed, or use the location description below.`}
      onLayout={event => setWidth(event.nativeEvent.layout.width)}
      onPress={event => onChange({ side, label: value?.label, x: Math.max(0, Math.min(1, event.nativeEvent.locationX / width)), y: Math.max(0, Math.min(1, event.nativeEvent.locationY / 320)) })}
      style={{ width: 260, maxWidth: '100%', height: 320, alignSelf: 'center', backgroundColor: colors.surfaceMuted, borderRadius: 16 }}>
      <Svg pointerEvents="none" width="100%" height="100%" viewBox="0 0 260 320" preserveAspectRatio="none">
        <Circle cx="130" cy="29" r="22" fill={colors.border} />
        <Path d="M112 55 L148 55 L169 70 L194 145 Q197 157 185 158 L173 143 L158 104 L158 164 L155 208 L149 292 Q147 310 134 302 L130 213 L126 302 Q112 310 110 292 L104 208 L102 164 L102 104 L87 143 L75 158 Q63 157 66 145 L91 70 Z" fill={colors.border} stroke={colors.textTertiary} strokeWidth="1" />
        {side === 'front' ? <Circle cx="130" cy="143" r="2" fill={colors.textTertiary} /> : <Path d="M130 64 L130 163" stroke={colors.textTertiary} strokeWidth="1" />}
        {recent.filter(site => site.location.side === side && site.location.x !== undefined).map((site, index) => <Circle key={index} cx={site.location.x! * 260} cy={site.location.y! * 320} r="7" fill={colors.textTertiary} opacity={0.4} />)}
        {value?.x !== undefined && value.y !== undefined ? <Circle cx={value.x * 260} cy={value.y * 320} r="9" fill={colors.primary} stroke={colors.background} strokeWidth="3" /> : null}
      </Svg>
    </Pressable>
    <Text style={{ color: colors.textSecondary }}>Tap any position to record where you placed it. This is your placement history, not placement guidance.</Text>
    <TextInput accessibilityLabel="Describe body location" placeholder="For example: left upper arm" placeholderTextColor={colors.textTertiary} maxLength={120} value={value?.label ?? ''} onChangeText={label => onChange({ ...value, side, label })} style={{ color: colors.text, backgroundColor: colors.surfaceMuted, borderRadius: 12, padding: 14, minHeight: 52 }} />
    {recent.slice(0, 4).map((site, index) => <Text key={index} style={{ color: colors.textSecondary }}>Previous: {site.date} · {site.location.side}{site.location.label ? ` · ${site.location.label}` : ''}</Text>)}
  </View>;
}
