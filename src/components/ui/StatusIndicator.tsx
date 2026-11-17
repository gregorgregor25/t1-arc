import { StyleSheet, View } from 'react-native';

import { type AppColors, useAppTheme } from '@/theme/theme';

/**
 * Status of a source, setting or check, shown as a small shape.
 *
 * Each tone has its own shape *and* its own word, so the indicator never relies
 * on colour alone:
 *
 * | tone        | shape          | word              | colour token |
 * | ----------- | -------------- | ----------------- | ------------ |
 * | `ok`        | filled circle  | "Working"         | `accent`     |
 * | `attention` | triangle       | "Needs attention" | `warning`    |
 * | `problem`   | diamond        | "Problem"         | `danger`     |
 * | `off`       | hollow ring    | "Off"             | `textTertiary` |
 *
 * The shape itself is hidden from screen readers; the row or line that shows
 * it speaks the word (see {@link statusToneWord}).
 */
export type StatusTone = 'ok' | 'attention' | 'problem' | 'off';

const STATUS_TONE_WORDS: Readonly<Record<StatusTone, string>> = {
  ok: 'Working',
  attention: 'Needs attention',
  problem: 'Problem',
  off: 'Off',
};

/** The spoken word for a tone, unless the caller gives a more specific one. */
export function statusToneWord(tone: StatusTone, override?: string): string {
  const custom = override?.trim();
  return custom ? custom : STATUS_TONE_WORDS[tone];
}

/** Theme colour for a tone. Matches `StatusPill` (accent / warning / danger). */
export function statusToneColor(tone: StatusTone, colors: AppColors): string {
  switch (tone) {
    case 'ok':
      return colors.accent;
    case 'attention':
      return colors.warning;
    case 'problem':
      return colors.danger;
    case 'off':
      return colors.textTertiary;
  }
}

export interface StatusIndicatorProps {
  tone: StatusTone;
  /** Box size in dp. The shape is centred in a square of this size. */
  size?: number;
}

/** Decorative status shape. Pair it with visible or spoken words. */
export function StatusIndicator({ tone, size = 12 }: StatusIndicatorProps) {
  const { colors } = useAppTheme();
  const color = statusToneColor(tone, colors);
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.box, { width: size, height: size }]}
      testID={`status-indicator-${tone}`}
    >
      {statusShape(tone, size, color)}
    </View>
  );
}

function statusShape(tone: StatusTone, size: number, color: string) {
  switch (tone) {
    case 'ok':
      return (
        <View
          style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: color }}
        />
      );
    case 'attention':
      return (
        <View
          style={[
            styles.triangle,
            {
              borderLeftWidth: size / 2,
              borderRightWidth: size / 2,
              borderBottomWidth: size,
              borderBottomColor: color,
            },
          ]}
        />
      );
    case 'problem': {
      // A square rotated 45 degrees; its diagonal fits inside the box.
      const side = Math.round(size * 0.72);
      return (
        <View
          style={{
            width: side,
            height: side,
            backgroundColor: color,
            transform: [{ rotate: '45deg' }],
          }}
        />
      );
    }
    case 'off':
      return (
        <View
          style={{
            width: size,
            height: size,
            borderRadius: size / 2,
            borderWidth: 2,
            borderColor: color,
          }}
        />
      );
  }
}

const styles = StyleSheet.create({
  box: {
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  triangle: {
    width: 0,
    height: 0,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
  },
});
