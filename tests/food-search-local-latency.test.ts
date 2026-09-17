import { describe, expect, it, vi } from 'vitest';

import { searchCofidFoods } from '@/data/food/cofidCatalog';
import {
  createFoodSearchEngine, createFoodSearchScheduler, FoodSearchCancelledError,
  type FoodSearchOptions, type FoodSearchResponse,
} from '@/data/food/foodSearch';
import type { FoodCandidate } from '@/data/food/types';

const localFood = searchCofidFoods('bread')[0]!;
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

describe('local-first food search publication', () => {
  it('publishes local and saved foods while the explicitly requested remote provider is pending', async () => {
    const pending = deferred<FoodCandidate[]>();
    const onLocalResults = vi.fn();
    const remote = vi.fn(() => pending.promise);
    const engine = createFoodSearchEngine({
      loadStoredCandidates: async () => [{ food: { ...localFood, id: 'mine', externalId: 'mine', provider: 'user' }, isFavourite: false, useCount: 1 }],
      providers: [
        { id: 'local', label: 'Local', kind: 'offline', search: () => [localFood] },
        { id: 'remote', label: 'Remote', kind: 'remote', search: remote },
      ],
    });
    let complete = false;
    const operation = engine.search('bread', { mode: 'submitted', onLocalResults }).then((result) => { complete = true; return result; });
    await vi.waitFor(() => expect(onLocalResults).toHaveBeenCalledOnce());
    expect(complete).toBe(false);
    const local = onLocalResults.mock.calls[0]![0] as FoodSearchResponse;
    expect(local.results.map(({ food }) => food.id)).toContain(localFood.id);
    expect(local.results.map(({ food }) => food.id)).toContain('mine');
    expect(local.providers.map(({ kind }) => kind)).toEqual(['offline']);
    expect(remote).toHaveBeenCalledOnce();
    pending.resolve([{ ...localFood, id: 'remote', externalId: 'remote' }]);
    expect((await operation).results.map(({ food }) => food.id)).toContain('remote');
    expect(onLocalResults).toHaveBeenCalledOnce();
  });

  it('keeps ordinary typeahead local-only even when the publication callback is supplied', async () => {
    const remote = vi.fn();
    const onLocalResults = vi.fn();
    const engine = createFoodSearchEngine({
      loadStoredCandidates: async () => [],
      providers: [
        { id: 'local', label: 'Local', kind: 'offline', search: () => [localFood] },
        { id: 'remote', label: 'Remote', kind: 'remote', search: remote },
      ],
    });
    expect((await engine.search('bread', { onLocalResults })).results).toHaveLength(1);
    expect(remote).not.toHaveBeenCalled();
    expect(onLocalResults).not.toHaveBeenCalled();
  });

  it('does not publish local results after cancellation while local IO was pending', async () => {
    const pending = deferred<FoodCandidate[]>();
    const controller = new AbortController();
    const onLocalResults = vi.fn();
    const engine = createFoodSearchEngine({
      loadStoredCandidates: async () => [],
      providers: [{ id: 'local', label: 'Local', kind: 'offline', search: () => pending.promise }],
    });
    const operation = engine.search('bread', { mode: 'submitted', signal: controller.signal, onLocalResults });
    const rejected = expect(operation).rejects.toBeInstanceOf(FoodSearchCancelledError);
    controller.abort();
    pending.resolve([localFood]);
    await rejected;
    expect(onLocalResults).not.toHaveBeenCalled();
  });

  it('runs a zero-debounce local request on the next turn without a fixed 450ms wait', async () => {
    vi.useFakeTimers();
    try {
      const engine = createFoodSearchEngine({ loadStoredCandidates: async () => [], providers: [] });
      const search = vi.spyOn(engine, 'search');
      const scheduler = createFoodSearchScheduler(engine, { debounceMs: 0 });
      const operation = scheduler.request('bread');
      await vi.advanceTimersByTimeAsync(0);
      expect(search).toHaveBeenCalledOnce();
      await expect(operation).resolves.toMatchObject({ query: 'bread' });
      scheduler.dispose();
    } finally { vi.useRealTimers(); }
  });

  it('suppresses old local callbacks when an engine ignores abort or the scheduler is disposed', async () => {
    vi.useFakeTimers();
    try {
      const pending = deferred<FoodSearchResponse>();
      const requests: FoodSearchOptions[] = [];
      const scheduler = createFoodSearchScheduler({ search: (_query, options = {}) => {
        requests.push(options);
        return pending.promise;
      } }, { debounceMs: 0 });
      const firstLocal = vi.fn();
      const secondLocal = vi.fn();
      const first = scheduler.request('bread', { mode: 'submitted', onLocalResults: firstLocal });
      await vi.advanceTimersByTimeAsync(0);
      const second = scheduler.request('rice', { mode: 'submitted', onLocalResults: secondLocal });
      await vi.advanceTimersByTimeAsync(0);
      const response: FoodSearchResponse = { query: 'rice', results: [], providers: [], personal: { state: 'success', candidateCount: 0 }, hasMore: false, remotePage: 1, countryScope: 'local' };
      requests[0]?.onLocalResults?.(response);
      requests[1]?.onLocalResults?.(response);
      expect(firstLocal).not.toHaveBeenCalled();
      expect(secondLocal).toHaveBeenCalledOnce();
      scheduler.dispose();
      requests[1]?.onLocalResults?.(response);
      expect(secondLocal).toHaveBeenCalledOnce();
      pending.resolve(response);
      await expect(first).resolves.toBeUndefined();
      await expect(second).resolves.toBeUndefined();
    } finally { vi.useRealTimers(); }
  });
});
