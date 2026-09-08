import type { FoodCandidate, FoodProviderId } from './types';
import { canonicalFoodBarcode } from './barcodeIdentity';

export type FoodSearchOrigin =
  | 'favourite'
  | 'recent'
  | 'custom'
  | 'cached'
  | 'offline-catalogue'
  | 'remote-catalogue';

export type FoodSearchMatch =
  | 'exact'
  | 'prefix'
  | 'tokens'
  | 'fuzzy'
  | 'suggestion';

/**
 * One candidate as supplied by a local or remote source. A candidate may have
 * several origins; for example, a user-created food can also be a favourite
 * and a recently logged food.
 */
export interface FoodSearchSeed {
  food: FoodCandidate;
  origins: readonly FoodSearchOrigin[];
  isFavourite?: boolean;
  useCount?: number;
  lastUsedAt?: number;
  /** Transient evidence for this query; never persisted on the food itself. */
  searchEvidence?: FoodSearchMatchEvidence;
}

export interface FoodSearchMatchEvidence {
  query: string;
  matchedQuery?: string;
  fields?: readonly string[];
  rank: number;
}

export interface FoodSearchProvenance {
  candidateId: string;
  provider: FoodProviderId;
  externalId: string;
  sourceLabel: string;
  sourceUrl?: string;
  barcode?: string;
  origins: FoodSearchOrigin[];
}

export interface RankedFoodSearchResult {
  /** The preferred candidate to pass to the logger. */
  food: FoodCandidate;
  match: FoodSearchMatch;
  score: number;
  isFavourite: boolean;
  isRecent: boolean;
  isCustom: boolean;
  useCount: number;
  lastUsedAt?: number;
  /** All sources folded into this result, including any deduplicated matches. */
  provenance: FoodSearchProvenance[];
}

export interface RankFoodSearchOptions {
  limit?: number;
  now?: number;
}

const MATCH_SCORE: Record<FoodSearchMatch, number> = {
  exact: 8_000,
  prefix: 6_500,
  tokens: 5_200,
  fuzzy: 4_000,
  suggestion: 0,
};

const ORIGIN_ORDER: readonly FoodSearchOrigin[] = [
  'favourite',
  'recent',
  'custom',
  'cached',
  'offline-catalogue',
  'remote-catalogue',
];

const DAY_MS = 24 * 60 * 60 * 1_000;

export function normaliseFoodSearchText(value: string) {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('en-GB')
    // Keep letters and numbers from every writing system. The previous ASCII
    // boundary silently reduced Japanese food names and queries to an empty
    // string, making any regional catalogue impossible to search.
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

/** One ideograph can name a food; one Latin letter cannot. */
export function isFoodSearchQueryReady(value: string, minimum = 2) {
  const query = normaliseFoodSearchText(value).normalize('NFC');
  return [...query].length >= minimum || /\p{Script=Han}/u.test(query);
}

function stableCompare(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function normaliseOpaqueIdentity(value: string) {
  return value.trim().toLocaleLowerCase('en-GB');
}

/** Matches the logger's one-decimal nutrient and portion presentation. */
function measurementIdentity(value: number | undefined) {
  if (value === undefined) return '';
  const rounded = Math.round(value * 10) / 10;
  return String(Object.is(rounded, -0) ? 0 : rounded);
}

function brandedContentIdentity(food: FoodCandidate, brand: string, name: string) {
  const nutrition = food.nutritionPerBasis;
  return [
    brand,
    name,
    measurementIdentity(food.basisAmount),
    food.basisUnit,
    measurementIdentity(food.defaultServingAmount ?? food.basisAmount),
    food.defaultServingUnit ?? food.basisUnit,
    measurementIdentity(nutrition.carbohydrateGrams),
    measurementIdentity(nutrition.energyKcal),
    measurementIdentity(nutrition.proteinGrams),
    measurementIdentity(nutrition.fatGrams),
    measurementIdentity(nutrition.fibreGrams),
    measurementIdentity(nutrition.sugarsGrams),
    measurementIdentity(nutrition.saturatedFatGrams),
  ].join(':');
}

function candidateKey(food: FoodCandidate) {
  return [
    food.provider,
    normaliseOpaqueIdentity(food.externalId),
    normaliseOpaqueIdentity(food.id),
  ].join('\u0000');
}

function boundedEditDistance(left: string, right: string, maximum: number) {
  if (left === right) return 0;
  if (Math.abs(left.length - right.length) > maximum) return maximum + 1;

  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex];
    let rowMinimum = leftIndex;
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const substitution =
        previous[rightIndex - 1]! +
        Number(left[leftIndex - 1] !== right[rightIndex - 1]);
      const value = Math.min(
        previous[rightIndex]! + 1,
        current[rightIndex - 1]! + 1,
        substitution,
      );
      current.push(value);
      rowMinimum = Math.min(rowMinimum, value);
    }
    if (rowMinimum > maximum) return maximum + 1;
    previous = current;
  }
  return previous[right.length]!;
}

function fuzzyWordMatch(word: string, token: string) {
  if (word === token || word.startsWith(token) || token.startsWith(word)) {
    return true;
  }
  const maximum = token.length >= 8 ? 2 : token.length >= 4 ? 1 : 0;
  return maximum > 0 && boundedEditDistance(word, token, maximum) <= maximum;
}

function classifyFields(fields: string[], query: string): FoodSearchMatch | undefined {
  if (fields.some((field) => field === query)) return 'exact';
  // A complete phrase prefix ("bread with seeds") outranks a word elsewhere.
  // A partial Latin word ("breadfruit") must not outrank actual "white bread";
  // retain it below whole words through fuzzy/typeahead matching instead.
  // Japanese scripts do not require spaces between words.
  const unsegmentedQuery = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]\p{M}*$/u.test(query);
  if (fields.some((field) => field.startsWith(`${query} `) ||
      (unsegmentedQuery && field.startsWith(query)))) return 'prefix';

  const queryTokens = query.split(' ').filter(Boolean);
  const combined = fields.join(' ');
  const words = combined.split(' ').filter(Boolean);
  if (queryTokens.every((token) => words.includes(token))) return 'tokens';
  if (queryTokens.every((token) =>
    /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(token)
      ? combined.includes(token)
      : words.includes(token),
  )) return 'tokens';
  if (
    queryTokens.every((token) =>
      words.some((word) => fuzzyWordMatch(word, token)),
    )
  ) {
    return 'fuzzy';
  }
  return undefined;
}

function queryEvidence(seed: FoodSearchSeed, query: string) {
  const evidence = seed.searchEvidence;
  if (!query || !evidence ||
      normaliseFoodSearchText(evidence.query).slice(0, 80) !== query ||
      !Number.isInteger(evidence.rank) || evidence.rank < 0 || evidence.rank >= 2_000 ||
      !seed.origins.some((origin) => origin === 'offline-catalogue' || origin === 'remote-catalogue')) {
    return undefined;
  }
  return evidence;
}

function classifyMatch(seed: FoodSearchSeed, query: string): FoodSearchMatch | undefined {
  if (!query) return 'suggestion';
  const name = normaliseFoodSearchText(seed.food.name);
  const brand = normaliseFoodSearchText(seed.food.brand ?? '');
  const fields = [name, [brand, name].filter(Boolean).join(' ')].filter(Boolean);
  const directMatch = classifyFields(fields, query);
  const evidence = queryEvidence(seed, query);
  if (!evidence) return directMatch;
  const matchedQuery = normaliseFoodSearchText(evidence.matchedQuery ?? query).slice(0, 80);
  if (!matchedQuery) return directMatch;
  const extraFields = (evidence.fields ?? []).slice(0, 8)
    .map((field) => normaliseFoodSearchText(field.slice(0, 240)));
  const evidenceMatch = classifyFields([...fields, ...extraFields], matchedQuery);
  // A category/alias match must not outrank an exact product-name match.
  const boundedMatch = evidenceMatch === 'exact' || evidenceMatch === 'prefix'
    ? 'tokens' : evidenceMatch;
  return boundedMatch && (!directMatch || MATCH_SCORE[boundedMatch] > MATCH_SCORE[directMatch])
    ? boundedMatch : directMatch;
}

function identityKeys(seed: FoodSearchSeed) {
  const food = seed.food;
  const keys = [
    `provider:${food.provider}:${normaliseOpaqueIdentity(food.externalId)}`,
    `id:${food.provider}:${normaliseOpaqueIdentity(food.id)}`,
  ];
  const barcode = food.barcode?.replace(/[^0-9]/g, '');
  if (barcode && barcode.length >= 7) keys.push(`barcode:${canonicalFoodBarcode(barcode)}`);

  const brand = normaliseFoodSearchText(food.brand ?? '');
  const name = normaliseFoodSearchText(food.name);
  // Text-search providers often return the same product content under several
  // package barcodes. Collapse only fully identical branded nutrition/serving
  // records at the precision users see; materially different variants stay
  // separate. Locally authored/catalogued no-barcode duplicates use a
  // provider-scoped key. Cached remote rows deliberately receive no content
  // key, preventing stale nutrition from bridging two fresh variants.
  if (
    brand &&
    name &&
    (seed.origins.includes('remote-catalogue') ||
      (!barcode &&
        food.provider !== 'open-food-facts' &&
        food.provider !== 'usda-fdc'))
  ) {
    const scope = seed.origins.includes('remote-catalogue')
      ? 'remote'
      : `local:${food.provider}`;
    keys.push(
      `branded-content:${scope}:${brandedContentIdentity(food, brand, name)}`,
    );
  }
  return keys;
}

function originSet(seed: FoodSearchSeed) {
  const origins = new Set(seed.origins);
  if (seed.food.provider === 'user') origins.add('custom');
  if (seed.isFavourite) origins.add('favourite');
  if (seed.lastUsedAt !== undefined || (seed.useCount ?? 0) > 0) {
    origins.add('recent');
  }
  return origins;
}

function nutritionCompleteness(food: FoodCandidate) {
  return Object.values(food.nutritionPerBasis).filter(
    (value) => value !== undefined,
  ).length;
}

function representativePriority(seed: FoodSearchSeed) {
  const origins = originSet(seed);
  const sourcePriority =
    seed.food.provider === 'user'
      ? 30_000
      : origins.has('remote-catalogue')
        ? 20_000
        : origins.has('offline-catalogue')
          ? 12_000
          : origins.has('cached')
            ? 8_000
            : 0;
  return (
    sourcePriority +
    nutritionCompleteness(seed.food) * 20 +
    Number(Boolean(seed.food.imageUrl)) * 5
  );
}

function mergeOrigins(seeds: readonly FoodSearchSeed[]) {
  const origins = new Set<FoodSearchOrigin>();
  for (const seed of seeds) {
    for (const origin of originSet(seed)) origins.add(origin);
  }
  return ORIGIN_ORDER.filter((origin) => origins.has(origin));
}

function provenanceFor(seeds: readonly FoodSearchSeed[]) {
  const merged = new Map<string, FoodSearchProvenance>();
  for (const seed of seeds) {
    const food = seed.food;
    const key = [food.provider, food.externalId, food.sourceLabel].join('\u0000');
    const existing = merged.get(key);
    const origins = ORIGIN_ORDER.filter((origin) => originSet(seed).has(origin));
    if (existing) {
      const nextOrigins = new Set([...existing.origins, ...origins]);
      existing.origins = ORIGIN_ORDER.filter((origin) => nextOrigins.has(origin));
      continue;
    }
    merged.set(key, {
      candidateId: food.id,
      provider: food.provider,
      externalId: food.externalId,
      sourceLabel: food.sourceLabel,
      sourceUrl: food.sourceUrl,
      barcode: food.barcode,
      origins,
    });
  }
  return [...merged.values()].sort(
    (left, right) =>
      stableCompare(left.provider, right.provider) ||
      stableCompare(left.externalId, right.externalId) ||
      stableCompare(left.sourceLabel, right.sourceLabel),
  );
}

function personalScore(
  origins: ReadonlySet<FoodSearchOrigin>,
  useCount: number,
  lastUsedAt: number | undefined,
  now: number,
) {
  let score = 0;
  if (origins.has('custom')) score += 1_000;
  if (origins.has('favourite')) score += 900;
  if (origins.has('recent')) score += 450;
  if (useCount > 0) score += Math.min(300, Math.log2(useCount + 1) * 75);
  if (lastUsedAt !== undefined) {
    const ageDays = Math.max(0, (now - lastUsedAt) / DAY_MS);
    score += Math.max(0, 650 - ageDays * 7);
  }
  return score;
}

interface GroupedSeeds {
  seeds: FoodSearchSeed[];
}

/** Deterministically folds exact identities and shared barcodes together. */
export function deduplicateFoodSearchSeeds(seeds: readonly FoodSearchSeed[]) {
  const sorted = [...seeds].sort((left, right) =>
    stableCompare(candidateKey(left.food), candidateKey(right.food)),
  );
  const parents = sorted.map((_, index) => index);
  const find = (index: number): number => {
    const parent = parents[index]!;
    if (parent === index) return index;
    const root = find(parent);
    parents[index] = root;
    return root;
  };
  const union = (left: number, right: number) => {
    const leftRoot = find(left);
    const rightRoot = find(right);
    if (leftRoot === rightRoot) return;
    parents[Math.max(leftRoot, rightRoot)] = Math.min(leftRoot, rightRoot);
  };
  const ownerByIdentity = new Map<string, number>();
  sorted.forEach((seed, index) => {
    for (const key of identityKeys(seed)) {
      const owner = ownerByIdentity.get(key);
      if (owner === undefined) ownerByIdentity.set(key, index);
      else union(index, owner);
    }
  });

  const groups = new Map<number, GroupedSeeds>();
  sorted.forEach((seed, index) => {
    const root = find(index);
    const group = groups.get(root) ?? { seeds: [] };
    group.seeds.push(seed);
    groups.set(root, group);
  });
  return [...groups.values()];
}

export function rankFoodSearchSeeds(
  rawQuery: string,
  seeds: readonly FoodSearchSeed[],
  options: RankFoodSearchOptions = {},
): RankedFoodSearchResult[] {
  const query = normaliseFoodSearchText(rawQuery).slice(0, 80);
  const now = options.now ?? Date.now();
  const limit = Math.max(0, Math.min(options.limit ?? 40, 200));

  return deduplicateFoodSearchSeeds(seeds)
    .flatMap(({ seeds: groupedSeeds }): RankedFoodSearchResult[] => {
      const matchingSeeds = groupedSeeds.flatMap((seed) => {
        const match = classifyMatch(seed, query);
        return match ? [{ seed, match }] : [];
      });
      if (!matchingSeeds.length) return [];
      const preferred = matchingSeeds.sort(
        (left, right) =>
          MATCH_SCORE[right.match] + representativePriority(right.seed) -
            (MATCH_SCORE[left.match] + representativePriority(left.seed)) ||
          stableCompare(candidateKey(left.seed.food), candidateKey(right.seed.food)),
      )[0]!;
      const representative = preferred.seed;
      const match = preferred.match;

      const origins = new Set(mergeOrigins(groupedSeeds));
      // Empty-query suggestions contain only things that belong to the user.
      if (
        match === 'suggestion' &&
        !origins.has('custom') &&
        !origins.has('favourite') &&
        !origins.has('recent')
      ) {
        return [];
      }
      const useCount = Math.max(
        0,
        ...groupedSeeds.map((seed) => seed.useCount ?? 0),
      );
      const lastUsedValues = groupedSeeds.flatMap((seed) =>
        seed.lastUsedAt === undefined ? [] : [seed.lastUsedAt],
      );
      const lastUsedAt = lastUsedValues.length
        ? Math.max(...lastUsedValues)
        : undefined;
      const isFavourite = origins.has('favourite');
      const isRecent = origins.has('recent');
      const isCustom = origins.has('custom');
      const personalPortion = [...groupedSeeds]
        .sort((left, right) => (right.lastUsedAt ?? 0) - (left.lastUsedAt ?? 0))
        .find(({ food }) => food.personalServingUnit === representative.food.basisUnit &&
          Number.isFinite(food.personalServingAmount) && (food.personalServingAmount ?? 0) > 0)?.food;
      const rememberedPortion = [...groupedSeeds]
        .sort((left, right) => (right.lastUsedAt ?? 0) - (left.lastUsedAt ?? 0))
        .find(({ food }) => food.lastPortionUnit === representative.food.basisUnit &&
          Number.isFinite(food.lastPortionAmount) && (food.lastPortionAmount ?? 0) > 0)?.food;
      return [
        {
          food: {
            ...representative.food,
            ...(personalPortion ? {
              personalServingAmount: personalPortion.personalServingAmount,
              personalServingUnit: personalPortion.personalServingUnit,
              personalServingLabel: personalPortion.personalServingLabel,
            } : {}),
            ...(rememberedPortion ? {
              lastPortionAmount: rememberedPortion.lastPortionAmount,
              lastPortionUnit: rememberedPortion.lastPortionUnit,
            } : {}),
          },
          match,
          score:
            MATCH_SCORE[match] +
            personalScore(origins, useCount, lastUsedAt, now) +
            (queryEvidence(representative, query)
              ? 200 / (1 + representative.searchEvidence!.rank)
              : 0),
          isFavourite,
          isRecent,
          isCustom,
          useCount,
          lastUsedAt,
          provenance: provenanceFor(groupedSeeds),
        },
      ];
    })
    .sort(
      (left, right) =>
        right.score - left.score ||
        Number(right.isFavourite) - Number(left.isFavourite) ||
        Number(right.isCustom) - Number(left.isCustom) ||
        stableCompare(
          normaliseFoodSearchText(left.food.name),
          normaliseFoodSearchText(right.food.name),
        ) ||
        stableCompare(candidateKey(left.food), candidateKey(right.food)),
    )
    .slice(0, limit);
}
