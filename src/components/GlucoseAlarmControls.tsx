import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useAppTheme } from '@/theme/theme';

export function AlarmAction({ label, onPress, disabled = false, selected = false, primary = false }: {
  label: string; onPress(): void; disabled?: boolean; selected?: boolean; primary?: boolean;
}) {
  const { colors, radius } = useAppTheme();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled, selected }} disabled={disabled} onPress={onPress}
      style={({ pressed }) => [styles.action, {
        borderColor: selected || primary ? colors.primary : colors.border, borderRadius: radius.md,
        backgroundColor: primary ? colors.primary : selected ? `${colors.primary}18` : colors.surfaceMuted,
        opacity: disabled ? 0.45 : pressed ? 0.7 : 1,
      }]}>
      <Text style={[styles.actionText, { color: primary ? colors.onPrimary : colors.text }]}>{label}</Text>
    </Pressable>
  );
}

export function AlarmChoices({ children }: { children: React.ReactNode }) {
  return <View style={styles.choices}>{children}</View>;
}

export function alarmClockLabel(timestamp: number, locale: string) {
  // Snooze follows the phone clock, even when the analysis profile uses another zone.
  return new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit' }).format(timestamp);
}

export function alarmUntilLabel(timestamp: number, locale: string, now = Date.now()) {
  const selected = new Date(timestamp), current = new Date(now);
  const tomorrow = selected.getFullYear() !== current.getFullYear() || selected.getMonth() !== current.getMonth() || selected.getDate() !== current.getDate();
  const minutes = Math.max(1, Math.ceil((timestamp - now) / 60_000));
  const hours = Math.floor(minutes / 60);
  const duration = hours > 0 ? `${hours} ${hours === 1 ? 'hour' : 'hours'}${minutes % 60 ? ` ${minutes % 60} min` : ''}` : `${minutes} min`;
  return `${tomorrow ? 'Tomorrow at' : 'Until'} ${alarmClockLabel(timestamp, locale)} · ${duration}`;
}

const styles = StyleSheet.create({
  action: { minHeight: 44, paddingHorizontal: 13, paddingVertical: 11, borderWidth: 1, justifyContent: 'center', alignItems: 'center', maxWidth: '100%' },
  actionText: { fontSize: 13, lineHeight: 19, fontWeight: '700', textAlign: 'center', flexShrink: 1 },
  choices: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
});
