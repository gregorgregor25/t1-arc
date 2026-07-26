import Ionicons from '@expo/vector-icons/Ionicons';
import { StyleSheet, Text, View } from 'react-native';

import { useAppTheme } from '@/theme/theme';

import { SectionCard } from './SectionCard';

export function ErrorCard({ message }: { message: string }) {
  const { colors } = useAppTheme();
  return (
    <SectionCard>
      <View style={styles.container}>
        <Ionicons
          accessibilityElementsHidden
          name="alert-circle-outline"
          color={colors.danger}
          size={24}
        />
        <View style={styles.copy}>
          <Text style={[styles.title, { color: colors.text }]}>Data unavailable</Text>
          <Text style={[styles.message, { color: colors.textSecondary }]}>
            {message}
          </Text>
        </View>
      </View>
    </SectionCard>
  );
}

const styles = StyleSheet.create({
  container: {
    minHeight: 96,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  copy: {
    flex: 1,
  },
  title: {
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '700',
  },
  message: {
    fontSize: 13,
    lineHeight: 19,
    marginTop: 3,
  },
});
