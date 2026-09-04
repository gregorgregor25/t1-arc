import rawCatalog from './mext-japan-2023.json';

import { normaliseFoodSearchText } from './foodSearchRanking';
import type {
  FoodCandidate,
  FoodNutrition,
  FoodNutritionQuality,
  NutrientQuality,
} from './types';

interface RawMextFood {
  id: string;
  code: string;
  name: string;
  searchName: string;
  group: string;
  carbs: number | null;
  energyKcal: number | null;
  protein: number | null;
  fat: number | null;
  fibre: number | null;
  quality: {
    carbs: NutrientQuality;
    energyKcal: NutrientQuality;
    protein: NutrientQuality;
    fat: NutrientQuality;
    fibre: NutrientQuality;
  };
}

interface RawMextCatalog {
  schemaVersion: number;
  dataset: string;
  datasetEnglish: string;
  sourceUrl: string;
  sourceSha256: string;
  licence: string;
  nutrientBasis: number;
  foods: RawMextFood[];
}

const catalog = rawCatalog as RawMextCatalog;

function optional(value: number | null) {
  return value ?? undefined;
}

function candidate(food: RawMextFood): FoodCandidate {
  const nutritionPerBasis: FoodNutrition = {
    carbohydrateGrams: optional(food.carbs),
    energyKcal: optional(food.energyKcal),
    proteinGrams: optional(food.protein),
    fatGrams: optional(food.fat),
    fibreGrams: optional(food.fibre),
  };
  const nutritionQuality: FoodNutritionQuality = {
    carbohydrate: food.quality.carbs,
    energy: food.quality.energyKcal,
    protein: food.quality.protein,
    fat: food.quality.fat,
    fibre: food.quality.fibre,
    sugars: 'missing',
    saturatedFat: 'missing',
  };
  return {
    id: food.id,
    provider: 'mext-jp',
    externalId: food.code,
    name: food.name,
    basisAmount: catalog.nutrientBasis,
    basisUnit: 'g',
    nutritionPerBasis,
    nutritionQuality,
    defaultServingAmount: 100,
    defaultServingUnit: 'g',
    sourceLabel: catalog.dataset,
    sourceUrl: catalog.sourceUrl,
  };
}

interface SearchableMextFood {
  food: RawMextFood;
  searchName: string;
}

const searchable: SearchableMextFood[] = catalog.foods.map((food) => ({
  food,
  searchName: normaliseFoodSearchText(food.searchName),
}));

function scoreFood(item: SearchableMextFood, query: string, tokens: string[]) {
  if (item.searchName === query) return 10_000;
  if (item.searchName.startsWith(query)) return 7_000 - item.searchName.length;
  if (!tokens.every((token) => item.searchName.includes(token))) return -1;
  return 4_000 - item.searchName.indexOf(query) - item.searchName.length;
}

export function searchMextJapanFoods(query: string, limit = 30) {
  const normalised = normaliseFoodSearchText(query);
  if (normalised.length < 2 || limit <= 0) return [];
  const tokens = normalised.split(' ').filter(Boolean);

  return searchable
    .map((item) => ({ item, score: scoreFood(item, normalised, tokens) }))
    .filter(({ score }) => score >= 0)
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.item.food.name.localeCompare(right.item.food.name, 'ja-JP'),
    )
    .slice(0, limit)
    .map(({ item }) => candidate(item.food));
}

export function getMextJapanFood(id: string) {
  const food = catalog.foods.find((item) => item.id === id);
  return food ? candidate(food) : undefined;
}

export const MEXT_JAPAN_CATALOG_INFO = {
  dataset: catalog.dataset,
  datasetEnglish: catalog.datasetEnglish,
  sourceUrl: catalog.sourceUrl,
  sourceSha256: catalog.sourceSha256,
  licence: catalog.licence,
  foodCount: catalog.foods.length,
};
