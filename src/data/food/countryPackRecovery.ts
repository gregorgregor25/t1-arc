/** Match only names emitted by the country-pack installer, never a prefix alone. */
export function isOwnedCountryPackFileName(name: string, packIds: readonly string[]): boolean {
  return packIds.some((id) => /^[a-z0-9-]+$/.test(id) && new RegExp(
    `^${id}-(?:[0-9]{13}-[a-z0-9]{0,8}\\.pending\\.(?:db|gz)|[a-f0-9]{16}-[0-9]{13}-[a-z0-9]{0,8}\\.db)$`,
  ).test(name));
}

/** The registry is authoritative, including disabled rows kept for safe recovery. */
export function abandonedCountryPackFileNames(
  fileNames: readonly string[],
  packIds: readonly string[],
  protectedFileNames: readonly string[],
): string[] {
  const protectedNames = new Set(protectedFileNames);
  return [...new Set(fileNames)].filter((name) =>
    !protectedNames.has(name) && isOwnedCountryPackFileName(name, packIds));
}
