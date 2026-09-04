import type {
  FoodCandidate,
  FoodNutritionQuality,
  NutrientQuality,
} from './types';
import {
  FoodLookupError,
  normaliseFoodBarcode,
  normaliseFoodSearchQuery,
} from './openFoodFacts';
import { FOOD_CATALOGUE_REGIONAL_CONTEXT_KEY } from './providerRetention';
import { USDA_REFERENCE_CATALOG_INFO } from './usdaReferenceCatalog';

const USDA_FDC_SEARCH_URL = 'https://api.nal.usda.gov/fdc/v1/foods/search';
const USDA_FDC_DEFAULT_API_KEY = 'DEMO_KEY';

export const USDA_FDC_CATALOG_INFO = {
  ...USDA_REFERENCE_CATALOG_INFO,
  apiGuideUrl: 'https://fdc.nal.usda.gov/api-guide/',
} as const;

export function shouldTryFoodDataCentralBarcodeFallback(
  countryCode: string,
  openFoodFactsError: unknown,
) {
  return (
    countryCode.trim().toUpperCase() === 'US' &&
    openFoodFactsError instanceof FoodLookupError &&
    openFoodFactsError.code === 'not_found'
  );
}

interface FoodDataCentralNutrient {
  nutrientId?: number;
  nutrientNumber?: string;
  nutrientName?: string;
  unitName?: string;
  value?: number;
}

export interface FoodDataCentralFood {
  fdcId?: number;
  description?: string;
  dataType?: string;
  brandOwner?: string;
  brandName?: string;
  gtinUpc?: string;
  servingSize?: number;
  servingSizeUnit?: string;
  householdServingFullText?: string;
  foodNutrients?: FoodDataCentralNutrient[];
}

export interface FoodDataCentralSearchResponse {
  foods?: FoodDataCentralFood[];
}

export interface FoodDataCentralRequestOptions {
  signal?: AbortSignal;
  apiKey?: string;
  limit?: number;
}

function numeric(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : undefined;
}

function nutrientValue(
  food: FoodDataCentralFood,
  ids: readonly number[],
  numbers: readonly string[] = [],
) {
  const nutrient = food.foodNutrients?.find(
    (candidate) =>
      (candidate.nutrientId !== undefined && ids.includes(candidate.nutrientId)) ||
      (candidate.nutrientNumber !== undefined &&
        numbers.includes(candidate.nutrientNumber)),
  );
  return numeric(nutrient?.value);
}

function quality(value: number | undefined): NutrientQuality {
  return value === undefined ? 'missing' : 'reported';
}

export function parseFoodDataCentralFood(
  food: FoodDataCentralFood,
): FoodCandidate {
  const fdcId = numeric(food.fdcId);
  const name = food.description?.replace(/\s+/g, ' ').trim();
  if (fdcId === undefined || !name) {
    throw new FoodLookupError(
      'incomplete',
      'FoodData Central returned a food without a usable identity.',
    );
  }

  const carbohydrateGrams = nutrientValue(food, [1005], ['1005']);
  if (carbohydrateGrams === undefined) {
    throw new FoodLookupError(
      'incomplete',
      'FoodData Central has no carbohydrate value for this food.',
    );
  }
  const energyKcal = nutrientValue(food, [1008], ['1008']);
  const energyKilojoules = nutrientValue(food, [1062], ['1062']);
  const resolvedEnergyKcal =
    energyKcal ??
    (energyKilojoules === undefined
      ? undefined
      : Math.round((energyKilojoules / 4.184) * 10) / 10);
  const proteinGrams = nutrientValue(food, [1003], ['1003']);
  const fatGrams = nutrientValue(food, [1004], ['1004']);
  const fibreGrams = nutrientValue(food, [1079], ['1079']);
  const sugarsGrams = nutrientValue(food, [2000], ['2000']);
  const saturatedFatGrams = nutrientValue(food, [1258], ['1258']);
  const nutritionQuality: FoodNutritionQuality = {
    carbohydrate: quality(carbohydrateGrams),
    energy: quality(resolvedEnergyKcal),
    protein: quality(proteinGrams),
    fat: quality(fatGrams),
    fibre: quality(fibreGrams),
    sugars: quality(sugarsGrams),
    saturatedFat: quality(saturatedFatGrams),
  };

  const barcode = food.gtinUpc?.replace(/\D/g, '') || undefined;
  const servingUnit = food.servingSizeUnit?.trim().toLowerCase();
  const servingAmount =
    servingUnit && ['g', 'gm', 'grm'].includes(servingUnit)
      ? numeric(food.servingSize)
      : undefined;
  const brand = (food.brandName || food.brandOwner)?.replace(/\s+/g, ' ').trim();
  const id = String(fdcId);

  return {
    id: `usda-fdc:${id}`,
    provider: 'usda-fdc',
    externalId: id,
    name,
    brand: brand || undefined,
    barcode,
    basisAmount: 100,
    basisUnit: 'g',
    nutritionPerBasis: {
      carbohydrateGrams,
      energyKcal: resolvedEnergyKcal,
      proteinGrams,
      fatGrams,
      fibreGrams,
      sugarsGrams,
      saturatedFatGrams,
    },
    nutritionQuality,
    defaultServingAmount: servingAmount ?? 100,
    defaultServingUnit: 'g',
    servingLabel: food.householdServingFullText?.trim() || undefined,
    sourceLabel: USDA_FDC_CATALOG_INFO.dataset,
    sourceUrl: `https://fdc.nal.usda.gov/food-details/${id}/nutrients`,
    rawPayload: {
      serving_size: food.householdServingFullText?.trim() || undefined,
      [FOOD_CATALOGUE_REGIONAL_CONTEXT_KEY]: {
        countryCode: 'US',
        languageTag: 'en',
      },
    },
  };
}

async function requestFoodDataCentral(
  query: string,
  fetchImpl: typeof fetch,
  options: FoodDataCentralRequestOptions,
) {
  let response: Response;
  try {
    const parameters = new URLSearchParams({
      // USDA documents DEMO_KEY specifically for public exploration. Never
      // embed a personal data.gov key in the client bundle; callers may inject
      // a key only for tests or a future secure broker boundary.
      api_key: options.apiKey?.trim() || USDA_FDC_DEFAULT_API_KEY,
    });
    response = await fetchImpl(`${USDA_FDC_SEARCH_URL}?${parameters}`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query,
        pageSize: Math.max(1, Math.min(options.limit ?? 25, 50)),
        pageNumber: 1,
      }),
      signal: options.signal,
    });
  } catch {
    if (options.signal?.aborted) {
      throw new FoodLookupError('cancelled', 'The US food search was cancelled.');
    }
    throw new FoodLookupError(
      'network',
      'The US food search could not reach USDA FoodData Central.',
    );
  }
  if (response.status === 429) {
    throw new FoodLookupError(
      'rate_limited',
      'The public USDA food-search allowance has been reached. Try again later.',
    );
  }
  if (!response.ok) {
    throw new FoodLookupError(
      'service',
      `USDA FoodData Central returned HTTP ${response.status}.`,
    );
  }
  try {
    return (await response.json()) as FoodDataCentralSearchResponse;
  } catch {
    throw new FoodLookupError(
      'service',
      'USDA FoodData Central returned an unreadable response.',
    );
  }
}

export async function searchFoodDataCentralFoods(
  value: string,
  fetchImpl: typeof fetch = globalThis.fetch,
  options: FoodDataCentralRequestOptions = {},
) {
  const query = normaliseFoodSearchQuery(value);
  const payload = await requestFoodDataCentral(query, fetchImpl, options);
  const observedAt = Date.now();
  return (payload.foods ?? []).flatMap((food) => {
    try {
      return [{ ...parseFoodDataCentralFood(food), catalogueObservedAt: observedAt }];
    } catch (error) {
      if (error instanceof FoodLookupError) return [];
      throw error;
    }
  });
}

export async function lookupFoodDataCentralBarcode(
  value: string,
  fetchImpl: typeof fetch = globalThis.fetch,
  options: FoodDataCentralRequestOptions = {},
) {
  const barcode = normaliseFoodBarcode(value);
  const payload = await requestFoodDataCentral(barcode, fetchImpl, {
    ...options,
    limit: 25,
  });
  const match = (payload.foods ?? []).find(
    (food) => food.gtinUpc?.replace(/\D/g, '') === barcode,
  );
  if (!match) {
    throw new FoodLookupError(
      'not_found',
      'This barcode is not in USDA FoodData Central.',
    );
  }
  return {
    ...parseFoodDataCentralFood(match),
    barcode,
    catalogueObservedAt: Date.now(),
  };
}
