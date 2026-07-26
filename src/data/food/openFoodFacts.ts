import {
  FoodCandidate,
  FoodNutritionQuality,
  NutrientQuality,
} from './types';

const OPEN_FOOD_FACTS_BASE =
  'https://world.openfoodfacts.org/api/v3/product';
const PRODUCT_FIELDS = [
  'code',
  'product_name',
  'product_name_en',
  'generic_name',
  'brands',
  'image_front_small_url',
  'serving_size',
  'serving_quantity',
  'serving_quantity_unit',
  'nutriments',
  'nutrition_data_per',
  'product_quantity_unit',
].join(',');

interface OpenFoodFactsProduct {
  code?: string | number;
  product_name?: string;
  product_name_en?: string;
  generic_name?: string;
  brands?: string;
  image_front_small_url?: string;
  serving_size?: string;
  serving_quantity?: number | string;
  serving_quantity_unit?: string;
  product_quantity_unit?: string;
  nutrition_data_per?: string;
  nutriments?: Record<string, unknown>;
}

interface OpenFoodFactsResponse {
  status?: string;
  product?: OpenFoodFactsProduct;
  result?: { id?: string; name?: string };
  errors?: unknown[];
}

export type FoodLookupErrorCode =
  | 'invalid_barcode'
  | 'not_found'
  | 'incomplete'
  | 'network'
  | 'rate_limited'
  | 'service';

export class FoodLookupError extends Error {
  constructor(
    readonly code: FoodLookupErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'FoodLookupError';
  }
}

export function normaliseFoodBarcode(value: string) {
  const barcode = value.replace(/[\s-]+/g, '');
  if (!/^\d{7,14}$/.test(barcode)) {
    throw new FoodLookupError(
      'invalid_barcode',
      'Scan or enter a 7–14 digit food barcode.',
    );
  }
  return barcode;
}

function numeric(value: unknown) {
  const number =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim()
        ? Number(value)
        : Number.NaN;
  return Number.isFinite(number) && number >= 0 ? number : undefined;
}

function nutrient(
  nutriments: Record<string, unknown>,
  key: string,
) {
  return numeric(nutriments[`${key}_100g`]);
}

function quality(value: number | undefined): NutrientQuality {
  return value === undefined ? 'missing' : 'reported';
}

export function parseOpenFoodFactsProduct(
  barcode: string,
  response: OpenFoodFactsResponse,
): FoodCandidate {
  const product = response.product;
  if (!product || response.result?.id === 'product_not_found') {
    throw new FoodLookupError(
      'not_found',
      'This barcode is not in Open Food Facts yet.',
    );
  }

  const name = (
    product.product_name_en ||
    product.product_name ||
    product.generic_name ||
    ''
  ).trim();
  if (!name) {
    throw new FoodLookupError(
      'incomplete',
      'The product exists, but its name is missing.',
    );
  }

  const nutriments = product.nutriments ?? {};
  const carbohydrateGrams = nutrient(nutriments, 'carbohydrates');
  const energyKcal = nutrient(nutriments, 'energy-kcal');
  const proteinGrams = nutrient(nutriments, 'proteins');
  const fatGrams = nutrient(nutriments, 'fat');
  const fibreGrams = nutrient(nutriments, 'fiber');
  const sugarsGrams = nutrient(nutriments, 'sugars');
  const saturatedFatGrams = nutrient(nutriments, 'saturated-fat');
  const nutritionQuality: FoodNutritionQuality = {
    carbohydrate: quality(carbohydrateGrams),
    energy: quality(energyKcal),
    protein: quality(proteinGrams),
    fat: quality(fatGrams),
    fibre: quality(fibreGrams),
    sugars: quality(sugarsGrams),
    saturatedFat: quality(saturatedFatGrams),
  };

  const servingUnit =
    product.serving_quantity_unit?.toLocaleLowerCase('en-GB') === 'ml'
      ? 'ml'
      : product.serving_quantity_unit?.toLocaleLowerCase('en-GB') === 'g'
        ? 'g'
        : undefined;
  const servingAmount = numeric(product.serving_quantity);
  const basisUnit =
    product.nutrition_data_per?.toLocaleLowerCase('en-GB').includes('ml') ||
    product.product_quantity_unit?.toLocaleLowerCase('en-GB') === 'ml'
      ? 'ml'
      : 'g';
  const externalId = String(product.code ?? barcode);

  return {
    id: `open-food-facts:${externalId}`,
    provider: 'open-food-facts',
    externalId,
    barcode: externalId,
    name,
    brand: product.brands?.trim() || undefined,
    imageUrl: product.image_front_small_url,
    basisAmount: 100,
    basisUnit,
    nutritionPerBasis: {
      carbohydrateGrams,
      energyKcal,
      proteinGrams,
      fatGrams,
      fibreGrams,
      sugarsGrams,
      saturatedFatGrams,
    },
    nutritionQuality,
    defaultServingAmount:
      servingAmount && servingUnit === basisUnit ? servingAmount : 100,
    defaultServingUnit:
      servingAmount && servingUnit === basisUnit ? servingUnit : basisUnit,
    sourceLabel: 'Open Food Facts',
    sourceUrl: `https://world.openfoodfacts.org/product/${externalId}`,
    rawPayload: product,
  };
}

export async function lookupOpenFoodFactsBarcode(
  value: string,
  fetchImpl: typeof fetch = globalThis.fetch,
) {
  const barcode = normaliseFoodBarcode(value);
  let response: Response;
  try {
    response = await fetchImpl(
      `${OPEN_FOOD_FACTS_BASE}/${encodeURIComponent(
        barcode,
      )}?fields=${encodeURIComponent(PRODUCT_FIELDS)}`,
      {
        headers: {
          Accept: 'application/json',
          'User-Agent':
            'Daymark/1.3 (Android; private personal health app)',
        },
      },
    );
  } catch {
    throw new FoodLookupError(
      'network',
      'The barcode lookup could not reach Open Food Facts.',
    );
  }

  if (response.status === 429) {
    throw new FoodLookupError(
      'rate_limited',
      'Open Food Facts is busy. Try again shortly.',
    );
  }
  if (response.status === 404) {
    throw new FoodLookupError(
      'not_found',
      'This barcode is not in Open Food Facts yet.',
    );
  }
  if (!response.ok) {
    throw new FoodLookupError(
      'service',
      `Open Food Facts returned HTTP ${response.status}.`,
    );
  }

  let payload: OpenFoodFactsResponse;
  try {
    payload = (await response.json()) as OpenFoodFactsResponse;
  } catch {
    throw new FoodLookupError(
      'service',
      'Open Food Facts returned an unreadable response.',
    );
  }
  return parseOpenFoodFactsProduct(barcode, payload);
}
