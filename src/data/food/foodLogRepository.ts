import type { SQLiteBindValue, SQLiteDatabase } from 'expo-sqlite';

import {
  foodLogTitle,
  revisedFoodLog,
} from './foodLogEditing';
import {
  FoodCandidate,
  FoodLog,
  FoodLogDraft,
  FoodLogItemSnapshot,
  FoodMealPreset,
  FoodNutrition,
  FoodNutritionQuality,
  FoodProviderId,
  FoodRecipe,
  FoodRecipeDraft,
} from './types';
import {
  nutritionForFoodAmount,
  totalNutrition,
} from './nutrition';
import { adjustedFoodLogPortions } from './portionAdjustments';
import {
  FOOD_PROVIDER_RETENTION_POLICIES,
  assertFoodHistoryRetentionAllowed,
  foodCatalogueRegionalContextFromPayload,
  retainedFoodCatalogData,
  type FoodCatalogueRegionalContext,
} from './providerRetention';
import { servingAmountFromRawPayload } from './servings';
import {
  openT1ArcDatabase,
  withT1ArcTransaction,
} from '@/data/persistence/t1arcDatabase';
import {
  acquireLocalDataWriteLease,
  assertLocalDataWriteLeaseInTransaction,
  type LocalDataWriteLease,
} from '@/data/privacy/localDataWriteEpoch';
import {
  advanceInsightInputGenerationInTransaction,
  clearSavedInsightReportsInTransaction,
} from '@/data/insights/insightReportRepository';
import { MealEvent, TimeRange } from '@/domain/models';

export const FOOD_LOG_SOURCE_ID = 't1arc-food';

export interface FoodLogMutationOptions {
  /**
   * Derived insight state is invalidated inside the primary food transaction so
   * a successful save cannot leave a stale report marked as current. Creating a
   * meal retains the last readable report; editing evidence removes its cached
   * human-readable copy.
   */
  insightInvalidation?: 'mark-dirty' | 'clear-saved-reports';
}

async function invalidateFoodInsightsInTransaction(
  database: SQLiteDatabase,
  invalidation: FoodLogMutationOptions['insightInvalidation'],
) {
  if (invalidation === 'clear-saved-reports') {
    await clearSavedInsightReportsInTransaction(database);
  } else if (invalidation === 'mark-dirty') {
    await advanceInsightInputGenerationInTransaction(database);
  }
}

function isMutableRegionalFoodProvider(provider: FoodProviderId) {
  return provider === 'open-food-facts' || provider === 'usda-fdc';
}

interface CatalogRow {
  id: string;
  provider: FoodProviderId;
  external_id: string;
  barcode: string | null;
  name: string;
  brand: string | null;
  image_url: string | null;
  basis_amount: number;
  basis_unit: 'g' | 'ml';
  default_serving_amount: number | null;
  default_serving_unit: 'g' | 'ml' | null;
  last_portion_amount: number | null;
  last_portion_unit: 'g' | 'ml' | null;
  carbohydrate_grams: number | null;
  energy_kcal: number | null;
  protein_grams: number | null;
  fat_grams: number | null;
  fibre_grams: number | null;
  sugars_grams: number | null;
  saturated_fat_grams: number | null;
  nutrition_quality_json: string;
  source_label: string;
  source_url: string | null;
  raw_payload_json: string | null;
  cached_at_ms?: number;
}

interface FoodSearchCatalogRow extends CatalogRow {
  cached_at_ms: number;
  is_favorite: number;
  use_count: number;
  last_used_at_ms: number | null;
}

interface BarcodeCatalogRow extends CatalogRow {
  cached_at_ms: number;
  expires_at_ms: number | null;
}

export interface FoodBarcodeCacheEntry {
  food: FoodCandidate;
  status: 'fresh' | 'stale';
  cachedAt: number;
  expiresAt?: number;
  regionalMatch: boolean;
}

export interface StoredFoodIdentity {
  id: string;
  provider: FoodProviderId;
  externalId: string;
}

export interface StoredFoodSearchEntry {
  food: FoodCandidate;
  cachedAt: number;
  isFavourite: boolean;
  useCount: number;
  lastUsedAt?: number;
}

interface RecentMealItemRow {
  log_id: string;
  title: string;
  meal_type: FoodLog['mealType'];
  timestamp_ms: number;
  is_favorite: number;
  log_carbohydrate_grams: number;
  log_energy_kcal: number | null;
  log_protein_grams: number | null;
  log_fat_grams: number | null;
  log_fibre_grams: number | null;
  log_sugars_grams: number | null;
  log_saturated_fat_grams: number | null;
  ordinal: number;
  catalog_id: string | null;
  provider: FoodProviderId;
  external_id: string;
  name_snapshot: string;
  brand_snapshot: string | null;
  barcode_snapshot: string | null;
  amount: number;
  unit: 'g' | 'ml';
  carbohydrate_grams: number | null;
  energy_kcal: number | null;
  protein_grams: number | null;
  fat_grams: number | null;
  fibre_grams: number | null;
  sugars_grams: number | null;
  saturated_fat_grams: number | null;
  source_label: string;
  source_url: string | null;
}

interface FoodLogItemRow extends RecentMealItemRow {
  item_id: string;
  context_event_id: string;
  created_at_ms: number;
}

interface RecipeItemRow {
  recipe_id: string;
  name: string;
  meal_type: FoodRecipe['mealType'];
  servings: number;
  is_favorite: number;
  created_at_ms: number;
  updated_at_ms: number;
  recipe_carbohydrate_grams: number;
  recipe_energy_kcal: number | null;
  recipe_protein_grams: number | null;
  recipe_fat_grams: number | null;
  recipe_fibre_grams: number | null;
  recipe_sugars_grams: number | null;
  recipe_saturated_fat_grams: number | null;
  ordinal: number;
  catalog_id: string | null;
  provider: FoodProviderId;
  external_id: string;
  name_snapshot: string;
  brand_snapshot: string | null;
  barcode_snapshot: string | null;
  amount: number;
  unit: 'g' | 'ml';
  carbohydrate_grams: number | null;
  energy_kcal: number | null;
  protein_grams: number | null;
  fat_grams: number | null;
  fibre_grams: number | null;
  sugars_grams: number | null;
  saturated_fat_grams: number | null;
  source_label: string;
  source_url: string | null;
}

function optional(value: number | null) {
  return value ?? undefined;
}

function nutritionFromRow(row: CatalogRow): FoodNutrition {
  return {
    carbohydrateGrams: optional(row.carbohydrate_grams),
    energyKcal: optional(row.energy_kcal),
    proteinGrams: optional(row.protein_grams),
    fatGrams: optional(row.fat_grams),
    fibreGrams: optional(row.fibre_grams),
    sugarsGrams: optional(row.sugars_grams),
    saturatedFatGrams: optional(row.saturated_fat_grams),
  };
}

function candidateFromRow(row: CatalogRow): FoodCandidate {
  let rawPayload: unknown;
  try {
    rawPayload = row.raw_payload_json
      ? (JSON.parse(row.raw_payload_json) as unknown)
      : undefined;
  } catch {
    rawPayload = undefined;
  }
  const defaultServingAmount =
    row.default_serving_amount ??
    servingAmountFromRawPayload(rawPayload, row.basis_unit) ??
    row.basis_amount;
  return {
    id: row.id,
    provider: row.provider,
    externalId: row.external_id,
    name: row.name,
    brand: row.brand ?? undefined,
    barcode: row.barcode ?? undefined,
    imageUrl: row.image_url ?? undefined,
    basisAmount: row.basis_amount,
    basisUnit: row.basis_unit,
    nutritionPerBasis: nutritionFromRow(row),
    nutritionQuality: JSON.parse(
      row.nutrition_quality_json,
    ) as FoodNutritionQuality,
    defaultServingAmount,
    defaultServingUnit: row.default_serving_unit ?? row.basis_unit,
    servingLabel:
      rawPayload &&
      typeof rawPayload === 'object' &&
      !Array.isArray(rawPayload) &&
      typeof (rawPayload as Record<string, unknown>).serving_size === 'string'
        ? String((rawPayload as Record<string, unknown>).serving_size).trim() ||
          undefined
        : undefined,
    lastPortionAmount: row.last_portion_amount ?? undefined,
    lastPortionUnit: row.last_portion_unit ?? undefined,
    sourceLabel: row.source_label,
    sourceUrl: row.source_url ?? undefined,
    catalogueObservedAt:
      isMutableRegionalFoodProvider(row.provider) &&
      Number.isFinite(row.cached_at_ms)
        ? row.cached_at_ms
        : undefined,
    rawPayload,
  };
}

function catalogueObservedAt(food: FoodCandidate, fallback: number) {
  const observedAt = food.catalogueObservedAt;
  if (isMutableRegionalFoodProvider(food.provider) && observedAt === undefined) {
    // An unknown provider fetch time must not become fresh merely because the
    // item was logged, favourited or restored. On conflict, zero is also the
    // signal to preserve the row's existing catalogue timestamps.
    return 0;
  }
  return observedAt !== undefined &&
    Number.isFinite(observedAt) &&
    observedAt > 0
    ? Math.min(observedAt, fallback)
    : fallback;
}

const FOOD_CATALOGUE_PROVIDER_COLUMNS = [
  'barcode',
  'name',
  'brand',
  'image_url',
  'basis_amount',
  'basis_unit',
  'default_serving_amount',
  'default_serving_unit',
  'carbohydrate_grams',
  'energy_kcal',
  'protein_grams',
  'fat_grams',
  'fibre_grams',
  'sugars_grams',
  'saturated_fat_grams',
  'nutrition_quality_json',
  'source_label',
  'source_url',
  'raw_payload_json',
  'cached_at_ms',
  'expires_at_ms',
] as const;

const FOOD_CATALOGUE_REFRESH_GUARD_SQL = `(
  excluded.provider NOT IN ('open-food-facts', 'usda-fdc')
  OR (
    excluded.cached_at_ms > 0
    AND excluded.cached_at_ms >= food_catalog_cache.cached_at_ms
  )
)`;

/** Provider content changes only with a demonstrably current observation. */
const FOOD_CATALOGUE_PROVIDER_UPDATE_SQL = FOOD_CATALOGUE_PROVIDER_COLUMNS.map(
  (column) =>
    `${column} = CASE
       WHEN ${FOOD_CATALOGUE_REFRESH_GUARD_SQL}
       THEN excluded.${column}
       ELSE food_catalog_cache.${column}
     END`,
).join(',\n       ');

function localId(prefix: string, timestamp: number) {
  const entropy = Math.random().toString(36).slice(2, 12);
  return `${prefix}:${timestamp}:${Date.now().toString(36)}-${entropy}`;
}

function nutritionColumns(nutrition: FoodNutrition) {
  return [
    nutrition.carbohydrateGrams ?? null,
    nutrition.energyKcal ?? null,
    nutrition.proteinGrams ?? null,
    nutrition.fatGrams ?? null,
    nutrition.fibreGrams ?? null,
    nutrition.sugarsGrams ?? null,
    nutrition.saturatedFatGrams ?? null,
  ] as const;
}

export function validateFoodLogDraft(draft: FoodLogDraft) {
  if (!Number.isFinite(draft.timestamp) || draft.timestamp <= 0) {
    throw new Error('Choose a valid meal date and time.');
  }
  if (!draft.items.length) {
    throw new Error('Add at least one food.');
  }
  if ((draft.title?.trim().length ?? 0) > 120) {
    throw new Error('Meal label must be 120 characters or fewer.');
  }
  for (const item of draft.items) {
    assertFoodHistoryRetentionAllowed(item.food);
    if (!Number.isFinite(item.amount) || item.amount <= 0 || item.amount > 10_000) {
      throw new Error('Each food amount must be between 0 and 10,000.');
    }
    if (item.food.nutritionPerBasis.carbohydrateGrams === undefined) {
      throw new Error(
        `${item.food.name} has no carbohydrate value. Enter it manually before saving.`,
      );
    }
  }
}

// Keep statements below SQLite's historical 999-variable builds as well as
// current Expo SQLite. A margin leaves room for future fixed parameters.
const SAFE_BATCH_SQL_VARIABLES = 900;
const FOOD_CATALOG_CACHE_BINDS_PER_ROW = 28;
const FOOD_LOG_ITEM_BINDS_PER_ROW = 20;
const FOOD_CATALOG_CACHE_BATCH_SIZE = Math.floor(
  SAFE_BATCH_SQL_VARIABLES / FOOD_CATALOG_CACHE_BINDS_PER_ROW,
);
const FOOD_LOG_ITEM_BATCH_SIZE = Math.floor(
  SAFE_BATCH_SQL_VARIABLES / FOOD_LOG_ITEM_BINDS_PER_ROW,
);
const FOOD_CATALOG_CACHE_VALUE_ROW_SQL = `(${[
  ...Array.from({ length: 26 }, () => '?'),
  '0',
  '?',
  '?',
].join(', ')})`;
const FOOD_LOG_ITEM_VALUE_ROW_SQL = `(${Array.from(
  { length: FOOD_LOG_ITEM_BINDS_PER_ROW },
  () => '?',
).join(', ')})`;

function cachedFoodBindValues(
  item: FoodLogDraft['items'][number],
  usedAt: number,
  incrementUseCount: boolean,
): SQLiteBindValue[] {
  const food = item.food;
  const cachedAt = catalogueObservedAt(food, usedAt);
  const retention = retainedFoodCatalogData(food, cachedAt);
  return [
    food.id,
    food.provider,
    food.externalId,
    food.barcode ?? null,
    food.name,
    food.brand ?? null,
    food.imageUrl ?? null,
    food.basisAmount,
    food.basisUnit,
    food.defaultServingAmount ?? food.basisAmount,
    food.defaultServingUnit ?? food.basisUnit,
    item.amount,
    item.unit,
    ...nutritionColumns(food.nutritionPerBasis),
    JSON.stringify(food.nutritionQuality),
    food.sourceLabel,
    food.sourceUrl ?? null,
    retention.rawPayloadJson,
    cachedAt,
    retention.expiresAt,
    incrementUseCount ? 1 : 0,
    usedAt,
  ];
}

/**
 * Duplicate catalogue IDs must cross a statement boundary so their last
 * portion and use-count effects retain the original item order exactly.
 */
function catalogCacheBatches(
  items: readonly FoodLogDraft['items'][number][],
) {
  const batches: FoodLogDraft['items'][number][][] = [];
  let batch: FoodLogDraft['items'][number][] = [];
  let ids = new Set<string>();
  const flush = () => {
    if (!batch.length) return;
    batches.push(batch);
    batch = [];
    ids = new Set<string>();
  };
  for (const item of items) {
    if (batch.length >= FOOD_CATALOG_CACHE_BATCH_SIZE || ids.has(item.food.id)) {
      flush();
    }
    batch.push(item);
    ids.add(item.food.id);
  }
  flush();
  return batches;
}

async function cacheLoggedFoods(
  database: SQLiteDatabase,
  items: readonly FoodLogDraft['items'][number][],
  usedAt: number,
  incrementUseCount: boolean,
) {
  for (const batch of catalogCacheBatches(items)) {
    const bindValues = batch.flatMap((item) =>
      cachedFoodBindValues(item, usedAt, incrementUseCount),
    );
    await database.runAsync(
      `INSERT INTO food_catalog_cache (
         id, provider, external_id, barcode, name, brand, image_url,
         basis_amount, basis_unit, default_serving_amount,
         default_serving_unit, last_portion_amount, last_portion_unit,
         carbohydrate_grams, energy_kcal,
         protein_grams, fat_grams, fibre_grams, sugars_grams,
         saturated_fat_grams, nutrition_quality_json, source_label,
         source_url, raw_payload_json, cached_at_ms, expires_at_ms,
         is_favorite, use_count, last_used_at_ms
       ) VALUES ${batch.map(() => FOOD_CATALOG_CACHE_VALUE_ROW_SQL).join(', ')}
       ON CONFLICT(id) DO UPDATE SET
         ${FOOD_CATALOGUE_PROVIDER_UPDATE_SQL},
         last_portion_amount = excluded.last_portion_amount,
         last_portion_unit = excluded.last_portion_unit,
         use_count = food_catalog_cache.use_count + excluded.use_count,
         last_used_at_ms = excluded.last_used_at_ms`,
      ...bindValues,
    );
  }
}

async function insertFoodLogItems(
  database: SQLiteDatabase,
  foodLogId: string,
  items: readonly FoodLogItemSnapshot[],
) {
  for (let start = 0; start < items.length; start += FOOD_LOG_ITEM_BATCH_SIZE) {
    const batch = items.slice(start, start + FOOD_LOG_ITEM_BATCH_SIZE);
    const bindValues = batch.flatMap((item, batchIndex): SQLiteBindValue[] => [
      item.id,
      foodLogId,
      start + batchIndex,
      item.foodId,
      item.provider,
      item.externalId,
      item.name,
      item.brand ?? null,
      item.barcode ?? null,
      item.amount,
      item.unit,
      ...nutritionColumns(item.nutrition),
      item.sourceLabel,
      item.sourceUrl ?? null,
    ]);
    await database.runAsync(
      `INSERT INTO food_log_items (
         id, food_log_id, ordinal, catalog_id, provider, external_id,
         name_snapshot, brand_snapshot, barcode_snapshot, amount, unit,
         carbohydrate_grams, energy_kcal, protein_grams, fat_grams,
         fibre_grams, sugars_grams, saturated_fat_grams,
         source_label, source_url
       ) VALUES ${batch.map(() => FOOD_LOG_ITEM_VALUE_ROW_SQL).join(', ')}`,
      ...bindValues,
    );
  }
}

async function insertFoodRecipeItems(
  database: SQLiteDatabase,
  recipeId: string,
  ingredients: readonly FoodLogDraft['items'][number][],
) {
  for (
    let start = 0;
    start < ingredients.length;
    start += FOOD_LOG_ITEM_BATCH_SIZE
  ) {
    const batch = ingredients.slice(start, start + FOOD_LOG_ITEM_BATCH_SIZE);
    const bindValues = batch.flatMap(
      (ingredient, batchIndex): SQLiteBindValue[] => {
        const index = start + batchIndex;
        return [
          `${recipeId}:item:${index}`,
          recipeId,
          index,
          ingredient.food.id,
          ingredient.food.provider,
          ingredient.food.externalId,
          ingredient.food.name,
          ingredient.food.brand ?? null,
          ingredient.food.barcode ?? null,
          ingredient.amount,
          ingredient.unit,
          ...nutritionColumns(nutritionForFoodAmount(ingredient)),
          ingredient.food.sourceLabel,
          ingredient.food.sourceUrl ?? null,
        ];
      },
    );
    await database.runAsync(
      `INSERT INTO food_recipe_items (
         id, recipe_id, ordinal, catalog_id, provider, external_id,
         name_snapshot, brand_snapshot, barcode_snapshot, amount, unit,
         carbohydrate_grams, energy_kcal, protein_grams, fat_grams,
         fibre_grams, sugars_grams, saturated_fat_grams,
         source_label, source_url
       ) VALUES ${batch.map(() => FOOD_LOG_ITEM_VALUE_ROW_SQL).join(', ')}`,
      ...bindValues,
    );
  }
}

export async function saveFoodLog(
  draft: FoodLogDraft,
  operationLease?: LocalDataWriteLease,
  options: FoodLogMutationOptions = {},
) {
  const writeLease = operationLease ?? await acquireLocalDataWriteLease();
  validateFoodLogDraft(draft);
  return withT1ArcTransaction(async (database) => {
    await assertLocalDataWriteLeaseInTransaction(database, writeLease);
    const result = await insertFoodLogDraftInTransaction(database, draft);
    await invalidateFoodInsightsInTransaction(
      database,
      options.insightInvalidation,
    );
    return result;
  });
}

export interface FoodLogInsertOptions {
  createdAt?: number;
  id?: string;
  contextEventId?: string;
  isFavorite?: boolean;
  cacheFoods?: boolean;
}

/** Transaction-scoped primitive used by single saves and atomic copy batches. */
export async function insertFoodLogDraftInTransaction(
  database: SQLiteDatabase,
  draft: FoodLogDraft,
  options: FoodLogInsertOptions = {},
) {
  validateFoodLogDraft(draft);
  const createdAt = options.createdAt ?? Date.now();
  const id = options.id ?? localId('food-log', draft.timestamp);
  const contextEventId =
    options.contextEventId ?? `${FOOD_LOG_SOURCE_ID}:meal:${id}`;
  const title = foodLogTitle(draft);
  const nutrition = totalNutrition(draft.items);
  const carbohydrateGrams = nutrition.carbohydrateGrams ?? 0;
  const itemSnapshots: FoodLogItemSnapshot[] = draft.items.map(
    (item, index) => ({
      id: `${id}:item:${index}`,
      foodId: item.food.id,
      provider: item.food.provider,
      externalId: item.food.externalId,
      name: item.food.name,
      brand: item.food.brand,
      barcode: item.food.barcode,
      amount: item.amount,
      unit: item.unit,
      nutrition: nutritionForFoodAmount(item),
      sourceLabel: item.food.sourceLabel,
      sourceUrl: item.food.sourceUrl,
    }),
  );

  if (options.cacheFoods !== false) {
    await cacheLoggedFoods(database, draft.items, createdAt, true);
  }

  await database.runAsync(
      `INSERT INTO context_events (
         id, source_id, origin, kind, start_ms, end_ms, title, meal_type,
         carbs_grams, energy_kcal, protein_grams, fat_grams, fibre_grams,
         sugars_grams, saturated_fat_grams, activity_type, duration_minutes,
         intensity, quality_percent, kilograms, amount, unit, recorded_at_ms,
         source_file, source_row
       ) VALUES (?, ?, 'manual', 'meal', ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?,
         NULL, NULL, NULL, NULL, NULL, NULL, NULL, ?, 'Food log', NULL)`,
      contextEventId,
      FOOD_LOG_SOURCE_ID,
      draft.timestamp,
      title,
      draft.mealType,
      ...nutritionColumns(nutrition),
      createdAt,
  );

  await database.runAsync(
      `INSERT INTO food_logs (
         id, context_event_id, timestamp_ms, meal_type, title,
         carbohydrate_grams, energy_kcal, protein_grams, fat_grams,
         fibre_grams, sugars_grams, saturated_fat_grams,
         created_at_ms, updated_at_ms, is_favorite
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      contextEventId,
      draft.timestamp,
      draft.mealType,
      title,
      ...nutritionColumns(nutrition),
      createdAt,
      createdAt,
      options.isFavorite ? 1 : 0,
  );

  await insertFoodLogItems(database, id, itemSnapshots);

  const event: MealEvent = {
    id: contextEventId,
    sourceId: FOOD_LOG_SOURCE_ID,
    sourceLabel: 'T1 Arc food log',
    origin: 'manual',
    kind: 'meal',
    start: draft.timestamp,
    title,
    mealType: draft.mealType,
    carbsGrams: carbohydrateGrams,
    energyKcal: nutrition.energyKcal,
    proteinGrams: nutrition.proteinGrams,
    fatGrams: nutrition.fatGrams,
    fibreGrams: nutrition.fibreGrams,
    sugarsGrams: nutrition.sugarsGrams,
    saturatedFatGrams: nutrition.saturatedFatGrams,
    nutritionDetail: 'itemized',
    items: itemSnapshots.map((item) => ({
      id: item.id,
      name: item.name,
      brand: item.brand,
      amount: item.amount,
      unit: item.unit,
      carbohydrateGrams: item.nutrition.carbohydrateGrams,
      energyKcal: item.nutrition.energyKcal,
      proteinGrams: item.nutrition.proteinGrams,
      fatGrams: item.nutrition.fatGrams,
      fibreGrams: item.nutrition.fibreGrams,
      sugarsGrams: item.nutrition.sugarsGrams,
      saturatedFatGrams: item.nutrition.saturatedFatGrams,
      sourceLabel: item.sourceLabel,
    })),
    recordedAt: createdAt,
    sourceFile: 'Food log',
  };
  const log: FoodLog = {
    id,
    contextEventId,
    timestamp: draft.timestamp,
    mealType: draft.mealType,
    title,
    nutrition,
    items: itemSnapshots,
    createdAt,
    ...(options.isFavorite ? { isFavorite: true } : {}),
  };
  return { event, log };
}

export async function getRecentFoods(limit = 12) {
  const database = await openT1ArcDatabase();
  const rows = await database.getAllAsync<CatalogRow>(
    `SELECT id, provider, external_id, barcode, name, brand, image_url,
       basis_amount, basis_unit, carbohydrate_grams, energy_kcal,
       default_serving_amount, default_serving_unit,
       last_portion_amount, last_portion_unit,
       protein_grams, fat_grams, fibre_grams, sugars_grams,
       saturated_fat_grams, nutrition_quality_json, source_label,
       source_url, raw_payload_json, cached_at_ms
     FROM food_catalog_cache
     WHERE last_used_at_ms IS NOT NULL
     ORDER BY last_used_at_ms DESC, use_count DESC
     LIMIT ?`,
    Math.max(0, Math.min(limit, 100)),
  );
  return rows.map(candidateFromRow);
}

export async function getFoodBarcodeCacheEntry(
  barcode: string,
  now = Date.now(),
  regionalContext?: FoodCatalogueRegionalContext,
): Promise<FoodBarcodeCacheEntry | undefined> {
  const database = await openT1ArcDatabase();
  const row = await database.getFirstAsync<BarcodeCatalogRow>(
    `SELECT id, provider, external_id, barcode, name, brand, image_url,
       basis_amount, basis_unit, carbohydrate_grams, energy_kcal,
       default_serving_amount, default_serving_unit,
       last_portion_amount, last_portion_unit,
       protein_grams, fat_grams, fibre_grams, sugars_grams,
       saturated_fat_grams, nutrition_quality_json, source_label,
       source_url, raw_payload_json, cached_at_ms, expires_at_ms
     FROM food_catalog_cache
     WHERE barcode = ?
     ORDER BY CASE provider WHEN 'user' THEN 0 ELSE 1 END,
       last_used_at_ms DESC, cached_at_ms DESC
    LIMIT 1`,
    barcode,
  );
  if (!row) return undefined;
  const policyTtl = FOOD_PROVIDER_RETENTION_POLICIES[row.provider].catalogCacheTtlMs;
  const cachedAt = Number.isFinite(row.cached_at_ms) ? row.cached_at_ms : 0;
  const food = candidateFromRow(row);
  const storedRegionalContext = foodCatalogueRegionalContextFromPayload(
    food.rawPayload,
  );
  const requestedCountry = regionalContext?.countryCode.trim().toUpperCase();
  const requestedLanguage = regionalContext?.languageTag
    .trim()
    .toLowerCase()
    .split('-')[0];
  const regionalMatch =
    !isMutableRegionalFoodProvider(row.provider) ||
    regionalContext === undefined ||
    (storedRegionalContext?.countryCode === requestedCountry &&
      storedRegionalContext?.languageTag === requestedLanguage);
  // Rows written before provider TTLs were introduced have a null expiry.
  // Derive it from cached_at_ms so upgrades do not keep them fresh forever.
  const expiresAt =
    row.expires_at_ms ??
    (policyTtl === undefined ? undefined : cachedAt + policyTtl);
  return {
    food,
    status:
      !regionalMatch ||
      (policyTtl !== undefined &&
        (now < cachedAt || (expiresAt !== undefined && now >= expiresAt)))
        ? 'stale'
        : 'fresh',
    cachedAt,
    expiresAt,
    regionalMatch,
  };
}

/**
 * Backward-compatible fresh-cache lookup. Callers that can provide an offline
 * fallback should use getFoodBarcodeCacheEntry and retain stale rows only when
 * provider revalidation fails.
 */
export async function getCachedFoodByBarcode(
  barcode: string,
  now = Date.now(),
  regionalContext?: FoodCatalogueRegionalContext,
) {
  const entry = await getFoodBarcodeCacheEntry(
    barcode,
    now,
    regionalContext,
  );
  return entry?.status === 'fresh' ? entry.food : undefined;
}

export async function getFavoriteFoods(limit = 50) {
  const database = await openT1ArcDatabase();
  const rows = await database.getAllAsync<CatalogRow>(
    `SELECT id, provider, external_id, barcode, name, brand, image_url,
       basis_amount, basis_unit, carbohydrate_grams, energy_kcal,
       default_serving_amount, default_serving_unit,
       last_portion_amount, last_portion_unit,
       protein_grams, fat_grams, fibre_grams, sugars_grams,
       saturated_fat_grams, nutrition_quality_json, source_label,
       source_url, raw_payload_json, cached_at_ms
     FROM food_catalog_cache
     WHERE is_favorite = 1
     ORDER BY use_count DESC, name ASC
     LIMIT ?`,
    Math.max(0, Math.min(limit, 200)),
  );
  return rows.map(candidateFromRow);
}

/**
 * Returns locally known catalogue entries with the usage metadata needed by
 * unified search. This deliberately does not pre-filter on spelling so the
 * pure ranking layer can still find a recent food after a small typo.
 */
export async function getStoredFoodSearchEntries(
  limit = 2_000,
): Promise<StoredFoodSearchEntry[]> {
  const database = await openT1ArcDatabase();
  const rows = await database.getAllAsync<FoodSearchCatalogRow>(
    `SELECT id, provider, external_id, barcode, name, brand, image_url,
       basis_amount, basis_unit, carbohydrate_grams, energy_kcal,
       default_serving_amount, default_serving_unit,
       last_portion_amount, last_portion_unit,
       protein_grams, fat_grams, fibre_grams, sugars_grams,
       saturated_fat_grams, nutrition_quality_json, source_label,
       source_url, raw_payload_json, cached_at_ms, is_favorite,
       use_count, last_used_at_ms
     FROM food_catalog_cache
     ORDER BY is_favorite DESC,
       CASE provider WHEN 'user' THEN 0 ELSE 1 END,
       last_used_at_ms DESC, use_count DESC, cached_at_ms DESC, id ASC
     LIMIT ?`,
    Math.max(0, Math.min(limit, 2_000)),
  );
  return rows.flatMap((row): StoredFoodSearchEntry[] => {
    try {
      return [{
        food: candidateFromRow(row),
        cachedAt: row.cached_at_ms,
        isFavourite: row.is_favorite === 1,
        useCount: Math.max(0, row.use_count),
        lastUsedAt: row.last_used_at_ms ?? undefined,
      }];
    } catch {
      // One malformed legacy/cache row must not hide every saved food.
      return [];
    }
  });
}

export async function getRecentMealPresets(limit = 6) {
  const database = await openT1ArcDatabase();
  const safeLimit = Math.max(0, Math.min(limit, 30));
  const rows = await database.getAllAsync<RecentMealItemRow>(
    `SELECT
       logs.id AS log_id, logs.title, logs.meal_type, logs.timestamp_ms,
       logs.is_favorite,
       logs.carbohydrate_grams AS log_carbohydrate_grams,
       logs.energy_kcal AS log_energy_kcal,
       logs.protein_grams AS log_protein_grams,
       logs.fat_grams AS log_fat_grams,
       logs.fibre_grams AS log_fibre_grams,
       logs.sugars_grams AS log_sugars_grams,
       logs.saturated_fat_grams AS log_saturated_fat_grams,
       items.ordinal, items.catalog_id, items.provider, items.external_id,
       items.name_snapshot, items.brand_snapshot, items.barcode_snapshot,
       items.amount, items.unit, items.carbohydrate_grams,
       items.energy_kcal, items.protein_grams, items.fat_grams,
       items.fibre_grams, items.sugars_grams,
       items.saturated_fat_grams, items.source_label, items.source_url
     FROM food_log_items AS items
     JOIN food_logs AS logs ON logs.id = items.food_log_id
     WHERE logs.id IN (
       SELECT id FROM food_logs
       ORDER BY is_favorite DESC, timestamp_ms DESC LIMIT ?
     )
     ORDER BY logs.is_favorite DESC, logs.timestamp_ms DESC,
       items.ordinal ASC`,
    safeLimit,
  );

  const presets = new Map<string, FoodMealPreset>();
  for (const row of rows) {
    let preset = presets.get(row.log_id);
    if (!preset) {
      preset = {
        id: row.log_id,
        title: row.title,
        mealType: row.meal_type,
        isFavorite: row.is_favorite === 1,
        nutrition: {
          carbohydrateGrams: row.log_carbohydrate_grams,
          energyKcal: optional(row.log_energy_kcal),
          proteinGrams: optional(row.log_protein_grams),
          fatGrams: optional(row.log_fat_grams),
          fibreGrams: optional(row.log_fibre_grams),
          sugarsGrams: optional(row.log_sugars_grams),
          saturatedFatGrams: optional(row.log_saturated_fat_grams),
        },
        items: [],
      };
      presets.set(row.log_id, preset);
    }
    const itemNutrition: FoodNutrition = {
      carbohydrateGrams: optional(row.carbohydrate_grams),
      energyKcal: optional(row.energy_kcal),
      proteinGrams: optional(row.protein_grams),
      fatGrams: optional(row.fat_grams),
      fibreGrams: optional(row.fibre_grams),
      sugarsGrams: optional(row.sugars_grams),
      saturatedFatGrams: optional(row.saturated_fat_grams),
    };
    preset.items.push({
      amount: row.amount,
      unit: row.unit,
      food: {
        id: row.catalog_id ?? `snapshot:${row.log_id}:${row.ordinal}`,
        provider: row.provider,
        externalId: row.external_id,
        name: row.name_snapshot,
        brand: row.brand_snapshot ?? undefined,
        barcode: row.barcode_snapshot ?? undefined,
        basisAmount: row.amount,
        basisUnit: row.unit,
        nutritionPerBasis: itemNutrition,
        nutritionQuality: {
          carbohydrate: qualityForSnapshot(itemNutrition.carbohydrateGrams),
          energy: qualityForSnapshot(itemNutrition.energyKcal),
          protein: qualityForSnapshot(itemNutrition.proteinGrams),
          fat: qualityForSnapshot(itemNutrition.fatGrams),
          fibre: qualityForSnapshot(itemNutrition.fibreGrams),
          sugars: qualityForSnapshot(itemNutrition.sugarsGrams),
          saturatedFat: qualityForSnapshot(
            itemNutrition.saturatedFatGrams,
          ),
        },
        defaultServingAmount: row.amount,
        defaultServingUnit: row.unit,
        sourceLabel: row.source_label,
        sourceUrl: row.source_url ?? undefined,
      },
    });
  }
  return [...presets.values()];
}

export async function saveFoodRecipe(
  draft: FoodRecipeDraft,
  operationLease?: LocalDataWriteLease,
): Promise<FoodRecipe> {
  const writeLease = operationLease ?? await acquireLocalDataWriteLease();
  const { name, nutrition } = validatedFoodRecipeDraft(draft);
  const timestamp = Date.now();

  const id = localId('food-recipe', timestamp);
  await withT1ArcTransaction(async (database) => {
    await assertLocalDataWriteLeaseInTransaction(database, writeLease);
    await cacheLoggedFoods(database, draft.ingredients, timestamp, false);
    await database.runAsync(
      `INSERT INTO food_recipes (
         id, name, meal_type, servings, carbohydrate_grams, energy_kcal,
         protein_grams, fat_grams, fibre_grams, sugars_grams,
         saturated_fat_grams, created_at_ms, updated_at_ms, is_favorite
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
      id,
      name,
      draft.mealType,
      draft.servings,
      ...nutritionColumns(nutrition),
      timestamp,
      timestamp,
    );

    await insertFoodRecipeItems(database, id, draft.ingredients);
  });

  return {
    id,
    name,
    mealType: draft.mealType,
    servings: draft.servings,
    nutrition,
    ingredients: draft.ingredients,
    isFavorite: true,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function validatedFoodRecipeDraft(draft: FoodRecipeDraft) {
  const name = draft.name.replace(/\s+/g, ' ').trim();
  if (!name) throw new Error('Give the recipe a name.');
  if (name.length > 120) {
    throw new Error('Recipe name must be 120 characters or fewer.');
  }
  if (
    !Number.isFinite(draft.servings) ||
    draft.servings <= 0 ||
    draft.servings > 100
  ) {
    throw new Error('Recipe servings must be greater than 0 and at most 100.');
  }
  validateFoodLogDraft({
    timestamp: Date.now(),
    mealType: draft.mealType,
    items: draft.ingredients,
  });
  return { name, nutrition: totalNutrition(draft.ingredients) };
}

export async function updateFoodRecipe(
  recipe: Pick<FoodRecipe, 'id'>,
  draft: FoodRecipeDraft,
  operationLease?: LocalDataWriteLease,
): Promise<FoodRecipe> {
  const writeLease = operationLease ?? await acquireLocalDataWriteLease();
  const { name, nutrition } = validatedFoodRecipeDraft(draft);
  const timestamp = Date.now();
  let existing: { created_at_ms: number; is_favorite: number } | null = null;
  await withT1ArcTransaction(async (database) => {
    await assertLocalDataWriteLeaseInTransaction(database, writeLease);
    existing = await database.getFirstAsync<{
      created_at_ms: number;
      is_favorite: number;
    }>(
      `SELECT created_at_ms, is_favorite FROM food_recipes WHERE id = ?`,
      recipe.id,
    );
    if (!existing) throw new Error('The recipe could not be found.');

    await cacheLoggedFoods(database, draft.ingredients, timestamp, false);
    const result = await database.runAsync(
      `UPDATE food_recipes
       SET name = ?, meal_type = ?, servings = ?, carbohydrate_grams = ?,
         energy_kcal = ?, protein_grams = ?, fat_grams = ?, fibre_grams = ?,
         sugars_grams = ?, saturated_fat_grams = ?, updated_at_ms = ?
       WHERE id = ?`,
      name,
      draft.mealType,
      draft.servings,
      ...nutritionColumns(nutrition),
      timestamp,
      recipe.id,
    );
    if (result.changes !== 1) throw new Error('The recipe could not be updated.');

    await database.runAsync(
      `DELETE FROM food_recipe_items WHERE recipe_id = ?`,
      recipe.id,
    );
    await insertFoodRecipeItems(database, recipe.id, draft.ingredients);
  });

  return {
    id: recipe.id,
    name,
    mealType: draft.mealType,
    servings: draft.servings,
    nutrition,
    ingredients: draft.ingredients,
    isFavorite: existing!.is_favorite === 1,
    createdAt: existing!.created_at_ms,
    updatedAt: timestamp,
  };
}

export async function getFoodRecipes(limit = 20): Promise<FoodRecipe[]> {
  const database = await openT1ArcDatabase();
  const rows = await database.getAllAsync<RecipeItemRow>(
    `SELECT
       recipes.id AS recipe_id, recipes.name, recipes.meal_type,
       recipes.servings, recipes.is_favorite, recipes.created_at_ms,
       recipes.updated_at_ms,
       recipes.carbohydrate_grams AS recipe_carbohydrate_grams,
       recipes.energy_kcal AS recipe_energy_kcal,
       recipes.protein_grams AS recipe_protein_grams,
       recipes.fat_grams AS recipe_fat_grams,
       recipes.fibre_grams AS recipe_fibre_grams,
       recipes.sugars_grams AS recipe_sugars_grams,
       recipes.saturated_fat_grams AS recipe_saturated_fat_grams,
       items.ordinal, items.catalog_id, items.provider, items.external_id,
       items.name_snapshot, items.brand_snapshot, items.barcode_snapshot,
       items.amount, items.unit, items.carbohydrate_grams,
       items.energy_kcal, items.protein_grams, items.fat_grams,
       items.fibre_grams, items.sugars_grams,
       items.saturated_fat_grams, items.source_label, items.source_url
     FROM food_recipe_items AS items
     JOIN food_recipes AS recipes ON recipes.id = items.recipe_id
     WHERE recipes.id IN (
       SELECT id FROM food_recipes
       ORDER BY is_favorite DESC, updated_at_ms DESC LIMIT ?
     )
     ORDER BY recipes.is_favorite DESC, recipes.updated_at_ms DESC,
       items.ordinal ASC`,
    Math.max(0, Math.min(100, Math.floor(limit))),
  );
  const recipes = new Map<string, FoodRecipe>();
  for (const row of rows) {
    let recipe = recipes.get(row.recipe_id);
    if (!recipe) {
      recipe = {
        id: row.recipe_id,
        name: row.name,
        mealType: row.meal_type,
        servings: row.servings,
        isFavorite: row.is_favorite === 1,
        nutrition: {
          carbohydrateGrams: row.recipe_carbohydrate_grams,
          energyKcal: optional(row.recipe_energy_kcal),
          proteinGrams: optional(row.recipe_protein_grams),
          fatGrams: optional(row.recipe_fat_grams),
          fibreGrams: optional(row.recipe_fibre_grams),
          sugarsGrams: optional(row.recipe_sugars_grams),
          saturatedFatGrams: optional(row.recipe_saturated_fat_grams),
        },
        ingredients: [],
        createdAt: row.created_at_ms,
        updatedAt: row.updated_at_ms,
      };
      recipes.set(row.recipe_id, recipe);
    }
    const itemNutrition: FoodNutrition = {
      carbohydrateGrams: optional(row.carbohydrate_grams),
      energyKcal: optional(row.energy_kcal),
      proteinGrams: optional(row.protein_grams),
      fatGrams: optional(row.fat_grams),
      fibreGrams: optional(row.fibre_grams),
      sugarsGrams: optional(row.sugars_grams),
      saturatedFatGrams: optional(row.saturated_fat_grams),
    };
    recipe.ingredients.push({
      amount: row.amount,
      unit: row.unit,
      food: {
        id: row.catalog_id ?? `recipe:${row.recipe_id}:${row.ordinal}`,
        provider: row.provider,
        externalId: row.external_id,
        name: row.name_snapshot,
        brand: row.brand_snapshot ?? undefined,
        barcode: row.barcode_snapshot ?? undefined,
        basisAmount: row.amount,
        basisUnit: row.unit,
        nutritionPerBasis: itemNutrition,
        nutritionQuality: {
          carbohydrate: qualityForSnapshot(itemNutrition.carbohydrateGrams),
          energy: qualityForSnapshot(itemNutrition.energyKcal),
          protein: qualityForSnapshot(itemNutrition.proteinGrams),
          fat: qualityForSnapshot(itemNutrition.fatGrams),
          fibre: qualityForSnapshot(itemNutrition.fibreGrams),
          sugars: qualityForSnapshot(itemNutrition.sugarsGrams),
          saturatedFat: qualityForSnapshot(
            itemNutrition.saturatedFatGrams,
          ),
        },
        defaultServingAmount: row.amount / row.servings,
        defaultServingUnit: row.unit,
        sourceLabel: row.source_label,
        sourceUrl: row.source_url ?? undefined,
      },
    });
  }
  return [...recipes.values()];
}

export async function setFoodRecipeFavorite(
  recipeId: string,
  favorite: boolean,
  operationLease?: LocalDataWriteLease,
) {
  const writeLease = operationLease ?? await acquireLocalDataWriteLease();
  await withT1ArcTransaction(async (database) => {
    await assertLocalDataWriteLeaseInTransaction(database, writeLease);
    const result = await database.runAsync(
      `UPDATE food_recipes
       SET is_favorite = ?, updated_at_ms = ?
       WHERE id = ?`,
      favorite ? 1 : 0,
      Date.now(),
      recipeId,
    );
    if (result.changes !== 1) {
      throw new Error('The recipe could not be updated.');
    }
  });
}

export async function deleteFoodRecipe(
  recipeId: string,
  operationLease?: LocalDataWriteLease,
) {
  const writeLease = operationLease ?? await acquireLocalDataWriteLease();
  await withT1ArcTransaction(async (database) => {
    await assertLocalDataWriteLeaseInTransaction(database, writeLease);
    const result = await database.runAsync(
      `DELETE FROM food_recipes WHERE id = ?`,
      recipeId,
    );
    if (result.changes !== 1) {
      throw new Error('The recipe could not be removed.');
    }
  });
}

function foodLogFromRows(rows: FoodLogItemRow[]) {
  const logs = new Map<string, FoodLog>();
  for (const row of rows) {
    let log = logs.get(row.log_id);
    if (!log) {
      log = {
        id: row.log_id,
        contextEventId: row.context_event_id,
        timestamp: row.timestamp_ms,
        mealType: row.meal_type,
        title: row.title,
        nutrition: {
          carbohydrateGrams: row.log_carbohydrate_grams,
          energyKcal: optional(row.log_energy_kcal),
          proteinGrams: optional(row.log_protein_grams),
          fatGrams: optional(row.log_fat_grams),
          fibreGrams: optional(row.log_fibre_grams),
          sugarsGrams: optional(row.log_sugars_grams),
          saturatedFatGrams: optional(row.log_saturated_fat_grams),
        },
        items: [],
        createdAt: row.created_at_ms,
        isFavorite: row.is_favorite === 1,
      };
      logs.set(row.log_id, log);
    }
    log.items.push({
      id: row.item_id,
      foodId: row.catalog_id ?? `snapshot:${row.log_id}:${row.ordinal}`,
      provider: row.provider,
      externalId: row.external_id,
      name: row.name_snapshot,
      brand: row.brand_snapshot ?? undefined,
      barcode: row.barcode_snapshot ?? undefined,
      amount: row.amount,
      unit: row.unit,
      nutrition: {
        carbohydrateGrams: optional(row.carbohydrate_grams),
        energyKcal: optional(row.energy_kcal),
        proteinGrams: optional(row.protein_grams),
        fatGrams: optional(row.fat_grams),
        fibreGrams: optional(row.fibre_grams),
        sugarsGrams: optional(row.sugars_grams),
        saturatedFatGrams: optional(row.saturated_fat_grams),
      },
      sourceLabel: row.source_label,
      sourceUrl: row.source_url ?? undefined,
    });
  }
  return [...logs.values()].sort((a, b) => b.timestamp - a.timestamp);
}

export async function getFoodLogByIdInTransaction(
  database: SQLiteDatabase,
  logId: string,
) {
  const rows = await database.getAllAsync<FoodLogItemRow>(
    `SELECT
       logs.id AS log_id, logs.context_event_id, logs.title, logs.meal_type,
       logs.timestamp_ms, logs.created_at_ms, logs.is_favorite,
       logs.carbohydrate_grams AS log_carbohydrate_grams,
       logs.energy_kcal AS log_energy_kcal,
       logs.protein_grams AS log_protein_grams,
       logs.fat_grams AS log_fat_grams,
       logs.fibre_grams AS log_fibre_grams,
       logs.sugars_grams AS log_sugars_grams,
       logs.saturated_fat_grams AS log_saturated_fat_grams,
       items.id AS item_id, items.ordinal, items.catalog_id, items.provider,
       items.external_id,
       items.name_snapshot, items.brand_snapshot, items.barcode_snapshot,
       items.amount, items.unit, items.carbohydrate_grams,
       items.energy_kcal, items.protein_grams, items.fat_grams,
       items.fibre_grams, items.sugars_grams,
       items.saturated_fat_grams, items.source_label, items.source_url
     FROM food_log_items AS items
     JOIN food_logs AS logs ON logs.id = items.food_log_id
     WHERE logs.id = ?
     ORDER BY items.ordinal ASC`,
    logId,
  );
  return foodLogFromRows(rows)[0];
}

export async function deleteFoodLogInTransaction(
  database: SQLiteDatabase,
  log: Pick<FoodLog, 'id' | 'contextEventId'>,
) {
  const result = await database.runAsync(
    `DELETE FROM context_events
     WHERE id = ? AND source_id = ? AND origin = 'manual' AND kind = 'meal'
       AND EXISTS (
         SELECT 1 FROM food_logs
         WHERE id = ? AND context_event_id = context_events.id
       )`,
    log.contextEventId,
    FOOD_LOG_SOURCE_ID,
    log.id,
  );
  if (result.changes !== 1) {
    throw new Error('A saved meal selected for replacement could not be found.');
  }
}

/** Restores an exact immutable meal snapshot for a just-undone batch. */
export async function restoreFoodLogInTransaction(
  database: SQLiteDatabase,
  log: FoodLog,
) {
  if (!log.items.length) throw new Error('An empty saved meal cannot be restored.');
  await database.runAsync(
    `INSERT INTO context_events (
       id, source_id, origin, kind, start_ms, end_ms, title, meal_type,
       carbs_grams, energy_kcal, protein_grams, fat_grams, fibre_grams,
       sugars_grams, saturated_fat_grams, activity_type, duration_minutes,
       intensity, quality_percent, kilograms, amount, unit, recorded_at_ms,
       source_file, source_row
     ) VALUES (?, ?, 'manual', 'meal', ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?,
       NULL, NULL, NULL, NULL, NULL, NULL, NULL, ?, 'Food log', NULL)`,
    log.contextEventId,
    FOOD_LOG_SOURCE_ID,
    log.timestamp,
    log.title,
    log.mealType,
    ...nutritionColumns(log.nutrition),
    log.createdAt,
  );
  await database.runAsync(
    `INSERT INTO food_logs (
       id, context_event_id, timestamp_ms, meal_type, title,
       carbohydrate_grams, energy_kcal, protein_grams, fat_grams,
       fibre_grams, sugars_grams, saturated_fat_grams,
       created_at_ms, updated_at_ms, is_favorite
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    log.id,
    log.contextEventId,
    log.timestamp,
    log.mealType,
    log.title,
    ...nutritionColumns(log.nutrition),
    log.createdAt,
    log.createdAt,
    log.isFavorite ? 1 : 0,
  );
  for (const [ordinal, item] of log.items.entries()) {
    const linkedCatalog = item.foodId.startsWith('snapshot:')
      ? null
      : await database.getFirstAsync<{ id: string }>(
        `SELECT id FROM food_catalog_cache WHERE id = ?`,
        item.foodId,
      );
    await database.runAsync(
      `INSERT INTO food_log_items (
         id, food_log_id, ordinal, catalog_id, provider, external_id,
         name_snapshot, brand_snapshot, barcode_snapshot, amount, unit,
         carbohydrate_grams, energy_kcal, protein_grams, fat_grams,
         fibre_grams, sugars_grams, saturated_fat_grams,
         source_label, source_url
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      item.id,
      log.id,
      ordinal,
      linkedCatalog?.id ?? null,
      item.provider,
      item.externalId,
      item.name,
      item.brand ?? null,
      item.barcode ?? null,
      item.amount,
      item.unit,
      ...nutritionColumns(item.nutrition),
      item.sourceLabel,
      item.sourceUrl ?? null,
    );
  }
}

export async function getFoodLogs(
  range: TimeRange,
  limit = 100,
): Promise<FoodLog[]> {
  const database = await openT1ArcDatabase();
  const safeLimit = Math.max(1, Math.min(500, Math.floor(limit)));
  const rows = await database.getAllAsync<FoodLogItemRow>(
    `SELECT
       logs.id AS log_id, logs.context_event_id, logs.title, logs.meal_type,
       logs.timestamp_ms, logs.created_at_ms, logs.is_favorite,
       logs.carbohydrate_grams AS log_carbohydrate_grams,
       logs.energy_kcal AS log_energy_kcal,
       logs.protein_grams AS log_protein_grams,
       logs.fat_grams AS log_fat_grams,
       logs.fibre_grams AS log_fibre_grams,
       logs.sugars_grams AS log_sugars_grams,
       logs.saturated_fat_grams AS log_saturated_fat_grams,
       items.id AS item_id, items.ordinal, items.catalog_id, items.provider,
       items.external_id,
       items.name_snapshot, items.brand_snapshot, items.barcode_snapshot,
       items.amount, items.unit, items.carbohydrate_grams,
       items.energy_kcal, items.protein_grams, items.fat_grams,
       items.fibre_grams, items.sugars_grams,
       items.saturated_fat_grams, items.source_label, items.source_url
     FROM food_log_items AS items
     JOIN food_logs AS logs ON logs.id = items.food_log_id
     WHERE logs.id IN (
       SELECT id
       FROM food_logs
       WHERE timestamp_ms >= ? AND timestamp_ms < ?
       ORDER BY timestamp_ms DESC
       LIMIT ?
     )
     ORDER BY logs.timestamp_ms DESC, items.ordinal ASC`,
    range.start,
    range.end,
    safeLimit,
  );
  return foodLogFromRows(rows);
}

export async function updateFoodLog(
  log: FoodLog,
  draft: FoodLogDraft,
  operationLease?: LocalDataWriteLease,
  options: FoodLogMutationOptions = {},
) {
  const writeLease = operationLease ?? await acquireLocalDataWriteLease();
  validateFoodLogDraft(draft);
  const updatedAt = Date.now();
  const adjusted = revisedFoodLog(log, draft, updatedAt.toString(36));

  await withT1ArcTransaction(async (database) => {
    await assertLocalDataWriteLeaseInTransaction(database, writeLease);
    const existing = await database.getFirstAsync<{
      context_event_id: string;
    }>(
      `SELECT context_event_id
       FROM food_logs
       WHERE id = ?`,
      log.id,
    );
    if (!existing || existing.context_event_id !== log.contextEventId) {
      throw new Error('The saved meal could not be found.');
    }

    await cacheLoggedFoods(database, draft.items, updatedAt, false);

    // A verified private migration can preserve an earlier technical source ID.
    // The unique food_logs → context_events relationship is the ownership proof;
    // adopting the current source here changes no health or nutrition value.
    const contextResult = await database.runAsync(
      `UPDATE context_events
       SET source_id = ?, start_ms = ?, title = ?, meal_type = ?, carbs_grams = ?,
          energy_kcal = ?, protein_grams = ?, fat_grams = ?,
          fibre_grams = ?, sugars_grams = ?, saturated_fat_grams = ?
       WHERE id = ? AND origin = 'manual'
          AND kind = 'meal'`,
      FOOD_LOG_SOURCE_ID,
      adjusted.timestamp,
      adjusted.title,
      adjusted.mealType,
      ...nutritionColumns(adjusted.nutrition),
      log.contextEventId,
    );
    if (contextResult.changes !== 1) {
      throw new Error('The meal timeline record could not be updated.');
    }

    const logResult = await database.runAsync(
      `UPDATE food_logs
       SET timestamp_ms = ?, meal_type = ?, title = ?,
         carbohydrate_grams = ?, energy_kcal = ?, protein_grams = ?,
         fat_grams = ?, fibre_grams = ?, sugars_grams = ?,
         saturated_fat_grams = ?, updated_at_ms = ?
       WHERE id = ? AND context_event_id = ?`,
      adjusted.timestamp,
      adjusted.mealType,
      adjusted.title,
      ...nutritionColumns(adjusted.nutrition),
      updatedAt,
      log.id,
      log.contextEventId,
    );
    if (logResult.changes !== 1) {
      throw new Error('The saved meal could not be updated.');
    }

    await database.runAsync(
      `DELETE FROM food_log_items WHERE food_log_id = ?`,
      log.id,
    );
    await insertFoodLogItems(database, log.id, adjusted.items);
    await invalidateFoodInsightsInTransaction(
      database,
      options.insightInvalidation,
    );
  });

  return adjusted;
}

export async function updateFoodLogPortions(
  log: FoodLog,
  amounts: Record<string, number>,
  operationLease?: LocalDataWriteLease,
  options: FoodLogMutationOptions = {},
) {
  const writeLease = operationLease ?? await acquireLocalDataWriteLease();
  const adjusted = adjustedFoodLogPortions(log, amounts);
  const updatedAt = Date.now();
  await withT1ArcTransaction(async (database) => {
    await assertLocalDataWriteLeaseInTransaction(database, writeLease);
    const itemUpdate = await database.prepareAsync(
      `UPDATE food_log_items
         SET amount = ?, carbohydrate_grams = ?, energy_kcal = ?,
           protein_grams = ?, fat_grams = ?, fibre_grams = ?,
           sugars_grams = ?, saturated_fat_grams = ?
         WHERE id = ? AND food_log_id = ?`,
    );
    try {
      const catalogueUpdate = await database.prepareAsync(
        `UPDATE food_catalog_cache
         SET last_portion_amount = ?, last_portion_unit = ?,
           last_used_at_ms = ?
         WHERE id = ?`,
      );
      try {
        for (const item of adjusted.items) {
          const result = await itemUpdate.executeAsync(
            item.amount,
            ...nutritionColumns(item.nutrition),
            item.id,
            log.id,
          );
          if (result.changes !== 1) {
            throw new Error('A saved meal item could not be updated.');
          }
          await catalogueUpdate.executeAsync(
            item.amount,
            item.unit,
            updatedAt,
            item.foodId,
          );
        }
      } finally {
        await catalogueUpdate.finalizeAsync();
      }
    } finally {
      await itemUpdate.finalizeAsync();
    }
    const logResult = await database.runAsync(
      `UPDATE food_logs
       SET carbohydrate_grams = ?, energy_kcal = ?, protein_grams = ?,
         fat_grams = ?, fibre_grams = ?, sugars_grams = ?,
         saturated_fat_grams = ?, updated_at_ms = ?
       WHERE id = ? AND context_event_id = ?`,
      ...nutritionColumns(adjusted.nutrition),
      updatedAt,
      log.id,
      log.contextEventId,
    );
    if (logResult.changes !== 1) {
      throw new Error('The saved meal could not be updated.');
    }
    const contextResult = await database.runAsync(
      `UPDATE context_events
       SET source_id = ?, carbs_grams = ?, energy_kcal = ?, protein_grams = ?,
          fat_grams = ?, fibre_grams = ?, sugars_grams = ?,
          saturated_fat_grams = ?
       WHERE id = ? AND origin = 'manual' AND kind = 'meal'
         AND EXISTS (
           SELECT 1 FROM food_logs
           WHERE id = ? AND context_event_id = context_events.id
         )`,
      FOOD_LOG_SOURCE_ID,
      ...nutritionColumns(adjusted.nutrition),
      log.contextEventId,
      log.id,
    );
    if (contextResult.changes !== 1) {
      throw new Error('The meal timeline record could not be updated.');
    }
    await invalidateFoodInsightsInTransaction(
      database,
      options.insightInvalidation,
    );
  });
  return adjusted;
}

export async function setMealPresetFavorite(
  logId: string,
  favorite: boolean,
  operationLease?: LocalDataWriteLease,
) {
  const writeLease = operationLease ?? await acquireLocalDataWriteLease();
  await withT1ArcTransaction(async (database) => {
    await assertLocalDataWriteLeaseInTransaction(database, writeLease);
    const result = await database.runAsync(
      `UPDATE food_logs
       SET is_favorite = ?, updated_at_ms = ?
       WHERE id = ?`,
      favorite ? 1 : 0,
      Date.now(),
      logId,
    );
    if (result.changes !== 1) {
      throw new Error('The saved meal could not be updated.');
    }
  });
}

function qualityForSnapshot(value: number | undefined) {
  return value === undefined ? 'missing' as const : value === 0
    ? 'trace' as const
    : 'reported' as const;
}

export async function setFoodFavorite(
  food: FoodCandidate,
  favorite: boolean,
  operationLease?: LocalDataWriteLease,
) {
  const writeLease = operationLease ?? await acquireLocalDataWriteLease();
  const cachedAt = catalogueObservedAt(food, Date.now());
  const retention = retainedFoodCatalogData(food, cachedAt);
  await withT1ArcTransaction(async (database) => {
    await assertLocalDataWriteLeaseInTransaction(database, writeLease);
    await database.runAsync(
      `INSERT INTO food_catalog_cache (
       id, provider, external_id, barcode, name, brand, image_url,
       basis_amount, basis_unit, default_serving_amount,
       default_serving_unit, last_portion_amount, last_portion_unit,
       carbohydrate_grams, energy_kcal,
       protein_grams, fat_grams, fibre_grams, sugars_grams,
       saturated_fat_grams, nutrition_quality_json, source_label,
       source_url, raw_payload_json, cached_at_ms, expires_at_ms,
       is_favorite, use_count, last_used_at_ms
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
       ?, ?, ?, ?, ?, ?, ?, 0, NULL)
     ON CONFLICT(id) DO UPDATE SET
       ${FOOD_CATALOGUE_PROVIDER_UPDATE_SQL},
       is_favorite = excluded.is_favorite`,
      food.id,
      food.provider,
      food.externalId,
      food.barcode ?? null,
      food.name,
      food.brand ?? null,
      food.imageUrl ?? null,
      food.basisAmount,
      food.basisUnit,
      food.defaultServingAmount ?? food.basisAmount,
      food.defaultServingUnit ?? food.basisUnit,
      food.lastPortionAmount ?? null,
      food.lastPortionUnit ?? null,
      ...nutritionColumns(food.nutritionPerBasis),
      JSON.stringify(food.nutritionQuality),
      food.sourceLabel,
      food.sourceUrl ?? null,
      retention.rawPayloadJson,
      cachedAt,
      retention.expiresAt,
      favorite ? 1 : 0,
    );
  });
}

/**
 * Changes favourite state without rewriting catalogue content. This is the
 * only safe mutation for a deduplicated result whose visible representative
 * may come from a different provider than the persisted identity.
 */
export async function setStoredFoodFavoritesByIdentity(
  identities: readonly StoredFoodIdentity[],
  favorite: boolean,
  operationLease?: LocalDataWriteLease,
) {
  const writeLease = operationLease ?? await acquireLocalDataWriteLease();
  const unique = new Map<string, StoredFoodIdentity>();
  for (const identity of identities) {
    unique.set(
      `${identity.provider}\u0000${identity.externalId}\u0000${identity.id}`,
      identity,
    );
  }
  if (!unique.size) return 0;

  return withT1ArcTransaction(async (database) => {
    await assertLocalDataWriteLeaseInTransaction(database, writeLease);
    let changes = 0;
    for (const identity of unique.values()) {
      const result = await database.runAsync(
        `UPDATE food_catalog_cache
         SET is_favorite = ?
         WHERE id = ? OR (provider = ? AND external_id = ?)`,
        favorite ? 1 : 0,
        identity.id,
        identity.provider,
        identity.externalId,
      );
      changes += result.changes;
    }
    if (favorite && changes === 0) {
      throw new Error('The saved food is no longer available. Search for it again.');
    }
    return changes;
  });
}
