import type { SQLiteDatabase } from 'expo-sqlite';

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
import { servingAmountFromRawPayload } from './servings';
import {
  openDaymarkDatabase,
  withDaymarkTransaction,
} from '@/data/persistence/daymarkDatabase';
import { MealEvent, TimeRange } from '@/domain/models';

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
    rawPayload,
  };
}

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

function validateDraft(draft: FoodLogDraft) {
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

async function cacheLoggedFood(
  database: SQLiteDatabase,
  item: FoodLogDraft['items'][number],
  usedAt: number,
  incrementUseCount: boolean,
) {
  const food = item.food;
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
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
       ?, ?, ?, ?, ?, ?, NULL, 0, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       barcode = excluded.barcode,
       name = excluded.name,
       brand = excluded.brand,
       image_url = excluded.image_url,
       basis_amount = excluded.basis_amount,
       basis_unit = excluded.basis_unit,
       default_serving_amount = excluded.default_serving_amount,
       default_serving_unit = excluded.default_serving_unit,
       last_portion_amount = excluded.last_portion_amount,
       last_portion_unit = excluded.last_portion_unit,
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
       use_count = food_catalog_cache.use_count + ?,
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
    food.defaultServingAmount ?? food.basisAmount,
    food.defaultServingUnit ?? food.basisUnit,
    item.amount,
    item.unit,
    ...nutritionColumns(food.nutritionPerBasis),
    JSON.stringify(food.nutritionQuality),
    food.sourceLabel,
    food.sourceUrl ?? null,
    food.rawPayload === undefined
      ? null
      : JSON.stringify(food.rawPayload),
    usedAt,
    incrementUseCount ? 1 : 0,
    usedAt,
    incrementUseCount ? 1 : 0,
  );
}

export async function saveFoodLog(draft: FoodLogDraft) {
  validateDraft(draft);
  const createdAt = Date.now();
  const id = localId('food-log', draft.timestamp);
  const contextEventId = `${FOOD_LOG_SOURCE_ID}:meal:${id}`;
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

  await withDaymarkTransaction(async (database) => {
    for (const item of draft.items) {
      await cacheLoggedFood(database, item, createdAt, true);
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
         created_at_ms, updated_at_ms, is_favorite
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
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
       default_serving_amount, default_serving_unit,
       last_portion_amount, last_portion_unit,
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

export async function getCachedFoodByBarcode(barcode: string) {
  const database = await openDaymarkDatabase();
  const row = await database.getFirstAsync<CatalogRow>(
    `SELECT id, provider, external_id, barcode, name, brand, image_url,
       basis_amount, basis_unit, carbohydrate_grams, energy_kcal,
       default_serving_amount, default_serving_unit,
       last_portion_amount, last_portion_unit,
       protein_grams, fat_grams, fibre_grams, sugars_grams,
       saturated_fat_grams, nutrition_quality_json, source_label,
       source_url, raw_payload_json
     FROM food_catalog_cache
     WHERE barcode = ?
     ORDER BY CASE provider WHEN 'user' THEN 0 ELSE 1 END,
       last_used_at_ms DESC, cached_at_ms DESC
     LIMIT 1`,
    barcode,
  );
  return row ? candidateFromRow(row) : undefined;
}

export async function getFavoriteFoods(limit = 50) {
  const database = await openDaymarkDatabase();
  const rows = await database.getAllAsync<CatalogRow>(
    `SELECT id, provider, external_id, barcode, name, brand, image_url,
       basis_amount, basis_unit, carbohydrate_grams, energy_kcal,
       default_serving_amount, default_serving_unit,
       last_portion_amount, last_portion_unit,
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

export async function getRecentMealPresets(limit = 6) {
  const database = await openDaymarkDatabase();
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
): Promise<FoodRecipe> {
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
  validateDraft({
    timestamp: Date.now(),
    mealType: draft.mealType,
    items: draft.ingredients,
  });

  const timestamp = Date.now();
  const id = localId('food-recipe', timestamp);
  const nutrition = totalNutrition(draft.ingredients);
  await withDaymarkTransaction(async (database) => {
    for (const ingredient of draft.ingredients) {
      await cacheLoggedFood(database, ingredient, timestamp, false);
    }
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

    for (const [index, ingredient] of draft.ingredients.entries()) {
      const ingredientNutrition = nutritionForFoodAmount(ingredient);
      await database.runAsync(
        `INSERT INTO food_recipe_items (
           id, recipe_id, ordinal, catalog_id, provider, external_id,
           name_snapshot, brand_snapshot, barcode_snapshot, amount, unit,
           carbohydrate_grams, energy_kcal, protein_grams, fat_grams,
           fibre_grams, sugars_grams, saturated_fat_grams,
           source_label, source_url
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
           ?, ?)`,
        `${id}:item:${index}`,
        id,
        index,
        ingredient.food.id,
        ingredient.food.provider,
        ingredient.food.externalId,
        ingredient.food.name,
        ingredient.food.brand ?? null,
        ingredient.food.barcode ?? null,
        ingredient.amount,
        ingredient.unit,
        ...nutritionColumns(ingredientNutrition),
        ingredient.food.sourceLabel,
        ingredient.food.sourceUrl ?? null,
      );
    }
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

export async function getFoodRecipes(limit = 20): Promise<FoodRecipe[]> {
  const database = await openDaymarkDatabase();
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
) {
  const database = await openDaymarkDatabase();
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
}

export async function deleteFoodRecipe(recipeId: string) {
  const database = await openDaymarkDatabase();
  const result = await database.runAsync(
    `DELETE FROM food_recipes WHERE id = ?`,
    recipeId,
  );
  if (result.changes !== 1) {
    throw new Error('The recipe could not be removed.');
  }
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

export async function getFoodLogs(
  range: TimeRange,
  limit = 100,
): Promise<FoodLog[]> {
  const database = await openDaymarkDatabase();
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
) {
  validateDraft(draft);
  const updatedAt = Date.now();
  const adjusted = revisedFoodLog(log, draft, updatedAt.toString(36));

  await withDaymarkTransaction(async (database) => {
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

    for (const item of draft.items) {
      await cacheLoggedFood(database, item, updatedAt, false);
    }

    const contextResult = await database.runAsync(
      `UPDATE context_events
       SET start_ms = ?, title = ?, meal_type = ?, carbs_grams = ?
       WHERE id = ? AND source_id = ? AND origin = 'manual'
         AND kind = 'meal'`,
      adjusted.timestamp,
      adjusted.title,
      adjusted.mealType,
      adjusted.nutrition.carbohydrateGrams ?? 0,
      log.contextEventId,
      FOOD_LOG_SOURCE_ID,
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
    for (const [index, item] of adjusted.items.entries()) {
      await database.runAsync(
        `INSERT INTO food_log_items (
           id, food_log_id, ordinal, catalog_id, provider, external_id,
           name_snapshot, brand_snapshot, barcode_snapshot, amount, unit,
           carbohydrate_grams, energy_kcal, protein_grams, fat_grams,
           fibre_grams, sugars_grams, saturated_fat_grams,
           source_label, source_url
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
           ?, ?)`,
        item.id,
        log.id,
        index,
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
      );
    }
  });

  return adjusted;
}

export async function updateFoodLogPortions(
  log: FoodLog,
  amounts: Record<string, number>,
) {
  const adjusted = adjustedFoodLogPortions(log, amounts);
  const updatedAt = Date.now();
  await withDaymarkTransaction(async (database) => {
    for (const item of adjusted.items) {
      const result = await database.runAsync(
        `UPDATE food_log_items
         SET amount = ?, carbohydrate_grams = ?, energy_kcal = ?,
           protein_grams = ?, fat_grams = ?, fibre_grams = ?,
           sugars_grams = ?, saturated_fat_grams = ?
         WHERE id = ? AND food_log_id = ?`,
        item.amount,
        ...nutritionColumns(item.nutrition),
        item.id,
        log.id,
      );
      if (result.changes !== 1) {
        throw new Error('A saved meal item could not be updated.');
      }
      await database.runAsync(
        `UPDATE food_catalog_cache
         SET last_portion_amount = ?, last_portion_unit = ?,
           last_used_at_ms = ?
         WHERE id = ?`,
        item.amount,
        item.unit,
        updatedAt,
        item.foodId,
      );
    }
    await database.runAsync(
      `UPDATE food_logs
       SET carbohydrate_grams = ?, energy_kcal = ?, protein_grams = ?,
         fat_grams = ?, fibre_grams = ?, sugars_grams = ?,
         saturated_fat_grams = ?, updated_at_ms = ?
       WHERE id = ?`,
      ...nutritionColumns(adjusted.nutrition),
      updatedAt,
      log.id,
    );
    await database.runAsync(
      `UPDATE context_events
       SET carbs_grams = ?
       WHERE id = ? AND source_id = ? AND kind = 'meal'`,
      adjusted.nutrition.carbohydrateGrams ?? 0,
      log.contextEventId,
      FOOD_LOG_SOURCE_ID,
    );
  });
  return adjusted;
}

export async function setMealPresetFavorite(
  logId: string,
  favorite: boolean,
) {
  const database = await openDaymarkDatabase();
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
}

function qualityForSnapshot(value: number | undefined) {
  return value === undefined ? 'missing' as const : value === 0
    ? 'trace' as const
    : 'reported' as const;
}

export async function setFoodFavorite(
  food: FoodCandidate,
  favorite: boolean,
) {
  const database = await openDaymarkDatabase();
  const cachedAt = Date.now();
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
       ?, ?, ?, ?, ?, NULL, ?, 0, NULL)
     ON CONFLICT(id) DO UPDATE SET
       default_serving_amount = excluded.default_serving_amount,
       default_serving_unit = excluded.default_serving_unit,
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
    food.rawPayload === undefined
      ? null
      : JSON.stringify(food.rawPayload),
    cachedAt,
    favorite ? 1 : 0,
  );
}
