/**
 * Static design tokens shared by `StyleSheet.create` blocks and the theme.
 *
 * Colours live in `modules/t1arc-glucose-display/shared/app-colors.json` (also
 * read by the native home-screen widget). Everything here is size and rhythm.
 */

/**
 * Minimal type scale in sp. Font scaling stays enabled, so these are the sizes
 * at the default system text size.
 *
 * - `micro` (11) is reserved for non-essential chart axis ticks and decorative
 *   artwork. It must never carry the only copy of a value, state or action.
 * - `caption` (12) is the smallest size for readable UI text: badges, units,
 *   timestamps and dense metadata.
 * - `footnote` (13) is the preferred size for secondary text and hints.
 */
export const typeScale = {
  micro: 11,
  caption: 12,
  footnote: 13,
  callout: 14,
  body: 15,
  bodyLarge: 16,
  title: 17,
  titleLarge: 20,
  headline: 24,
  /** Screen titles in the 2026 redesign (`ScreenHeader`). */
  screenTitle: 28,
  display: 32,
} as const;

/** Smallest text size allowed for user-facing copy. */
export const MIN_READABLE_FONT_SIZE = typeScale.caption;
/** Smallest size allowed anywhere, for non-essential chart ticks only. */
export const MIN_DECORATIVE_FONT_SIZE = typeScale.micro;

/** Base spacing scale in dp (4, 8, 12, 16, 24, 32, 48). */
export const spacing = {
  xs: 4,
  sm: 8,
  smd: 12,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
} as const;

/** Padding inside a standard card. Matches `SectionCard`. */
export const CARD_PADDING = 20;
/** Vertical gap between stacked cards on a screen. */
export const CARD_GAP = spacing.md;

/** Minimum interactive target (Android/WCAG target guidance). */
export const MIN_TOUCH_TARGET = 44;
/** Preferred height for primary rows and buttons. */
export const PREFERRED_TOUCH_TARGET = 48;

/**
 * Returns a hitSlop that grows a visually smaller control to at least
 * {@link MIN_TOUCH_TARGET} in each direction.
 */
export function touchSlop(width: number, height: number = width) {
  const horizontal = Math.max(0, Math.ceil((MIN_TOUCH_TARGET - width) / 2));
  const vertical = Math.max(0, Math.ceil((MIN_TOUCH_TARGET - height) / 2));
  return { top: vertical, bottom: vertical, left: horizontal, right: horizontal };
}

/**
 * Upper bound for `maxFontSizeMultiplier` on dense rows (chips, tab labels,
 * table cells) so very large system text stays legible without breaking the
 * row. Essential copy elsewhere should scale freely.
 */
export const DENSE_ROW_MAX_FONT_SCALE = 1.8;

/** Bottom clearance the Today floating "+" button needs above content. */
export const FLOATING_BUTTON_SIZE = 58;
export const FLOATING_BUTTON_MARGIN = 18;
/** Extra scroll padding so the last card can scroll clear of the "+" button. */
export const FLOATING_BUTTON_CLEARANCE =
  FLOATING_BUTTON_SIZE + FLOATING_BUTTON_MARGIN * 2;
