import Ionicons from '@expo/vector-icons/Ionicons';
import { StyleSheet, Text, View } from 'react-native';

import { useAppTheme } from '@/theme/theme';

export function SafetyNote() {
  const { colors, radius } = useAppTheme();
  return (
    <View
      accessibilityLabel="For personal review only. Do not use T1 Arc to calculate or change insulin doses."
      style={[
        styles.container,
        {
          backgroundColor: colors.surfaceMuted,
          borderColor: colors.border,
          borderRadius: radius.md,
        },
      ]}
    >
      <Ionicons
        accessibilityElementsHidden
        name="information-circle-outline"
        color={colors.textSecondary}
        size={20}
      />
      <Text style={[styles.text, { color: colors.textSecondary }]}>
        Personal review only. T1 Arc never recommends doses or pump-setting changes.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    minHeight: 52,
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  text: {
    flex: 1,
    fontSize: 12,
    lineHeight: 18,
  },
});
