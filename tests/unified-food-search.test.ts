import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_REGIONAL_PROFILE } from '@/domain/regionalProfile';
import { setRuntimeRegionalProfile } from '@/domain/regionalProfileRuntime';

import {
  createDefaultFoodSearchEngine,
  openFoodFactsSearchProvider,
} from '@/data/food/unifiedFoodSearch';

const mocks = vi.hoisted(() => ({
  loadStored: vi.fn(),
  searchOpenFoodFacts: vi.fn(),
}));

vi.mock('@/data/food/foodLogRepository', () => ({
  getStoredFoodSearchEntries: mocks.loadStored,
}));

vi.mock('@/data/food/openFoodFacts', () => ({
  searchOpenFoodFactsProducts: mocks.searchOpenFoodFacts,
}));

const remoteFood = {
  id: 'open-food-facts:5000157071644',
  provider: 'open-food-facts' as const,
  externalId: '5000157071644',
  name: 'Heinz baked beans',
  brand: 'Heinz',
  barcode: '5000157071644',
  basisAmount: 100,
  basisUnit: 'g' as const,
  nutritionPerBasis: { carbohydrateGrams: 12.5 },
  nutritionQuality: {
    carbohydrate: 'reported' as const,
    energy: 'missing' as const,
    protein: 'missing' as const,
    fat: 'missing' as const,
    fibre: 'missing' as const,
    sugars: 'missing' as const,
    saturatedFat: 'missing' as const,
  },
  sourceLabel: 'Open Food Facts',
};

describe('default unified food search policy', () => {
  beforeEach(() => {
    mocks.loadStored.mockReset().mockResolvedValue([]);
    mocks.searchOpenFoodFacts.mockReset().mockResolvedValue([remoteFood]);
  });

  afterEach(() => {
    setRuntimeRegionalProfile({ ...DEFAULT_REGIONAL_PROFILE });
  });

  it('never sends typeahead text to Open Food Facts', async () => {
    const engine = createDefaultFoodSearchEngine();
    const response = await engine.search('baked beans', { mode: 'typeahead' });

    expect(mocks.searchOpenFoodFacts).not.toHaveBeenCalled();
    expect(response.providers.find((provider) => provider.id === 'open-food-facts')).toMatchObject({
      state: 'skipped',
      skipReason: 'submission-required',
    });
  });

  it('includes Open Food Facts after a deliberate universal search submission', async () => {
    const engine = createDefaultFoodSearchEngine();
    const response = await engine.search('baked beans', { mode: 'submitted' });

    expect(mocks.searchOpenFoodFacts).toHaveBeenCalledOnce();
    expect(response.results.some((result) => result.food.id === remoteFood.id)).toBe(true);
  });

  it('keeps the public provider fail-closed during typeahead', () => {
    expect(openFoodFactsSearchProvider.supportsTypeahead).toBe(false);
  });

  it('searches the bundled USDA reference without a network request for US users', async () => {
    setRuntimeRegionalProfile({
      ...DEFAULT_REGIONAL_PROFILE,
      region: 'us',
      countryCode: 'US',
      languageTag: 'en-US',
      analysisTimeZone: 'America/New_York',
      followDeviceTimeZone: false,
      glucoseUnit: 'mgDl',
      measurementSystem: 'imperial',
    });

    const engine = createDefaultFoodSearchEngine();
    const response = await engine.search('peanut butter', { mode: 'typeahead' });

    expect(mocks.searchOpenFoodFacts).not.toHaveBeenCalled();
    expect(
      response.providers.find((provider) => provider.id === 'usda-fdc-reference'),
    ).toMatchObject({
      kind: 'offline',
      state: 'success',
    });
    expect(response.results.some((result) => result.food.provider === 'usda-fdc')).toBe(
      true,
    );
  });

  it('offers the bundled Japanese catalogue only for the Japan profile', async () => {
    setRuntimeRegionalProfile({
      ...DEFAULT_REGIONAL_PROFILE,
      region: 'japan',
      countryCode: 'JP',
      languageTag: 'ja-JP',
      analysisTimeZone: 'Asia/Tokyo',
      followDeviceTimeZone: false,
      glucoseUnit: 'mgDl',
    });

    const engine = createDefaultFoodSearchEngine();
    const response = await engine.search('りんご 生', { mode: 'typeahead' });

    expect(response.providers.find((provider) => provider.id === 'mext-jp')).toMatchObject({
      state: 'success',
    });
    expect(response.results.some((result) => result.food.provider === 'mext-jp')).toBe(true);
    expect(mocks.searchOpenFoodFacts).not.toHaveBeenCalled();
  });
});
