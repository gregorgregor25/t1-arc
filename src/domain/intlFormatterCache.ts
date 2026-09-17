export const INTL_FORMATTER_CACHE_LIMIT = 64;

const numberFormatters = new Map<string, Intl.NumberFormat>();
const dateTimeFormatters = new Map<string, Intl.DateTimeFormat>();

function optionsKey(options: object) {
  return JSON.stringify(
    Object.entries(options)
      .filter(([, value]) => value !== undefined)
      // These are option names, not display text. Locale-aware collation on
      // every cache lookup allocates heavily in Android's Intl implementation.
      // This key is process-local; the formatter still receives its locale.
      .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0),
  );
}

function cachedFormatter<T>(
  cache: Map<string, T>,
  key: string,
  create: () => T,
) {
  const existing = cache.get(key);
  if (existing) {
    cache.delete(key);
    cache.set(key, existing);
    return existing;
  }
  const created = create();
  cache.set(key, created);
  if (cache.size > INTL_FORMATTER_CACHE_LIMIT) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  return created;
}

export function getCachedNumberFormat(
  locale: string,
  options: Intl.NumberFormatOptions = {},
) {
  const key = `${locale}\u0000${optionsKey(options)}`;
  return cachedFormatter(
    numberFormatters,
    key,
    () => new Intl.NumberFormat(locale, options),
  );
}

export function getCachedDateTimeFormat(
  locale: string,
  options: Intl.DateTimeFormatOptions = {},
) {
  const key = `${locale}\u0000${optionsKey(options)}`;
  return cachedFormatter(
    dateTimeFormatters,
    key,
    () => new Intl.DateTimeFormat(locale, options),
  );
}
