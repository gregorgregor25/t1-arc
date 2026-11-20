/**
 * Option lists for the Region page pickers. Both depend on Intl features that
 * a JavaScript engine may not provide (Hermes support varies by version), so
 * each returns undefined when unavailable and the UI falls back to a validated
 * text field.
 */

export interface PickerOption {
  value: string;
  label: string;
}

type IntlWithSupportedValues = typeof Intl & {
  supportedValuesOf?: (key: "timeZone") => string[];
};

/** Readable label for a time-zone identifier, e.g. "America/New York". */
export function timeZoneLabel(zone: string) {
  return zone.replace(/_/g, " ");
}

export function timeZoneOptions(): PickerOption[] | undefined {
  try {
    const zones = (Intl as IntlWithSupportedValues).supportedValuesOf?.("timeZone");
    if (!zones?.length) return undefined;
    return zones.map((zone) => ({ value: zone, label: timeZoneLabel(zone) }));
  } catch {
    return undefined;
  }
}

/**
 * Codes that Intl may name but that are not countries or territories people
 * live in (groupings, test codes, unknown) or are withdrawn ISO codes.
 */
const EXCLUDED_REGION_CODES = new Set([
  "EU", "EZ", "UN", "QO", "XA", "XB", "ZZ",
  "AN", "BU", "CS", "DD", "FX", "NT", "SU", "TP", "YD", "YU", "ZR",
]);

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

export function countryOptions(locale: string): PickerOption[] | undefined {
  let names: Intl.DisplayNames;
  try {
    names = new Intl.DisplayNames([locale, "en"], { type: "region", fallback: "none" });
  } catch {
    return undefined;
  }
  const seen = new Set<string>();
  const options: PickerOption[] = [];
  try {
    for (const first of LETTERS) {
      for (const second of LETTERS) {
        const code = `${first}${second}`;
        if (EXCLUDED_REGION_CODES.has(code)) continue;
        const name = names.of(code);
        if (!name || name === code || seen.has(name)) continue;
        seen.add(name);
        options.push({ value: code, label: name });
      }
    }
  } catch {
    return undefined;
  }
  if (options.length < 100) return undefined;
  return options.sort((a, b) => a.label.localeCompare(b.label, locale));
}

/** Case- and accent-insensitive filter on label and value. */
export function filterPickerOptions(
  options: readonly PickerOption[],
  query: string,
): PickerOption[] {
  const fold = (value: string) =>
    value
      .toLocaleLowerCase("en-GB")
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[_/]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  const needle = fold(query);
  if (!needle) return [...options];
  return options.filter(
    (option) => fold(option.label).includes(needle) || fold(option.value).includes(needle),
  );
}
