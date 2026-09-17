import { StyleSheet, Text, View } from 'react-native';

import { SourceFreshness } from '@/domain/models';
import { freshnessCopy } from '@/domain/freshness';
import { useAppTheme } from '@/theme/theme';

export function StatusPill({
  freshness,
  compact = false,
}: {
  freshness: SourceFreshness;
  compact?: boolean;
}) {
  const { colors } = useAppTheme();
  const tone =
    freshness === 'current'
      ? colors.accent
      : freshness === 'delayed'
        ? colors.warning
        : colors.danger;
  return (
    <View
      accessibilityLabel={`Data status: ${freshnessCopy[freshness].label}`}
      style={[
        styles.container,
        {
          backgroundColor: `${tone}${compact ? '18' : '1F'}`,
          borderColor: `${tone}55`,
        },
        compact && styles.compact,
      ]}
    >
      <View style={[styles.dot, { backgroundColor: tone }]} />
      <Text style={[styles.label, { color: tone }]}>
        {freshnessCopy[freshness].label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    minHeight: 32,
    paddingHorizontal: 10,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 6,
  },
  compact: {
    minHeight: 28,
    paddingHorizontal: 8,
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 99,
  },
  label: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '700',
  },
});
