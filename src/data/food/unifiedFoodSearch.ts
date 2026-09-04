import { searchCofidFoods } from './cofidCatalog';
import { searchMextJapanFoods } from './mextJapanCatalog';
import {
  FoodSearchEngine,
  FoodSearchOptions,
  FoodSearchProvider,
  FoodSearchSchedulerOptions,
  createFoodSearchEngine,
  createFoodSearchScheduler,
} from './foodSearch';
import { getStoredFoodSearchEntries } from './foodLogRepository';
import { searchOpenFoodFactsProducts } from './openFoodFacts';
import { searchUsdaReferenceFoods } from './usdaReferenceCatalog';
import { resolveRegionalDefaults } from '@/domain/regionalProfile';
import { getRuntimeRegionalProfile } from '@/domain/regionalProfileRuntime';

export const cofidSearchProvider: FoodSearchProvider = {
  id: 'cofid',
  label: "McCance and Widdowson's CoFID 2021",
  kind: 'offline',
  minQueryLength: 2,
  supportsTypeahead: true,
  search(query, { limit }) {
    const defaults = resolveRegionalDefaults(getRuntimeRegionalProfile());
    return defaults.countryCode === 'GB' ? searchCofidFoods(query, limit) : [];
  },
};

export const openFoodFactsSearchProvider: FoodSearchProvider = {
  id: 'open-food-facts',
  label: 'Open Food Facts',
  kind: 'remote',
  // Avoid issuing a public network search for every very short input.
  minQueryLength: 3,
  supportsTypeahead: false,
  cacheScope() {
    const defaults = resolveRegionalDefaults(getRuntimeRegionalProfile());
    return `${defaults.countryCode}|${defaults.locale}`;
  },
  search(query, { signal }) {
    const defaults = resolveRegionalDefaults(getRuntimeRegionalProfile());
    return searchOpenFoodFactsProducts(query, globalThis.fetch, {
      signal,
      countryCode: defaults.countryCode === 'ZZ' ? undefined : defaults.countryCode,
      languageTag: defaults.locale,
    });
  },
};

export const mextJapanSearchProvider: FoodSearchProvider = {
  id: 'mext-jp',
  label: '日本食品標準成分表（八訂）増補2023年',
  kind: 'offline',
  minQueryLength: 2,
  supportsTypeahead: true,
  search(query, { limit }) {
    const defaults = resolveRegionalDefaults(getRuntimeRegionalProfile());
    return defaults.countryCode === 'JP'
      ? searchMextJapanFoods(query, limit)
      : [];
  },
};

export const usdaFoodDataCentralSearchProvider: FoodSearchProvider = {
  id: 'usda-fdc-reference',
  label: 'USDA FoodData Central (offline reference)',
  kind: 'offline',
  minQueryLength: 2,
  supportsTypeahead: true,
  search(query, { limit }) {
    const defaults = resolveRegionalDefaults(getRuntimeRegionalProfile());
    if (defaults.countryCode !== 'US') return [];
    return searchUsdaReferenceFoods(query, limit);
  },
};

export interface DefaultFoodSearchEngineOptions {
  /** Extra brokered providers can be appended without changing the UI. */
  additionalProviders?: readonly FoodSearchProvider[];
}

export function createDefaultFoodSearchEngine(
  options: DefaultFoodSearchEngineOptions = {},
) {
  return createFoodSearchEngine({
    async loadStoredCandidates() {
      const entries = await getStoredFoodSearchEntries();
      return entries.map((entry) => ({
        food: entry.food,
        isFavourite: entry.isFavourite,
        useCount: entry.useCount,
        lastUsedAt: entry.lastUsedAt,
      }));
    },
    providers: [
      cofidSearchProvider,
      mextJapanSearchProvider,
      openFoodFactsSearchProvider,
      usdaFoodDataCentralSearchProvider,
      ...(options.additionalProviders ?? []),
    ],
  });
}

export const defaultFoodSearchEngine = createDefaultFoodSearchEngine();

/** One-call API for screens that do not need their own engine instance. */
export function searchFoods(
  query: string,
  options?: FoodSearchOptions,
) {
  return defaultFoodSearchEngine.search(query, options);
}

/**
 * Preferred UI handoff: retain this controller for the lifetime of the search
 * screen and dispose it on unmount.
 */
export function createDefaultFoodSearchScheduler(
  options?: FoodSearchSchedulerOptions,
) {
  return createFoodSearchScheduler(defaultFoodSearchEngine, options);
}

export type { FoodSearchEngine };
