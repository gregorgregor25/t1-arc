import rawCatalog from './cofid-2021.json';

import {
  FoodCandidate,
  FoodNutrition,
  FoodNutritionQuality,
  NutrientQuality,
} from './types';

interface RawCofidFood {
  id: string;
  code: string;
  name: string;
  group: string;
  basisUnit: 'g' | 'ml';
  carbs: number | null;
  energyKcal: number | null;
  protein: number | null;
  fat: number | null;
  fibre: number | null;
  sugars: number | null;
  saturatedFat: number | null;
  quality: {
    carbs: NutrientQuality;
    energyKcal: NutrientQuality;
    protein: NutrientQuality;
    fat: NutrientQuality;
    fibre: NutrientQuality;
    sugars: NutrientQuality;
    saturatedFat: NutrientQuality;
  };
  fibreMethod: 'AOAC' | 'NSP';
}

interface RawCofidCatalog {
  schemaVersion: number;
  dataset: string;
  sourceUrl: string;
  sourceSha256: string;
  licence: string;
  nutrientBasis: number;
  foods: RawCofidFood[];
}

const catalog = rawCatalog as RawCofidCatalog;

function optional(value: number | null) {
  return value ?? undefined;
}

function candidate(food: RawCofidFood): FoodCandidate {
  const nutritionPerBasis: FoodNutrition = {
    carbohydrateGrams: optional(food.carbs),
    energyKcal: optional(food.energyKcal),
    proteinGrams: optional(food.protein),
    fatGrams: optional(food.fat),
    fibreGrams: optional(food.fibre),
    sugarsGrams: optional(food.sugars),
    saturatedFatGrams: optional(food.saturatedFat),
  };
  const nutritionQuality: FoodNutritionQuality = {
    carbohydrate: food.quality.carbs,
    energy: food.quality.energyKcal,
    protein: food.quality.protein,
    fat: food.quality.fat,
    fibre: food.quality.fibre,
    sugars: food.quality.sugars,
    saturatedFat: food.quality.saturatedFat,
  };
  return {
    id: food.id,
    provider: 'cofid',
    externalId: food.code,
    name: food.name,
    basisAmount: catalog.nutrientBasis,
    basisUnit: food.basisUnit,
    nutritionPerBasis,
    nutritionQuality,
    defaultServingAmount: 100,
    defaultServingUnit: food.basisUnit,
    sourceLabel: catalog.dataset,
    sourceUrl: catalog.sourceUrl,
  };
}

function normaliseSearchText(value: string) {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('en-GB')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

interface SearchableFood {
  food: RawCofidFood;
  searchName: string;
  words: string[];
}

const CONTEXT_TOKENS = new Set([
  'a',
  'an',
  'available',
  'bakery',
  'co',
  'coop',
  'cooperative',
  'from',
  'made',
  'of',
  'op',
  'the',
  'with',
]);

function editDistanceAtMostOne(left: string, right: string) {
  if (left === right) return true;
  if (Math.abs(left.length - right.length) > 1) return false;
  let leftIndex = 0;
  let rightIndex = 0;
  let edits = 0;
  while (leftIndex < left.length && rightIndex < right.length) {
    if (left[leftIndex] === right[rightIndex]) {
      leftIndex += 1;
      rightIndex += 1;
      continue;
    }
    edits += 1;
    if (edits > 1) return false;
    if (left.length > right.length) leftIndex += 1;
    else if (right.length > left.length) rightIndex += 1;
    else {
      leftIndex += 1;
      rightIndex += 1;
    }
  }
  return edits + Number(leftIndex < left.length || rightIndex < right.length) <= 1;
}

function wordMatchesToken(word: string, token: string) {
  return (
    word === token ||
    word.startsWith(token) ||
    token.startsWith(word) ||
    (token.length >= 5 && word.length >= 5 && editDistanceAtMostOne(word, token))
  );
}

const searchable: SearchableFood[] = catalog.foods.map((food) => {
  const searchName = normaliseSearchText(food.name);
  return { food, searchName, words: searchName.split(' ') };
});

function scoreFood(item: SearchableFood, query: string, tokens: string[]) {
  if (item.searchName === query) return 10_000;
  if (item.searchName.startsWith(query)) {
    return 7_000 - item.searchName.length;
  }
  if (!tokens.every((token) => item.words.some((word) => wordMatchesToken(word, token)))) {
    return -1;
  }

  let score = 3_000;
  for (const token of tokens) {
    const wordIndex = item.words.findIndex((word) => word === token);
    if (wordIndex >= 0) {
      score += 350 - Math.min(wordIndex, 20) * 5;
      continue;
    }
    if (item.words.some((word) => wordMatchesToken(word, token))) {
      score += 180;
    }
  }
  return score - item.searchName.length;
}

export function searchCofidFoods(query: string, limit = 30) {
  const normalised = normaliseSearchText(query);
  if (normalised.length < 2 || limit <= 0) return [];
  const rawTokens = normalised.split(' ').filter(Boolean);
  const meaningfulTokens = rawTokens.filter((token) => !CONTEXT_TOKENS.has(token));
  const tokens = meaningfulTokens.length ? meaningfulTokens : rawTokens;
  const rankingQuery = tokens.join(' ');

  return searchable
    .map((item) => ({ item, score: scoreFood(item, rankingQuery, tokens) }))
    .filter(({ score }) => score >= 0)
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.item.food.name.localeCompare(right.item.food.name, 'en-GB'),
    )
    .slice(0, limit)
    .map(({ item }) => candidate(item.food));
}

export function getCofidFood(id: string) {
  const food = catalog.foods.find((item) => item.id === id);
  return food ? candidate(food) : undefined;
}

export const COFID_CATALOG_INFO = {
  dataset: catalog.dataset,
  sourceUrl: catalog.sourceUrl,
  sourceSha256: catalog.sourceSha256,
  licence: catalog.licence,
  foodCount: catalog.foods.length,
};
