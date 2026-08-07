import {
  GlucoseAppearanceSettings,
  GLUCOSE_COLOR_PALETTE,
  GlucoseRange,
  validateGlucoseAppearance,
} from './glucoseAppearance';
import {
  DEFAULT_GLUCOSE_ALERT_PREFERENCES,
  GlucoseAlertPreferences,
  validateGlucoseAlertPreferences,
} from './glucoseAlerts';

export const PORTABLE_PREFERENCES_VERSION = 2;

export const PORTABLE_AOD_POSITIONS = [
  'topLeft',
  'topCenter',
  'topRight',
  'middleLeft',
  'middleCenter',
  'middleRight',
  'bottomLeft',
  'bottomCenter',
  'bottomRight',
] as const;

export const PORTABLE_AOD_SIZES = ['small', 'standard', 'large'] as const;

export type PortableAodPosition = (typeof PORTABLE_AOD_POSITIONS)[number];
export type PortableAodSize = (typeof PORTABLE_AOD_SIZES)[number];
export type PortableGlucoseAlertSettings = Omit<
  GlucoseAlertPreferences,
  'enabled'
>;

export interface PortablePreferences {
  version: typeof PORTABLE_PREFERENCES_VERSION;
  glucoseAppearance: GlucoseAppearanceSettings;
  glanceableDisplay: {
    lockScreenVisible: boolean;
    aodPosition: PortableAodPosition;
    aodSize: PortableAodSize;
  };
  insightReviews: {
    weeklyNotificationEnabled: boolean;
  };
  glucoseAlerts: PortableGlucoseAlertSettings;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function hasExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
) {
  const keys = Object.keys(value);
  return (
    keys.length === expected.length &&
    keys.every((key) => expected.includes(key))
  );
}

export function validatePortablePreferences(
  value: unknown,
): PortablePreferences {
  if (!isPlainObject(value) || (value.version !== 1 && value.version !== 2)) {
    throw new Error('The backup preferences use an unsupported format.');
  }
  const expectedKeys =
    value.version === 1
      ? [
          'version',
          'glucoseAppearance',
          'glanceableDisplay',
          'insightReviews',
        ]
      : [
          'version',
          'glucoseAppearance',
          'glanceableDisplay',
          'insightReviews',
          'glucoseAlerts',
        ];
  if (
    !hasExactKeys(value, expectedKeys)
  ) {
    throw new Error('The backup preferences use an unsupported format.');
  }

  const appearance = value.glucoseAppearance;
  const display = value.glanceableDisplay;
  const reviews = value.insightReviews;
  if (
    !isPlainObject(appearance) ||
    !hasExactKeys(appearance, [
      'veryLowMax',
      'targetMin',
      'targetMax',
      'veryHighMin',
      'colors',
    ])
  ) {
    throw new Error('The backup contains invalid glucose appearance settings.');
  }
  const appearanceColors = appearance.colors;
  if (
    !isPlainObject(appearanceColors) ||
    !hasExactKeys(appearanceColors, [
      'veryLow',
      'low',
      'target',
      'high',
      'veryHigh',
      'stale',
    ])
  ) {
    throw new Error('The backup contains invalid glucose appearance settings.');
  }

  const glucoseRanges: GlucoseRange[] = [
    'veryLow',
    'low',
    'target',
    'high',
    'veryHigh',
    'stale',
  ];
  if (
    !['veryLowMax', 'targetMin', 'targetMax', 'veryHighMin'].every(
      (key) => typeof appearance[key] === 'number',
    ) ||
    glucoseRanges.some(
      (range) =>
        typeof appearanceColors[range] !== 'string' ||
        !((appearanceColors[range] as string) in GLUCOSE_COLOR_PALETTE),
    )
  ) {
    throw new Error('The backup contains invalid glucose appearance settings.');
  }
  const normalisedAppearance = {
    veryLowMax: appearance.veryLowMax,
    targetMin: appearance.targetMin,
    targetMax: appearance.targetMax,
    veryHighMin: appearance.veryHighMin,
    colors: Object.fromEntries(
      glucoseRanges.map((range) => [range, appearanceColors[range]]),
    ),
  } as GlucoseAppearanceSettings;
  const appearanceError = validateGlucoseAppearance(normalisedAppearance);
  if (appearanceError) {
    throw new Error(`The backup appearance is invalid. ${appearanceError}`);
  }

  if (
    !isPlainObject(display) ||
    !hasExactKeys(display, [
      'lockScreenVisible',
      'aodPosition',
      'aodSize',
    ]) ||
    typeof display.lockScreenVisible !== 'boolean' ||
    typeof display.aodPosition !== 'string' ||
    !PORTABLE_AOD_POSITIONS.includes(
      display.aodPosition as PortableAodPosition,
    ) ||
    typeof display.aodSize !== 'string' ||
    !PORTABLE_AOD_SIZES.includes(display.aodSize as PortableAodSize)
  ) {
    throw new Error('The backup contains invalid glanceable display settings.');
  }
  if (
    !isPlainObject(reviews) ||
    !hasExactKeys(reviews, ['weeklyNotificationEnabled']) ||
    typeof reviews.weeklyNotificationEnabled !== 'boolean'
  ) {
    throw new Error('The backup contains invalid review settings.');
  }
  let glucoseAlerts = DEFAULT_GLUCOSE_ALERT_PREFERENCES;
  if (value.version === PORTABLE_PREFERENCES_VERSION) {
    const alertValue = value.glucoseAlerts;
    if (
      !isPlainObject(alertValue) ||
      !hasExactKeys(alertValue, [
        'lowEnabled',
        'lowThresholdMmolL',
        'highEnabled',
        'highThresholdMmolL',
        'staleEnabled',
        'repeatMinutes',
      ])
    ) {
      throw new Error('The backup contains invalid glucose alert settings.');
    }
    glucoseAlerts = {
      enabled: false,
      lowEnabled: alertValue.lowEnabled as boolean,
      lowThresholdMmolL: alertValue.lowThresholdMmolL as number,
      highEnabled: alertValue.highEnabled as boolean,
      highThresholdMmolL: alertValue.highThresholdMmolL as number,
      staleEnabled: alertValue.staleEnabled as boolean,
      repeatMinutes:
        alertValue.repeatMinutes as GlucoseAlertPreferences['repeatMinutes'],
    };
    const alertError = validateGlucoseAlertPreferences(glucoseAlerts);
    if (alertError) {
      throw new Error(`The backup alert settings are invalid. ${alertError}`);
    }
  }

  return {
    version: PORTABLE_PREFERENCES_VERSION,
    glucoseAppearance: normalisedAppearance,
    glanceableDisplay: {
      lockScreenVisible: display.lockScreenVisible,
      aodPosition: display.aodPosition as PortableAodPosition,
      aodSize: display.aodSize as PortableAodSize,
    },
    insightReviews: {
      weeklyNotificationEnabled: reviews.weeklyNotificationEnabled,
    },
    glucoseAlerts: {
      lowEnabled: glucoseAlerts.lowEnabled,
      lowThresholdMmolL: glucoseAlerts.lowThresholdMmolL,
      highEnabled: glucoseAlerts.highEnabled,
      highThresholdMmolL: glucoseAlerts.highThresholdMmolL,
      staleEnabled: glucoseAlerts.staleEnabled,
      repeatMinutes: glucoseAlerts.repeatMinutes,
    },
  };
}
