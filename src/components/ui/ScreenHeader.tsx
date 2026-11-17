import Ionicons from '@expo/vector-icons/Ionicons';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useAppTheme } from '@/theme/theme';
import { MIN_TOUCH_TARGET, PREFERRED_TOUCH_TARGET } from '@/theme/tokens';

export interface ScreenHeaderAction {
  icon: keyof typeof Ionicons.glyphMap;
  /** Required: the button has no visible text. */
  accessibilityLabel: string;
  accessibilityHint?: string;
  onPress: () => void;
  testID?: string;
}

export interface ScreenHeaderBack {
  /** Name of the page it returns to, shown as "‹ Settings". */
  label: string;
  onPress: () => void;
  accessibilityHint?: string;
}

export interface ScreenHeaderProps {
  title: string;
  subtitle?: string;
  /** Optional back link shown above the title. */
  back?: ScreenHeaderBack;
  /** Round icon buttons on the right, in order. */
  actions?: readonly ScreenHeaderAction[];
  /** Extra right-side content after the actions (for example `AppMenuButton`). */
  trailing?: ReactNode;
}

/** Spoken label for the back link, for example "Back to Settings". */
export function screenHeaderBackLabel(label: string) {
  return `Back to ${label}`;
}

/**
 * Page header: optional back link, large title (a screen-reader heading),
 * optional subtitle and round icon buttons on the right. Text wraps instead of
 * truncating, so it stays readable at large system font sizes.
 */
export function ScreenHeader({ title, subtitle, back, actions = [], trailing }: ScreenHeaderProps) {
  const { colors, type } = useAppTheme();
  const hasRight = actions.length > 0 || (trailing !== undefined && trailing !== null);

  return (
    <View style={styles.header}>
      {back ? (
        <Pressable
          accessibilityHint={back.accessibilityHint}
          accessibilityLabel={screenHeaderBackLabel(back.label)}
          accessibilityRole="button"
          hitSlop={4}
          onPress={back.onPress}
          style={({ pressed }) => [styles.back, { opacity: pressed ? 0.7 : 1 }]}
        >
          <Ionicons
            accessibilityElementsHidden
            color={colors.primary}
            importantForAccessibility="no-hide-descendants"
            name="chevron-back"
            size={18}
          />
          <Text style={[styles.backLabel, { color: colors.primary, fontSize: type.bodyLarge }]}>
            {back.label}
          </Text>
        </Pressable>
      ) : null}
      <View style={styles.titleRow}>
        <View style={styles.titleCopy}>
          <Text
            accessibilityRole="header"
            style={[styles.title, { color: colors.text, fontSize: type.screenTitle }]}
          >
            {title}
          </Text>
          {subtitle ? (
            <Text style={[styles.subtitle, { color: colors.textSecondary, fontSize: type.body }]}>
              {subtitle}
            </Text>
          ) : null}
        </View>
        {hasRight ? (
          <View style={styles.actions}>
            {actions.map((action) => (
              <Pressable
                accessibilityHint={action.accessibilityHint}
                accessibilityLabel={action.accessibilityLabel}
                accessibilityRole="button"
                key={action.accessibilityLabel}
                onPress={action.onPress}
                style={({ pressed }) => [
                  styles.iconButton,
                  {
                    backgroundColor: pressed ? colors.surfaceElevated : colors.surface,
                    borderColor: colors.border,
                  },
                ]}
                testID={action.testID}
              >
                <Ionicons
                  accessibilityElementsHidden
                  color={colors.text}
                  importantForAccessibility="no-hide-descendants"
                  name={action.icon}
                  size={22}
                />
              </Pressable>
            ))}
            {trailing}
          </View>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    gap: 6,
    paddingTop: 16,
    paddingBottom: 12,
  },
  back: {
    alignSelf: 'flex-start',
    minHeight: MIN_TOUCH_TARGET,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingRight: 8,
  },
  backLabel: {
    fontWeight: '700',
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  titleCopy: {
    flex: 1,
    flexShrink: 1,
    gap: 4,
  },
  title: {
    fontWeight: '700',
    lineHeight: 34,
  },
  subtitle: {
    lineHeight: 21,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  iconButton: {
    width: PREFERRED_TOUCH_TARGET,
    height: PREFERRED_TOUCH_TARGET,
    borderRadius: PREFERRED_TOUCH_TARGET / 2,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
