import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useAppTheme } from '@/theme/theme';

export function FeatureEntry({ title, detail, icon, onPress }: {
  title: string; detail: string; icon: keyof typeof Ionicons.glyphMap; onPress: () => void;
}) {
  const { colors, radius } = useAppTheme();
  return <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.row, { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radius.md, opacity: pressed ? 0.7 : 1 }]}>
    <Ionicons name={icon} size={24} color={colors.primary} accessibilityElementsHidden />
    <View style={styles.copy}><Text style={[styles.title, { color: colors.text }]}>{title}</Text><Text style={[styles.detail, { color: colors.textSecondary }]}>{detail}</Text></View>
    <Ionicons name="chevron-forward" size={20} color={colors.textSecondary} accessibilityElementsHidden />
  </Pressable>;
}
const styles = StyleSheet.create({ row: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16, minHeight: 64, borderWidth: StyleSheet.hairlineWidth }, copy: { flex: 1 }, title: { fontSize: 16, fontWeight: '700' }, detail: { fontSize: 14, lineHeight: 20, marginTop: 4 } });
