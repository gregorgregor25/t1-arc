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
import {
  DEFAULT_GLUCOSE_ALARM_CONFIGURATION,
  GLUCOSE_ALARM_SOUND_KEYS,
  type GlucoseAlarmConfiguration,
  validateGlucoseAlarmConfiguration,
} from './glucoseAlarms';
import { AppThemeMode, isAppThemeMode } from './themePreference';
import {
  isT1ArcRegionalProfile,
  type T1ArcRegionalProfile,
} from './regionalProfile';

export const PORTABLE_PREFERENCES_VERSION = 7;

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

/**
 * Native alarm choices. The master switch and the sound switch are never part
 * of a backup, so a restore always leaves alarms off for the user to review.
 * Custom sounds are references only (id and name); audio files stay local.
 */
export type PortableGlucoseAlarmConfiguration = Omit<GlucoseAlarmConfiguration, 'enabled' | 'audioEnabled'>;
export interface PortableGlucoseAlarmSettings {
  configuration: PortableGlucoseAlarmConfiguration;
  customSounds: { id: string; name: string }[];
}

export const PORTABLE_GLUCOSE_ALARM_CONFIGURATION_KEYS: readonly (keyof PortableGlucoseAlarmConfiguration)[] =
  (Object.keys(DEFAULT_GLUCOSE_ALARM_CONFIGURATION) as (keyof GlucoseAlarmConfiguration)[])
    .filter((key): key is keyof PortableGlucoseAlarmConfiguration => key !== 'enabled' && key !== 'audioEnabled');

export interface PortableTreatmentProfile {
  schemaVersion: 1;
  source: 'manual';
  confirmedAt: number;
  carbRatioSchedule: {
    id: string;
    startMinute: number;
    gramsPerUnit: number;
  }[];
}

export const PORTABLE_PREFERENCE_GROUPS = [
  'glucoseAppearance',
  'glanceableDisplay',
  'insightReviews',
  'glucoseAlerts',
  'themeMode',
  'healthGoals',
  'treatmentProfile',
  'regionalProfile',
  'glucoseAlarms',
] as const;

export type PortablePreferenceGroup =
  (typeof PORTABLE_PREFERENCE_GROUPS)[number];

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
    /** Null only when an older backup did not contain an explicit schedule. */
    reviewWeekday: number | null;
    reviewHour: number | null;
    reviewMinute: number | null;
  };
  glucoseAlerts: PortableGlucoseAlertSettings;
  /** Null only when an older backup did not contain a theme choice. */
  themeMode: AppThemeMode | null;
  /** Null only when an older backup did not contain health goals. */
  healthGoals: {
    dailyStepGoal: number | null;
  } | null;
  /** Null when no manual insulin-to-carb ratios were saved. */
  treatmentProfile: PortableTreatmentProfile | null;
  /** Null only when an older backup did not contain regional preferences. */
  regionalProfile: T1ArcRegionalProfile | null;
  /** Null when this phone has no saved native alarm choices, or in backups before version 7. */
  glucoseAlarms: PortableGlucoseAlarmSettings | null;
}

const includedGroupsByPreferences = new WeakMap<
  PortablePreferences,
  readonly PortablePreferenceGroup[]
>();

/**
 * Returns only the groups that were present in the source backup. Validation
 * upgrades old preference payloads for safe internal use, so this sidecar
 * keeps legacy v1/v2 omissions distinct without adding fields to the backup.
 */
export function getIncludedPortablePreferenceGroups(
  preferences: PortablePreferences,
): readonly PortablePreferenceGroup[] {
  const included = includedGroupsByPreferences.get(preferences);
  if (included) return included;
  const groups: PortablePreferenceGroup[] = [
    'glucoseAppearance',
    'glanceableDisplay',
    'insightReviews',
    'glucoseAlerts',
  ];
  if (preferences.themeMode !== null) groups.push('themeMode');
  if (preferences.healthGoals !== null) groups.push('healthGoals');
  if (preferences.treatmentProfile !== null) groups.push('treatmentProfile');
  if (preferences.regionalProfile !== null) groups.push('regionalProfile');
  if (preferences.glucoseAlarms !== null) groups.push('glucoseAlarms');
  return groups;
}

function validatePortableGlucoseAlarms(value: unknown): PortableGlucoseAlarmSettings {
  const invalid = () => new Error('The backup contains invalid glucose alarm settings.');
  if (!isPlainObject(value) || !hasExactKeys(value, ['configuration', 'customSounds'])) throw invalid();
  const configuration = value.configuration;
  if (!isPlainObject(configuration) || !hasExactKeys(configuration, PORTABLE_GLUCOSE_ALARM_CONFIGURATION_KEYS)) throw invalid();
  const error = validateGlucoseAlarmConfiguration({ ...configuration, enabled: false, audioEnabled: false });
  if (error) throw new Error(`The backup alarm settings are invalid. ${error}`);
  const sounds = value.customSounds;
  if (!Array.isArray(sounds) || sounds.length > 5) throw invalid();
  const customSounds = sounds.map((sound) => {
    if (
      !isPlainObject(sound) ||
      !hasExactKeys(sound, ['id', 'name']) ||
      typeof sound.id !== 'string' ||
      !/^custom:[a-f0-9-]{36}$/.test(sound.id) ||
      typeof sound.name !== 'string' ||
      sound.name.length > 160
    ) {
      throw invalid();
    }
    return { id: sound.id, name: sound.name };
  });
  const normalisedConfiguration = Object.fromEntries(
    PORTABLE_GLUCOSE_ALARM_CONFIGURATION_KEYS.map((key) => [key, configuration[key]]),
  ) as unknown as PortableGlucoseAlarmConfiguration;
  // Only references to sounds that a level actually uses are kept.
  const used = new Set(Object.values(GLUCOSE_ALARM_SOUND_KEYS).map((key) => normalisedConfiguration[key]));
  return { configuration: normalisedConfiguration, customSounds: customSounds.filter((sound) => used.has(sound.id)) };
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
  if (
    !isPlainObject(value) ||
    (value.version !== 1 &&
      value.version !== 2 &&
      value.version !== 3 &&
      value.version !== 4 &&
      value.version !== 5 &&
      value.version !== 6 &&
      value.version !== 7)
  ) {
    throw new Error('The backup preferences use an unsupported format.');
  }
  const inheritedGroups = includedGroupsByPreferences.get(
    value as unknown as PortablePreferences,
  );
  const sourceVersion = value.version;
  const expectedKeys =
    value.version === 1
      ? ['version', 'glucoseAppearance', 'glanceableDisplay', 'insightReviews']
      : value.version === 2
        ? [
            'version',
            'glucoseAppearance',
            'glanceableDisplay',
            'insightReviews',
            'glucoseAlerts',
          ]
        : value.version === 3
          ? [
              'version',
              'glucoseAppearance',
              'glanceableDisplay',
              'insightReviews',
              'glucoseAlerts',
              'themeMode',
              'healthGoals',
            ]
          : value.version === 4
            ? [
                'version',
                'glucoseAppearance',
                'glanceableDisplay',
                'insightReviews',
                'glucoseAlerts',
                'themeMode',
                'healthGoals',
                'treatmentProfile',
              ]
            : value.version <= 6
              ? [
                  'version',
                  'glucoseAppearance',
                  'glanceableDisplay',
                  'insightReviews',
                  'glucoseAlerts',
                  'themeMode',
                  'healthGoals',
                  'treatmentProfile',
                  'regionalProfile',
                ]
              : [
                  'version',
                  'glucoseAppearance',
                  'glanceableDisplay',
                  'insightReviews',
                  'glucoseAlerts',
                  'themeMode',
                  'healthGoals',
                  'treatmentProfile',
                  'regionalProfile',
                  'glucoseAlarms',
                ];
  if (!hasExactKeys(value, expectedKeys)) {
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
    !hasExactKeys(display, ['lockScreenVisible', 'aodPosition', 'aodSize']) ||
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
  const reviewKeys =
    sourceVersion >= 6
      ? [
          'weeklyNotificationEnabled',
          'reviewWeekday',
          'reviewHour',
          'reviewMinute',
        ]
      : ['weeklyNotificationEnabled'];
  const reviewRecord = isPlainObject(reviews) ? reviews : undefined;
  const inheritedLegacyTiming =
    inheritedGroups !== undefined &&
    reviewRecord?.reviewWeekday === null &&
    reviewRecord.reviewHour === null &&
    reviewRecord.reviewMinute === null;
  if (
    !isPlainObject(reviews) ||
    !hasExactKeys(reviews, reviewKeys) ||
    typeof reviews.weeklyNotificationEnabled !== 'boolean' ||
    (sourceVersion >= 6 &&
      !inheritedLegacyTiming &&
      (!Number.isInteger(reviews.reviewWeekday) ||
        Number(reviews.reviewWeekday) < 0 ||
        Number(reviews.reviewWeekday) > 6 ||
        !Number.isInteger(reviews.reviewHour) ||
        Number(reviews.reviewHour) < 0 ||
        Number(reviews.reviewHour) > 23 ||
        !Number.isInteger(reviews.reviewMinute) ||
        Number(reviews.reviewMinute) < 0 ||
        Number(reviews.reviewMinute) > 59))
  ) {
    throw new Error('The backup contains invalid review settings.');
  }
  let glucoseAlerts = DEFAULT_GLUCOSE_ALERT_PREFERENCES;
  if (value.version >= 2) {
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

  let themeMode: AppThemeMode | null = null;
  let healthGoals: PortablePreferences['healthGoals'] = null;
  if (value.version >= 3) {
    if (value.themeMode !== null && !isAppThemeMode(value.themeMode)) {
      throw new Error('The backup contains an invalid theme preference.');
    }
    themeMode = value.themeMode as AppThemeMode | null;
    if (value.healthGoals !== null) {
      if (
        !isPlainObject(value.healthGoals) ||
        !hasExactKeys(value.healthGoals, ['dailyStepGoal']) ||
        (value.healthGoals.dailyStepGoal !== null &&
          (typeof value.healthGoals.dailyStepGoal !== 'number' ||
            !Number.isFinite(value.healthGoals.dailyStepGoal) ||
            !Number.isInteger(value.healthGoals.dailyStepGoal) ||
            value.healthGoals.dailyStepGoal < 500 ||
            value.healthGoals.dailyStepGoal > 100_000))
      ) {
        throw new Error('The backup contains an invalid daily step goal.');
      }
      healthGoals = {
        dailyStepGoal: value.healthGoals.dailyStepGoal,
      };
    }
  }

  let treatmentProfile: PortableTreatmentProfile | null = null;
  if (value.version >= 4) {
    const profile = value.treatmentProfile;
    if (profile !== null) {
      if (
        !isPlainObject(profile) ||
        !hasExactKeys(profile, [
          'schemaVersion',
          'source',
          'confirmedAt',
          'carbRatioSchedule',
        ]) ||
        profile.schemaVersion !== 1 ||
        profile.source !== 'manual' ||
        !Number.isSafeInteger(profile.confirmedAt) ||
        Number(profile.confirmedAt) <= 0 ||
        !Array.isArray(profile.carbRatioSchedule) ||
        profile.carbRatioSchedule.length > 12
      ) {
        throw new Error('The backup contains an invalid diabetes profile.');
      }
      const starts = new Set<number>();
      const carbRatioSchedule = profile.carbRatioSchedule.map((segment) => {
        if (
          !isPlainObject(segment) ||
          !hasExactKeys(segment, ['id', 'startMinute', 'gramsPerUnit']) ||
          typeof segment.id !== 'string' ||
          !segment.id.trim() ||
          segment.id.length > 80 ||
          !Number.isInteger(segment.startMinute) ||
          Number(segment.startMinute) < 0 ||
          Number(segment.startMinute) > 1_439 ||
          typeof segment.gramsPerUnit !== 'number' ||
          !Number.isFinite(segment.gramsPerUnit) ||
          segment.gramsPerUnit < 1 ||
          segment.gramsPerUnit > 100 ||
          starts.has(Number(segment.startMinute))
        ) {
          throw new Error('The backup contains an invalid insulin-to-carb ratio.');
        }
        starts.add(Number(segment.startMinute));
        return {
          id: segment.id,
          startMinute: Number(segment.startMinute),
          gramsPerUnit: Math.round(segment.gramsPerUnit * 10) / 10,
        };
      });
      carbRatioSchedule.sort((left, right) => left.startMinute - right.startMinute);
      treatmentProfile = {
        schemaVersion: 1,
        source: 'manual',
        confirmedAt: Number(profile.confirmedAt),
        carbRatioSchedule,
      };
    }
  }

  let regionalProfile: T1ArcRegionalProfile | null = null;
  if (value.version >= 5) {
    if (value.regionalProfile !== null) {
      if (!isT1ArcRegionalProfile(value.regionalProfile)) {
        throw new Error('The backup contains invalid regional settings.');
      }
      regionalProfile = value.regionalProfile;
    }
  }

  let glucoseAlarms: PortableGlucoseAlarmSettings | null = null;
  if (value.version >= 7 && value.glucoseAlarms !== null) {
    glucoseAlarms = validatePortableGlucoseAlarms(value.glucoseAlarms);
  }

  const normalised: PortablePreferences = {
    version: PORTABLE_PREFERENCES_VERSION,
    glucoseAppearance: normalisedAppearance,
    glanceableDisplay: {
      lockScreenVisible: display.lockScreenVisible,
      aodPosition: display.aodPosition as PortableAodPosition,
      aodSize: display.aodSize as PortableAodSize,
    },
    insightReviews: {
      weeklyNotificationEnabled: reviews.weeklyNotificationEnabled,
      reviewWeekday:
        sourceVersion >= 6 && !inheritedLegacyTiming
          ? Number(reviews.reviewWeekday)
          : null,
      reviewHour:
        sourceVersion >= 6 && !inheritedLegacyTiming
          ? Number(reviews.reviewHour)
          : null,
      reviewMinute:
        sourceVersion >= 6 && !inheritedLegacyTiming
          ? Number(reviews.reviewMinute)
          : null,
    },
    glucoseAlerts: {
      lowEnabled: glucoseAlerts.lowEnabled,
      lowThresholdMmolL: glucoseAlerts.lowThresholdMmolL,
      highEnabled: glucoseAlerts.highEnabled,
      highThresholdMmolL: glucoseAlerts.highThresholdMmolL,
      staleEnabled: glucoseAlerts.staleEnabled,
      repeatMinutes: glucoseAlerts.repeatMinutes,
    },
    themeMode,
    healthGoals,
    treatmentProfile,
    regionalProfile,
    glucoseAlarms,
  };
  const includedGroups: PortablePreferenceGroup[] = inheritedGroups
    ? [...inheritedGroups]
    : ['glucoseAppearance', 'glanceableDisplay', 'insightReviews'];
  if (!inheritedGroups && sourceVersion >= 2) {
    includedGroups.push('glucoseAlerts');
  }
  if (
    !inheritedGroups &&
    sourceVersion >= 3 &&
    themeMode !== null
  ) {
    includedGroups.push('themeMode');
  }
  if (
    !inheritedGroups &&
    sourceVersion >= 3 &&
    healthGoals !== null
  ) {
    includedGroups.push('healthGoals');
  }
  if (
    !inheritedGroups &&
    sourceVersion >= 4
  ) {
    includedGroups.push('treatmentProfile');
  }
  if (!inheritedGroups && sourceVersion >= 5 && regionalProfile !== null) {
    includedGroups.push('regionalProfile');
  }
  if (!inheritedGroups && sourceVersion >= 7 && glucoseAlarms !== null) {
    includedGroups.push('glucoseAlarms');
  }
  includedGroupsByPreferences.set(normalised, Object.freeze(includedGroups));
  return normalised;
}
