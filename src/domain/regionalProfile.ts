import { getCachedDateTimeFormat } from './intlFormatterCache';

export type T1ArcRegion = 'automatic' | 'europe' | 'us' | 'japan' | 'other';
export type T1ArcGlucoseUnit = 'automatic' | 'mmolL' | 'mgDl';
export type T1ArcMeasurementSystem = 'automatic' | 'metric' | 'imperial';
export type T1ArcEnergyUnit = 'automatic' | 'kcal' | 'kJ';

export interface T1ArcRegionalProfile {
  schemaVersion: 2;
  /** Broad connection preset. Individual source-account regions remain independent. */
  region: T1ArcRegion;
  /** ISO 3166-1 alpha-2 code, or automatic from the device locale. */
  countryCode: 'automatic' | string;
  /** BCP-47 language tag, or automatic from the app/device locale. */
  languageTag: 'automatic' | string;
  /** IANA timezone used for calendar-day analysis, or automatic from the device. */
  analysisTimeZone: 'automatic' | string;
  /** When true, travel changes the analysis timezone with the device. */
  followDeviceTimeZone: boolean;
  glucoseUnit: T1ArcGlucoseUnit;
  measurementSystem: T1ArcMeasurementSystem;
  energyUnit: T1ArcEnergyUnit;
  /** ISO country code for reviewed care pathways, or generic when unavailable. */
  clinicalJurisdiction: 'automatic' | 'generic' | string;
}

interface LegacyRegionalProfileV1 {
  schemaVersion: 1;
  region: T1ArcRegion;
  glucoseUnit: T1ArcGlucoseUnit;
}

export interface T1ArcRegionalDefaults {
  region: Exclude<T1ArcRegion, 'automatic'>;
  countryCode: string;
  locale: string;
  timeZone: string;
  glucoseUnit: Exclude<T1ArcGlucoseUnit, 'automatic'>;
  measurementSystem: Exclude<T1ArcMeasurementSystem, 'automatic'>;
  energyUnit: Exclude<T1ArcEnergyUnit, 'automatic'>;
  clinicalJurisdiction: string;
  firstDayOfWeek: 0 | 1 | 6;
  libreTopLevelDomain: 'io' | 'us';
  dexcomRegion: 'international' | 'us' | 'japan';
  medtrumRegion: 'eu' | 'fr';
  glookoRegion: 'eu' | 'us';
}

export interface T1ArcDeviceRegionalContext {
  locale: string;
  timeZone: string;
}

export const DEFAULT_REGIONAL_PROFILE: T1ArcRegionalProfile = {
  schemaVersion: 2,
  region: 'automatic',
  countryCode: 'automatic',
  languageTag: 'automatic',
  analysisTimeZone: 'automatic',
  followDeviceTimeZone: true,
  glucoseUnit: 'automatic',
  measurementSystem: 'automatic',
  energyUnit: 'automatic',
  clinicalJurisdiction: 'automatic',
};

const REGIONS = new Set<T1ArcRegion>([
  'automatic',
  'europe',
  'us',
  'japan',
  'other',
]);
const UNITS = new Set<T1ArcGlucoseUnit>(['automatic', 'mmolL', 'mgDl']);
const MEASUREMENT_SYSTEMS = new Set<T1ArcMeasurementSystem>([
  'automatic',
  'metric',
  'imperial',
]);
const ENERGY_UNITS = new Set<T1ArcEnergyUnit>(['automatic', 'kcal', 'kJ']);

const EUROPEAN_COUNTRIES = new Set([
  'AL', 'AD', 'AT', 'BY', 'BE', 'BA', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE',
  'FI', 'FR', 'DE', 'GR', 'HU', 'IS', 'IE', 'IT', 'XK', 'LV', 'LI', 'LT',
  'LU', 'MT', 'MD', 'MC', 'ME', 'NL', 'MK', 'NO', 'PL', 'PT', 'RO', 'RU',
  'SM', 'RS', 'SK', 'SI', 'ES', 'SE', 'CH', 'TR', 'UA', 'GB', 'VA',
]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]) {
  const actual = Object.keys(value);
  return actual.length === keys.length && actual.every((key) => keys.includes(key));
}

export function normaliseCountryCode(value: string | undefined) {
  const country = value?.trim().toUpperCase() ?? '';
  return /^[A-Z]{2}$/.test(country) ? country : undefined;
}

export function localeCountryCode(locale: string) {
  try {
    const region = new Intl.Locale(locale.replace(/_/g, '-')).region;
    return normaliseCountryCode(region);
  } catch {
    const parts = locale.replace(/_/g, '-').split('-');
    return normaliseCountryCode(
      parts.find((part, index) => index > 0 && /^[A-Z]{2}$/i.test(part)),
    );
  }
}

function isLanguageTag(value: string) {
  const normalised = value.trim().replace(/_/g, '-');
  if (
    !normalised ||
    normalised.length > 255 ||
    !/^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/.test(normalised)
  ) {
    return false;
  }
  try {
    if (typeof Intl.Locale === 'function') {
      void new Intl.Locale(normalised);
      return true;
    }
    if (typeof Intl.getCanonicalLocales === 'function') {
      Intl.getCanonicalLocales(normalised);
      return true;
    }
  } catch {
    return false;
  }
  // Hermes versions without the optional Intl.Locale/canonicalisation APIs
  // still need to persist the app's structurally valid BCP-47 choices.
  return true;
}

export function isIanaTimeZone(value: string) {
  try {
    getCachedDateTimeFormat('en', { timeZone: value }).format(0);
    return true;
  } catch {
    return false;
  }
}

export function isT1ArcRegionalProfile(value: unknown): value is T1ArcRegionalProfile {
  if (!isPlainObject(value)) return false;
  const candidate = value as Partial<T1ArcRegionalProfile>;
  const countryValid =
    candidate.countryCode === 'automatic' ||
    normaliseCountryCode(candidate.countryCode) === candidate.countryCode;
  const languageValid =
    candidate.languageTag === 'automatic' ||
    (typeof candidate.languageTag === 'string' && isLanguageTag(candidate.languageTag));
  const timezoneValid =
    candidate.analysisTimeZone === 'automatic' ||
    (typeof candidate.analysisTimeZone === 'string' && isIanaTimeZone(candidate.analysisTimeZone));
  const jurisdictionValid =
    candidate.clinicalJurisdiction === 'automatic' ||
    candidate.clinicalJurisdiction === 'generic' ||
    normaliseCountryCode(candidate.clinicalJurisdiction) === candidate.clinicalJurisdiction;
  return (
    candidate.schemaVersion === 2 &&
    REGIONS.has(candidate.region as T1ArcRegion) &&
    countryValid &&
    languageValid &&
    timezoneValid &&
    typeof candidate.followDeviceTimeZone === 'boolean' &&
    UNITS.has(candidate.glucoseUnit as T1ArcGlucoseUnit) &&
    MEASUREMENT_SYSTEMS.has(candidate.measurementSystem as T1ArcMeasurementSystem) &&
    ENERGY_UNITS.has(candidate.energyUnit as T1ArcEnergyUnit) &&
    jurisdictionValid &&
    exactKeys(candidate as Record<string, unknown>, [
      'schemaVersion',
      'region',
      'countryCode',
      'languageTag',
      'analysisTimeZone',
      'followDeviceTimeZone',
      'glucoseUnit',
      'measurementSystem',
      'energyUnit',
      'clinicalJurisdiction',
    ])
  );
}

function isLegacyProfile(value: unknown): value is LegacyRegionalProfileV1 {
  if (!isPlainObject(value)) return false;
  return (
    value.schemaVersion === 1 &&
    REGIONS.has(value.region as T1ArcRegion) &&
    UNITS.has(value.glucoseUnit as T1ArcGlucoseUnit) &&
    exactKeys(value, ['schemaVersion', 'region', 'glucoseUnit'])
  );
}

export function migrateRegionalProfile(value: unknown): T1ArcRegionalProfile | undefined {
  if (isT1ArcRegionalProfile(value)) return value;
  if (!isLegacyProfile(value)) return undefined;
  return {
    ...DEFAULT_REGIONAL_PROFILE,
    region: value.region,
    glucoseUnit: value.glucoseUnit,
  };
}

export function deviceRegionalContext(): T1ArcDeviceRegionalContext {
  const resolved = Intl.DateTimeFormat().resolvedOptions();
  return {
    locale: resolved.locale || 'en-GB',
    timeZone: resolved.timeZone || 'Europe/London',
  };
}

function regionFromCountry(country: string | undefined, timeZone: string) {
  if (country === 'US') return 'us' as const;
  if (country === 'JP') return 'japan' as const;
  if ((country && EUROPEAN_COUNTRIES.has(country)) || timeZone.startsWith('Europe/')) {
    return 'europe' as const;
  }
  return 'other' as const;
}

export function inferT1ArcRegion(locale: string, timeZone: string) {
  return regionFromCountry(localeCountryCode(locale), timeZone);
}

function fallbackCountry(region: Exclude<T1ArcRegion, 'automatic'>) {
  if (region === 'us') return 'US';
  if (region === 'japan') return 'JP';
  if (region === 'europe') return 'GB';
  return 'ZZ';
}

function firstDayOfWeek(locale: string, countryCode: string): 0 | 1 | 6 {
  try {
    const localeObject = new Intl.Locale(locale) as Intl.Locale & {
      weekInfo?: { firstDay?: number };
      getWeekInfo?(): { firstDay?: number };
    };
    const info = localeObject.weekInfo ?? localeObject.getWeekInfo?.();
    if (info?.firstDay === 7) return 0;
    if (info?.firstDay === 6) return 6;
    if (info?.firstDay === 1) return 1;
  } catch {
    // Fall through to a conservative CLDR-style country default.
  }
  return new Set(['US', 'CA', 'JP']).has(countryCode) ? 0 : 1;
}

export function resolveRegionalDefaults(
  profile: T1ArcRegionalProfile = DEFAULT_REGIONAL_PROFILE,
  context: T1ArcDeviceRegionalContext = deviceRegionalContext(),
): T1ArcRegionalDefaults {
  const deviceCountry = localeCountryCode(context.locale);
  const preliminaryRegion =
    profile.region === 'automatic'
      ? inferT1ArcRegion(context.locale, context.timeZone)
      : profile.region;
  const explicitCountry =
    profile.countryCode === 'automatic'
      ? undefined
      : normaliseCountryCode(profile.countryCode);
  const countryCode =
    explicitCountry ??
    (deviceCountry &&
    (profile.region === 'automatic' ||
      regionFromCountry(deviceCountry, context.timeZone) === preliminaryRegion)
      ? deviceCountry
      : fallbackCountry(preliminaryRegion));
  const region =
    profile.region === 'automatic'
      ? regionFromCountry(countryCode, context.timeZone)
      : preliminaryRegion;
  const locale =
    profile.languageTag === 'automatic' ? context.locale : profile.languageTag;
  const timeZone =
    profile.followDeviceTimeZone || profile.analysisTimeZone === 'automatic'
      ? context.timeZone
      : profile.analysisTimeZone;
  const glucoseUnit =
    profile.glucoseUnit === 'automatic'
      ? region === 'us' || region === 'japan'
        ? 'mgDl'
        : 'mmolL'
      : profile.glucoseUnit;
  const measurementSystem =
    profile.measurementSystem === 'automatic'
      ? countryCode === 'US'
        ? 'imperial'
        : 'metric'
      : profile.measurementSystem;
  const energyUnit =
    profile.energyUnit === 'automatic'
      ? new Set(['AU', 'NZ']).has(countryCode)
        ? 'kJ'
        : 'kcal'
      : profile.energyUnit;
  const clinicalJurisdiction =
    profile.clinicalJurisdiction === 'automatic'
      ? countryCode === 'ZZ'
        ? 'generic'
        : countryCode
      : profile.clinicalJurisdiction;
  return {
    region,
    countryCode,
    locale,
    timeZone,
    glucoseUnit,
    measurementSystem,
    energyUnit,
    clinicalJurisdiction,
    firstDayOfWeek: firstDayOfWeek(locale, countryCode),
    libreTopLevelDomain: region === 'us' ? 'us' : 'io',
    dexcomRegion:
      region === 'us' ? 'us' : region === 'japan' ? 'japan' : 'international',
    medtrumRegion: countryCode === 'FR' ? 'fr' : 'eu',
    glookoRegion: region === 'us' ? 'us' : 'eu',
  };
}

export function regionalProfileLabel(defaults: T1ArcRegionalDefaults) {
  if (defaults.countryCode !== 'ZZ') {
    try {
      const name = new Intl.DisplayNames([defaults.locale], { type: 'region' }).of(
        defaults.countryCode,
      );
      if (name) return name;
    } catch {
      // Use the stable fallback below on older runtimes.
    }
  }
  switch (defaults.region) {
    case 'europe':
      return 'UK & Europe';
    case 'us':
      return 'United States';
    case 'japan':
      return 'Japan';
    case 'other':
      return 'Other region';
  }
}
