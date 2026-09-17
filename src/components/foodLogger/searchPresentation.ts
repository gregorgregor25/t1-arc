import type { RankedFoodSearchResult } from "@/data/food/foodSearchRanking";
import type { FoodCandidate } from "@/data/food/types";

const STORED_ORIGIN_PRIORITY = ["custom", "recent", "cached"] as const;
export const REMOTE_PRODUCT_IMAGE_LIMIT = 8;

export interface FoodFavoriteIdentity {
  id: string;
  provider: FoodCandidate["provider"];
  externalId: string;
}

export interface FoodFavoriteMutationPlan {
  storedIdentities: FoodFavoriteIdentity[];
  insertFood?: FoodCandidate;
}

export function searchResultCandidateIds(result: RankedFoodSearchResult) {
  return [
    ...new Set([
      result.food.id,
      ...result.provenance.map((source) => source.candidateId),
    ]),
  ];
}

/** Treats provider variants folded into one ranked result as the same food. */
export function searchResultMatchesFood(
  result: RankedFoodSearchResult,
  food: FoodCandidate,
) {
  return (
    result.food.id === food.id ||
    result.provenance.some(
      (source) =>
        source.candidateId === food.id ||
        (source.provider === food.provider &&
          source.externalId === food.externalId),
    )
  );
}

/** Never mixes a ranked representative's data with another stored identity. */
export function favoriteMutationPlanForSearchResult(
  result: RankedFoodSearchResult,
  currentlyFavorite: boolean,
  knownFavoriteIds: ReadonlySet<string> = new Set(),
): FoodFavoriteMutationPlan {
  const identity = (source: RankedFoodSearchResult["provenance"][number]) => ({
    id: source.candidateId,
    provider: source.provider,
    externalId: source.externalId,
  });

  if (currentlyFavorite) {
    return {
      storedIdentities: result.provenance
        .filter(
          (source) =>
            source.origins.includes("favourite") ||
            knownFavoriteIds.has(source.candidateId),
        )
        .map(identity),
    };
  }

  for (const origin of STORED_ORIGIN_PRIORITY) {
    const source = result.provenance.find((candidate) =>
      candidate.origins.includes(origin),
    );
    if (source) {
      const representativeIsStoredIdentity =
        source.candidateId === result.food.id &&
        source.provider === result.food.provider &&
        source.externalId === result.food.externalId;
      return representativeIsStoredIdentity
        ? { storedIdentities: [], insertFood: result.food }
        : { storedIdentities: [identity(source)] };
    }
  }

  return { storedIdentities: [], insertFood: result.food };
}

export function barcodeCacheLookupPlan(status?: "fresh" | "stale") {
  return status === "fresh" ? ("use-cache" as const) : ("revalidate" as const);
}

export function canUseStaleBarcodeFallback(errorCode: string | undefined) {
  return ["network", "rate_limited", "service"].includes(errorCode ?? "");
}

export function staleBarcodeFallbackMessage(foodName: string) {
  return `${foodName} was added using saved details because the catalogue could not be reached. Check the label before saving; these details need refreshing.`;
}

export function shouldLoadRemoteProductImage(
  result: RankedFoodSearchResult,
  resultIndex: number,
) {
  return (
    resultIndex >= 0 &&
    resultIndex < REMOTE_PRODUCT_IMAGE_LIMIT &&
    result.provenance.some((source) =>
      source.origins.includes("remote-catalogue"),
    )
  );
}
