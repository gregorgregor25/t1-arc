import { describe, expect, it } from 'vitest';

import appColors from '../modules/t1arc-glucose-display/shared/app-colors.json';
import glucoseColors from '../modules/t1arc-glucose-display/shared/glucose-colors.json';
import {
  contrastRatio,
  WCAG_AA_NON_TEXT,
  WCAG_AA_NORMAL_TEXT,
} from './support/contrast';
import type { AppColors } from '@/theme/theme';

type PaletteName = keyof typeof appColors;
const palettes = appColors as Record<PaletteName, AppColors>;
const paletteNames = Object.keys(palettes) as PaletteName[];

/** Colours used for text and essential icons. */
const TEXT_ROLES = [
  'text',
  'textSecondary',
  'textTertiary',
  'primary',
  'primaryStrong',
  'accent',
  'glucose',
  'insulin',
  'low',
  'high',
  'warning',
  'danger',
] as const satisfies readonly (keyof AppColors)[];

/** Surfaces that text is drawn on, including tinted chips and bands. */
const TEXT_BACKGROUNDS = [
  'background',
  'surface',
  'surfaceElevated',
  'surfaceMuted',
  'surfaceGradientStart',
  'surfaceGradientMiddle',
  'surfaceGradientEnd',
  'tabBar',
  'insulinSoft',
  'targetBand',
] as const satisfies readonly (keyof AppColors)[];

/** Surfaces that an input or control outline sits on. */
const CONTROL_BACKGROUNDS = [
  'background',
  'surface',
  'surfaceElevated',
  'surfaceMuted',
  'surfaceGradientEnd',
] as const satisfies readonly (keyof AppColors)[];

describe('theme colour contrast (WCAG AA)', () => {
  for (const name of paletteNames) {
    const colors = palettes[name];

    it(`${name}: text roles reach 4.5:1 on every text surface`, () => {
      const failures: string[] = [];
      for (const role of TEXT_ROLES) {
        for (const background of TEXT_BACKGROUNDS) {
          const ratio = contrastRatio(colors[role], colors[background]);
          if (ratio < WCAG_AA_NORMAL_TEXT) {
            failures.push(`${role} on ${background}: ${ratio.toFixed(2)}`);
          }
        }
      }
      expect(failures).toEqual([]);
    });

    it(`${name}: text on primary buttons reaches 4.5:1`, () => {
      expect(contrastRatio(colors.onPrimary, colors.primary)).toBeGreaterThanOrEqual(WCAG_AA_NORMAL_TEXT);
      expect(contrastRatio(colors.onPrimary, colors.primaryStrong)).toBeGreaterThanOrEqual(WCAG_AA_NORMAL_TEXT);
    });

    it(`${name}: control outlines reach 3:1`, () => {
      for (const background of CONTROL_BACKGROUNDS) {
        expect(
          contrastRatio(colors.controlBorder, colors[background]),
          `controlBorder on ${background}`,
        ).toBeGreaterThanOrEqual(WCAG_AA_NON_TEXT);
      }
    });
  }

  it('every selectable glucose range colour reads as text on light and dark surfaces', () => {
    const failures: string[] = [];
    for (const [token, swatch] of Object.entries(glucoseColors)) {
      for (const name of paletteNames) {
        const dark = name.endsWith('Dark');
        const colour = dark ? swatch.dark : swatch.light;
        for (const background of CONTROL_BACKGROUNDS) {
          const ratio = contrastRatio(colour, palettes[name][background]);
          if (ratio < WCAG_AA_NORMAL_TEXT) {
            failures.push(`${token} (${dark ? 'dark' : 'light'}) on ${name}.${background}: ${ratio.toFixed(2)}`);
          }
        }
      }
    }
    expect(failures).toEqual([]);
  });

  it('keeps the contrast helper aligned with the WCAG reference values', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 5);
    expect(contrastRatio('#FFFFFF', '#FFFFFF')).toBeCloseTo(1, 5);
    expect(contrastRatio('#767676', '#FFFFFF')).toBeCloseTo(4.54, 2);
  });
});
