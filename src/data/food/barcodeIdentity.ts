/** GTINs identify the same trade item when padded on the left to 14 digits.
 * Short, nonstandard identifiers are preserved; UPC-E expansion is not padding.
 * This does not validate checksums or turn approximate matches into identities.
 */
export function canonicalFoodBarcode(value: string): string {
  const digits = value.replace(/[\s-]+/g, '');
  return /^\d{12,14}$/.test(digits) ? digits.padStart(14, '0') : digits;
}

export function equivalentFoodBarcodes(value: string): string[] {
  const digits = value.replace(/[\s-]+/g, '');
  if (!/^\d{12,14}$/.test(digits)) return [digits];
  const canonical = canonicalFoodBarcode(digits);
  const alternatives = [digits, canonical];
  if (canonical.startsWith('0')) alternatives.push(canonical.slice(1));
  if (canonical.startsWith('00')) alternatives.push(canonical.slice(2));
  return [...new Set(alternatives)];
}
