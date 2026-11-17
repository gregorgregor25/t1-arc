import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { createContext, type ComponentType, type ReactElement } from 'react';
import type { StyleProp, TextStyle } from 'react-native';
import { describe, expect, it, vi } from 'vitest';

import {
  createAppText,
  createAppTextInput,
  installAppTypeface,
  type ReactNativeTextExports,
} from '@/theme/installAppTypeface';
import {
  APP_FONT_FAMILY,
  appNavigationFonts,
  normalizeAppFontWeight,
  readTextFont,
  resolveAppTypefaceStyle,
} from '@/theme/typography';

const hooks = vi.hoisted(() => ({ textAncestor: false }));

vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react')>()),
  useContext: () => hooks.textAncestor,
}));

const root = path.resolve(__dirname, '..');
const familyStyle = { fontFamily: APP_FONT_FAMILY };

describe('app font weight mapping', () => {
  it('maps every bold weight to the 700 face and lighter weights to 400', () => {
    for (const weight of ['bold', '600', '700', '800', '900', 600, 900, 'semibold', 'heavy', 'black'] as const) {
      expect(normalizeAppFontWeight(weight)).toBe('700');
    }
    for (const weight of ['normal', '100', '300', '400', '500', 500, 'medium', 'light', 'regular'] as const) {
      expect(normalizeAppFontWeight(weight)).toBe('400');
    }
    expect(normalizeAppFontWeight(undefined)).toBeUndefined();
  });
});

describe('reading a style prop', () => {
  it('flattens nested arrays like React Native and ignores empty entries', () => {
    expect(
      readTextFont([
        { fontWeight: '400' },
        false,
        null,
        [{ fontWeight: '800' }, undefined, { fontFamily: undefined }],
      ]),
    ).toEqual({ fontWeight: '800' });
    expect(readTextFont([{ fontFamily: 'monospace' }, { fontSize: 12 }])).toEqual({
      fontFamily: 'monospace',
    });
  });
});

describe('resolving the app typeface for a style', () => {
  it('gives outermost text the app family before its own style', () => {
    const style = { fontSize: 16, color: '#111' };
    expect(resolveAppTypefaceStyle(style, 'root')).toEqual([familyStyle, style]);
    expect(resolveAppTypefaceStyle(undefined, 'root')).toEqual([familyStyle, undefined]);
  });

  it('normalises heavy weights so Android never fakes a bolder face', () => {
    const style = [{ fontSize: 32 }, { fontWeight: '800' as const }];
    expect(resolveAppTypefaceStyle(style, 'root')).toEqual([
      familyStyle,
      style,
      { fontWeight: '700' },
    ]);
  });

  it('leaves monospace and icon fonts exactly as they are', () => {
    const mono = { fontFamily: 'monospace', fontWeight: '700' as const };
    expect(resolveAppTypefaceStyle(mono, 'root')).toBe(mono);
    const icon = [{ fontFamily: 'ionicons' }, { fontWeight: 'normal' as const }];
    expect(resolveAppTypefaceStyle(icon, 'nested')).toBe(icon);
  });

  it('lets nested text inherit its parent family and only fixes its weight', () => {
    const plain = { color: 'red' };
    expect(resolveAppTypefaceStyle(plain, 'nested')).toBe(plain);
    const bold = { fontWeight: '900' as const };
    expect(resolveAppTypefaceStyle(bold, 'nested')).toEqual([bold, { fontWeight: '700' }]);
  });

  it('returns the original style object when nothing has to change', () => {
    const style = { fontFamily: APP_FONT_FAMILY, fontWeight: '700' as const };
    expect(resolveAppTypefaceStyle(style, 'root')).toBe(style);
  });

  it('keeps navigation labels on the app font', () => {
    for (const font of Object.values(appNavigationFonts)) {
      expect(font.fontFamily).toBe(APP_FONT_FAMILY);
      expect(['400', '700']).toContain(font.fontWeight);
    }
  });
});

describe('Text and TextInput wrappers', () => {
  const ancestor = createContext(false);
  const BaseText = (() => null) as ComponentType<{ style?: StyleProp<TextStyle>; children?: unknown }>;

  it('passes props and refs through and adds the app family to outer text', () => {
    hooks.textAncestor = false;
    const AppText = createAppText(BaseText, ancestor);
    const ref = { current: null };
    const element = (AppText as (props: object) => ReactElement)({
      children: 'Hello',
      ref,
      style: { fontWeight: 'bold' },
    }) as ReactElement<Record<string, unknown>>;
    expect(element.type).toBe(BaseText);
    expect(element.props.children).toBe('Hello');
    expect(element.props.ref).toBe(ref);
    expect(element.props.style).toEqual([familyStyle, { fontWeight: 'bold' }, { fontWeight: '700' }]);
  });

  it('does not override the family of text nested inside other text', () => {
    hooks.textAncestor = true;
    const AppText = createAppText(BaseText, ancestor);
    const style = { color: 'blue' };
    const element = (AppText as (props: object) => ReactElement)({ style }) as ReactElement<{
      style: unknown;
    }>;
    expect(element.props.style).toBe(style);
    hooks.textAncestor = false;
  });

  it('keeps TextInput statics such as TextInput.State', () => {
    const state = { currentlyFocusedInput: () => null };
    const BaseInput = Object.assign(() => null, { State: state });
    const AppTextInput = createAppTextInput(BaseInput) as unknown as { State: unknown; displayName: string };
    expect(AppTextInput.State).toBe(state);
    expect(AppTextInput.displayName).toBe('TextInput');
  });

  it('replaces the react-native exports once', () => {
    const BaseInput = () => null;
    const reactNative = {
      get Text() {
        return BaseText;
      },
      get TextInput() {
        return BaseInput;
      },
      unstable_TextAncestorContext: ancestor,
    } as unknown as ReactNativeTextExports;
    expect(installAppTypeface(reactNative)).toBe(true);
    const installedText = reactNative.Text;
    expect(installedText).not.toBe(BaseText);
    expect(reactNative.TextInput).not.toBe(BaseInput);
    expect(installAppTypeface(reactNative)).toBe(false);
    expect(reactNative.Text).toBe(installedText);
  });
});

describe('typeface packaging', () => {
  const officialSha256: Record<string, string> = {
    'AtkinsonHyperlegible-Regular.ttf':
      '7fb917c89019896d0b52ee84b7cbb3304c18cb90b19a62f5e32712bd23e97669',
    'AtkinsonHyperlegible-Bold.ttf':
      '5a3b0c8cc8ca545155150b4512a1fa248298df121c50d6557e651e61fbdab92f',
  };

  it('ships the unmodified official font files with their licence', () => {
    for (const [file, digest] of Object.entries(officialSha256)) {
      const bytes = readFileSync(path.join(root, 'assets/fonts', file));
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(digest);
    }
    const licence = readFileSync(path.join(root, 'assets/fonts/OFL.txt'), 'utf8');
    expect(licence).toContain('Copyright 2020 Braille Institute of America, Inc.');
    expect(licence).toContain('SIL OPEN FONT LICENSE Version 1.1');
    const notices = readFileSync(path.join(root, 'THIRD_PARTY_NOTICES.md'), 'utf8');
    expect(notices).toContain('## App typeface');
    expect(notices).toContain('Atkinson Hyperlegible');
    expect(notices).toContain('SIL OPEN FONT LICENSE Version 1.1');
  });

  it('embeds one Android font family with real 400 and 700 faces', () => {
    const appConfig = JSON.parse(readFileSync(path.join(root, 'app.json'), 'utf8')) as {
      expo: { plugins: (string | [string, Record<string, unknown>])[] };
    };
    const plugin = appConfig.expo.plugins.find(
      (entry): entry is [string, Record<string, unknown>] =>
        Array.isArray(entry) && entry[0] === 'expo-font',
    );
    expect(plugin).toBeDefined();
    const android = plugin![1].android as {
      fonts: { fontFamily: string; fontDefinitions: { path: string; weight: number }[] }[];
    };
    expect(android.fonts).toHaveLength(1);
    const [family] = android.fonts;
    expect(family?.fontFamily).toBe(APP_FONT_FAMILY);
    expect(family?.fontDefinitions.map(({ weight }) => weight)).toEqual([400, 700]);
    for (const { path: fontPath } of family?.fontDefinitions ?? []) {
      expect(existsSync(path.join(root, fontPath))).toBe(true);
    }
  });

  it('installs the default font before any other module runs', () => {
    const entry = readFileSync(path.join(root, 'index.ts'), 'utf8');
    const firstImport = entry.match(/^import .*$/m)?.[0];
    expect(firstImport).toBe("import './src/theme/registerAppTypeface';");
  });
});
