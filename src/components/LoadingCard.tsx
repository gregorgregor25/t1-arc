import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { useAppTheme } from '@/theme/theme';

import { SectionCard } from './SectionCard';

export function LoadingCard({ label = 'Loading data…' }: { label?: string }) {
  const { colors } = useAppTheme();
  return (
    <SectionCard>
      <View style={styles.container}>
        <ActivityIndicator color={colors.primary} />
        <Text style={[styles.label, { color: colors.textSecondary }]}>{label}</Text>
      </View>
    </SectionCard>
  );
}

const styles = StyleSheet.create({
  container: {
    minHeight: 150,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  label: {
    fontSize: 13,
    lineHeight: 19,
  },
});
