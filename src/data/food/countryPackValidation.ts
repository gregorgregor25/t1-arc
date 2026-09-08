import type { FoodCandidate, FoodProviderId, NutrientQuality } from './types';

export interface CountryFoodPackManifest {
  id: string;
  provider: FoodProviderId;
  countryCode: string;
  version: string;
  label: string;
  sourceUrl: string;
  sourceSha256: string;
  licence: string;
  licenceUrl: string;
  attribution: string;
  carbohydrateDefinition: 'available' | 'total' | 'by-difference' | 'unknown';
  carbohydrateNote: string;
  schemaVersion: number;
  dataRevision?: number;
  foodCount: number;
  bundled: boolean;
  optional?: boolean;
  assetCompression?: 'gzip';
  assetFileName?: string;
  compressedSha256?: string;
  compressedChunkSha256?: readonly string[];
  fileName: string;
  sizeBytes: number;
  compressedBytes: number;
  sha256: string;
  chunkSize: number;
  chunkSha256: readonly string[];
}

export interface CountryPackRow {
  source_id: string;
  names_json: string;
  aliases_json: string;
  brand: string | null;
  barcode: string | null;
  carbs: number | null;
  kcal: number | null;
  protein: number | null;
  fat: number | null;
  fibre: number | null;
  sugars: number | null;
  saturated_fat: number | null;
  quality_json: string;
  serving_amount: number | null;
  serving_unit: 'g' | 'ml' | null;
  serving_label: string | null;
  energy_definition: 'reported' | 'atwater-specific' | 'atwater-general';
  basis_unit?: 'g' | 'ml';
  nutrient_conflicts_json?: string;
}

export function throwIfPackCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) {
    const error = new Error('Food catalogue preparation cancelled.');
    error.name = 'AbortError';
    throw error;
  }
}

/** Only compile-time trusted manifests are accepted by the installer. */
export function validateCountryPackManifest(pack: CountryFoodPackManifest): void {
  const hash = /^[a-f0-9]{64}$/;
  if (!/^[a-z0-9-]+$/.test(pack.id) || !/^[a-z0-9.-]+\.db$/.test(pack.fileName)
    || pack.schemaVersion !== 1 || !Number.isSafeInteger(pack.foodCount) || pack.foodCount < 1
    || !Number.isSafeInteger(pack.sizeBytes) || pack.sizeBytes < 4096 || pack.sizeBytes > 2 ** 31
    || pack.chunkSize !== 1024 * 1024 || !hash.test(pack.sha256) || !hash.test(pack.sourceSha256)
    || pack.chunkSha256.length !== Math.ceil(pack.sizeBytes / pack.chunkSize)
    || pack.chunkSha256.some((value) => !hash.test(value))) {
    throw new Error('Unsupported food catalogue manifest.');
  }
}

/** Verify one bounded chunk at a time, including length/order and final EOF. */
export async function verifyCountryPackChunks(
  pack: CountryFoodPackManifest,
  read: (length: number) => Uint8Array<ArrayBuffer>,
  digest: (bytes: Uint8Array<ArrayBuffer>) => Promise<string>,
  options: { signal?: AbortSignal; onProgress?: (progress: number) => void } = {},
): Promise<void> {
  validateCountryPackManifest(pack);
  let readBytes = 0;
  for (const expected of pack.chunkSha256) {
    throwIfPackCancelled(options.signal);
    const length = Math.min(pack.chunkSize, pack.sizeBytes - readBytes);
    const bytes = read(length);
    if (bytes.length !== length || await digest(bytes) !== expected) {
      throw new Error('Food catalogue is incomplete or its checksum does not match.');
    }
    readBytes += bytes.length;
    options.onProgress?.(readBytes / pack.sizeBytes);
  }
  if (read(1).length !== 0) throw new Error('Unexpected extra food catalogue data.');
  throwIfPackCancelled(options.signal);
}

export function countryPackQuery(query: string): string | null {
  const words = query.slice(0, 256).normalize('NFKD').replace(/\p{M}/gu, '')
    .toLowerCase().match(/[\p{L}\p{N}]+/gu)?.slice(0, 8);
  if (!words?.length || words.join('').length < 2) return null;
  return words.map((word) => `"${word.slice(0, 60)}"*`).join(' AND ');
}

/** Streaming inflation retains the deflate window and bounded chunks, never the DB. */
export async function inflateCountryPackGzip(
  pack: CountryFoodPackManifest,
  read: (length: number) => Uint8Array<ArrayBuffer>,
  write: (chunk: Uint8Array) => void,
  options: { signal?: AbortSignal; onProgress?: (progress: number) => void } = {},
): Promise<void> {
  const { Gunzip } = await import('fflate');
  let written = 0;
  const unzip = new Gunzip((chunk) => {
    written += chunk.length;
    if (written > pack.sizeBytes) throw new Error('Expanded catalogue exceeds its declared size.');
    write(chunk);
  });
  let consumed = 0;
  while (consumed < pack.compressedBytes) {
    throwIfPackCancelled(options.signal);
    const chunk = read(Math.min(16384, pack.compressedBytes-consumed));
    if (!chunk.length) throw new Error('Incomplete compressed catalogue.');
    consumed += chunk.length;
    unzip.push(chunk, consumed === pack.compressedBytes);
    if (consumed % (256*1024) === 0) {
      options.onProgress?.(consumed/pack.compressedBytes);
      await new Promise<void>((resolve) => { setTimeout(resolve, 0); });
    }
  }
  if (written !== pack.sizeBytes) throw new Error('Expanded catalogue size does not match.');
  throwIfPackCancelled(options.signal);
}

function boundedStrings(value: unknown, limit: number): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string' && item.length > 0 && item.length <= 500).slice(0, limit);
}

export function countryPackRowToFood(row: CountryPackRow, pack: CountryFoodPackManifest, locale = 'en'): FoodCandidate | null {
  try {
    const names: unknown = JSON.parse(row.names_json);
    if (!names || typeof names !== 'object' || Array.isArray(names)) return null;
    const languages = names as Record<string, unknown>;
    const allNames = boundedStrings(Object.values(languages), 8);
    const language = locale.toLowerCase().split('-')[0] ?? 'en';
    const localized = languages[language];
    const name = typeof localized === 'string' && localized.length <= 500 ? localized : allNames[0];
    if (!name || !row.source_id || row.source_id.length > 100) return null;
    const basisUnit = row.basis_unit ?? 'g';
    if (basisUnit !== 'g' && basisUnit !== 'ml') return null;
    const values = [row.carbs, row.kcal, row.protein, row.fat, row.fibre, row.sugars, row.saturated_fat];
    if (values.every((v) => v === null) || values.some((v, index) => v !== null
      && (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > (index === 1 ? 1100 : basisUnit === 'ml' ? 200 : 100.1)))) return null;
    const quality: unknown = JSON.parse(row.quality_json);
    if (!Array.isArray(quality) || quality.length !== 7 || quality.some((q) => !['reported', 'trace', 'missing'].includes(q))) return null;
    if (quality.some((q, index) => (values[index] !== null) !== (q === 'reported'))) return null;
    if (!['reported', 'atwater-specific', 'atwater-general'].includes(row.energy_definition)) return null;
    const conflictKeys = ['carbs', 'kcal', 'protein', 'fat', 'fibre', 'sugars', 'saturated_fat'] as const;
    const conflicts: unknown = row.nutrient_conflicts_json === undefined ? [] : JSON.parse(row.nutrient_conflicts_json);
    if (!Array.isArray(conflicts) || conflicts.length > conflictKeys.length || conflicts.some((key) =>
      !conflictKeys.includes(key) || row[key as typeof conflictKeys[number]] !== null)) return null;
    const conflictLabels: Record<string, string> = { carbs: 'carbohydrate', kcal: 'energy', protein: 'protein', fat: 'fat', fibre: 'fibre', sugars: 'sugars', saturated_fat: 'saturated fat' };
    const conflictNote = conflicts.length ? `Conflicting source ${conflicts.map((key: string) => conflictLabels[key]).join(', ')} values were left unknown.` : '';
    const aliases = [...new Set([...allNames, ...boundedStrings(JSON.parse(row.aliases_json), 8)])].slice(0, 16);
    // A source portion can default only within its explicitly declared basis unit.
    const validServing = typeof row.serving_amount === 'number' && Number.isFinite(row.serving_amount)
      && row.serving_amount > 0 && row.serving_amount <= 5000 && row.serving_unit === basisUnit;
    // A dated source snapshot does not become fresh merely because it was installed.
    const snapshotObservedAt = /^\d{4}-\d{2}-\d{2}$/.test(pack.version)
      ? Date.parse(`${pack.version}T00:00:00.000Z`) : Number.NaN;
    return {
      id: `${pack.provider}:${row.source_id}`, provider: pack.provider, externalId: row.source_id,
      name, brand: row.brand || undefined, barcode: row.barcode || undefined,
      basisAmount: 100, basisUnit,
      nutritionPerBasis: {
        carbohydrateGrams: row.carbs ?? undefined, energyKcal: row.kcal ?? undefined,
        proteinGrams: row.protein ?? undefined, fatGrams: row.fat ?? undefined,
        fibreGrams: row.fibre ?? undefined, sugarsGrams: row.sugars ?? undefined,
        saturatedFatGrams: row.saturated_fat ?? undefined,
      },
      nutritionQuality: {
        carbohydrate: quality[0] as NutrientQuality, energy: quality[1] as NutrientQuality,
        protein: quality[2] as NutrientQuality, fat: quality[3] as NutrientQuality,
        fibre: quality[4] as NutrientQuality, sugars: quality[5] as NutrientQuality,
        saturatedFat: quality[6] as NutrientQuality,
      },
      nutrientDefinitions: { carbohydrate: pack.carbohydrateDefinition, energy: row.energy_definition, note: [pack.carbohydrateNote, conflictNote].filter(Boolean).join(' ') },
      defaultServingAmount: validServing ? row.serving_amount! : 100,
      defaultServingUnit: validServing ? row.serving_unit! : basisUnit,
      servingLabel: validServing && row.serving_label ? row.serving_label : undefined,
      sourceLabel: pack.label, sourceUrl: pack.sourceUrl,
      catalogueObservedAt: Number.isFinite(snapshotObservedAt) ? snapshotObservedAt : undefined,
      rawPayload: { countryPackId: pack.id, version: pack.version, searchAliases: aliases, sourceNutrientConflicts: conflicts },
    };
  } catch {
    return null;
  }
}

export function countryPackMatchEvidence(food: FoodCandidate): { fields: readonly string[] } {
  const payload = food.rawPayload;
  if (!payload || typeof payload !== 'object' || !('searchAliases' in payload)) return { fields: [] };
  return { fields: boundedStrings(payload.searchAliases, 16) };
}

/** Pointer publication is the final step; any earlier failure keeps the old pack. */
export async function installVerifiedCountryPack<T>(steps: {
  prepare: () => Promise<T>;
  verify: (staged: T) => Promise<void>;
  activate: (staged: T) => Promise<void>;
  discard: (staged: T) => Promise<void>;
}, signal?: AbortSignal): Promise<void> {
  throwIfPackCancelled(signal);
  const staged = await steps.prepare();
  try {
    throwIfPackCancelled(signal);
    await steps.verify(staged);
    throwIfPackCancelled(signal);
    await steps.activate(staged);
  } finally {
    await steps.discard(staged);
  }
}
