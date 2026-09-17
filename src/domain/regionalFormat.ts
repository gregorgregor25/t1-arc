import { MG_DL_PER_MMOL_L } from './models';
import {
  getCachedDateTimeFormat,
  getCachedNumberFormat,
} from './intlFormatterCache';
import type { T1ArcRegionalDefaults } from './regionalProfile';

export type RegionalFormatOptions = Pick<
  T1ArcRegionalDefaults,
  'locale' | 'timeZone' | 'glucoseUnit' | 'measurementSystem' | 'energyUnit'
>;

function boundedDecimals(value: number, maximumFractionDigits = 2) {
  if (!Number.isFinite(value)) return maximumFractionDigits;
  return Math.max(0, Math.min(2, maximumFractionDigits));
}

export function formatRegionalNumber(
  value: number,
  locale: string,
  options: Intl.NumberFormatOptions = {},
) {
  const requestedMaximum = boundedDecimals(
    value,
    options.maximumFractionDigits ?? 2,
  );
  const requestedMinimum = Math.min(
    requestedMaximum,
    boundedDecimals(value, options.minimumFractionDigits ?? 0),
  );
  return getCachedNumberFormat(locale, {
    ...options,
    minimumFractionDigits: requestedMinimum,
    maximumFractionDigits: requestedMaximum,
  }).format(value);
}

/**
 * Locale-aware replacement for presentation-only `toFixed` calls.
 *
 * This deliberately controls display precision only. Callers must continue to
 * retain and calculate with the original canonical number.
 */
export function formatRegionalFixedNumber(
  value: number,
  locale: string,
  fractionDigits: number,
) {
  return formatRegionalNumber(value, locale, {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  });
}

export function glucoseUnitLabel(
  unit: T1ArcRegionalDefaults['glucoseUnit'],
): 'mg/dL' | 'mmol/L' {
  return unit === 'mgDl' ? 'mg/dL' : 'mmol/L';
}

export function glucoseUnitSpokenLabel(
  unit: T1ArcRegionalDefaults['glucoseUnit'],
) {
  return unit === 'mgDl' ? 'milligrams per decilitre' : 'millimoles per litre';
}

export function glucoseFromMmolL(
  mmolL: number,
  unit: T1ArcRegionalDefaults['glucoseUnit'],
) {
  return unit === 'mgDl' ? Math.round(mmolL * MG_DL_PER_MMOL_L) : mmolL;
}

export function glucoseToMmolL(
  value: number,
  unit: T1ArcRegionalDefaults['glucoseUnit'],
) {
  return unit === 'mgDl' ? value / MG_DL_PER_MMOL_L : value;
}

export function formatGlucose(
  mmolL: number,
  settings: Pick<T1ArcRegionalDefaults, 'locale' | 'glucoseUnit'>,
  options: { withUnit?: boolean; signed?: boolean } = {},
) {
  const value = glucoseFromMmolL(mmolL, settings.glucoseUnit);
  const decimals = settings.glucoseUnit === 'mgDl' ? 0 : 1;
  const numeric = formatRegionalNumber(value, settings.locale, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
    signDisplay: options.signed ? 'exceptZero' : 'auto',
  });
  return options.withUnit === false
    ? numeric
    : `${numeric} ${glucoseUnitLabel(settings.glucoseUnit)}`;
}

export function formatGlucoseAccessible(
  mmolL: number,
  settings: Pick<T1ArcRegionalDefaults, 'locale' | 'glucoseUnit'>,
) {
  return `${formatGlucose(mmolL, settings, { withUnit: false })} ${glucoseUnitSpokenLabel(
    settings.glucoseUnit,
  )}`;
}

export function formatWeight(
  kilograms: number,
  settings: Pick<T1ArcRegionalDefaults, 'locale' | 'measurementSystem'>,
) {
  const imperial = settings.measurementSystem === 'imperial';
  const value = imperial ? kilograms * 2.2046226218 : kilograms;
  return `${formatRegionalNumber(value, settings.locale, {
    maximumFractionDigits: 2,
  })} ${imperial ? 'lb' : 'kg'}`;
}

export function formatDistance(
  metres: number,
  settings: Pick<T1ArcRegionalDefaults, 'locale' | 'measurementSystem'>,
) {
  const imperial = settings.measurementSystem === 'imperial';
  const metricMetres = !imperial && Math.abs(metres) < 1_000;
  const value = imperial ? metres / 1609.344 : metricMetres ? metres : metres / 1000;
  return `${formatRegionalNumber(value, settings.locale, {
    maximumFractionDigits: 2,
  })} ${imperial ? 'mi' : metricMetres ? 'm' : 'km'}`;
}

export function formatElevation(
  metres: number,
  settings: Pick<T1ArcRegionalDefaults, 'locale' | 'measurementSystem'>,
) {
  const imperial = settings.measurementSystem === 'imperial';
  const value = imperial ? metres * 3.280839895 : metres;
  return `${formatRegionalNumber(value, settings.locale, {
    maximumFractionDigits: 2,
  })} ${imperial ? 'ft' : 'm'}`;
}

export function formatHeight(
  metres: number,
  settings: Pick<T1ArcRegionalDefaults, 'locale' | 'measurementSystem'>,
) {
  if (settings.measurementSystem !== 'imperial') {
    return `${formatRegionalNumber(metres * 100, settings.locale, {
      maximumFractionDigits: 1,
    })} cm`;
  }
  const totalInches = Math.round(metres * 39.37007874);
  const feet = formatRegionalNumber(
    Math.floor(totalInches / 12),
    settings.locale,
    { maximumFractionDigits: 0 },
  );
  const inches = formatRegionalNumber(totalInches % 12, settings.locale, {
    maximumFractionDigits: 0,
  });
  return `${feet} ft ${inches} in`;
}

export function formatVolumeLitres(
  litres: number,
  settings: Pick<T1ArcRegionalDefaults, 'locale' | 'measurementSystem'>,
) {
  const imperial = settings.measurementSystem === 'imperial';
  const value = imperial ? litres * 33.814022702 : litres;
  return `${formatRegionalNumber(value, settings.locale, {
    maximumFractionDigits: 2,
  })} ${imperial ? 'fl oz' : 'L'}`;
}

export function formatSpeed(
  metresPerSecond: number,
  settings: Pick<T1ArcRegionalDefaults, 'locale' | 'measurementSystem'>,
) {
  const imperial = settings.measurementSystem === 'imperial';
  const value = metresPerSecond * (imperial ? 2.2369362921 : 3.6);
  return `${formatRegionalNumber(value, settings.locale, {
    maximumFractionDigits: 2,
  })} ${imperial ? 'mph' : 'km/h'}`;
}

export function formatTemperature(
  celsius: number,
  settings: Pick<T1ArcRegionalDefaults, 'locale' | 'measurementSystem'>,
) {
  const imperial = settings.measurementSystem === 'imperial';
  const value = imperial ? (celsius * 9) / 5 + 32 : celsius;
  return `${formatRegionalNumber(value, settings.locale, {
    maximumFractionDigits: 1,
  })} °${imperial ? 'F' : 'C'}`;
}

export function formatEnergy(
  kcal: number,
  settings: Pick<T1ArcRegionalDefaults, 'locale' | 'energyUnit'>,
) {
  const useKilojoules = settings.energyUnit === 'kJ';
  const value = useKilojoules ? kcal * 4.184 : kcal;
  return `${formatRegionalNumber(value, settings.locale, {
    maximumFractionDigits: 0,
  })} ${useKilojoules ? 'kJ' : 'kcal'}`;
}

export function formatEnergyPerDay(
  kcal: number,
  settings: Pick<T1ArcRegionalDefaults, 'locale' | 'energyUnit'>,
) {
  return `${formatEnergy(kcal, settings)}/day`;
}

export function formatRegionalDateTime(
  timestamp: number,
  settings: Pick<T1ArcRegionalDefaults, 'locale' | 'timeZone'>,
  options: Intl.DateTimeFormatOptions = {},
) {
  return getCachedDateTimeFormat(settings.locale, {
    timeZone: settings.timeZone,
    dateStyle: 'medium',
    timeStyle: 'short',
    ...options,
  }).format(timestamp);
}
