import {
  FoodCandidate,
  FoodLog,
  FoodLogDraft,
  FoodLogItemSnapshot,
  FoodNutrition,
  FoodNutritionQuality,
  FoodProviderId,
} from './types';
import {
  nutritionForFoodAmount,
  totalNutrition,
} from './nutrition';
import {
  openDaymarkDatabase,
  withDaymarkTransaction,
} from '@/data/persistence/daymarkDatabase';
import { MealEvent } from '@/domain/models';

export const FOOD_LOG_SOURCE_ID = 'daymark-food';

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
    defaultServingAmount: row.basis_amount,
    defaultServingUnit: row.basis_unit,
    sourceLabel: row.source_label,
    sourceUrl: row.source_url ?? undefined,
    rawPayload: row.raw_payload_json
      ? (JSON.parse(row.raw_payload_json) as unknown)
      : undefined,
  };
}

function localId(prefix: string, timestamp: number) {
  const entropy = Math.random().toString(36).slice(2, 12);
  return `${prefix}:${timestamp}:${Date.now().toString(36)}-${entropy}`;
}

function mealTitle(draft: FoodLogDraft) {
  const explicit = draft.title?.trim();
  if (explicit) return explicit;
  if (draft.items.length === 1) return draft.items[0]!.food.name;
  const meal =
    draft.mealType[0]!.toUpperCase() + draft.mealType.slice(1);
  return `${meal} · ${draft.items.length} items`;
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

function validateDraft(draft: FoodLogDraft) {
  if (!Number.isFinite(draft.timestamp) || draft.timestamp <= 0) {
    throw new Error('Choose a valid meal date and time.');
  }
  if (!draft.items.length) {
    throw new Error('Add at least one food.');
  }
  for (const item of draft.items) {
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

export async function saveFoodLog(draft: FoodLogDraft) {
  validateDraft(draft);
  const createdAt = Date.now();
  const id = localId('food-log', draft.timestamp);
  const contextEventId = `${FOOD_LOG_SOURCE_ID}:meal:${id}`;
  const title = mealTitle(draft);
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

  await withDaymarkTransaction(async (database) => {
    for (const item of draft.items) {
      const food = item.food;
      await database.runAsync(
        `INSERT INTO food_catalog_cache (
           id, provider, external_id, barcode, name, brand, image_url,
           basis_amount, basis_unit, carbohydrate_grams, energy_kcal,
           protein_grams, fat_grams, fibre_grams, sugars_grams,
           saturated_fat_grams, nutrition_quality_json, source_label,
           source_url, raw_payload_json, cached_at_ms, expires_at_ms,
           is_favorite, use_count, last_used_at_ms
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
           ?, ?, ?, NULL, 0, 1, ?)
         ON CONFLICT(id) DO UPDATE SET
           barcode = excluded.barcode,
           name = excluded.name,
           brand = excluded.brand,
           image_url = excluded.image_url,
           basis_amount = excluded.basis_amount,
           basis_unit = excluded.basis_unit,
           carbohydrate_grams = excluded.carbohydrate_grams,
           energy_kcal = excluded.energy_kcal,
           protein_grams = excluded.protein_grams,
           fat_grams = excluded.fat_grams,
           fibre_grams = excluded.fibre_grams,
           sugars_grams = excluded.sugars_grams,
           saturated_fat_grams = excluded.saturated_fat_grams,
           nutrition_quality_json = excluded.nutrition_quality_json,
           source_label = excluded.source_label,
           source_url = excluded.source_url,
           raw_payload_json = excluded.raw_payload_json,
           cached_at_ms = excluded.cached_at_ms,
           use_count = food_catalog_cache.use_count + 1,
           last_used_at_ms = excluded.last_used_at_ms`,
        food.id,
        food.provider,
        food.externalId,
        food.barcode ?? null,
        food.name,
        food.brand ?? null,
        food.imageUrl ?? null,
        food.basisAmount,
        food.basisUnit,
        ...nutritionColumns(food.nutritionPerBasis),
        JSON.stringify(food.nutritionQuality),
        food.sourceLabel,
        food.sourceUrl ?? null,
        food.rawPayload === undefined
          ? null
          : JSON.stringify(food.rawPayload),
        createdAt,
        createdAt,
      );
    }

    await database.runAsync(
      `INSERT INTO context_events (
         id, source_id, origin, kind, start_ms, end_ms, title, meal_type,
         carbs_grams, activity_type, duration_minutes, intensity,
         quality_percent, kilograms, amount, unit, recorded_at_ms,
         source_file, source_row
       ) VALUES (?, ?, 'manual', 'meal', ?, NULL, ?, ?, ?, NULL, NULL,
         NULL, NULL, NULL, NULL, NULL, ?, 'Food log', NULL)`,
      contextEventId,
      FOOD_LOG_SOURCE_ID,
      draft.timestamp,
      title,
      draft.mealType,
      carbohydrateGrams,
      createdAt,
    );

    await database.runAsync(
      `INSERT INTO food_logs (
         id, context_event_id, timestamp_ms, meal_type, title,
         carbohydrate_grams, energy_kcal, protein_grams, fat_grams,
         fibre_grams, sugars_grams, saturated_fat_grams,
         created_at_ms, updated_at_ms
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      contextEventId,
      draft.timestamp,
      draft.mealType,
      title,
      ...nutritionColumns(nutrition),
      createdAt,
      createdAt,
    );

    for (const [index, snapshot] of itemSnapshots.entries()) {
      await database.runAsync(
        `INSERT INTO food_log_items (
           id, food_log_id, ordinal, catalog_id, provider, external_id,
           name_snapshot, brand_snapshot, barcode_snapshot, amount, unit,
           carbohydrate_grams, energy_kcal, protein_grams, fat_grams,
           fibre_grams, sugars_grams, saturated_fat_grams,
           source_label, source_url
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
           ?, ?)`,
        snapshot.id,
        id,
        index,
        snapshot.foodId,
        snapshot.provider,
        snapshot.externalId,
        snapshot.name,
        snapshot.brand ?? null,
        snapshot.barcode ?? null,
        snapshot.amount,
        snapshot.unit,
        ...nutritionColumns(snapshot.nutrition),
        snapshot.sourceLabel,
        snapshot.sourceUrl ?? null,
      );
    }
  });

  const event: MealEvent = {
    id: contextEventId,
    sourceId: FOOD_LOG_SOURCE_ID,
    origin: 'manual',
    kind: 'meal',
    start: draft.timestamp,
    title,
    mealType: draft.mealType,
    carbsGrams: carbohydrateGrams,
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
  };
  return { event, log };
}

export async function getRecentFoods(limit = 12) {
  const database = await openDaymarkDatabase();
  const rows = await database.getAllAsync<CatalogRow>(
    `SELECT id, provider, external_id, barcode, name, brand, image_url,
       basis_amount, basis_unit, carbohydrate_grams, energy_kcal,
       protein_grams, fat_grams, fibre_grams, sugars_grams,
       saturated_fat_grams, nutrition_quality_json, source_label,
       source_url, raw_payload_json
     FROM food_catalog_cache
     WHERE last_used_at_ms IS NOT NULL
     ORDER BY last_used_at_ms DESC, use_count DESC
     LIMIT ?`,
    Math.max(0, Math.min(limit, 100)),
  );
  return rows.map(candidateFromRow);
}

export async function getFavoriteFoods(limit = 50) {
  const database = await openDaymarkDatabase();
  const rows = await database.getAllAsync<CatalogRow>(
    `SELECT id, provider, external_id, barcode, name, brand, image_url,
       basis_amount, basis_unit, carbohydrate_grams, energy_kcal,
       protein_grams, fat_grams, fibre_grams, sugars_grams,
       saturated_fat_grams, nutrition_quality_json, source_label,
       source_url, raw_payload_json
     FROM food_catalog_cache
     WHERE is_favorite = 1
     ORDER BY use_count DESC, name ASC
     LIMIT ?`,
    Math.max(0, Math.min(limit, 200)),
  );
  return rows.map(candidateFromRow);
}

export async function setFoodFavorite(
  food: FoodCandidate,
  favorite: boolean,
) {
  const database = await openDaymarkDatabase();
  const changed = await database.runAsync(
    `UPDATE food_catalog_cache SET is_favorite = ? WHERE id = ?`,
    favorite ? 1 : 0,
    food.id,
  );
  if (changed.changes === 0) {
    throw new Error('Log this food once before adding it to favourites.');
  }
}
