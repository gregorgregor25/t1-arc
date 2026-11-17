/**
 * Side-effect entry: makes Atkinson Hyperlegible the default font for every
 * React Native `Text` and `TextInput`. `index.ts` imports this before anything
 * else so it runs before the first render. See `src/theme/typography.ts`.
 */
import { installAppTypeface, type ReactNativeTextExports } from './installAppTypeface';

// Patch the real CommonJS exports object, not an ES-module namespace copy.
// eslint-disable-next-line @typescript-eslint/no-require-imports
installAppTypeface(require('react-native') as ReactNativeTextExports);
