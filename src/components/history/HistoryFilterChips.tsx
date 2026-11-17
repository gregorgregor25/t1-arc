import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useAppTheme } from '@/theme/theme';
import { PREFERRED_TOUCH_TARGET } from '@/theme/tokens';

export interface HistoryFilterChip<T extends string> {
  value: T;
  label: string;
}

/**
 * Wrapping filter chips. The selected chip is marked with a tick and a filled
 * background, so the state does not rely on colour alone; screen readers hear
 * it as a selected tab.
 */
export function HistoryFilterChips<T extends string>({
  accessibilityLabel,
  options,
  value,
  onChange,
}: {
  accessibilityLabel: string;
  options: readonly HistoryFilterChip<T>[];
  value: T;
  onChange(value: T): void;
}) {
  const { colors, radius, type } = useAppTheme();
  return (
    <View accessibilityLabel={accessibilityLabel} accessibilityRole="tablist" style={styles.row}>
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Pressable
            accessibilityLabel={option.label}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            key={option.value}
            onPress={() => onChange(option.value)}
            style={({ pressed }) => [
              styles.chip,
              {
                backgroundColor: selected ? colors.surfaceElevated : 'transparent',
                borderColor: selected ? colors.primary : colors.border,
                borderRadius: radius.pill,
                opacity: pressed ? 0.7 : 1,
              },
            ]}
          >
            {selected ? (
              <Ionicons
                accessibilityElementsHidden
                color={colors.primary}
                importantForAccessibility="no-hide-descendants"
                name="checkmark"
                size={16}
              />
            ) : null}
            <Text
              style={[
                styles.label,
                { color: selected ? colors.text : colors.textSecondary, fontSize: type.callout },
                selected && styles.selectedLabel,
              ]}
            >
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    minHeight: PREFERRED_TOUCH_TARGET,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  label: { lineHeight: 20, fontWeight: '600' },
  selectedLabel: { fontWeight: '700' },
});
