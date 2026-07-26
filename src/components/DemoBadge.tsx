import { StyleSheet, Text, View } from 'react-native';

import { useAppTheme } from '@/theme/theme';

export function DemoBadge() {
  const { colors, radius } = useAppTheme();
  return (
    <View
      accessibilityLabel="Synthetic demo data"
      style={[
        styles.badge,
        {
          backgroundColor: `${colors.primary}16`,
          borderColor: `${colors.primary}55`,
          borderRadius: radius.pill,
        },
      ]}
    >
      <Text style={[styles.text, { color: colors.primary }]}>DEMO</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    minWidth: 58,
    minHeight: 32,
    paddingHorizontal: 11,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: {
    fontSize: 10,
    lineHeight: 14,
    fontWeight: '800',
    letterSpacing: 1,
  },
});
