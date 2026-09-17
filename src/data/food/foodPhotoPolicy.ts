export const MAX_FOOD_PHOTO_BYTES = 256 * 1024;
export type FoodPhotoOwner = { kind: 'food' | 'meal' | 'recipe'; id: string };
export const FOOD_PHOTO_COLUMNS = { food: 'food_id', meal: 'log_id', recipe: 'recipe_id' } as const;

/** Validate bounded, metadata-free JPEGs before storage or backup restoration. */
export function validateFoodPhoto(value: unknown): string {
  if (typeof value !== 'string' || !value.startsWith('data:image/jpeg;base64,')) throw new Error('Use a JPEG photo taken in the app.');
  const encoded = value.slice(23);
  if (encoded.length > Math.ceil(MAX_FOOD_PHOTO_BYTES / 3) * 4 || encoded.length % 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) throw new Error('The photo is too large or unreadable.');
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const bytes: number[] = [];
  let bits = 0, accumulator = 0;
  for (const char of encoded.replace(/=+$/, '')) {
    accumulator = (accumulator << 6) | alphabet.indexOf(char); bits += 6;
    if (bits >= 8) { bits -= 8; bytes.push((accumulator >> bits) & 255); }
  }
  if (bytes.length > MAX_FOOD_PHOTO_BYTES || bytes[0] !== 255 || bytes[1] !== 216 || bytes.at(-2) !== 255 || bytes.at(-1) !== 217) throw new Error('The photo is unreadable.');
  let dimensions = false;
  for (let offset = 2; offset + 4 < bytes.length;) {
    if (bytes[offset++] !== 255) throw new Error('The photo is unreadable.');
    while (bytes[offset] === 255) offset++;
    const marker = bytes[offset++]!;
    if (marker === 218) break;
    const length = bytes[offset]! * 256 + bytes[offset + 1]!;
    if (length < 2 || offset + length > bytes.length) throw new Error('The photo is unreadable.');
    // EXIF and comments must not survive the native re-encoding step.
    if (marker === 225 || marker === 254) throw new Error('Remove photo metadata before saving.');
    if ([192, 193, 194].includes(marker)) {
      const height = bytes[offset + 3]! * 256 + bytes[offset + 4]!;
      const width = bytes[offset + 5]! * 256 + bytes[offset + 6]!;
      if (length < 8 || width < 1 || height < 1 || width > 1024 || height > 1024) throw new Error('The photo dimensions are unsupported.');
      dimensions = true;
    }
    offset += length;
  }
  if (!dimensions) throw new Error('The photo is unreadable.');
  return value;
}

export function isProductPhotoUrl(value: string) {
  try { const url = new URL(value); return url.protocol === 'https:' && url.hostname === 'images.openfoodfacts.org' && !url.username && !url.password && !url.port; } catch { return false; }
}
