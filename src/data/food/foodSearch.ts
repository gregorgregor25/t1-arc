import type { FoodCandidate } from './types';
import {
  FoodSearchOrigin,
  FoodSearchSeed,
  RankedFoodSearchResult,
  normaliseFoodSearchText,
  rankFoodSearchSeeds,
} from './foodSearchRanking';

export interface StoredFoodSearchCandidate {
  food: FoodCandidate;
  isFavourite: boolean;
  useCount: number;
  lastUsedAt?: number;
}

export interface FoodSearchProviderContext {
  signal?: AbortSignal;
  limit: number;
  mode: FoodSearchMode;
}

export type FoodSearchMode = 'typeahead' | 'submitted';

/**
 * Provider-neutral catalogue boundary. A future server-brokered commercial
 * catalogue can implement this contract without placing credentials in the
 * app or changing search/ranking behaviour.
 */
export interface FoodSearchProvider {
  id: string;
  label: string;
  kind: 'offline' | 'remote';
  minQueryLength?: number;
  /** Public catalogues that prohibit search-as-you-type leave this false. */
  supportsTypeahead?: boolean;
  /** Separates cached remote results when locale/country/account context changes. */
  cacheScope?(): string;
  search(
    query: string,
    context: FoodSearchProviderContext,
  ): Promise<readonly FoodCandidate[]> | readonly FoodCandidate[];
}

export interface FoodSearchProviderStatus {
  id: string;
  label: string;
  kind: FoodSearchProvider['kind'];
  state: 'success' | 'error' | 'skipped';
  candidateCount: number;
  skipReason?: 'query-too-short' | 'submission-required';
  message?: string;
}

export interface FoodSearchResponse {
  query: string;
  results: RankedFoodSearchResult[];
  personal: {
    state: 'success' | 'error';
    candidateCount: number;
    message?: string;
  };
  providers: FoodSearchProviderStatus[];
}

export interface FoodSearchOptions {
  signal?: AbortSignal;
  limit?: number;
  now?: number;
  /** Submitted is a deliberate keyboard/search action, not every keystroke. */
  mode?: FoodSearchMode;
}

export interface FoodSearchEngine {
  search(query: string, options?: FoodSearchOptions): Promise<FoodSearchResponse>;
  clearRemoteCache(): void;
}

export interface CreateFoodSearchEngineOptions {
  loadStoredCandidates(
    signal?: AbortSignal,
  ): Promise<readonly StoredFoodSearchCandidate[]>;
  providers: readonly FoodSearchProvider[];
  remoteCacheTtlMs?: number;
  now?: () => number;
}

interface ProviderCacheEntry {
  storedAt: number;
  foods: readonly FoodCandidate[];
}

export class FoodSearchCancelledError extends Error {
  constructor() {
    super('The food search was cancelled.');
    this.name = 'FoodSearchCancelledError';
  }
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw new FoodSearchCancelledError();
}

function errorMessage(error: unknown, provider: FoodSearchProvider) {
  return error instanceof Error && error.message.trim()
    ? error.message
    : `${provider.label} could not be searched.`;
}

function originsForStored(entry: StoredFoodSearchCandidate): FoodSearchOrigin[] {
  const origins = new Set<FoodSearchOrigin>(['cached']);
  if (entry.food.provider === 'user') origins.add('custom');
  if (entry.isFavourite) origins.add('favourite');
  if (entry.lastUsedAt !== undefined || entry.useCount > 0) origins.add('recent');
  return [...origins];
}

function skippedStatus(
  provider: FoodSearchProvider,
  skipReason: NonNullable<FoodSearchProviderStatus['skipReason']>,
): FoodSearchProviderStatus {
  return {
    id: provider.id,
    label: provider.label,
    kind: provider.kind,
    state: 'skipped',
    candidateCount: 0,
    skipReason,
  };
}

export function createFoodSearchEngine({
  loadStoredCandidates,
  providers,
  remoteCacheTtlMs = 5 * 60 * 1_000,
  now: clock = Date.now,
}: CreateFoodSearchEngineOptions): FoodSearchEngine {
  const remoteCache = new Map<string, ProviderCacheEntry>();
  const cacheRemoteFoods = (
    cacheKey: string,
    foods: readonly FoodCandidate[],
    storedAt: number,
  ) => {
    for (const [key, entry] of remoteCache) {
      if (storedAt - entry.storedAt >= remoteCacheTtlMs) remoteCache.delete(key);
    }
    while (remoteCache.size >= 100) {
      const oldestKey = remoteCache.keys().next().value as string | undefined;
      if (oldestKey === undefined) break;
      remoteCache.delete(oldestKey);
    }
    remoteCache.set(cacheKey, { storedAt, foods: [...foods] });
  };

  return {
    async search(rawQuery, options = {}) {
      throwIfAborted(options.signal);
      const query = normaliseFoodSearchText(rawQuery).slice(0, 80);
      const limit = Math.max(0, Math.min(options.limit ?? 40, 200));
      const now = options.now ?? clock();
      // Fail closed: a caller must explicitly identify a deliberate submit
      // before any public remote provider is allowed to run.
      const mode = options.mode ?? 'typeahead';

      const storedPromise = loadStoredCandidates(options.signal)
        .then((candidates) => ({
          candidates,
          state: 'success' as const,
        }))
        .catch((error) => {
          throwIfAborted(options.signal);
          return {
            candidates: [] as readonly StoredFoodSearchCandidate[],
            state: 'error' as const,
            message:
              error instanceof Error && error.message.trim()
                ? error.message
                : 'Saved foods could not be searched.',
          };
        });

      const providerTasks = providers.map(async (provider) => {
        const minimum = Math.max(2, provider.minQueryLength ?? 2);
        if (query.length < minimum) {
          return {
            status: skippedStatus(provider, 'query-too-short'),
            seeds: [] as FoodSearchSeed[],
          };
        }
        if (
          mode === 'typeahead' &&
          provider.kind === 'remote' &&
          provider.supportsTypeahead !== true
        ) {
          return {
            status: skippedStatus(provider, 'submission-required'),
            seeds: [] as FoodSearchSeed[],
          };
        }
        const providerLimit = Math.max(40, limit * 2);
        const cacheKey = [
          provider.id,
          provider.cacheScope?.() ?? '',
          mode,
          providerLimit,
          query,
        ].join('\u0000');
        const cached = provider.kind === 'remote' ? remoteCache.get(cacheKey) : undefined;
        const cacheAge = cached ? now - cached.storedAt : undefined;
        if (
          cached &&
          cacheAge !== undefined &&
          cacheAge >= 0 &&
          cacheAge < remoteCacheTtlMs
        ) {
          return {
            status: {
              id: provider.id,
              label: provider.label,
              kind: provider.kind,
              state: 'success',
              candidateCount: cached.foods.length,
            } satisfies FoodSearchProviderStatus,
            seeds: cached.foods.map((food) => ({
              food,
              origins: ['remote-catalogue'] as const,
            })),
          };
        }

        try {
          const foods = await provider.search(query, {
            signal: options.signal,
            limit: providerLimit,
            mode,
          });
          throwIfAborted(options.signal);
          if (provider.kind === 'remote') {
            cacheRemoteFoods(cacheKey, foods, now);
          }
          const origin: FoodSearchOrigin =
            provider.kind === 'remote'
              ? 'remote-catalogue'
              : 'offline-catalogue';
          return {
            status: {
              id: provider.id,
              label: provider.label,
              kind: provider.kind,
              state: 'success',
              candidateCount: foods.length,
            } satisfies FoodSearchProviderStatus,
            seeds: foods.map((food) => ({ food, origins: [origin] })),
          };
        } catch (error) {
          throwIfAborted(options.signal);
          return {
            status: {
              id: provider.id,
              label: provider.label,
              kind: provider.kind,
              state: 'error',
              candidateCount: 0,
              message: errorMessage(error, provider),
            } satisfies FoodSearchProviderStatus,
            seeds: [] as FoodSearchSeed[],
          };
        }
      });

      const [storedResult, providerResults] = await Promise.all([
        storedPromise,
        Promise.all(providerTasks),
      ]);
      throwIfAborted(options.signal);

      const storedSeeds: FoodSearchSeed[] = storedResult.candidates.map((entry) => ({
        food: entry.food,
        origins: originsForStored(entry),
        isFavourite: entry.isFavourite,
        useCount: entry.useCount,
        lastUsedAt: entry.lastUsedAt,
      }));
      const providerSeeds = providerResults.flatMap((result) => result.seeds);
      return {
        query,
        results: rankFoodSearchSeeds(query, [...storedSeeds, ...providerSeeds], {
          limit,
          now,
        }),
        personal: {
          state: storedResult.state,
          candidateCount: storedResult.candidates.length,
          ...('message' in storedResult ? { message: storedResult.message } : {}),
        },
        providers: providerResults.map((result) => result.status),
      };
    },

    clearRemoteCache() {
      remoteCache.clear();
    },
  };
}

export interface FoodSearchScheduler {
  /** Resolves undefined when superseded or explicitly cancelled. */
  request(
    query: string,
    options?: FoodSearchSchedulerRequestOptions,
  ): Promise<FoodSearchResponse | undefined>;
  cancel(): void;
  dispose(): void;
}

export interface FoodSearchSchedulerOptions {
  debounceMs?: number;
  defaultMode?: FoodSearchMode;
}

export interface FoodSearchSchedulerRequestOptions
  extends Omit<FoodSearchOptions, 'signal'> {
  /** Useful for a keyboard Search submission after debounced typeahead. */
  immediate?: boolean;
}

interface PendingSearch {
  timer?: ReturnType<typeof setTimeout>;
  controller: AbortController;
  resolve(value: FoodSearchResponse | undefined): void;
}

/**
 * Framework-independent debounce/cancellation coordinator. Each request
 * invalidates the previous one, and a late provider response can never be
 * mistaken for the current query.
 */
export function createFoodSearchScheduler(
  engine: Pick<FoodSearchEngine, 'search'>,
  {
    debounceMs = 650,
    defaultMode = 'typeahead',
  }: FoodSearchSchedulerOptions = {},
): FoodSearchScheduler {
  const delay = Math.max(0, debounceMs);
  let generation = 0;
  let pending: PendingSearch | undefined;
  let disposed = false;

  const cancelPending = () => {
    generation += 1;
    if (!pending) return;
    if (pending.timer !== undefined) clearTimeout(pending.timer);
    pending.controller.abort();
    pending.resolve(undefined);
    pending = undefined;
  };

  return {
    request(query, options = {}) {
      if (disposed) return Promise.resolve(undefined);
      cancelPending();
      const requestGeneration = generation;
      const controller = new AbortController();
      const { immediate = false, ...searchOptions } = options;
      return new Promise<FoodSearchResponse | undefined>((resolve, reject) => {
        const current: PendingSearch = { controller, resolve };
        current.timer = setTimeout(async () => {
          current.timer = undefined;
          try {
            const response = await engine.search(query, {
              mode: defaultMode,
              ...searchOptions,
              signal: controller.signal,
            });
            if (
              disposed ||
              controller.signal.aborted ||
              generation !== requestGeneration
            ) {
              resolve(undefined);
              return;
            }
            if (pending === current) pending = undefined;
            resolve(response);
          } catch (error) {
            if (
              disposed ||
              controller.signal.aborted ||
              generation !== requestGeneration ||
              error instanceof FoodSearchCancelledError
            ) {
              resolve(undefined);
              return;
            }
            if (pending === current) pending = undefined;
            reject(error);
          }
        }, immediate ? 0 : delay);
        pending = current;
      });
    },

    cancel() {
      cancelPending();
    },

    dispose() {
      disposed = true;
      cancelPending();
    },
  };
}
