import {
  FoodCandidate,
  FoodNutritionQuality,
  NutrientQuality,
} from './types';
import { servingAmountFromRawPayload } from './servings';
import appPackage from '../../../package.json';

const OPEN_FOOD_FACTS_BASE =
  'https://world.openfoodfacts.org/api/v3/product';
const OPEN_FOOD_FACTS_SEARCH =
  'https://search.openfoodfacts.org/search';
const OPEN_FOOD_FACTS_USER_AGENT =
  `T1Arc/${appPackage.version} (https://github.com/gregorgregor25/daymark)`;
export const OPEN_FOOD_FACTS_REQUEST_TIMEOUT_MS = 8_000;
const OPEN_FOOD_FACTS_NETWORK_ATTEMPTS = 2;
const OPEN_FOOD_FACTS_RETRY_DELAY_MS = 250;
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
  brands?: string | string[];
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

interface OpenFoodFactsSearchResponse {
  hits?: OpenFoodFactsProduct[];
  errors?: unknown[];
  timed_out?: boolean;
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

class OpenFoodFactsRequestTimeoutError extends Error {
  constructor() {
    super('Open Food Facts request timed out.');
    this.name = 'OpenFoodFactsRequestTimeoutError';
  }
}

function wait(milliseconds: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

async function fetchWithTimeout(
  fetchImpl: typeof fetch,
  input: RequestInfo | URL,
  init: RequestInit,
) {
  const controller = new AbortController();
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      controller.abort();
      reject(new OpenFoodFactsRequestTimeoutError());
    }, OPEN_FOOD_FACTS_REQUEST_TIMEOUT_MS);
  });

  try {
    return await Promise.race([
      fetchImpl(input, {
        ...init,
        signal: controller.signal,
      }),
      timeout,
    ]);
  } finally {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
    }
  }
}

async function fetchOpenFoodFacts(
  fetchImpl: typeof fetch,
  input: RequestInfo | URL,
  init: RequestInit,
) {
  let lastError: unknown;
  for (
    let attempt = 1;
    attempt <= OPEN_FOOD_FACTS_NETWORK_ATTEMPTS;
    attempt += 1
  ) {
    try {
      return await fetchWithTimeout(fetchImpl, input, init);
    } catch (error) {
      lastError = error;
      if (attempt < OPEN_FOOD_FACTS_NETWORK_ATTEMPTS) {
        await wait(OPEN_FOOD_FACTS_RETRY_DELAY_MS);
      }
    }
  }
  throw lastError;
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

export function normaliseFoodSearchQuery(value: string) {
  const query = value.replace(/\s+/g, ' ').trim();
  if (query.length < 2) {
    throw new FoodLookupError(
      'incomplete',
      'Enter at least two characters to search branded foods.',
    );
  }
  return query.slice(0, 80);
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

  const basisUnit =
    product.nutrition_data_per?.toLocaleLowerCase('en-GB').includes('ml') ||
    product.product_quantity_unit?.toLocaleLowerCase('en-GB') === 'ml'
      ? 'ml'
      : 'g';
  const servingAmount = servingAmountFromRawPayload(product, basisUnit);
  const externalId = String(product.code ?? barcode);

  const brand = Array.isArray(product.brands)
    ? product.brands.map((value) => value.trim()).filter(Boolean).join(', ')
    : product.brands?.trim();

  return {
    id: `open-food-facts:${externalId}`,
    provider: 'open-food-facts',
    externalId,
    barcode: externalId,
    name,
    brand: brand || undefined,
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
    defaultServingAmount: servingAmount ?? 100,
    defaultServingUnit: basisUnit,
    servingLabel: product.serving_size?.trim() || undefined,
    sourceLabel: 'Open Food Facts',
    sourceUrl: `https://world.openfoodfacts.org/product/${externalId}`,
    rawPayload: product,
  };
}

export function parseOpenFoodFactsSearchResponse(
  response: OpenFoodFactsSearchResponse,
) {
  if (!Array.isArray(response.hits)) {
    throw new FoodLookupError(
      'service',
      'Open Food Facts returned an unreadable search response.',
    );
  }

  const candidates: FoodCandidate[] = [];
  const seen = new Set<string>();
  for (const product of response.hits) {
    const code = String(product.code ?? '').trim();
    if (!code || seen.has(code)) continue;
    try {
      const candidate = parseOpenFoodFactsProduct(code, {
        status: 'success',
        product,
      });
      if (
        candidate.nutritionPerBasis.carbohydrateGrams === undefined
      ) {
        continue;
      }
      candidates.push(candidate);
      seen.add(code);
    } catch (error) {
      if (!(error instanceof FoodLookupError)) throw error;
    }
  }
  return candidates;
}

export async function searchOpenFoodFactsProducts(
  value: string,
  fetchImpl: typeof fetch = globalThis.fetch,
) {
  const query = normaliseFoodSearchQuery(value);
  let response: Response;
  try {
    response = await fetchOpenFoodFacts(fetchImpl, OPEN_FOOD_FACTS_SEARCH, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'User-Agent': OPEN_FOOD_FACTS_USER_AGENT,
      },
      body: JSON.stringify({
        q: `${query} countries_tags:"en:united-kingdom"`,
        page: 1,
        page_size: 20,
        boost_phrase: true,
        langs: ['en'],
        sort_by: 'popularity_key',
        fields: PRODUCT_FIELDS.split(','),
      }),
    });
  } catch {
    throw new FoodLookupError(
      'network',
      'The branded-food search could not reach Open Food Facts.',
    );
  }

  if (response.status === 429) {
    throw new FoodLookupError(
      'rate_limited',
      'Open Food Facts is busy. Try the branded-food search again shortly.',
    );
  }
  if (!response.ok) {
    throw new FoodLookupError(
      'service',
      `Open Food Facts returned HTTP ${response.status}.`,
    );
  }

  let payload: OpenFoodFactsSearchResponse;
  try {
    payload = (await response.json()) as OpenFoodFactsSearchResponse;
  } catch {
    throw new FoodLookupError(
      'service',
      'Open Food Facts returned an unreadable search response.',
    );
  }
  if (payload.timed_out) {
    throw new FoodLookupError(
      'service',
      'The branded-food search timed out. Try again.',
    );
  }
  return parseOpenFoodFactsSearchResponse(payload);
}

export async function lookupOpenFoodFactsBarcode(
  value: string,
  fetchImpl: typeof fetch = globalThis.fetch,
) {
  const barcode = normaliseFoodBarcode(value);
  let response: Response;
  try {
    response = await fetchOpenFoodFacts(
      fetchImpl,
      `${OPEN_FOOD_FACTS_BASE}/${encodeURIComponent(
        barcode,
      )}?fields=${encodeURIComponent(PRODUCT_FIELDS)}`,
      {
        headers: {
          Accept: 'application/json',
          'User-Agent': OPEN_FOOD_FACTS_USER_AGENT,
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
