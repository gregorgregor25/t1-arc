import rawCatalog from './mext-japan-2023.json';

import { isFoodSearchQueryReady, normaliseFoodSearchText } from './foodSearchRanking';
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
  searchFields: string[];
}

/** Script folding affects retrieval only; source names and preparations stay intact. */
export function normaliseMextSearchQuery(value: string) {
  return normaliseFoodSearchText(value.normalize('NFKC')
    .replace(/[\u30a1-\u30f6]/g, (letter) => String.fromCharCode(letter.charCodeAt(0) - 0x60)));
}

function everydayAliases(name: string) {
  const aliases: string[] = [];
  // Cooked rice aliases deliberately never match the uncooked 水稲穀粒 rows.
  if (name.startsWith('こめ') && name.includes('水稲めし')) {
    aliases.push('ごはん ご飯 飯 炊いた米');
    if (name.includes('精白米 うるち米')) aliases.push('白ごはん 白飯');
  }
  const rules: [RegExp, string][] = [
    [/^うし /, '牛肉 ぎゅうにく'],
    [/^ぶた /, '豚肉 ぶたにく'],
    [/^にわとり /, '鶏肉 とりにく チキン'],
    [/^鶏卵 /, '卵 たまご 玉子'],
    [/豆腐/, 'とうふ トーフ'],
    [/^じゃがいも /, 'じゃが芋 ジャガイモ'],
    [/^ほうれんそう /, 'ほうれん草 ホウレンソウ'],
    [/（たまねぎ類） たまねぎ /, '玉ねぎ 玉葱'],
    [/（にんじん類） にんじん /, '人参 ニンジン'],
    [/（だいこん類） だいこん /, '大根 ダイコン'],
    [/^りんご /, '林檎 リンゴ'],
  ];
  for (const [pattern, alias] of rules) if (pattern.test(name)) aliases.push(alias);
  return aliases;
}

const searchable: SearchableMextFood[] = catalog.foods.map((food) => {
  const searchName = normaliseMextSearchQuery(food.searchName);
  return {
    food,
    searchName,
    searchFields: [searchName, ...everydayAliases(food.name)
      .map((alias) => normaliseMextSearchQuery(`${alias} ${food.name}`))],
  };
});
const searchableById = new Map(searchable.map((item) => [item.food.code, item]));

export function mextJapanSearchFields(food: FoodCandidate) {
  return searchableById.get(food.externalId)?.searchFields ?? [];
}

function scoreFood(item: SearchableMextFood, query: string, tokens: string[]) {
  if (item.searchName === query) return 10_000;
  if (item.searchName.startsWith(query)) return 7_000 - item.searchName.length;
  const indexed = item.searchFields.join(' ');
  if (!tokens.every((token) => indexed.includes(token))) return -1;
  const nameMatches = tokens.every((token) => item.searchName.includes(token));
  const plainCookedRice = !nameMatches && item.food.name.includes('水稲めし') &&
    item.food.name.includes('精白米 うるち米');
  return (nameMatches ? 4_000 : plainCookedRice ? 3_900 : 3_500) - item.searchName.length;
}

export function searchMextJapanFoods(query: string, limit = 30) {
  const normalised = normaliseMextSearchQuery(query);
  if (!isFoodSearchQueryReady(normalised) || limit <= 0) return [];
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
