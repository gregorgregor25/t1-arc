/**
 * App typeface: Atkinson Hyperlegible (Braille Institute, SIL OFL 1.1).
 *
 * How the font reaches every screen:
 *
 * 1. Embedding. `app.json` configures the `expo-font` config plugin with one
 *    Android XML font family named {@link APP_FONT_FAMILY} that contains the
 *    regular (400) and bold (700) files from `assets/fonts/`. The fonts are
 *    compiled into the APK and registered with React Native's font manager in
 *    `MainApplication.onCreate`, so there is no runtime loading, no flash of
 *    the system font and no change to the startup gate.
 * 2. Default family. `src/theme/registerAppTypeface.ts` (imported first by
 *    `index.ts`) wraps React Native's `Text` and `TextInput` once, using
 *    {@link resolveAppTypefaceStyle}. Screens keep importing `Text` from
 *    `react-native` and keep writing `fontWeight`; they do not name the font.
 * 3. Weights. Only real faces are requested: any bold weight (`bold`, 600-900)
 *    becomes 700 and any lighter weight becomes 400, so Android never
 *    synthesises ("fake bolds") a heavier face from the 700 file.
 *
 * Text that names its own `fontFamily` (monospace record ids, icon fonts) is
 * left untouched, and so is unstyled nested text, which inherits its parent.
 *
 * This module is pure (type imports only) so it can be unit tested in Node.
 */
import type { StyleProp, TextStyle } from 'react-native';

/**
 * Family name registered on Android (XML font family) and the family name
 * stored inside the font files (used by iOS). Keep both in sync with
 * `app.json` > `expo-font`.
 */
export const APP_FONT_FAMILY = 'Atkinson Hyperlegible';

/** The two faces that ship with the app. */
export const APP_FONT_WEIGHT = {
  regular: '400',
  bold: '700',
} as const;

export type AppFontWeight = (typeof APP_FONT_WEIGHT)[keyof typeof APP_FONT_WEIGHT];

type FontWeightValue = TextStyle['fontWeight'];

const NAMED_WEIGHTS: Readonly<Record<string, number>> = {
  normal: 400,
  regular: 400,
  bold: 700,
  ultralight: 100,
  thin: 100,
  light: 300,
  medium: 500,
  semibold: 600,
  condensedBold: 700,
  condensed: 400,
  heavy: 800,
  black: 900,
};

/**
 * Maps any React Native `fontWeight` onto one of the embedded faces.
 * 600 and heavier use the bold face; everything lighter uses regular.
 * Returns `undefined` when no weight was given, so inheritance still works.
 */
export function normalizeAppFontWeight(
  weight: FontWeightValue | null | undefined,
): AppFontWeight | undefined {
  if (weight === undefined || weight === null) return undefined;
  const numeric =
    typeof weight === 'number'
      ? weight
      : (NAMED_WEIGHTS[weight] ?? Number.parseInt(weight, 10));
  if (!Number.isFinite(numeric)) return APP_FONT_WEIGHT.regular;
  return numeric >= 600 ? APP_FONT_WEIGHT.bold : APP_FONT_WEIGHT.regular;
}

export interface TextFontDeclaration {
  fontFamily?: string;
  fontWeight?: FontWeightValue;
}

/**
 * Reads the effective `fontFamily` and `fontWeight` from a style prop the way
 * React Native flattens it: arrays are applied in order, later values win and
 * falsy entries are skipped. `undefined` values do not override earlier ones.
 */
export function readTextFont(style: StyleProp<TextStyle>): TextFontDeclaration {
  const result: TextFontDeclaration = {};
  collectTextFont(style, result);
  return result;
}

function collectTextFont(style: unknown, result: TextFontDeclaration): void {
  if (!style || typeof style !== 'object') return;
  if (Array.isArray(style)) {
    for (const entry of style) collectTextFont(entry, result);
    return;
  }
  const { fontFamily, fontWeight } = style as TextStyle;
  if (fontFamily !== undefined && fontFamily !== null) result.fontFamily = fontFamily;
  if (fontWeight !== undefined && fontWeight !== null) result.fontWeight = fontWeight;
}

/**
 * `root`: an outermost `Text` or any `TextInput`; gets the app family by default.
 * `nested`: a `Text` inside another `Text`; inherits its parent's family.
 */
export type TypefacePlacement = 'root' | 'nested';

const APP_FAMILY_STYLE: TextStyle = Object.freeze({ fontFamily: APP_FONT_FAMILY });
const APP_WEIGHT_STYLE: Readonly<Record<AppFontWeight, TextStyle>> = Object.freeze({
  '400': Object.freeze({ fontWeight: '400' }),
  '700': Object.freeze({ fontWeight: '700' }),
});

/**
 * Returns the style to pass to the underlying React Native component.
 *
 * - A custom `fontFamily` (anything except {@link APP_FONT_FAMILY}) is kept
 *   exactly as given.
 * - A root element without a family gets {@link APP_FONT_FAMILY} as a default
 *   placed before the caller's style.
 * - An explicit weight is mapped onto 400 or 700 (see
 *   {@link normalizeAppFontWeight}) and appended last so it wins.
 * - When nothing needs to change the original style object is returned
 *   unchanged (same identity), so memoised styles stay cheap.
 */
export function resolveAppTypefaceStyle(
  style: StyleProp<TextStyle>,
  placement: TypefacePlacement,
): StyleProp<TextStyle> {
  const font = readTextFont(style);
  if (font.fontFamily !== undefined && font.fontFamily !== APP_FONT_FAMILY) {
    return style;
  }
  const addFamily = placement === 'root' && font.fontFamily === undefined;
  const weight = normalizeAppFontWeight(font.fontWeight);
  const replaceWeight = weight !== undefined && font.fontWeight !== weight;
  if (!addFamily && !replaceWeight) return style;
  const resolved: StyleProp<TextStyle>[] = [];
  if (addFamily) resolved.push(APP_FAMILY_STYLE);
  resolved.push(style);
  if (replaceWeight) resolved.push(APP_WEIGHT_STYLE[weight]);
  return resolved;
}

interface NavigationFontStyle {
  fontFamily: string;
  fontWeight: AppFontWeight;
}

/**
 * Fonts for the React Navigation theme (tab bar labels and any navigator
 * header). Navigation passes these as explicit families, so they must name the
 * app font themselves.
 */
export const appNavigationFonts: {
  regular: NavigationFontStyle;
  medium: NavigationFontStyle;
  bold: NavigationFontStyle;
  heavy: NavigationFontStyle;
} = {
  regular: { fontFamily: APP_FONT_FAMILY, fontWeight: APP_FONT_WEIGHT.regular },
  medium: { fontFamily: APP_FONT_FAMILY, fontWeight: APP_FONT_WEIGHT.regular },
  bold: { fontFamily: APP_FONT_FAMILY, fontWeight: APP_FONT_WEIGHT.bold },
  heavy: { fontFamily: APP_FONT_FAMILY, fontWeight: APP_FONT_WEIGHT.bold },
};
