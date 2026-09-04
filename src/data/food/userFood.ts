import {
  FoodCandidate,
  FoodNutrition,
  FoodNutritionQuality,
  NutrientQuality,
  UserFoodDraft,
} from './types';

const nutrientEntries = [
  ['carbohydrateGrams', 'Carbohydrate'],
  ['energyKcal', 'Energy'],
  ['proteinGrams', 'Protein'],
  ['fatGrams', 'Fat'],
  ['fibreGrams', 'Fibre'],
  ['sugarsGrams', 'Sugars'],
  ['saturatedFatGrams', 'Saturated fat'],
] as const;

function validateNutrition(nutrition: FoodNutrition) {
  for (const [key, label] of nutrientEntries) {
    const value = nutrition[key];
    if (value === undefined) continue;
    if (!Number.isFinite(value) || value < 0) {
      throw new Error(`${label} must be zero or more.`);
    }
    const maximum = key === 'energyKcal' ? 20_000 : 10_000;
    if (value > maximum) {
      throw new Error(`${label} is outside the supported range.`);
    }
  }
  if (nutrition.carbohydrateGrams === undefined) {
    throw new Error('Enter carbohydrate for the serving.');
  }
}

function quality(value: number | undefined): NutrientQuality {
  return value === undefined ? 'missing' : value === 0 ? 'trace' : 'reported';
}

function nutritionQuality(
  nutrition: FoodNutrition,
): FoodNutritionQuality {
  return {
    carbohydrate: quality(nutrition.carbohydrateGrams),
    energy: quality(nutrition.energyKcal),
    protein: quality(nutrition.proteinGrams),
    fat: quality(nutrition.fatGrams),
    fibre: quality(nutrition.fibreGrams),
    sugars: quality(nutrition.sugarsGrams),
    saturatedFat: quality(nutrition.saturatedFatGrams),
  };
}

export function createUserFoodCandidate(
  draft: UserFoodDraft,
  createdAt = Date.now(),
  entropy = Math.random().toString(36).slice(2, 10),
): FoodCandidate {
  const name = draft.name.trim();
  const brand = draft.brand?.trim() || undefined;
  const barcode = draft.barcode?.replace(/[\s-]+/g, '') || undefined;
  if (!name) throw new Error('Enter a food name.');
  if (name.length > 120) throw new Error('Food name is too long.');
  if (brand && brand.length > 80) throw new Error('Brand name is too long.');
  if (barcode && !/^\d{7,14}$/.test(barcode)) {
    throw new Error('Barcode must contain 7–14 digits.');
  }
  if (
    !Number.isFinite(draft.servingAmount) ||
    draft.servingAmount <= 0 ||
    draft.servingAmount > 10_000
  ) {
    throw new Error('Serving amount must be between 0 and 10,000.');
  }
  validateNutrition(draft.nutritionPerServing);

  const externalId = barcode
    ? `barcode:${barcode}`
    : `${createdAt}-${entropy}`;
  return {
    id: `user:${externalId}`,
    provider: 'user',
    externalId,
    barcode,
    name,
    brand,
    basisAmount: draft.servingAmount,
    basisUnit: draft.servingUnit,
    nutritionPerBasis: { ...draft.nutritionPerServing },
    nutritionQuality: nutritionQuality(draft.nutritionPerServing),
    defaultServingAmount: draft.servingAmount,
    defaultServingUnit: draft.servingUnit,
    servingLabel: `1 serving (${draft.servingAmount} ${draft.servingUnit})`,
    sourceLabel: 'My foods',
    rawPayload: {
      createdAt,
      enteredOnDevice: true,
      barcode,
      serving_size: `1 serving (${draft.servingAmount} ${draft.servingUnit})`,
    },
  };
}
