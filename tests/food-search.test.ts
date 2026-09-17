import { describe, expect, it, vi } from 'vitest';

import {
  FoodSearchCancelledError,
  FoodSearchEngine,
  FoodSearchOptions,
  FoodSearchProvider,
  createFoodSearchEngine,
  createFoodSearchScheduler,
} from '@/data/food/foodSearch';
import {
  FoodSearchSeed,
  normaliseFoodSearchText,
  rankFoodSearchSeeds,
} from '@/data/food/foodSearchRanking';
import { FoodCandidate, FoodProviderId } from '@/data/food/types';

const quality = {
  carbohydrate: 'reported',
  energy: 'missing',
  protein: 'missing',
  fat: 'missing',
  fibre: 'missing',
  sugars: 'missing',
  saturatedFat: 'missing',
} as const;

function food(
  id: string,
  name: string,
  options: {
    provider?: FoodProviderId;
    externalId?: string;
    brand?: string;
    barcode?: string;
    carbs?: number;
    sourceLabel?: string;
  } = {},
): FoodCandidate {
  const provider = options.provider ?? 'cofid';
  return {
    id,
    provider,
    externalId: options.externalId ?? id,
    name,
    brand: options.brand,
    barcode: options.barcode,
    basisAmount: 100,
    basisUnit: 'g',
    nutritionPerBasis: { carbohydrateGrams: options.carbs ?? 10 },
    nutritionQuality: quality,
    sourceLabel: options.sourceLabel ?? provider,
  };
}

describe('food search ranking', () => {
  it('normalises accents, punctuation and repeated whitespace', () => {
    expect(normaliseFoodSearchText('  Crème—BRÛLÉE!!  ')).toBe('creme brulee');
  });

  it('orders exact, prefix, token and fuzzy matches deterministically', () => {
    const seeds: FoodSearchSeed[] = [
      { food: food('4', 'Digestive biscuit'), origins: ['offline-catalogue'] },
      { food: food('3', 'Chocolate digestive biscuit'), origins: ['offline-catalogue'] },
      { food: food('2', 'Digestive biscuit with chocolate'), origins: ['offline-catalogue'] },
      { food: food('1', 'Digestve biscuit'), origins: ['offline-catalogue'] },
    ];

    expect(rankFoodSearchSeeds('digestive biscuit', seeds).map((result) => [
      result.food.id,
      result.match,
    ])).toEqual([
      ['4', 'exact'],
      ['2', 'prefix'],
      ['3', 'tokens'],
      ['1', 'fuzzy'],
    ]);
  });

  it('puts personal history before equally relevant generic results', () => {
    const now = Date.UTC(2026, 7, 18);
    const results = rankFoodSearchSeeds(
      'porridge',
      [
        { food: food('generic', 'Porridge with milk'), origins: ['offline-catalogue'] },
        {
          food: food('mine', 'Porridge with berries', { provider: 'user' }),
          origins: ['cached', 'custom', 'favourite', 'recent'],
          isFavourite: true,
          useCount: 12,
          lastUsedAt: now - 2 * 60 * 60 * 1_000,
        },
      ],
      { now },
    );

    expect(results.map((result) => result.food.id)).toEqual(['mine', 'generic']);
    expect(results[0]).toMatchObject({
      isFavourite: true,
      isRecent: true,
      isCustom: true,
    });
  });

  it('deduplicates shared barcodes, prefers the personal version and preserves provenance', () => {
    const sharedBarcode = '5000157071644';
    const userFood = food('user:beans', 'Baked beans', {
      provider: 'user',
      externalId: `barcode:${sharedBarcode}`,
      barcode: sharedBarcode,
      sourceLabel: 'My foods',
    });
    const remoteFood = food('open-food-facts:beans', 'Baked beans', {
      provider: 'open-food-facts',
      externalId: sharedBarcode,
      barcode: sharedBarcode,
      sourceLabel: 'Open Food Facts',
    });
    const seeds: FoodSearchSeed[] = [
      { food: remoteFood, origins: ['remote-catalogue'] },
      {
        food: userFood,
        origins: ['custom', 'favourite', 'cached'],
        isFavourite: true,
      },
    ];

    const forward = rankFoodSearchSeeds('baked beans', seeds);
    const backward = rankFoodSearchSeeds('baked beans', [...seeds].reverse());
    expect(forward).toHaveLength(1);
    expect(forward[0]?.food.id).toBe('user:beans');
    expect(forward[0]?.provenance).toHaveLength(2);
    expect(forward[0]?.provenance.map((source) => source.provider)).toEqual([
      'open-food-facts',
      'user',
    ]);
    expect(backward).toEqual(forward);
  });

  it('can match another provenance entry when the preferred personal name differs', () => {
    const barcode = '5000157071644';
    const results = rankFoodSearchSeeds('heinz', [
      {
        food: food('user:beans', 'Beans for toast', {
          provider: 'user',
          barcode,
        }),
        origins: ['custom', 'recent'],
      },
      {
        food: food('off:beans', 'Baked beans', {
          provider: 'open-food-facts',
          brand: 'Heinz',
          barcode,
        }),
        origins: ['remote-catalogue'],
      },
    ]);

    expect(results).toHaveLength(1);
    expect(results[0]?.food.id).toBe('off:beans');
    expect(results[0]?.isCustom).toBe(true);
    expect(results[0]?.provenance).toHaveLength(2);
  });

  it('does not collapse distinct unbranded foods merely because names match', () => {
    const results = rankFoodSearchSeeds('porridge', [
      { food: food('cofid:porridge', 'Porridge'), origins: ['offline-catalogue'] },
      {
        food: food('user:porridge', 'Porridge', { provider: 'user' }),
        origins: ['custom'],
      },
    ]);
    expect(results).toHaveLength(2);
  });

  it('keeps identically named branded variants with different barcodes separate', () => {
    const results = rankFoodSearchSeeds('protein bar', [
      {
        food: food('bar:one', 'Protein bar', {
          provider: 'open-food-facts',
          brand: 'Example',
          barcode: '5000000000001',
        }),
        origins: ['remote-catalogue'],
      },
      {
        food: food('bar:two', 'Protein bar', {
          provider: 'open-food-facts',
          brand: 'Example',
          barcode: '5000000000002',
          carbs: 12,
        }),
        origins: ['remote-catalogue'],
      },
    ]);
    expect(results).toHaveLength(2);
  });

  it('keeps differently formulated branded user foods without barcodes separate', () => {
    const results = rankFoodSearchSeeds('protein bar', [
      {
        food: food('user:bar:one', 'Protein bar', {
          provider: 'user',
          brand: 'Example',
          carbs: 10,
        }),
        origins: ['custom'],
      },
      {
        food: food('user:bar:two', 'Protein bar', {
          provider: 'user',
          brand: 'Example',
          carbs: 25,
        }),
        origins: ['custom'],
      },
    ]);
    expect(results).toHaveLength(2);
    expect(
      results.map((result) => result.food.nutritionPerBasis.carbohydrateGrams),
    ).toEqual([10, 25]);
  });

  it('collapses indistinguishable branded text results while preserving every barcode', () => {
    const results = rankFoodSearchSeeds('nutella', [
      {
        food: food('jar:one', 'Nutella', {
          provider: 'open-food-facts',
          externalId: '5000000000001',
          brand: 'Ferrero',
          barcode: '5000000000001',
          carbs: 57.5,
        }),
        origins: ['remote-catalogue'],
      },
      {
        food: food('jar:two', 'Nutella', {
          provider: 'open-food-facts',
          externalId: '5000000000002',
          brand: 'Ferrero',
          barcode: '5000000000002',
          carbs: 57.5,
        }),
        origins: ['remote-catalogue'],
      },
    ]);
    expect(results).toHaveLength(1);
    expect(results[0]?.provenance.map((source) => source.barcode)).toEqual([
      '5000000000001',
      '5000000000002',
    ]);
  });

  it('collapses float-noise variants that render identically to users', () => {
    const results = rankFoodSearchSeeds('nutella', [
      {
        food: food('jar:one', 'Nutella', {
          provider: 'open-food-facts',
          externalId: '5000000000001',
          brand: 'Ferrero',
          barcode: '5000000000001',
          carbs: 57.49,
        }),
        origins: ['remote-catalogue'],
      },
      {
        food: food('jar:two', 'Nutella', {
          provider: 'open-food-facts',
          externalId: '5000000000002',
          brand: 'Ferrero',
          barcode: '5000000000002',
          carbs: 57.51,
        }),
        origins: ['remote-catalogue'],
      },
    ]);
    expect(results).toHaveLength(1);
    expect(results[0]?.provenance).toHaveLength(2);
  });

  it('keeps variants separate when their displayed nutrition differs', () => {
    const results = rankFoodSearchSeeds('nutella', [
      {
        food: food('jar:one', 'Nutella', {
          provider: 'open-food-facts',
          brand: 'Ferrero',
          barcode: '5000000000001',
          carbs: 57.44,
        }),
        origins: ['remote-catalogue'],
      },
      {
        food: food('jar:two', 'Nutella', {
          provider: 'open-food-facts',
          brand: 'Ferrero',
          barcode: '5000000000002',
          carbs: 57.46,
        }),
        origins: ['remote-catalogue'],
      },
    ]);
    expect(results).toHaveLength(2);
  });

  it('uses fresh provider nutrition over its cached copy while retaining personal rank metadata', () => {
    const cached = food('open-food-facts:beans', 'Baked beans', {
      provider: 'open-food-facts',
      externalId: '5000157071644',
      barcode: '5000157071644',
      carbs: 10,
    });
    const fresh = {
      ...cached,
      nutritionPerBasis: { carbohydrateGrams: 12.5 },
    };
    const results = rankFoodSearchSeeds('baked beans', [
      {
        food: cached,
        origins: ['cached', 'favourite', 'recent'],
        isFavourite: true,
        useCount: 20,
        lastUsedAt: Date.UTC(2026, 7, 18),
      },
      { food: fresh, origins: ['remote-catalogue'] },
    ]);

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      food: { nutritionPerBasis: { carbohydrateGrams: 12.5 } },
      isFavourite: true,
      isRecent: true,
      useCount: 20,
    });
    expect(results[0]?.provenance[0]?.origins).toEqual([
      'favourite',
      'recent',
      'cached',
      'remote-catalogue',
    ]);
    expect(cached.nutritionPerBasis.carbohydrateGrams).toBe(10);
  });

  it('does not let stale cached nutrition bridge two fresh branded variants', () => {
    const cached = food('cached:one', 'Protein bar', {
      provider: 'open-food-facts',
      externalId: '5000000000001',
      brand: 'Example',
      barcode: '5000000000001',
      carbs: 10,
    });
    const freshChanged = {
      ...cached,
      id: 'fresh:one',
      nutritionPerBasis: { carbohydrateGrams: 12 },
    };
    const otherFreshVariant = food('fresh:two', 'Protein bar', {
      provider: 'open-food-facts',
      externalId: '5000000000002',
      brand: 'Example',
      barcode: '5000000000002',
      carbs: 10,
    });
    const results = rankFoodSearchSeeds('protein bar', [
      { food: cached, origins: ['cached', 'recent'] },
      { food: freshChanged, origins: ['remote-catalogue'] },
      { food: otherFreshVariant, origins: ['remote-catalogue'] },
    ]);
    expect(results).toHaveLength(2);
    expect(
      results.map((result) => result.food.nutritionPerBasis.carbohydrateGrams),
    ).toEqual([12, 10]);
  });

  it('shows only personal suggestions before a query is entered', () => {
    const results = rankFoodSearchSeeds('', [
      { food: food('generic', 'Banana'), origins: ['offline-catalogue'] },
      {
        food: food('recent', 'Toast', { provider: 'user' }),
        origins: ['custom', 'recent'],
        lastUsedAt: 100,
      },
    ]);
    expect(results.map((result) => result.food.id)).toEqual(['recent']);
    expect(results[0]?.match).toBe('suggestion');
  });
});

describe('food search engine', () => {
  it('automatically merges offline, remote and stored results for one query', async () => {
    const offlineSearch = vi.fn(() => [food('cofid:beans', 'Baked beans')]);
    const remoteSearch = vi.fn(async () => [
      food('off:beans', 'Heinz baked beans', {
        provider: 'open-food-facts',
        brand: 'Heinz',
      }),
    ]);
    const providers: FoodSearchProvider[] = [
      { id: 'offline', label: 'Offline', kind: 'offline', search: offlineSearch },
      { id: 'remote', label: 'Remote', kind: 'remote', search: remoteSearch },
    ];
    const engine = createFoodSearchEngine({
      loadStoredCandidates: async () => [
        {
          food: food('user:beans', 'My baked beans', { provider: 'user' }),
          isFavourite: true,
          useCount: 8,
          lastUsedAt: Date.UTC(2026, 7, 17),
        },
      ],
      providers,
    });

    const response = await engine.search('baked beans', {
      now: Date.UTC(2026, 7, 18),
      mode: 'submitted',
    });
    expect(offlineSearch).toHaveBeenCalledOnce();
    expect(remoteSearch).toHaveBeenCalledOnce();
    expect(response.results.map((result) => result.food.id)).toEqual([
      'user:beans',
      'cofid:beans',
      'off:beans',
    ]);
    expect(response.providers.map((provider) => provider.state)).toEqual([
      'success',
      'success',
    ]);
  });

  it('keeps local results when a remote catalogue is unavailable', async () => {
    const engine = createFoodSearchEngine({
      loadStoredCandidates: async () => [],
      providers: [
        {
          id: 'offline',
          label: 'Offline',
          kind: 'offline',
          search: () => [food('banana', 'Banana')],
        },
        {
          id: 'remote',
          label: 'Remote',
          kind: 'remote',
          search: async () => {
            throw new Error('No connection');
          },
        },
      ],
    });
    const response = await engine.search('banana', { mode: 'submitted' });
    expect(response.results.map((result) => result.food.id)).toEqual(['banana']);
    expect(response.providers[1]).toMatchObject({
      id: 'remote',
      state: 'error',
      message: 'No connection',
    });
  });

  it('reports an unavailable personal catalogue while keeping provider results', async () => {
    const engine = createFoodSearchEngine({
      loadStoredCandidates: async () => {
        throw new Error('Database unavailable');
      },
      providers: [
        {
          id: 'offline',
          label: 'Offline',
          kind: 'offline',
          search: () => [food('banana', 'Banana')],
        },
      ],
    });
    const response = await engine.search('banana');
    expect(response.results).toHaveLength(1);
    expect(response.personal).toEqual({
      state: 'error',
      candidateCount: 0,
      message: 'Database unavailable',
    });
  });

  it('skips catalogues below their minimum query length and caches remote results', async () => {
    let now = 1_000;
    const remoteSearch = vi.fn(async () => [food('remote:oats', 'Oats')]);
    const engine = createFoodSearchEngine({
      loadStoredCandidates: async () => [],
      providers: [
        {
          id: 'broker',
          label: 'Future broker',
          kind: 'remote',
          minQueryLength: 3,
          search: remoteSearch,
        },
      ],
      now: () => now,
      remoteCacheTtlMs: 5_000,
    });

    expect((await engine.search('o')).providers[0]?.state).toBe('skipped');
    await engine.search('oats', { mode: 'submitted' });
    now += 1_000;
    await engine.search('oats', { mode: 'submitted' });
    expect(remoteSearch).toHaveBeenCalledTimes(1);
    now += 6_000;
    await engine.search('oats', { mode: 'submitted' });
    expect(remoteSearch).toHaveBeenCalledTimes(2);
  });

  it('fails closed for remote typeahead unless a provider explicitly permits it', async () => {
    const publicSearch = vi.fn(async () => [food('public', 'Porridge')]);
    const paidSearch = vi.fn(async () => [food('paid', 'Porridge pot')]);
    const engine = createFoodSearchEngine({
      loadStoredCandidates: async () => [],
      providers: [
        {
          id: 'public',
          label: 'Public catalogue',
          kind: 'remote',
          search: publicSearch,
        },
        {
          id: 'paid',
          label: 'Future paid catalogue',
          kind: 'remote',
          supportsTypeahead: true,
          search: paidSearch,
        },
      ],
    });

    const typing = await engine.search('porridge', { mode: 'typeahead' });
    expect(publicSearch).not.toHaveBeenCalled();
    expect(typing.providers[0]).toMatchObject({
      state: 'skipped',
      skipReason: 'submission-required',
    });
    expect(paidSearch).toHaveBeenCalledOnce();

    await engine.search('porridge', { mode: 'submitted' });
    expect(publicSearch).toHaveBeenCalledOnce();
  });

  it('keys remote cache entries by search mode and requested capacity', async () => {
    const remoteSearch = vi.fn(async (query: string) => [food(`remote:${query}`, query)]);
    const engine = createFoodSearchEngine({
      loadStoredCandidates: async () => [],
      providers: [
        {
          id: 'paid',
          label: 'Future paid catalogue',
          kind: 'remote',
          supportsTypeahead: true,
          search: remoteSearch,
        },
      ],
    });

    await engine.search('porridge', { mode: 'submitted', limit: 20 });
    await engine.search('porridge', { mode: 'submitted', limit: 20 });
    await engine.search('porridge', { mode: 'submitted', limit: 30 });
    await engine.search('porridge', { mode: 'typeahead', limit: 20 });
    expect(remoteSearch).toHaveBeenCalledTimes(3);
  });

  it('does not reuse remote results after regional search context changes', async () => {
    let scope = 'GB|en-GB';
    const remoteSearch = vi.fn(async () => [food(`remote:${scope}`, 'Porridge')]);
    const engine = createFoodSearchEngine({
      loadStoredCandidates: async () => [],
      providers: [
        {
          id: 'regional',
          label: 'Regional catalogue',
          kind: 'remote',
          cacheScope: () => scope,
          search: remoteSearch,
        },
      ],
    });

    await engine.search('porridge', { mode: 'submitted' });
    await engine.search('porridge', { mode: 'submitted' });
    scope = 'US|en-US';
    const us = await engine.search('porridge', { mode: 'submitted' });

    expect(remoteSearch).toHaveBeenCalledTimes(2);
    expect(us.results[0]?.food.id).toBe('remote:US|en-US');
  });

  it('does not treat a future-dated cache entry as fresh after clock rollback', async () => {
    let now = 10_000;
    const remoteSearch = vi.fn(async () => [food('remote', 'Porridge')]);
    const engine = createFoodSearchEngine({
      loadStoredCandidates: async () => [],
      providers: [
        {
          id: 'remote',
          label: 'Remote catalogue',
          kind: 'remote',
          search: remoteSearch,
        },
      ],
      now: () => now,
    });
    await engine.search('porridge', { mode: 'submitted' });
    now -= 1_000;
    await engine.search('porridge', { mode: 'submitted' });
    expect(remoteSearch).toHaveBeenCalledTimes(2);
  });

  it('defaults to fail-closed typeahead when the caller does not declare a mode', async () => {
    const remoteSearch = vi.fn(async () => [food('remote', 'Porridge')]);
    const engine = createFoodSearchEngine({
      loadStoredCandidates: async () => [],
      providers: [
        {
          id: 'public',
          label: 'Public catalogue',
          kind: 'remote',
          search: remoteSearch,
        },
      ],
    });
    const response = await engine.search('porridge');
    expect(remoteSearch).not.toHaveBeenCalled();
    expect(response.providers[0]).toMatchObject({
      state: 'skipped',
      skipReason: 'submission-required',
    });
  });

  it('propagates cancellation instead of presenting it as a provider failure', async () => {
    const controller = new AbortController();
    controller.abort();
    const engine = createFoodSearchEngine({
      loadStoredCandidates: async () => [],
      providers: [],
    });
    await expect(engine.search('banana', { signal: controller.signal })).rejects.toBeInstanceOf(
      FoodSearchCancelledError,
    );
  });
});

describe('food search scheduler', () => {
  it('debounces requests and suppresses a stale response even if a provider ignores abort', async () => {
    vi.useFakeTimers();
    try {
      const resolutions = new Map<string, (value: unknown) => void>();
      const search = vi.fn(
        (query: string, _options?: FoodSearchOptions) =>
          new Promise((resolve) => {
            resolutions.set(query, resolve);
          }),
      );
      const scheduler = createFoodSearchScheduler(
        { search: search as FoodSearchEngine['search'] },
        { debounceMs: 25 },
      );

      const first = scheduler.request('por');
      await vi.advanceTimersByTimeAsync(25);
      expect(search).toHaveBeenCalledTimes(1);

      const second = scheduler.request('porridge');
      await expect(first).resolves.toBeUndefined();
      await vi.advanceTimersByTimeAsync(25);
      expect(search).toHaveBeenCalledTimes(2);

      const currentResponse = {
        query: 'porridge',
        results: [],
        personal: { state: 'success' as const, candidateCount: 0 },
        providers: [],
      };
      resolutions.get('porridge')?.(currentResponse);
      await expect(second).resolves.toEqual(currentResponse);

      expect(search.mock.calls[1]?.[1]).toMatchObject({ mode: 'typeahead' });

      resolutions.get('por')?.({
        query: 'por',
        results: [],
        personal: { state: 'success', candidateCount: 0 },
        providers: [],
      });
      scheduler.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not run a superseded request that is still inside the debounce window', async () => {
    vi.useFakeTimers();
    try {
      const search = vi.fn(async (query: string, _options?: FoodSearchOptions) => ({
        query,
        results: [],
        personal: { state: 'success' as const, candidateCount: 0 },
        providers: [],
        hasMore: false,
        remotePage: 1,
        countryScope: 'local' as const,
      }));
      const scheduler = createFoodSearchScheduler(
        { search },
        { debounceMs: 100 },
      );
      const first = scheduler.request('toast');
      const second = scheduler.request('toastie');
      await vi.advanceTimersByTimeAsync(100);
      await expect(first).resolves.toBeUndefined();
      await expect(second).resolves.toMatchObject({ query: 'toastie' });
      expect(search).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('can run a deliberate submitted search immediately', async () => {
    vi.useFakeTimers();
    try {
      const search = vi.fn(async (query: string, _options?: FoodSearchOptions) => ({
        query,
        results: [],
        personal: { state: 'success' as const, candidateCount: 0 },
        providers: [],
        hasMore: false,
        remotePage: 1,
        countryScope: 'local' as const,
      }));
      const scheduler = createFoodSearchScheduler(
        { search },
        { debounceMs: 650 },
      );
      const submitted = scheduler.request('baked beans', {
        mode: 'submitted',
        immediate: true,
      });
      await vi.advanceTimersByTimeAsync(0);
      await expect(submitted).resolves.toMatchObject({ query: 'baked beans' });
      expect(search.mock.calls[0]?.[1]).toMatchObject({ mode: 'submitted' });
    } finally {
      vi.useRealTimers();
    }
  });
});
