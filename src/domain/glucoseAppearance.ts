import sharedGlucoseColors from '../../modules/t1arc-glucose-display/shared/glucose-colors.json';
import { SourceFreshness } from './models';
import { formatGlucose } from './regionalFormat';
import { getRuntimeRegionalDefaults } from './regionalProfileRuntime';

export const GLUCOSE_COLOR_PALETTE = sharedGlucoseColors;

export type GlucoseColorToken = keyof typeof GLUCOSE_COLOR_PALETTE;

export type GlucoseRange =
  | 'veryLow'
  | 'low'
  | 'target'
  | 'high'
  | 'veryHigh'
  | 'stale';

export interface GlucoseAppearanceSettings {
  veryLowMax: number;
  targetMin: number;
  targetMax: number;
  veryHighMin: number;
  colors: Record<GlucoseRange, GlucoseColorToken>;
}

export const DEFAULT_GLUCOSE_APPEARANCE: GlucoseAppearanceSettings = {
  veryLowMax: 3,
  targetMin: 3.9,
  targetMax: 10,
  veryHighMin: 13.9,
  colors: {
    veryLow: 'rose',
    low: 'amber',
    target: 'green',
    high: 'orange',
    veryHigh: 'rose',
    stale: 'slate',
  },
};

export const GLUCOSE_RANGE_LABELS: Record<GlucoseRange, string> = {
  veryLow: 'Very low',
  low: 'Low',
  target: 'In range',
  high: 'High',
  veryHigh: 'Very high',
  stale: 'Stale or missing',
};

export function validateGlucoseAppearance(
  settings: GlucoseAppearanceSettings,
): string | undefined {
  const values = [
    settings.veryLowMax,
    settings.targetMin,
    settings.targetMax,
    settings.veryHighMin,
  ];
  if (values.some((value) => !Number.isFinite(value))) {
    return 'Enter a number for every glucose boundary.';
  }
  if (values.some((value) => value < 1 || value > 30)) {
    return `Glucose boundaries must be between ${formatGlucose(1, getRuntimeRegionalDefaults())} and ${formatGlucose(30, getRuntimeRegionalDefaults())}.`;
  }
  if (
    settings.veryLowMax >= settings.targetMin ||
    settings.targetMin >= settings.targetMax ||
    settings.targetMax >= settings.veryHighMin
  ) {
    return 'Boundaries must increase from very low through very high.';
  }
  if (
    Object.values(settings.colors).some(
      (token) => !(token in GLUCOSE_COLOR_PALETTE),
    )
  ) {
    return 'Choose a supported colour for every glucose range.';
  }
  return undefined;
}

export function glucoseRangeForValue(
  mmolL: number | undefined,
  freshness: SourceFreshness = 'current',
  settings = DEFAULT_GLUCOSE_APPEARANCE,
): GlucoseRange {
  if (
    mmolL === undefined ||
    freshness === 'stale' ||
    freshness === 'missing'
  ) {
    return 'stale';
  }
  if (mmolL <= settings.veryLowMax) return 'veryLow';
  if (mmolL < settings.targetMin) return 'low';
  if (mmolL <= settings.targetMax) return 'target';
  if (mmolL < settings.veryHighMin) return 'high';
  return 'veryHigh';
}

/** Illustrative values within each valid configured band, always in mmol/L. */
export function glucoseAppearancePreview(settings: GlucoseAppearanceSettings): {
  mmolL: number;
  range: Exclude<GlucoseRange, 'stale'>;
}[] {
  return [
    { mmolL: settings.veryLowMax - 0.1, range: 'veryLow' },
    { mmolL: (settings.veryLowMax + settings.targetMin) / 2, range: 'low' },
    { mmolL: (settings.targetMin + settings.targetMax) / 2, range: 'target' },
    { mmolL: (settings.targetMax + settings.veryHighMin) / 2, range: 'high' },
    { mmolL: settings.veryHighMin + 0.1, range: 'veryHigh' },
  ];
}

export function glucoseTone(
  mmolL: number | undefined,
  freshness: SourceFreshness,
  settings: GlucoseAppearanceSettings,
  dark: boolean,
) {
  const range = glucoseRangeForValue(mmolL, freshness, settings);
  const palette = GLUCOSE_COLOR_PALETTE[settings.colors[range]];
  return dark ? palette.dark : palette.light;
}
