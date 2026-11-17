import { StyleSheet, type ViewStyle } from 'react-native';

import type { AppTheme } from '@/theme/theme';

/**
 * Flat card surface used by the redesign primitives (`ListGroup`, `NavCard`):
 * `surface` fill, `border` outline and the large radius. Kept in one place so
 * every grouped card looks the same in light and dark mode.
 */
export function flatSurfaceStyle({ colors, radius }: Pick<AppTheme, 'colors' | 'radius'>): ViewStyle {
  return {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
  };
}
