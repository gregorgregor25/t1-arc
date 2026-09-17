import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_REGIONAL_PROFILE } from '@/domain/regionalProfile';
import { setRuntimeRegionalProfile } from '@/domain/regionalProfileRuntime';

import {
  createDefaultFoodSearchEngine,
  openFoodFactsSearchProvider,
} from '@/data/food/unifiedFoodSearch';
import { searchCofidFoods } from '@/data/food/cofidCatalog';

const mocks = vi.hoisted(() => ({
  loadStored: vi.fn(),
  searchOpenFoodFacts: vi.fn(),
  searchCountryPacks: vi.fn(),
}));

vi.mock('@/data/food/countryPacks', async () => {
  const { countryPackMatchEvidence } = await import('@/data/food/countryPackValidation');
  return { searchCountryPackFoods: mocks.searchCountryPacks, countryPackMatchEvidence, getCountryFoodPackRevision: () => 0 };
});

vi.mock('@/data/food/foodLogRepository', () => ({
  getStoredFoodSearchEntries: mocks.loadStored,
}));

vi.mock('@/data/food/openFoodFacts', () => ({
  searchOpenFoodFactsPage: mocks.searchOpenFoodFacts,
  openFoodFactsSearchFields: () => [],
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
    mocks.searchOpenFoodFacts.mockReset().mockResolvedValue({ foods: [remoteFood], hasMore: false });
    mocks.searchCountryPacks.mockReset().mockResolvedValue([]);
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

  it('keeps local-country alias matches and forwards country, language and cancellation', async () => {
    setRuntimeRegionalProfile({ ...DEFAULT_REGIONAL_PROFILE, countryCode: 'CA', languageTag: 'fr-CA' });
    const french = { ...remoteFood, id: 'cnf:2', provider: 'cnf' as const, externalId: '2',
      name: 'Soufflé au fromage', brand: undefined, barcode: undefined, sourceLabel: 'Canadian Nutrient File 2026',
      rawPayload: { searchAliases: ['Cheese souffle', 'Soufflé au fromage'] } };
    mocks.searchCountryPacks.mockResolvedValue([french]);
    const controller = new AbortController();
    const response = await createDefaultFoodSearchEngine().search('cheese souffle', { mode: 'typeahead', signal: controller.signal });
    expect(mocks.searchCountryPacks).toHaveBeenCalledWith('cheese souffle', expect.objectContaining({ countryCode: 'CA', locale: 'fr-CA', signal: controller.signal }));
    expect(response.results.some((row) => row.food.id === 'cnf:2')).toBe(true);
    expect(mocks.searchOpenFoodFacts).not.toHaveBeenCalled();
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

  it('retains CoFID context-word matches and its relevance order', async () => {
    setRuntimeRegionalProfile({ ...DEFAULT_REGIONAL_PROFILE, countryCode: 'GB' });
    const engine = createDefaultFoodSearchEngine();
    const bread = await engine.search('bakery bread');
    expect(bread.results.length).toBeGreaterThan(0);
    expect(bread.results.some(({ food }) => food.name.startsWith('Bread'))).toBe(true);
    const milk = await engine.search('milk');
    expect(milk.results[0]?.food.id).toBe(searchCofidFoods('milk')[0]?.id);
    expect(mocks.searchOpenFoodFacts).not.toHaveBeenCalled();
  });

  it('retains USDA category-only matches through unified ranking', async () => {
    setRuntimeRegionalProfile({ ...DEFAULT_REGIONAL_PROFILE, countryCode: 'US' });
    const response = await createDefaultFoodSearchEngine().search('poultry mixed dishes');
    expect(response.results.length).toBeGreaterThan(0);
    expect(response.results.some(({ food }) => food.name === 'Chili, white')).toBe(true);
    expect(response.results.every(({ food }) => food.provider === 'usda-fdc')).toBe(true);
  });

  it('finds everyday cooked-rice aliases and single kanji without raw-rice leakage', async () => {
    setRuntimeRegionalProfile({ ...DEFAULT_REGIONAL_PROFILE, countryCode: 'JP', languageTag: 'ja-JP' });
    const engine = createDefaultFoodSearchEngine();
    for (const query of ['ごはん', 'ご飯', '飯']) {
      const response = await engine.search(query);
      expect(response.results.length).toBeGreaterThan(0);
      expect(response.results.some(({ food }) => food.name.includes('水稲めし'))).toBe(true);
      if (query !== '飯') {
        expect(response.results.every(({ food }) => food.name.includes('水稲めし'))).toBe(true);
      }
      expect(response.results.some(({ food }) => food.name.includes('水稲穀粒'))).toBe(false);
    }
    expect(mocks.searchOpenFoodFacts).not.toHaveBeenCalled();
  });

  it('supports kana variants and preserves Japanese preparation qualifiers', async () => {
    setRuntimeRegionalProfile({ ...DEFAULT_REGIONAL_PROFILE, countryCode: 'JP', languageTag: 'ja-JP' });
    const engine = createDefaultFoodSearchEngine();
    const hiragana = await engine.search('ばなな');
    const katakana = await engine.search('バナナ');
    expect(hiragana.results.map(({ food }) => food.id).sort())
      .toEqual(katakana.results.map(({ food }) => food.id).sort());
    const beef = await engine.search('牛肉 もも 焼き');
    expect(beef.results.length).toBeGreaterThan(0);
    expect(beef.results.every(({ food }) => food.name.startsWith('うし ') &&
      food.name.includes('もも') && food.name.includes('焼き'))).toBe(true);
    expect((await engine.search('ごはん 生')).results).toEqual([]);
  });

  it('passes explicit worldwide scope and page size without changing language', async () => {
    setRuntimeRegionalProfile({ ...DEFAULT_REGIONAL_PROFILE, countryCode: 'FR', languageTag: 'fr-FR' });
    await createDefaultFoodSearchEngine().search('beans', { mode: 'submitted', countryScope: 'worldwide' });
    expect(mocks.searchOpenFoodFacts).toHaveBeenCalledWith('beans', globalThis.fetch,
      expect.objectContaining({ countryCode: 'FR', languageTag: 'fr-FR', countryScope: 'worldwide', page: 1, pageSize: 20 }));
  });
});
