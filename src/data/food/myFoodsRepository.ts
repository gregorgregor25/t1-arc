import type { SQLiteDatabase } from 'expo-sqlite';

import { retainedFoodCatalogData } from './providerRetention';
import { servingAmountFromRawPayload } from './servings';
import type {
  FoodBasisUnit,
  FoodCandidate,
  FoodNutrition,
  FoodNutritionQuality,
  UserFoodDraft,
} from './types';
import { createUserFoodCandidate } from './userFood';
import { openT1ArcDatabase, withT1ArcTransaction } from '@/data/persistence/t1arcDatabase';
import {
  acquireLocalDataWriteLease,
  assertLocalDataWriteLeaseInTransaction,
  type LocalDataWriteLease,
} from '@/data/privacy/localDataWriteEpoch';

interface MyFoodRow {
  id: string;
  external_id: string;
  barcode: string | null;
  name: string;
  brand: string | null;
  basis_amount: number;
  basis_unit: FoodBasisUnit;
  default_serving_amount: number | null;
  default_serving_unit: FoodBasisUnit | null;
  last_portion_amount: number | null;
  last_portion_unit: FoodBasisUnit | null;
  carbohydrate_grams: number | null;
  energy_kcal: number | null;
  protein_grams: number | null;
  fat_grams: number | null;
  fibre_grams: number | null;
  sugars_grams: number | null;
  saturated_fat_grams: number | null;
  nutrition_quality_json: string;
  source_label: string;
  raw_payload_json: string | null;
  cached_at_ms: number;
}

const MY_FOOD_SELECT = `SELECT id, external_id, barcode, name, brand,
  basis_amount, basis_unit, default_serving_amount, default_serving_unit,
  last_portion_amount, last_portion_unit, carbohydrate_grams, energy_kcal,
  protein_grams, fat_grams, fibre_grams, sugars_grams,
  saturated_fat_grams, nutrition_quality_json, source_label,
  raw_payload_json, cached_at_ms
  FROM food_catalog_cache`;

export interface MyFoodWriteOptions {
  lease?: LocalDataWriteLease;
  now?: number;
  /** Test seam; production callers should leave this unset. */
  entropy?: string;
}

function optional(value: number | null) {
  return value ?? undefined;
}

function nutritionFromRow(row: MyFoodRow): FoodNutrition {
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

function candidateFromRow(row: MyFoodRow): FoodCandidate {
  let rawPayload: unknown;
  try {
    rawPayload = row.raw_payload_json
      ? JSON.parse(row.raw_payload_json) as unknown
      : undefined;
  } catch {
    rawPayload = undefined;
  }
  return {
    id: row.id,
    provider: 'user',
    externalId: row.external_id,
    barcode: row.barcode ?? undefined,
    name: row.name,
    brand: row.brand ?? undefined,
    basisAmount: row.basis_amount,
    basisUnit: row.basis_unit,
    nutritionPerBasis: nutritionFromRow(row),
    nutritionQuality: JSON.parse(row.nutrition_quality_json) as FoodNutritionQuality,
    defaultServingAmount:
      row.default_serving_amount ??
      servingAmountFromRawPayload(rawPayload, row.basis_unit) ??
      row.basis_amount,
    defaultServingUnit: row.default_serving_unit ?? row.basis_unit,
    lastPortionAmount: row.last_portion_amount ?? undefined,
    lastPortionUnit: row.last_portion_unit ?? undefined,
    sourceLabel: row.source_label,
    rawPayload,
  };
}

function nutritionValues(food: FoodCandidate) {
  const nutrition = food.nutritionPerBasis;
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

async function assertBarcodeAvailable(
  database: SQLiteDatabase,
  barcode: string | undefined,
  excludingId?: string,
) {
  if (!barcode) return;
  const collision = await database.getFirstAsync<{ id: string }>(
    `SELECT id FROM food_catalog_cache
     WHERE provider = 'user' AND barcode = ? AND (? IS NULL OR id <> ?)
     LIMIT 1`,
    barcode,
    excludingId ?? null,
    excludingId ?? null,
  );
  if (collision) throw new Error('That barcode is already used by another My Food.');
}

export async function createMyFoodInTransaction(
  database: SQLiteDatabase,
  draft: UserFoodDraft,
  now = Date.now(),
  entropy?: string,
) {
  const food = createUserFoodCandidate(draft, now, entropy);
  if (await database.getFirstAsync(`SELECT id FROM food_catalog_cache WHERE id = ?`, food.id)) {
    throw new Error('That My Food already exists. Edit it instead.');
  }
  await assertBarcodeAvailable(database, food.barcode);
  const retention = retainedFoodCatalogData(food, now);
  await database.runAsync(
    `INSERT INTO food_catalog_cache (
       id, provider, external_id, barcode, name, brand, image_url,
       basis_amount, basis_unit, default_serving_amount, default_serving_unit,
       last_portion_amount, last_portion_unit, carbohydrate_grams, energy_kcal,
       protein_grams, fat_grams, fibre_grams, sugars_grams,
       saturated_fat_grams, nutrition_quality_json, source_label, source_url,
       raw_payload_json, cached_at_ms, expires_at_ms, is_favorite, use_count,
       last_used_at_ms
     ) VALUES (?, 'user', ?, ?, ?, ?, NULL, ?, ?, ?, ?, NULL, NULL, ?, ?, ?,
       ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, 0, 0, NULL)`,
    food.id,
    food.externalId,
    food.barcode ?? null,
    food.name,
    food.brand ?? null,
    food.basisAmount,
    food.basisUnit,
    food.defaultServingAmount ?? food.basisAmount,
    food.defaultServingUnit ?? food.basisUnit,
    ...nutritionValues(food),
    JSON.stringify(food.nutritionQuality),
    food.sourceLabel,
    retention.rawPayloadJson,
    now,
    retention.expiresAt,
  );
  return food;
}

export async function updateMyFoodInTransaction(
  database: SQLiteDatabase,
  foodId: string,
  draft: UserFoodDraft,
  now = Date.now(),
) {
  const row = await database.getFirstAsync<MyFoodRow>(
    `${MY_FOOD_SELECT} WHERE id = ? AND provider = 'user'`,
    foodId,
  );
  if (!row) throw new Error('The My Food could not be found.');
  const existing = candidateFromRow(row);
  const revised = createUserFoodCandidate(draft, now, 'update');
  await assertBarcodeAvailable(database, revised.barcode, foodId);
  const existingPayload = existing.rawPayload &&
    typeof existing.rawPayload === 'object' &&
    !Array.isArray(existing.rawPayload)
    ? existing.rawPayload as Record<string, unknown>
    : {};
  const revisedPayload = revised.rawPayload as Record<string, unknown>;
  const stable: FoodCandidate = {
    ...revised,
    id: existing.id,
    externalId: existing.externalId,
    rawPayload: {
      ...revisedPayload,
      createdAt: existingPayload.createdAt ?? revisedPayload.createdAt,
      updatedAt: now,
    },
  };
  const retention = retainedFoodCatalogData(stable, now);
  const result = await database.runAsync(
    `UPDATE food_catalog_cache SET barcode = ?, name = ?, brand = ?,
       basis_amount = ?, basis_unit = ?, default_serving_amount = ?,
       default_serving_unit = ?, carbohydrate_grams = ?, energy_kcal = ?,
       protein_grams = ?, fat_grams = ?, fibre_grams = ?, sugars_grams = ?,
       saturated_fat_grams = ?, nutrition_quality_json = ?, source_label = ?,
       source_url = NULL, raw_payload_json = ?, cached_at_ms = ?, expires_at_ms = ?
     WHERE id = ? AND provider = 'user'`,
    stable.barcode ?? null,
    stable.name,
    stable.brand ?? null,
    stable.basisAmount,
    stable.basisUnit,
    stable.defaultServingAmount ?? stable.basisAmount,
    stable.defaultServingUnit ?? stable.basisUnit,
    ...nutritionValues(stable),
    JSON.stringify(stable.nutritionQuality),
    stable.sourceLabel,
    retention.rawPayloadJson,
    now,
    retention.expiresAt,
    foodId,
  );
  if (result.changes !== 1) throw new Error('The My Food could not be updated.');
  return stable;
}

export async function deleteMyFoodInTransaction(
  database: SQLiteDatabase,
  foodId: string,
) {
  const result = await database.runAsync(
    `DELETE FROM food_catalog_cache WHERE id = ? AND provider = 'user'`,
    foodId,
  );
  if (result.changes !== 1) throw new Error('The My Food could not be removed.');
}

export async function listMyFoods(limit = 200) {
  const database = await openT1ArcDatabase();
  const rows = await database.getAllAsync<MyFoodRow>(
    `${MY_FOOD_SELECT} WHERE provider = 'user'
     ORDER BY is_favorite DESC, last_used_at_ms DESC, cached_at_ms DESC, name ASC
     LIMIT ?`,
    Math.max(1, Math.min(1_000, Math.floor(limit))),
  );
  return rows.flatMap((row): FoodCandidate[] => {
    try {
      return [candidateFromRow(row)];
    } catch {
      // Preserve access to valid older rows if one legacy payload is malformed.
      return [];
    }
  });
}

export async function getMyFood(foodId: string) {
  const database = await openT1ArcDatabase();
  const row = await database.getFirstAsync<MyFoodRow>(
    `${MY_FOOD_SELECT} WHERE id = ? AND provider = 'user'`,
    foodId,
  );
  if (!row) return undefined;
  try {
    return candidateFromRow(row);
  } catch {
    return undefined;
  }
}

export async function createMyFood(
  draft: UserFoodDraft,
  options: MyFoodWriteOptions = {},
) {
  const lease = options.lease ?? await acquireLocalDataWriteLease();
  return withT1ArcTransaction(async (database) => {
    await assertLocalDataWriteLeaseInTransaction(database, lease);
    return createMyFoodInTransaction(database, draft, options.now, options.entropy);
  });
}

export async function updateMyFood(
  foodId: string,
  draft: UserFoodDraft,
  options: MyFoodWriteOptions = {},
) {
  const lease = options.lease ?? await acquireLocalDataWriteLease();
  return withT1ArcTransaction(async (database) => {
    await assertLocalDataWriteLeaseInTransaction(database, lease);
    return updateMyFoodInTransaction(database, foodId, draft, options.now);
  });
}

export async function deleteMyFood(
  foodId: string,
  lease?: LocalDataWriteLease,
) {
  const writeLease = lease ?? await acquireLocalDataWriteLease();
  return withT1ArcTransaction(async (database) => {
    await assertLocalDataWriteLeaseInTransaction(database, writeLease);
    return deleteMyFoodInTransaction(database, foodId);
  });
}
