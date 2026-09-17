import type { FoodCandidate, FoodProviderId } from './types';

export const OPEN_FOOD_FACTS_CATALOG_CACHE_TTL_MS =
  7 * 24 * 60 * 60 * 1_000;
export const USDA_FDC_CATALOG_CACHE_TTL_MS = 31 * 24 * 60 * 60 * 1_000;

export interface FoodProviderRetentionPolicy {
  /** Normalized user-selected fields are always stored in immutable log items. */
  historySnapshot: 'permitted' | 'prohibited';
  rawPayload: 'none' | 'local-only' | 'minimal-serving';
  catalogCacheTtlMs?: number;
}

/**
 * Adding a FoodProviderId is intentionally a compile-time retention decision.
 * Search adapters must not silently make an entire vendor response durable.
 */
export const FOOD_PROVIDER_RETENTION_POLICIES: Record<
  FoodProviderId,
  FoodProviderRetentionPolicy
> = {
  cnf: { historySnapshot: 'permitted', rawPayload: 'none' },
  ciqual: { historySnapshot: 'permitted', rawPayload: 'none' },
  bls: { historySnapshot: 'permitted', rawPayload: 'none' },
  fineli: { historySnapshot: 'permitted', rawPayload: 'none' },
  cofid: {
    historySnapshot: 'permitted',
    rawPayload: 'none',
  },
  'mext-jp': {
    historySnapshot: 'permitted',
    // The versioned government reference table is bundled with the app.
    rawPayload: 'none',
  },
  'open-food-facts': {
    historySnapshot: 'permitted',
    rawPayload: 'minimal-serving',
    // Community catalogue records can be corrected after a scan. Revalidate
    // at most weekly, while retaining the normalized row as an offline fallback.
    catalogCacheTtlMs: OPEN_FOOD_FACTS_CATALOG_CACHE_TTL_MS,
  },
  'usda-fdc': {
    historySnapshot: 'permitted',
    rawPayload: 'minimal-serving',
    // FoodData Central branded data is updated regularly. Keep normalized
    // offline results while revalidating the public catalogue monthly.
    catalogCacheTtlMs: USDA_FDC_CATALOG_CACHE_TTL_MS,
  },
  user: {
    historySnapshot: 'permitted',
    rawPayload: 'local-only',
  },
};

export interface RetainedFoodCatalogData {
  rawPayloadJson: string | null;
  expiresAt: number | null;
}

export interface FoodCatalogueRegionalContext {
  countryCode: string;
  languageTag: string;
}

export const FOOD_CATALOGUE_REGIONAL_CONTEXT_KEY =
  '_t1arcRegionalContext';

export function foodCatalogueRegionalContextFromPayload(
  value: unknown,
): FoodCatalogueRegionalContext | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  const candidate = (value as Record<string, unknown>)[
    FOOD_CATALOGUE_REGIONAL_CONTEXT_KEY
  ];
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
    return undefined;
  }
  const context = candidate as Record<string, unknown>;
  const countryCode =
    typeof context.countryCode === 'string'
      ? context.countryCode.trim().toUpperCase()
      : '';
  const languageTag =
    typeof context.languageTag === 'string'
      ? context.languageTag.trim().toLowerCase()
      : '';
  if (!/^[A-Z]{2}$/.test(countryCode) || !/^[a-z]{2,3}$/.test(languageTag)) {
    return undefined;
  }
  return { countryCode, languageTag };
}

function serialise(value: unknown) {
  if (value === undefined) return null;
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}

export function foodMetadataFromPayload(payload: unknown): Pick<FoodCandidate,
  'personalServingAmount' | 'personalServingUnit' | 'personalServingLabel' | 'nutrientDefinitions'> {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return {};
  const source = payload as Record<string, unknown>;
  const result: ReturnType<typeof foodMetadataFromPayload> = {};
  const personal = source._t1arcPersonalServing;
  if (personal && typeof personal === 'object' && !Array.isArray(personal)) {
    const serving = personal as Record<string, unknown>;
    if (typeof serving.amount === 'number' && Number.isFinite(serving.amount) && serving.amount > 0 &&
        (serving.unit === 'g' || serving.unit === 'ml')) {
      result.personalServingAmount = serving.amount;
      result.personalServingUnit = serving.unit;
      if (typeof serving.label === 'string') result.personalServingLabel = serving.label.slice(0, 80);
    }
  }
  const definitions = source._t1arcNutrientDefinitions;
  if (definitions && typeof definitions === 'object' && !Array.isArray(definitions)) {
    const sourceDefinitions = definitions as Record<string, unknown>;
    const normalized: NonNullable<FoodCandidate['nutrientDefinitions']> = {};
    if (['available', 'total', 'by-difference', 'unknown'].includes(String(sourceDefinitions.carbohydrate))) {
      normalized.carbohydrate = sourceDefinitions.carbohydrate as NonNullable<FoodCandidate['nutrientDefinitions']>['carbohydrate'];
    }
    if (['reported', 'atwater-specific', 'atwater-general'].includes(String(sourceDefinitions.energy))) {
      normalized.energy = sourceDefinitions.energy as NonNullable<FoodCandidate['nutrientDefinitions']>['energy'];
    }
    if (typeof sourceDefinitions.note === 'string') normalized.note = sourceDefinitions.note.slice(0, 240);
    if (Object.keys(normalized).length) result.nutrientDefinitions = normalized;
  }
  return result;
}

function retainedLocalPayload(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  const source = value as Record<string, unknown>;
  if (source.enteredOnDevice !== true) return undefined;
  const retained: Record<string, unknown> = { enteredOnDevice: true };
  if (typeof source.createdAt === 'number' && Number.isFinite(source.createdAt)) {
    retained.createdAt = source.createdAt;
  }
  if (typeof source.barcode === 'string') retained.barcode = source.barcode;
  if (typeof source.serving_size === 'string') {
    retained.serving_size = source.serving_size;
  }
  if (source.quickCarbEntry === true) retained.quickCarbEntry = true;
  return retained;
}

export function retainedFoodCatalogData(
  food: FoodCandidate,
  cachedAt: number,
): RetainedFoodCatalogData {
  const policy = FOOD_PROVIDER_RETENTION_POLICIES[food.provider];
  let retainedPayload: unknown;
  if (policy.rawPayload === 'local-only') {
    // Only the small marker set created by T1 Arc is durable. This prevents a
    // malformed cross-provider candidate from laundering a vendor response by
    // merely changing its provider identity to `user`.
    retainedPayload = retainedLocalPayload(food.rawPayload);
  } else if (policy.rawPayload === 'minimal-serving') {
    // candidateFromRow needs only the normalized serving and regional lookup
    // identity. The provider response itself is not retained.
    const minimal: Record<string, unknown> = {};
    if (food.servingLabel) minimal.serving_size = food.servingLabel;
    const regionalContext = foodCatalogueRegionalContextFromPayload(
      food.rawPayload,
    );
    if (regionalContext) {
      minimal[FOOD_CATALOGUE_REGIONAL_CONTEXT_KEY] = regionalContext;
    }
    retainedPayload = Object.keys(minimal).length ? minimal : undefined;
  }
  // Only normalized app metadata is retained, never an arbitrary provider blob.
  const metadata = foodMetadataFromPayload({
    _t1arcPersonalServing: { amount: food.personalServingAmount, unit: food.personalServingUnit, label: food.personalServingLabel },
    _t1arcNutrientDefinitions: food.nutrientDefinitions,
  });
  if (metadata.personalServingAmount !== undefined || metadata.nutrientDefinitions) {
    const enriched = { ...(retainedPayload as Record<string, unknown> | undefined) };
    if (metadata.personalServingAmount !== undefined) enriched._t1arcPersonalServing = {
      amount: metadata.personalServingAmount, unit: metadata.personalServingUnit, label: metadata.personalServingLabel,
    };
    if (metadata.nutrientDefinitions) enriched._t1arcNutrientDefinitions = metadata.nutrientDefinitions;
    retainedPayload = enriched;
  }
  return {
    rawPayloadJson: serialise(retainedPayload),
    expiresAt:
      policy.catalogCacheTtlMs === undefined
        ? null
        : cachedAt + policy.catalogCacheTtlMs,
  };
}

export function assertFoodHistoryRetentionAllowed(food: FoodCandidate) {
  const policy = FOOD_PROVIDER_RETENTION_POLICIES[food.provider];
  if (policy.historySnapshot !== 'permitted') {
    throw new Error(`${food.sourceLabel} does not permit saved food history.`);
  }
}
