import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useAppTheme } from '@/theme/theme';

import { flatSurfaceStyle } from './surface';

export interface NavCardProps {
  icon: keyof typeof Ionicons.glyphMap;
  /** Place name, for example "Glucose source". */
  title: string;
  /** What lives there, for example "Where your readings come from". */
  detail?: string;
  onPress: () => void;
  /** Defaults to "title, detail". */
  accessibilityLabel?: string;
  accessibilityHint?: string;
  testID?: string;
}

/** Spoken label for a navigation card. */
export function navCardAccessibilityLabel({ title, detail }: Pick<NavCardProps, 'title' | 'detail'>) {
  return detail ? `${title}, ${detail}` : title;
}

/**
 * A large tappable card that opens another page: icon, bold title, detail and
 * chevron (Settings home "six main places"). At least 68 dp tall and grows
 * with the system font size.
 */
export function NavCard({
  icon,
  title,
  detail,
  onPress,
  accessibilityLabel,
  accessibilityHint,
  testID,
}: NavCardProps) {
  const theme = useAppTheme();
  const { colors, type } = theme;
  return (
    <Pressable
      accessibilityHint={accessibilityHint}
      accessibilityLabel={accessibilityLabel ?? navCardAccessibilityLabel({ title, detail })}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.card,
        flatSurfaceStyle(theme),
        { backgroundColor: pressed ? colors.surfaceElevated : colors.surface },
      ]}
      testID={testID}
    >
      <Ionicons
        accessibilityElementsHidden
        color={colors.primary}
        importantForAccessibility="no-hide-descendants"
        name={icon}
        size={24}
      />
      <View style={styles.copy}>
        <Text style={[styles.title, { color: colors.text, fontSize: type.title }]}>{title}</Text>
        {detail ? (
          <Text style={[styles.detail, { color: colors.textSecondary, fontSize: type.callout }]}>
            {detail}
          </Text>
        ) : null}
      </View>
      <Ionicons
        accessibilityElementsHidden
        color={colors.textSecondary}
        importantForAccessibility="no-hide-descendants"
        name="chevron-forward"
        size={20}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    minHeight: 68,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  copy: {
    flex: 1,
    flexShrink: 1,
    gap: 2,
  },
  title: {
    fontWeight: '700',
    lineHeight: 23,
  },
  detail: {
    lineHeight: 20,
  },
});
