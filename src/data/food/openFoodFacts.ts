import {
  FoodCandidate,
  FoodNutritionQuality,
  NutrientQuality,
} from './types';
import { servingAmountFromRawPayload } from './servings';
import { FOOD_CATALOGUE_REGIONAL_CONTEXT_KEY } from './providerRetention';
import appPackage from '../../../package.json';
import { isFoodSearchQueryReady } from './foodSearchRanking';
import { openFoodFactsCountryTag } from './openFoodFactsCountries';

const OPEN_FOOD_FACTS_BASE =
  'https://world.openfoodfacts.org/api/v3/product';
const OPEN_FOOD_FACTS_SEARCH =
  'https://search.openfoodfacts.org/search';
// Open Food Facts accepts an actionable URL or contact information in its
// official User-Agent format. The public issue tracker is the project's
// configured support route; no public support email is stored in this repo.
const OPEN_FOOD_FACTS_USER_AGENT =
  `T1Arc/${appPackage.version} (https://github.com/gregorgregor25/t1-arc/issues)`;
export const OPEN_FOOD_FACTS_REQUEST_TIMEOUT_MS = 8_000;
const OPEN_FOOD_FACTS_NETWORK_ATTEMPTS = 2;
const OPEN_FOOD_FACTS_RETRY_DELAY_MS = 250;
export const OPEN_FOOD_FACTS_MINIMUM_INTERVAL_MS = {
  search: 6_500,
  // Public product reads are limited to 15/minute. Keep headroom above 4s.
  product: 4_200,
} as const;
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
  [key: string]: unknown;
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
  page_count?: number;
  count?: number;
  is_count_exact?: boolean;
  errors?: unknown[];
  timed_out?: boolean;
}

export type FoodLookupErrorCode =
  | 'invalid_barcode'
  | 'not_found'
  | 'incomplete'
  | 'cancelled'
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

class OpenFoodFactsRequestCancelledError extends Error {
  constructor() {
    super('Open Food Facts request cancelled.');
    this.name = 'OpenFoodFactsRequestCancelledError';
  }
}

export interface FoodLookupRequestOptions {
  signal?: AbortSignal;
  rateGate?: OpenFoodFactsRateGate;
  /** ISO country context used to rank/filter products sold locally. */
  countryCode?: string;
  /** Preferred BCP-47 language tag used for product names and taxonomy labels. */
  languageTag?: string;
  page?: number;
  pageSize?: number;
  countryScope?: 'local' | 'worldwide';
}

export type OpenFoodFactsEndpoint = keyof typeof OPEN_FOOD_FACTS_MINIMUM_INTERVAL_MS;

export interface OpenFoodFactsRateGate {
  waitForTurn(endpoint: OpenFoodFactsEndpoint, signal?: AbortSignal): Promise<void>;
  observeResponse(endpoint: OpenFoodFactsEndpoint, response: Response): void;
}

interface CreateOpenFoodFactsRateGateOptions {
  now?: () => number;
  wallNow?: () => number;
  delay?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
  minimumIntervalMs?: Partial<Record<OpenFoodFactsEndpoint, number>>;
}

function wait(milliseconds: number, signal?: AbortSignal) {
  if (signal?.aborted) {
    return Promise.reject(new OpenFoodFactsRequestCancelledError());
  }
  if (milliseconds <= 0) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      signal?.removeEventListener('abort', cancel);
      resolve();
    }, milliseconds);
    const cancel = () => {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', cancel);
      reject(new OpenFoodFactsRequestCancelledError());
    };
    signal?.addEventListener('abort', cancel, { once: true });
  });
}

function retryAfterMilliseconds(value: string | null, wallNow: number) {
  if (!value?.trim()) return undefined;
  const seconds = Number(value.trim());
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1_000;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? Math.max(0, timestamp - wallNow) : undefined;
}

function waitForPreviousTurn(previous: Promise<void>, signal?: AbortSignal) {
  if (!signal) return previous;
  if (signal.aborted) {
    return Promise.reject(new OpenFoodFactsRequestCancelledError());
  }
  return new Promise<void>((resolve, reject) => {
    const cancel = () => {
      cleanup();
      reject(new OpenFoodFactsRequestCancelledError());
    };
    const cleanup = () => signal.removeEventListener('abort', cancel);
    signal.addEventListener('abort', cancel, { once: true });
    previous.then(
      () => {
        cleanup();
        resolve();
      },
      (error) => {
        cleanup();
        reject(error);
      },
    );
  });
}

/**
 * Reserves endpoint-specific request slots synchronously before waiting, so
 * concurrent callers cannot burst through the public API limits. Clock
 * rollback preserves the remaining wait instead of extending it indefinitely.
 */
export function createOpenFoodFactsRateGate(
  options: CreateOpenFoodFactsRateGateOptions = {},
): OpenFoodFactsRateGate {
  const now = options.now ?? Date.now;
  const wallNow = options.wallNow ?? Date.now;
  const delay = options.delay ?? wait;
  const intervals = {
    search:
      options.minimumIntervalMs?.search ??
      OPEN_FOOD_FACTS_MINIMUM_INTERVAL_MS.search,
    product:
      options.minimumIntervalMs?.product ??
      OPEN_FOOD_FACTS_MINIMUM_INTERVAL_MS.product,
  };
  const nextAllowedAt: Record<OpenFoodFactsEndpoint, number> = {
    search: 0,
    product: 0,
  };
  const backoffUntil: Record<OpenFoodFactsEndpoint, number> = {
    search: 0,
    product: 0,
  };
  const queueTail: Record<OpenFoodFactsEndpoint, Promise<void>> = {
    search: Promise.resolve(),
    product: Promise.resolve(),
  };
  let lastObservedAt = now();

  const stableNow = () => {
    const current = now();
    if (current < lastObservedAt) {
      const rollback = lastObservedAt - current;
      nextAllowedAt.search = Math.max(current, nextAllowedAt.search - rollback);
      nextAllowedAt.product = Math.max(current, nextAllowedAt.product - rollback);
      backoffUntil.search = Math.max(current, backoffUntil.search - rollback);
      backoffUntil.product = Math.max(current, backoffUntil.product - rollback);
    }
    lastObservedAt = current;
    return current;
  };

  return {
    async waitForTurn(endpoint, signal) {
      if (signal?.aborted) throw new OpenFoodFactsRequestCancelledError();
      const previous = queueTail[endpoint];
      let release!: () => void;
      const turn = new Promise<void>((resolve) => {
        release = resolve;
      });
      queueTail[endpoint] = previous.catch(() => undefined).then(() => turn);
      try {
        await waitForPreviousTurn(previous, signal);
        while (true) {
          const current = stableNow();
          const permittedAt = Math.max(
            current,
            nextAllowedAt[endpoint],
            backoffUntil[endpoint],
          );
          await delay(Math.max(0, permittedAt - current), signal);
          const dispatchAt = stableNow();
          // Retry-After can arrive while this call is queued. Re-check shared
          // backoff immediately before allowing the physical fetch to start.
          if (
            dispatchAt < nextAllowedAt[endpoint] ||
            dispatchAt < backoffUntil[endpoint]
          ) {
            continue;
          }
          nextAllowedAt[endpoint] =
            dispatchAt + Math.max(0, intervals[endpoint]);
          return;
        }
      } finally {
        release();
      }
    },

    observeResponse(endpoint, response) {
      if (response.status !== 429) return;
      const retryAfter = retryAfterMilliseconds(
        response.headers.get('Retry-After'),
        wallNow(),
      );
      if (retryAfter === undefined) return;
      const current = stableNow();
      backoffUntil[endpoint] = Math.max(
        backoffUntil[endpoint],
        current + retryAfter,
      );
    },
  };
}

const defaultOpenFoodFactsRateGate = createOpenFoodFactsRateGate();

async function fetchWithTimeout(
  fetchImpl: typeof fetch,
  input: RequestInfo | URL,
  init: RequestInit,
) {
  if (init.signal?.aborted) {
    throw new OpenFoodFactsRequestCancelledError();
  }
  const controller = new AbortController();
  const externalSignal = init.signal;
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  let abortHandler: (() => void) | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      controller.abort();
      reject(new OpenFoodFactsRequestTimeoutError());
    }, OPEN_FOOD_FACTS_REQUEST_TIMEOUT_MS);
  });
  const cancelled = new Promise<never>((_, reject) => {
    abortHandler = () => {
      controller.abort();
      reject(new OpenFoodFactsRequestCancelledError());
    };
    if (externalSignal?.aborted) abortHandler();
    else externalSignal?.addEventListener('abort', abortHandler, { once: true });
  });

  try {
    return await Promise.race([
      fetchImpl(input, {
        ...init,
        signal: controller.signal,
      }),
      timeout,
      cancelled,
    ]);
  } finally {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
    }
    if (abortHandler) externalSignal?.removeEventListener('abort', abortHandler);
  }
}

async function fetchOpenFoodFacts(
  fetchImpl: typeof fetch,
  input: RequestInfo | URL,
  init: RequestInit,
  endpoint: OpenFoodFactsEndpoint,
  rateGate: OpenFoodFactsRateGate,
) {
  let lastError: unknown;
  for (
    let attempt = 1;
    attempt <= OPEN_FOOD_FACTS_NETWORK_ATTEMPTS;
    attempt += 1
  ) {
    try {
      await rateGate.waitForTurn(endpoint, init.signal ?? undefined);
      const response = await fetchWithTimeout(fetchImpl, input, init);
      rateGate.observeResponse(endpoint, response);
      return response;
    } catch (error) {
      if (init.signal?.aborted) throw error;
      lastError = error;
      if (attempt < OPEN_FOOD_FACTS_NETWORK_ATTEMPTS) {
        await wait(OPEN_FOOD_FACTS_RETRY_DELAY_MS, init.signal ?? undefined);
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
  if (!isFoodSearchQueryReady(query)) {
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
  languageTag = 'en',
  countryCode = 'ZZ',
): FoodCandidate {
  const product = response.product;
  if (!product || response.result?.id === 'product_not_found') {
    throw new FoodLookupError(
      'not_found',
      'This barcode is not in Open Food Facts yet.',
    );
  }

  const language = languageTag.split('-')[0]!.toLowerCase();
  const localisedName = product[`product_name_${language}`];
  const name = (
    (typeof localisedName === 'string' ? localisedName : undefined) ||
    product.product_name ||
    product.product_name_en ||
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
    rawPayload: {
      ...product,
      [FOOD_CATALOGUE_REGIONAL_CONTEXT_KEY]: {
        countryCode: /^[A-Z]{2}$/.test(countryCode.trim().toUpperCase())
          ? countryCode.trim().toUpperCase()
          : 'ZZ',
        languageTag: language,
      },
    },
  };
}

export function parseOpenFoodFactsSearchResponse(
  response: OpenFoodFactsSearchResponse,
  languageTag = 'en',
  countryCode = 'ZZ',
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
      }, languageTag, countryCode);
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

export function openFoodFactsSearchFields(food: FoodCandidate) {
  const payload = food.rawPayload;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return [];
  return Object.entries(payload as Record<string, unknown>)
    .filter(([key, value]) => typeof value === 'string' &&
      (key === 'generic_name' || key === 'product_name' || key.startsWith('product_name_')))
    .slice(0, 8).map(([, value]) => String(value).slice(0, 240));
}

export async function searchOpenFoodFactsPage(
  value: string,
  fetchImpl: typeof fetch = globalThis.fetch,
  options: FoodLookupRequestOptions = {},
) {
  const query = normaliseFoodSearchQuery(value);
  const language = (options.languageTag ?? 'en').split('-')[0]!.toLowerCase();
  const country = options.countryCode?.trim().toUpperCase();
  const countryTag = options.countryScope === 'worldwide'
    ? undefined : openFoodFactsCountryTag(country);
  const page = Number.isFinite(options.page)
    ? Math.max(1, Math.min(Math.floor(options.page!), 10)) : 1;
  const pageSize = Number.isFinite(options.pageSize)
    ? Math.max(1, Math.min(Math.floor(options.pageSize!), 50)) : 20;
  let response: Response;
  try {
    response = await fetchOpenFoodFacts(
      fetchImpl,
      OPEN_FOOD_FACTS_SEARCH,
      {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'User-Agent': OPEN_FOOD_FACTS_USER_AGENT,
        },
        body: JSON.stringify({
          q: countryTag
            ? `${query} countries_tags:"${countryTag}"`
            : query,
          page,
          page_size: pageSize,
          boost_phrase: true,
          langs: [language],
          fields: [
            ...PRODUCT_FIELDS.split(','),
            `product_name_${language}`,
          ],
        }),
        signal: options.signal,
      },
      'search',
      options.rateGate ?? defaultOpenFoodFactsRateGate,
    );
  } catch {
    if (options.signal?.aborted) {
      throw new FoodLookupError('cancelled', 'The branded-food search was cancelled.');
    }
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
  const catalogueObservedAt = Date.now();
  const foods = parseOpenFoodFactsSearchResponse(
    payload,
    language,
    country ?? 'ZZ',
  ).map((food) => ({
      ...food,
      catalogueObservedAt,
    }));
  const hasMore = typeof payload.page_count === 'number' && Number.isFinite(payload.page_count)
    ? page < payload.page_count
    : typeof payload.count === 'number' && Number.isFinite(payload.count) && payload.is_count_exact !== false
      ? page * pageSize < payload.count
      : (payload.hits?.length ?? 0) >= pageSize;
  return { foods, hasMore: page < 10 && hasMore };
}

/** Compatibility API for callers that only need a page's foods. */
export async function searchOpenFoodFactsProducts(
  value: string,
  fetchImpl: typeof fetch = globalThis.fetch,
  options: FoodLookupRequestOptions = {},
) {
  return (await searchOpenFoodFactsPage(value, fetchImpl, options)).foods;
}

export async function lookupOpenFoodFactsBarcode(
  value: string,
  fetchImpl: typeof fetch = globalThis.fetch,
  options: FoodLookupRequestOptions = {},
) {
  const barcode = normaliseFoodBarcode(value);
  const language = (options.languageTag ?? 'en').split('-')[0]!.toLowerCase();
  const country = options.countryCode?.trim().toLowerCase();
  const regionalParameters = new URLSearchParams({
    fields: [PRODUCT_FIELDS, `product_name_${language}`].join(','),
    lc: language,
    tags_lc: language,
  });
  if (country && /^[a-z]{2}$/.test(country)) regionalParameters.set('cc', country);
  let response: Response;
  try {
    response = await fetchOpenFoodFacts(
      fetchImpl,
      `${OPEN_FOOD_FACTS_BASE}/${encodeURIComponent(barcode)}?${regionalParameters.toString()}`,
      {
        headers: {
          Accept: 'application/json',
          'User-Agent': OPEN_FOOD_FACTS_USER_AGENT,
        },
        signal: options.signal,
      },
      'product',
      options.rateGate ?? defaultOpenFoodFactsRateGate,
    );
  } catch {
    if (options.signal?.aborted) {
      throw new FoodLookupError('cancelled', 'The barcode lookup was cancelled.');
    }
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
  return {
    ...parseOpenFoodFactsProduct(
      barcode,
      payload,
      language,
      country?.toUpperCase() ?? 'ZZ',
    ),
    catalogueObservedAt: Date.now(),
  };
}
