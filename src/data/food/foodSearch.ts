import type { FoodCandidate } from './types';
import {
  FoodSearchOrigin,
  FoodSearchMatchEvidence,
  FoodSearchSeed,
  RankedFoodSearchResult,
  normaliseFoodSearchText,
  isFoodSearchQueryReady,
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
  page: number;
  countryScope: FoodSearchCountryScope;
}

export type FoodSearchMode = 'typeahead' | 'submitted';
export type FoodSearchCountryScope = 'local' | 'worldwide';

export interface FoodSearchProviderPage {
  foods: readonly FoodCandidate[];
  hasMore: boolean;
}

type FoodSearchProviderResult = readonly FoodCandidate[] | FoodSearchProviderPage;

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
  supportsPagination?: boolean;
  /** Real indexed aliases/categories, never an unverified claim that a hit matches. */
  matchEvidence?(food: FoodCandidate, query: string):
    Pick<FoodSearchMatchEvidence, 'matchedQuery' | 'fields'>;
  /** Separates cached remote results when locale/country/account context changes. */
  cacheScope?(): string;
  search(
    query: string,
    context: FoodSearchProviderContext,
  ): Promise<FoodSearchProviderResult> | FoodSearchProviderResult;
}

export interface FoodSearchProviderStatus {
  id: string;
  label: string;
  kind: FoodSearchProvider['kind'];
  state: 'success' | 'error' | 'skipped';
  candidateCount: number;
  hasMore?: boolean;
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
  hasMore: boolean;
  remotePage: number;
  countryScope: FoodSearchCountryScope;
}

export interface FoodSearchOptions {
  signal?: AbortSignal;
  limit?: number;
  now?: number;
  /** Submitted is a deliberate keyboard/search action, not every keystroke. */
  mode?: FoodSearchMode;
  /** Cumulative explicit online pages; page one remains cached when loading more. */
  remotePage?: number;
  countryScope?: FoodSearchCountryScope;
  /** Submitted searches can publish local matches without awaiting online IO. */
  onLocalResults?(response: FoodSearchResponse): void;
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
  hasMore: boolean;
}

interface ProviderSearchOutcome {
  status: FoodSearchProviderStatus;
  seeds: FoodSearchSeed[];
}

interface StoredSearchOutcome {
  candidates: readonly StoredFoodSearchCandidate[];
  state: 'success' | 'error';
  message?: string;
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
    page: FoodSearchProviderPage,
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
    remoteCache.set(cacheKey, { storedAt, foods: [...page.foods], hasMore: page.hasMore });
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
      const remotePage = Number.isFinite(options.remotePage)
        ? Math.max(1, Math.min(Math.floor(options.remotePage!), 10)) : 1;
      const countryScope = options.countryScope === 'worldwide' ? 'worldwide' : 'local';

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

      const providerTasks = providers.map(async (provider): Promise<ProviderSearchOutcome> => {
        const minimum = Math.max(2, provider.minQueryLength ?? 2);
        if (!isFoodSearchQueryReady(query, minimum)) {
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
        const paged = provider.kind === 'remote' && provider.supportsPagination === true;
        const providerLimit = paged ? 20 : Math.max(40, limit * 2);
        const requestedPages = paged ? remotePage : 1;
        const foods: FoodCandidate[] = [];
        let hasMore = false;
        const seeds = (): FoodSearchSeed[] => foods.map((food, rank) => ({
          food,
          origins: [provider.kind === 'remote' ? 'remote-catalogue' : 'offline-catalogue'],
          searchEvidence: {
            ...provider.matchEvidence?.(food, query),
            query,
            rank,
          },
        }));
        try {
          for (let page = 1; page <= requestedPages; page += 1) {
            const cacheKey = [provider.id, provider.cacheScope?.() ?? '', mode,
              providerLimit, countryScope, page, query].join('\u0000');
            const cached = provider.kind === 'remote' ? remoteCache.get(cacheKey) : undefined;
            const age = cached ? now - cached.storedAt : undefined;
            let result: FoodSearchProviderPage;
            if (cached && age !== undefined && age >= 0 && age < remoteCacheTtlMs) {
              result = cached;
            } else {
              const supplied = await provider.search(query, {
                signal: options.signal, limit: providerLimit, mode, page, countryScope,
              });
              throwIfAborted(options.signal);
              result = 'foods' in supplied ? supplied : {
                foods: supplied,
                hasMore: supplied.length >= providerLimit,
              };
              result = { foods: result.foods.slice(0, providerLimit), hasMore: result.hasMore };
              if (provider.kind === 'remote') cacheRemoteFoods(cacheKey, result, now);
            }
            foods.push(...result.foods);
            hasMore = result.hasMore;
            if (!hasMore) break;
          }
          return {
            status: {
              id: provider.id,
              label: provider.label,
              kind: provider.kind,
              state: 'success',
              candidateCount: foods.length,
              hasMore: hasMore && (!paged || remotePage < 10),
            } satisfies FoodSearchProviderStatus,
            seeds: seeds(),
          };
        } catch (error) {
          throwIfAborted(options.signal);
          return {
            status: {
              id: provider.id,
              label: provider.label,
              kind: provider.kind,
              state: 'error',
              candidateCount: foods.length,
              hasMore: paged && foods.length > 0,
              message: errorMessage(error, provider),
            } satisfies FoodSearchProviderStatus,
            seeds: seeds(),
          };
        }
      });

      const responseFor = (storedResult: StoredSearchOutcome, providerResults: readonly ProviderSearchOutcome[]): FoodSearchResponse => {
        const storedSeeds: FoodSearchSeed[] = storedResult.candidates.map((entry) => ({
          food: entry.food,
          origins: originsForStored(entry),
          isFavourite: entry.isFavourite,
          useCount: entry.useCount,
          lastUsedAt: entry.lastUsedAt,
        }));
        const providerSeeds = providerResults.flatMap((result) => result.seeds);
        const ranked = rankFoodSearchSeeds(query, [...storedSeeds, ...providerSeeds], {
          limit: 200,
          now,
        });
        return {
          query,
          results: ranked.slice(0, limit),
          hasMore: limit < 200 && (ranked.length > limit ||
            providerResults.some(({ status }) => status.hasMore)),
          remotePage,
          countryScope,
          personal: {
            state: storedResult.state,
            candidateCount: storedResult.candidates.length,
            ...(storedResult.message !== undefined ? { message: storedResult.message } : {}),
          },
          providers: providerResults.map((result) => result.status),
        };
      };

      const localPublication = mode === 'submitted' && options.onLocalResults
        ? Promise.all([storedPromise, Promise.all(providerTasks.filter((_, index) => providers[index]!.kind === 'offline'))])
          .then(([stored, local]) => {
            throwIfAborted(options.signal);
            options.onLocalResults?.(responseFor(stored, local));
          })
        : Promise.resolve();
      // Both branches are observed immediately, including cancellation failures.
      // A slow public provider cannot delay the independent local publication.
      const [storedResult, providerResults] = await Promise.all([
        storedPromise, Promise.all(providerTasks), localPublication,
      ]);
      throwIfAborted(options.signal);
      return responseFor(storedResult, providerResults);
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
        const { immediate = false, onLocalResults, ...searchOptions } = options;
      return new Promise<FoodSearchResponse | undefined>((resolve, reject) => {
        const current: PendingSearch = { controller, resolve };
        current.timer = setTimeout(async () => {
          current.timer = undefined;
          try {
            const response = await engine.search(query, {
              mode: defaultMode,
              ...searchOptions,
              signal: controller.signal,
              ...(onLocalResults ? { onLocalResults: (response: FoodSearchResponse) => {
                if (!disposed && !controller.signal.aborted && generation === requestGeneration) {
                  onLocalResults(response);
                }
              } } : {}),
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
