/**
 * Installs the app typeface as the default for React Native `Text` and
 * `TextInput`. See `src/theme/typography.ts` for the full explanation.
 *
 * React 19 no longer applies `defaultProps` to function components, so the
 * default is applied by replacing the `Text` and `TextInput` exports of the
 * `react-native` module with thin wrappers. Every `import { Text } from
 * 'react-native'` reads the export when it renders, so installing once before
 * the first render covers the whole app (and libraries that render plain
 * React Native text) without touching individual screens. React Native's own
 * internals import the original components directly and are unaffected.
 */
import { createContext, createElement, useContext, type Context, type ComponentType } from 'react';
import type { StyleProp, TextStyle } from 'react-native';

import { resolveAppTypefaceStyle } from './typography';

interface StyledProps {
  style?: StyleProp<TextStyle>;
}

type AnyComponent = ComponentType<StyledProps> & Record<string, unknown>;

const INSTALLED = Symbol.for('t1arc.appTypefaceInstalled');

function copyStatics(target: AnyComponent, source: AnyComponent) {
  for (const key of Object.keys(source)) {
    if (!(key in target)) target[key] = source[key];
  }
}

/**
 * Wraps React Native `Text`. Outermost text gets the app family; text nested
 * inside another `Text` (detected with React Native's own text-ancestor
 * context) inherits its parent's family and only has its weight normalised.
 */
export function createAppText<P extends StyledProps>(
  BaseText: ComponentType<P>,
  textAncestorContext: Context<boolean>,
): ComponentType<P> {
  function AppText(props: P) {
    const nested = useContext(textAncestorContext);
    const style = resolveAppTypefaceStyle(props.style, nested ? 'nested' : 'root');
    return createElement(BaseText, style === props.style ? props : { ...props, style });
  }
  copyStatics(AppText as unknown as AnyComponent, BaseText as unknown as AnyComponent);
  AppText.displayName = 'Text';
  return AppText;
}

/** Wraps React Native `TextInput`; inputs never inherit a parent's font. */
export function createAppTextInput<P extends StyledProps>(
  BaseTextInput: ComponentType<P>,
): ComponentType<P> {
  function AppTextInput(props: P) {
    const style = resolveAppTypefaceStyle(props.style, 'root');
    return createElement(BaseTextInput, style === props.style ? props : { ...props, style });
  }
  // Keeps statics such as `TextInput.State` (used by KeyboardFormScrollView).
  copyStatics(AppTextInput as unknown as AnyComponent, BaseTextInput as unknown as AnyComponent);
  AppTextInput.displayName = 'TextInput';
  return AppTextInput;
}

/** The parts of the `react-native` module this installer reads and replaces. */
export interface ReactNativeTextExports {
  Text: ComponentType<StyledProps>;
  TextInput: ComponentType<StyledProps>;
  unstable_TextAncestorContext: Context<boolean>;
}

/**
 * Replaces `Text` and `TextInput` on the given `react-native` module object.
 * Safe to call more than once; later calls do nothing. Returns `true` when the
 * wrappers were installed by this call.
 */
export function installAppTypeface(reactNative: ReactNativeTextExports): boolean {
  const marked = reactNative as unknown as Record<symbol, unknown>;
  if (marked[INSTALLED]) return false;
  // `unstable_TextAncestorContext` is exported by React Native 0.86. If a later
  // version drops it, every Text is treated as outermost: still the app font,
  // but plain text nested in monospace text would switch to the app font.
  const textAncestorContext =
    (reactNative.unstable_TextAncestorContext as Context<boolean> | undefined) ??
    createContext(false);
  const AppText = createAppText(reactNative.Text, textAncestorContext);
  const AppTextInput = createAppTextInput(reactNative.TextInput);
  Object.defineProperty(reactNative, 'Text', {
    configurable: true,
    enumerable: true,
    get: () => AppText,
  });
  Object.defineProperty(reactNative, 'TextInput', {
    configurable: true,
    enumerable: true,
    get: () => AppTextInput,
  });
  Object.defineProperty(reactNative, INSTALLED, { value: true });
  return true;
}
