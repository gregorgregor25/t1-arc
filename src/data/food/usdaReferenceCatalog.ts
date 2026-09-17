import rawCatalog from './usda-reference-2026.json';

import { normaliseFoodSearchText } from './foodSearchRanking';
import type {
  FoodCandidate,
  FoodNutrition,
  FoodNutritionQuality,
  NutrientQuality,
} from './types';

interface RawUsdaReferenceFood {
  fdcId: number;
  name: string;
  category: string | null;
  dataType: 'foundation' | 'fndds';
  carbs: number;
  energyKcal: number | null;
  protein: number | null;
  fat: number | null;
  fibre: number | null;
  sugars: number | null;
  saturatedFat: number | null;
  servingGrams: number | null;
  servingLabel: string | null;
}

interface RawUsdaReferenceSource {
  dataType: string;
  release: string;
  url: string;
  archiveSha256: string;
  jsonSha256: string;
  sourceRecordCount: number;
}

interface RawUsdaReferenceCatalog {
  schemaVersion: number;
  dataset: string;
  datasetDetail: string;
  sourceUrl: string;
  licence: string;
  nutrientBasis: number;
  sources: RawUsdaReferenceSource[];
  foods: RawUsdaReferenceFood[];
}

const catalog = rawCatalog as RawUsdaReferenceCatalog;

function optional(value: number | null) {
  return value ?? undefined;
}

function quality(value: number | null): NutrientQuality {
  return value === null ? 'missing' : 'reported';
}

function candidate(food: RawUsdaReferenceFood): FoodCandidate {
  const nutritionPerBasis: FoodNutrition = {
    carbohydrateGrams: food.carbs,
    energyKcal: optional(food.energyKcal),
    proteinGrams: optional(food.protein),
    fatGrams: optional(food.fat),
    fibreGrams: optional(food.fibre),
    sugarsGrams: optional(food.sugars),
    saturatedFatGrams: optional(food.saturatedFat),
  };
  const nutritionQuality: FoodNutritionQuality = {
    carbohydrate: 'reported',
    energy: quality(food.energyKcal),
    protein: quality(food.protein),
    fat: quality(food.fat),
    fibre: quality(food.fibre),
    sugars: quality(food.sugars),
    saturatedFat: quality(food.saturatedFat),
  };
  const id = String(food.fdcId);
  return {
    id: `usda-fdc:${id}`,
    provider: 'usda-fdc',
    externalId: id,
    name: food.name,
    basisAmount: catalog.nutrientBasis,
    basisUnit: 'g',
    nutritionPerBasis,
    nutritionQuality,
    defaultServingAmount: food.servingGrams ?? catalog.nutrientBasis,
    defaultServingUnit: 'g',
    servingLabel: food.servingLabel ?? undefined,
    sourceLabel: catalog.dataset,
    sourceUrl: `https://fdc.nal.usda.gov/food-details/${id}/nutrients`,
  };
}

interface SearchableUsdaReferenceFood {
  food: RawUsdaReferenceFood;
  searchName: string;
  words: string[];
}

const searchable: SearchableUsdaReferenceFood[] = catalog.foods.map((food) => {
  const searchName = normaliseFoodSearchText(
    [food.name, food.category].filter(Boolean).join(' '),
  );
  return { food, searchName, words: searchName.split(' ') };
});
const searchableById = new Map(searchable.map((item) => [String(item.food.fdcId), item]));

export function usdaReferenceSearchFields(food: FoodCandidate) {
  const item = searchableById.get(food.externalId);
  return item ? [item.searchName] : [];
}

function scoreFood(
  item: SearchableUsdaReferenceFood,
  query: string,
  tokens: string[],
) {
  const name = normaliseFoodSearchText(item.food.name);
  if (name === query) return 10_000;
  if (name.startsWith(query)) return 8_000 - name.length;
  if (item.searchName.includes(query)) {
    return 6_000 - item.searchName.indexOf(query) - name.length;
  }
  if (!tokens.every((token) => item.words.some((word) => word.startsWith(token)))) {
    return -1;
  }
  return 4_000 - name.length;
}

export function searchUsdaReferenceFoods(query: string, limit = 40) {
  const normalised = normaliseFoodSearchText(query);
  if (normalised.length < 2 || limit <= 0) return [];
  const tokens = normalised.split(' ').filter(Boolean);

  return searchable
    .map((item) => ({ item, score: scoreFood(item, normalised, tokens) }))
    .filter(({ score }) => score >= 0)
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.item.food.name.localeCompare(right.item.food.name, 'en-US') ||
        left.item.food.fdcId - right.item.food.fdcId,
    )
    .slice(0, limit)
    .map(({ item }) => candidate(item.food));
}

export function getUsdaReferenceFood(id: string) {
  const externalId = id.startsWith('usda-fdc:') ? id.slice('usda-fdc:'.length) : id;
  const fdcId = Number(externalId);
  if (!Number.isInteger(fdcId)) return undefined;
  const food = catalog.foods.find((item) => item.fdcId === fdcId);
  return food ? candidate(food) : undefined;
}

export const USDA_REFERENCE_CATALOG_INFO = {
  dataset: catalog.dataset,
  datasetDetail: catalog.datasetDetail,
  sourceUrl: catalog.sourceUrl,
  licence: catalog.licence,
  foodCount: catalog.foods.length,
  sources: catalog.sources.map((source) => ({ ...source })),
};
