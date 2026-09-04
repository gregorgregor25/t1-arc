import {
  getCachedNumberFormat,
  INTL_FORMATTER_CACHE_LIMIT,
} from './intlFormatterCache';

export interface NormalizedRegionalNumberInput {
  /** A grouping-free ASCII decimal suitable for diagnostics and native bridges. */
  normalized: string;
  /** The canonical JavaScript number. Callers still own range/unit validation. */
  value: number;
}

/** Formats a number for editing, without grouping or changing its canonical unit. */
export function formatRegionalNumberInput(
  value: number,
  locale: string,
  maximumFractionDigits = 20,
) {
  const options: Intl.NumberFormatOptions = {
    maximumFractionDigits: Math.max(0, Math.min(20, maximumFractionDigits)),
    useGrouping: false,
  };
  try {
    return getCachedNumberFormat(locale, options).format(value);
  } catch {
    return getCachedNumberFormat('en-US', options).format(value);
  }
}

interface RegionalNumberSymbols {
  decimal: string;
  digitMap: ReadonlyMap<string, string>;
  group: string;
  primaryGroupSize: number;
  secondaryGroupSize: number;
}

const symbolCache = new Map<string, RegionalNumberSymbols>();
const BIDI_MARKS = /[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/g;
const SPACE_GROUPS = /[\s\u00a0\u202f]/g;
const MINUS_SIGNS = /[\u2212\u2010-\u2015\ufe63\uff0d]/g;

function normalizedSymbol(value: string) {
  return value.normalize('NFKC').replace(BIDI_MARKS, '');
}

function regionalNumberSymbols(locale: string): RegionalNumberSymbols {
  const cached = symbolCache.get(locale);
  if (cached) return cached;

  let formatter: Intl.NumberFormat;
  try {
    formatter = getCachedNumberFormat(locale, {
      maximumFractionDigits: 1,
      useGrouping: true,
    });
  } catch {
    formatter = getCachedNumberFormat('en-US', {
      maximumFractionDigits: 1,
      useGrouping: true,
    });
  }

  const parts = formatter.formatToParts(1_234_567_890_123.4);
  const integerParts = parts
    .filter((part) => part.type === 'integer')
    .map((part) => normalizedSymbol(part.value));
  const primaryGroupSize = integerParts.at(-1)?.length || 3;
  const secondaryGroupSize = integerParts.at(-2)?.length || primaryGroupSize;
  const digitFormatter = getCachedNumberFormat(formatter.resolvedOptions().locale, {
    maximumFractionDigits: 0,
    useGrouping: false,
  });
  const digitMap = new Map<string, string>();
  for (let digit = 0; digit <= 9; digit += 1) {
    digitMap.set(normalizedSymbol(digitFormatter.format(digit)), String(digit));
  }

  const symbols: RegionalNumberSymbols = {
    decimal: normalizedSymbol(
      parts.find((part) => part.type === 'decimal')?.value ?? '.',
    ),
    digitMap,
    group: normalizedSymbol(
      parts.find((part) => part.type === 'group')?.value ?? ',',
    ),
    primaryGroupSize,
    secondaryGroupSize,
  };
  symbolCache.set(locale, symbols);
  if (symbolCache.size > INTL_FORMATTER_CACHE_LIMIT) {
    const oldest = symbolCache.keys().next().value;
    if (oldest !== undefined) symbolCache.delete(oldest);
  }
  return symbols;
}

function replaceRegionalDigits(
  value: string,
  digitMap: ReadonlyMap<string, string>,
) {
  let result = value;
  for (const [regionalDigit, asciiDigit] of digitMap) {
    if (regionalDigit !== asciiDigit) {
      result = result.split(regionalDigit).join(asciiDigit);
    }
  }
  return result;
}

function separatorCount(value: string, separator: string) {
  if (!separator) return 0;
  return value.split(separator).length - 1;
}

function validGroupedInteger(
  value: string,
  separator: string,
  symbols: RegionalNumberSymbols,
) {
  if (!separator || !value.includes(separator)) return false;
  const unsigned = /^[+-]/.test(value) ? value.slice(1) : value;
  const groups = unsigned.split(separator);
  if (
    groups.length < 2 ||
    groups.some((group) => !/^\d+$/.test(group)) ||
    groups.at(-1)!.length !== symbols.primaryGroupSize
  ) {
    return false;
  }
  for (let index = 1; index < groups.length - 1; index += 1) {
    if (groups[index]!.length !== symbols.secondaryGroupSize) return false;
  }
  return groups[0]!.length >= 1 && groups[0]!.length <= symbols.secondaryGroupSize;
}

function decimalSeparator(
  value: string,
  symbols: RegionalNumberSymbols,
): string | undefined | null {
  const localeDecimalCount = separatorCount(value, symbols.decimal);
  if (localeDecimalCount > 1) return null;
  if (localeDecimalCount === 1) return symbols.decimal;

  const dotCount = separatorCount(value, '.');
  const commaCount = separatorCount(value, ',');
  if (dotCount && commaCount) {
    return value.lastIndexOf('.') > value.lastIndexOf(',') ? '.' : ',';
  }

  const candidate = dotCount ? '.' : commaCount ? ',' : undefined;
  if (!candidate) return undefined;
  const count = candidate === '.' ? dotCount : commaCount;
  if (candidate === symbols.group && validGroupedInteger(value, candidate, symbols)) {
    return undefined;
  }
  return count === 1 ? candidate : null;
}

function stripIntegerGrouping(
  value: string,
  decimal: string | undefined,
  symbols: RegionalNumberSymbols,
) {
  const westernGrouping =
    decimal === '.' ? [','] : decimal === ',' ? ['.'] : ['.', ','];
  const candidates = new Set(
    [symbols.group, ...westernGrouping].filter(Boolean),
  );
  const used = [...candidates].filter((separator) => value.includes(separator));
  if (used.length > 1) return null;
  if (!used.length) {
    if (/^[+-]?\d+$/.test(value)) return value;
    if (decimal && /^[+-]?$/.test(value)) return `${value}0`;
    return null;
  }
  const separator = used[0]!;
  return validGroupedInteger(value, separator, symbols)
    ? value.split(separator).join('')
    : null;
}

/**
 * Converts a regional decimal input into a grouping-free ASCII number without
 * changing its unit or storage semantics. Arabic/Persian digits, regional
 * decimal/group separators and pasted Western digits are supported.
 *
 * A missing result means the whole input was not a valid finite decimal. This
 * intentionally rejects partial parses such as `12 mg` and scientific notation.
 */
export function normalizeRegionalNumberInput(
  input: string,
  locale: string,
): NormalizedRegionalNumberInput | undefined {
  const symbols = regionalNumberSymbols(locale);
  const value = replaceRegionalDigits(
    normalizedSymbol(input).trim(),
    symbols.digitMap,
  )
    .replace(MINUS_SIGNS, '-')
    .replace(SPACE_GROUPS, '');
  if (!value || !/\d/.test(value)) return undefined;

  const decimal = decimalSeparator(value, symbols);
  if (decimal === null) return undefined;
  const pieces = decimal ? value.split(decimal) : [value];
  if (pieces.length > 2) return undefined;
  const integer = stripIntegerGrouping(pieces[0]!, decimal, symbols);
  const fraction = pieces[1];
  if (integer === null || (fraction !== undefined && !/^\d*$/.test(fraction))) {
    return undefined;
  }

  let normalized = `${integer}${fraction !== undefined ? `.${fraction}` : ''}`;
  if (!/^[+-]?\d+(?:\.\d*)?$/.test(normalized)) return undefined;

  const number = Number(normalized);
  if (!Number.isFinite(number)) return undefined;
  return {
    normalized: normalized.endsWith('.') ? normalized.slice(0, -1) : normalized,
    value: number,
  };
}
