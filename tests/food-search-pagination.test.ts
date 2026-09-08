import { describe, expect, it, vi } from 'vitest';

import { createFoodSearchEngine, type FoodSearchProviderContext } from '@/data/food/foodSearch';
import { isFoodSearchQueryReady, rankFoodSearchSeeds } from '@/data/food/foodSearchRanking';
import { searchCofidFoods } from '@/data/food/cofidCatalog';
import type { FoodCandidate } from '@/data/food/types';

const reference = searchCofidFoods('bread')[0]!;
function food(id: string, name = 'Bread'): FoodCandidate {
  return { ...reference, id, externalId: id, name };
}

describe('bounded search evidence', () => {
  it('does not trust a provider result without matching text or actual alias evidence', async () => {
    const engine = createFoodSearchEngine({
      loadStoredCandidates: async () => [],
      providers: [{ id: 'unrelated', label: 'Unrelated', kind: 'remote', search: () => [food('one', 'Orange')] }],
    });
    expect((await engine.search('bread', { mode: 'submitted' })).results).toEqual([]);
  });

  it('rejects stale query evidence, cached evidence, empty rewrites and excessive fields', () => {
    const candidate = food('one', 'Orange');
    const evidence = { query: 'fruit', fields: ['fruit'], rank: 0 };
    expect(rankFoodSearchSeeds('fruit', [{ food: candidate, origins: ['offline-catalogue'], searchEvidence: evidence }])).toHaveLength(1);
    expect(rankFoodSearchSeeds('bread', [{ food: candidate, origins: ['offline-catalogue'], searchEvidence: evidence }])).toEqual([]);
    expect(rankFoodSearchSeeds('fruit', [{ food: candidate, origins: ['cached'], searchEvidence: evidence }])).toEqual([]);
    expect(rankFoodSearchSeeds('fruit', [{ food: candidate, origins: ['offline-catalogue'], searchEvidence: { ...evidence, matchedQuery: '' } }])).toEqual([]);
    expect(rankFoodSearchSeeds('fruit', [{ food: candidate, origins: ['offline-catalogue'], searchEvidence: { ...evidence, fields: [...Array<string>(8).fill('unrelated'), 'fruit'] } }])).toEqual([]);
  });

  it('allows meaningful single ideographs while retaining Latin minimum lengths', () => {
    expect(isFoodSearchQueryReady('飯')).toBe(true);
    expect(isFoodSearchQueryReady('米')).toBe(true);
    expect(isFoodSearchQueryReady('a')).toBe(false);
    expect(isFoodSearchQueryReady('ab', 3)).toBe(false);
    expect(isFoodSearchQueryReady('')).toBe(false);
  });

  it('deduplicates equivalent UPC/EAN identities without merging short barcodes', () => {
    const first = { ...food('a'), barcode: '123456789012' };
    const second = { ...food('b'), barcode: '0123456789012' };
    expect(rankFoodSearchSeeds('bread', [first, second].map((candidate) => ({ food: candidate, origins: ['remote-catalogue'] })))).toHaveLength(1);
  });

  it('preserves compatible personal portions when fresh catalogue nutrients win', () => {
    const stored = { ...food('same'), personalServingAmount: 75, personalServingUnit: 'g' as const,
      personalServingLabel: 'My slice', lastPortionAmount: 150, lastPortionUnit: 'g' as const };
    const fresh = { ...food('same'), nutritionPerBasis: { carbohydrateGrams: 22 } };
    const ranked = rankFoodSearchSeeds('bread', [
      { food: stored, origins: ['cached'], lastUsedAt: 100 },
      { food: fresh, origins: ['remote-catalogue'] },
    ]);
    expect(ranked[0]?.food).toMatchObject({ nutritionPerBasis: { carbohydrateGrams: 22 },
      personalServingAmount: 75, personalServingLabel: 'My slice', lastPortionAmount: 150 });
    const volume = { ...stored, personalServingUnit: 'ml' as const, lastPortionUnit: 'ml' as const };
    expect(rankFoodSearchSeeds('bread', [
      { food: volume, origins: ['cached'] }, { food: fresh, origins: ['remote-catalogue'] },
    ])[0]?.food.personalServingAmount).toBeUndefined();
  });
});

describe('explicit cumulative food search pages', () => {
  it('reuses page one as display capacity increases and deduplicates later pages', async () => {
    const search = vi.fn((_query: string, { page }: FoodSearchProviderContext) => ({
      foods: page === 1 ? [food('one'), food('duplicate')] : [food('duplicate'), food('two')],
      hasMore: page === 1,
    }));
    const engine = createFoodSearchEngine({ loadStoredCandidates: async () => [], providers: [
      { id: 'paged', label: 'Paged', kind: 'remote', supportsPagination: true, search },
    ] });
    const first = await engine.search('bread', { mode: 'submitted', limit: 2 });
    expect(first.hasMore).toBe(true);
    const second = await engine.search('bread', { mode: 'submitted', remotePage: 2, limit: 40 });
    expect(search.mock.calls.map(([, context]) => context.page)).toEqual([1, 2]);
    expect(second.results.map(({ food: candidate }) => candidate.id)).toEqual(['one', 'duplicate', 'two']);
    expect(second.hasMore).toBe(false);
    expect(second.remotePage).toBe(2);
    expect(second.countryScope).toBe('local');
  });

  it('separates wider-country, regional and language cache scopes', async () => {
    let region = 'GB|en';
    const search = vi.fn((_query: string, { countryScope }: FoodSearchProviderContext) => ({ foods: [food(countryScope)], hasMore: false }));
    const engine = createFoodSearchEngine({ loadStoredCandidates: async () => [], providers: [
      { id: 'paged', label: 'Paged', kind: 'remote', supportsPagination: true, cacheScope: () => region, search },
    ] });
    await engine.search('bread', { mode: 'submitted' });
    await engine.search('bread', { mode: 'submitted', countryScope: 'worldwide' });
    await engine.search('bread', { mode: 'submitted' });
    expect(search).toHaveBeenCalledTimes(2);
    region = 'FR|fr';
    await engine.search('bread', { mode: 'submitted' });
    expect(search).toHaveBeenCalledTimes(3);
  });

  it('retains earlier-page results when the next page fails and permits retry', async () => {
    let unavailable = true;
    const search = vi.fn((_query: string, { page }: FoodSearchProviderContext) => {
      if (page === 2 && unavailable) throw new Error('Rate limit; try again shortly.');
      return { foods: [food(String(page))], hasMore: page === 1 };
    });
    const engine = createFoodSearchEngine({ loadStoredCandidates: async () => [], providers: [
      { id: 'paged', label: 'Paged', kind: 'remote', supportsPagination: true, search },
    ] });
    await engine.search('bread', { mode: 'submitted' });
    const failed = await engine.search('bread', { mode: 'submitted', remotePage: 2 });
    expect(failed.results.map(({ food: candidate }) => candidate.id)).toEqual(['1']);
    expect(failed.providers[0]?.state).toBe('error');
    expect(failed.hasMore).toBe(true);
    unavailable = false;
    const retried = await engine.search('bread', { mode: 'submitted', remotePage: 2 });
    expect(retried.results.map(({ food: candidate }) => candidate.id)).toEqual(['1', '2']);
    expect(search.mock.calls.map(([, context]) => context.page)).toEqual([1, 2, 2]);
  });

  it('never pages a public provider during typeahead, even with wider scope', async () => {
    const search = vi.fn(() => ({ foods: [food('one')], hasMore: true }));
    const engine = createFoodSearchEngine({ loadStoredCandidates: async () => [], providers: [
      { id: 'paged', label: 'Paged', kind: 'remote', supportsPagination: true, search },
    ] });
    await engine.search('bread', { remotePage: 3, countryScope: 'worldwide' });
    expect(search).not.toHaveBeenCalled();
  });

  it('aborts before continuing to another page when an old request is cancelled', async () => {
    const controller = new AbortController();
    const search = vi.fn(() => { controller.abort(); return { foods: [food('one')], hasMore: true }; });
    const engine = createFoodSearchEngine({ loadStoredCandidates: async () => [], providers: [
      { id: 'paged', label: 'Paged', kind: 'remote', supportsPagination: true, search },
    ] });
    await expect(engine.search('bread', { mode: 'submitted', remotePage: 3, signal: controller.signal })).rejects.toThrow('cancelled');
    expect(search).toHaveBeenCalledOnce();
  });
});
