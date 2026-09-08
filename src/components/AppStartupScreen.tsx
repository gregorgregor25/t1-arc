import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { useAppTheme } from '@/theme/theme';

/** A visible, non-sensitive surface while local privacy checks finish. */
export function AppStartupScreen() {
  const { colors } = useAppTheme();
  return (
    <View accessibilityLabel="Opening T1 Arc" style={[styles.fill, { backgroundColor: colors.background }]}>
      <Text style={[styles.name, { color: colors.text }]}>T1 Arc</Text>
      <ActivityIndicator accessibilityLabel="Loading local settings" color={colors.primary} />
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 24 },
  name: { fontSize: 30, fontWeight: '700', letterSpacing: -1 },
});
