import { SourceFreshness } from './models';

export const GLUCOSE_COLOR_PALETTE = {
  rose: {
    label: 'Rose',
    light: '#B4233A',
    dark: '#FF9BAE',
    aod: '#FF9BAE',
  },
  amber: {
    label: 'Amber',
    light: '#8A4B08',
    dark: '#F1B66F',
    aod: '#F1B66F',
  },
  orange: {
    label: 'Orange',
    light: '#98520A',
    dark: '#FFB066',
    aod: '#FFB066',
  },
  cyan: {
    label: 'Cyan',
    light: '#087F99',
    dark: '#65D2E7',
    aod: '#65D2E7',
  },
  green: {
    label: 'Green',
    light: '#087A5C',
    dark: '#69D5AC',
    aod: '#69D5AC',
  },
  blue: {
    label: 'Blue',
    light: '#255DA8',
    dark: '#82B7FF',
    aod: '#82B7FF',
  },
  purple: {
    label: 'Purple',
    light: '#6844A5',
    dark: '#C2A9FF',
    aod: '#C2A9FF',
  },
  slate: {
    label: 'Slate',
    light: '#526A72',
    dark: '#A9BDC2',
    aod: '#A9BDC2',
  },
} as const;

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
    target: 'cyan',
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
    return 'Glucose boundaries must be between 1.0 and 30.0 mmol/L.';
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
