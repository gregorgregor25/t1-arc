import { StyleSheet, Text, View } from 'react-native';

import { DataMode } from '@/data/libreLinkUp/secureStore';
import { useAppTheme } from '@/theme/theme';

export function DataModeBadge({ mode }: { mode: DataMode }) {
  const { colors, radius } = useAppTheme();
  const live = mode === 'live';
  const tone = live ? colors.accent : colors.primary;
  return (
    <View
      accessibilityLabel={
        live ? 'Using personal live glucose' : 'Using synthetic demo data'
      }
      style={[
        styles.badge,
        {
          backgroundColor: `${tone}16`,
          borderColor: `${tone}55`,
          borderRadius: radius.pill,
        },
      ]}
    >
      <View style={[styles.dot, { backgroundColor: tone }]} />
      <Text style={[styles.text, { color: tone }]}>
        {live ? 'PERSONAL' : 'DEMO'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    minHeight: 32,
    paddingHorizontal: 11,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 99,
  },
  text: {
    fontSize: 9,
    lineHeight: 13,
    fontWeight: '800',
    letterSpacing: 0.85,
  },
});
