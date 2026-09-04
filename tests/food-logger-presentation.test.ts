import { describe, expect, it } from "vitest";

import { presentFoodNutrition } from "@/components/foodLogger/presentation";
import {
  barcodeCacheLookupPlan,
  canUseStaleBarcodeFallback,
  favoriteMutationPlanForSearchResult,
  searchResultCandidateIds,
  searchResultMatchesFood,
  shouldLoadRemoteProductImage,
  staleBarcodeFallbackMessage,
} from "@/components/foodLogger/searchPresentation";
import type { RankedFoodSearchResult } from "@/data/food/foodSearchRanking";
import type { FoodCandidate } from "@/data/food/types";

const quality = {
  carbohydrate: "reported",
  energy: "missing",
  protein: "missing",
  fat: "missing",
  fibre: "missing",
  sugars: "missing",
  saturatedFat: "missing",
} as const;

function food(
  id: string,
  provider: FoodCandidate["provider"],
  externalId = id,
): FoodCandidate {
  return {
    id,
    provider,
    externalId,
    name: "Porridge",
    basisAmount: 100,
    basisUnit: "g",
    nutritionPerBasis: { carbohydrateGrams: 12 },
    nutritionQuality: quality,
    sourceLabel: provider,
  };
}

function rankedResult(): RankedFoodSearchResult {
  return {
    food: food("remote-porridge", "open-food-facts", "5000111000011"),
    match: "exact",
    score: 8_000,
    isFavourite: true,
    isRecent: true,
    isCustom: false,
    useCount: 2,
    provenance: [
      {
        candidateId: "saved-porridge",
        provider: "open-food-facts",
        externalId: "5000111000011",
        sourceLabel: "Saved food",
        origins: ["cached", "favourite", "recent"],
      },
      {
        candidateId: "remote-porridge",
        provider: "open-food-facts",
        externalId: "5000111000011",
        sourceLabel: "Open Food Facts",
        origins: ["remote-catalogue"],
      },
    ],
  };
}

describe("food logger nutrition presentation", () => {
  it("keeps carbohydrate first and supporting macros in a stable order", () => {
    expect(
      presentFoodNutrition({
        carbohydrateGrams: 37.46,
        energyKcal: 412.04,
        proteinGrams: 12,
        fatGrams: 8.55,
      }),
    ).toEqual({
      carbs: "37.5 g carbs",
      calories: "412 kcal",
      protein: "12 g protein",
      fat: "8.6 g fat",
      secondary: "412 kcal · 12 g protein · 8.6 g fat",
    });
  });

  it("does not invent missing nutrients and preserves reported zeroes", () => {
    expect(
      presentFoodNutrition({ carbohydrateGrams: 0, proteinGrams: 0 }),
    ).toEqual({
      carbs: "0 g carbs",
      calories: undefined,
      protein: "0 g protein",
      fat: undefined,
      secondary: "0 g protein",
    });
    expect(presentFoodNutrition({}).carbs).toBe("Not reported");
  });
});

describe("food logger ranked search presentation", () => {
  it("recognises every deduplicated provenance identity as already selected", () => {
    const result = rankedResult();

    expect(searchResultCandidateIds(result)).toEqual([
      "remote-porridge",
      "saved-porridge",
    ]);
    expect(
      searchResultMatchesFood(
        result,
        food("another-local-id", "open-food-facts", "5000111000011"),
      ),
    ).toBe(true);
    expect(searchResultMatchesFood(result, food("different", "cofid"))).toBe(
      false,
    );
  });

  it("targets stored identities without mixing in representative food data", () => {
    const grouped = rankedResult();
    grouped.isFavourite = false;
    grouped.provenance[0] = {
      candidateId: "custom-porridge",
      provider: "user",
      externalId: "custom-porridge",
      sourceLabel: "My foods",
      origins: ["custom", "cached"],
    };

    expect(favoriteMutationPlanForSearchResult(grouped, false)).toEqual({
      storedIdentities: [
        {
          id: "custom-porridge",
          provider: "user",
          externalId: "custom-porridge",
        },
      ],
    });
  });

  it("only inserts the displayed candidate when no stored identity exists", () => {
    const remoteOnly = rankedResult();
    remoteOnly.isFavourite = false;
    remoteOnly.provenance = [remoteOnly.provenance[1]!];

    expect(favoriteMutationPlanForSearchResult(remoteOnly, false)).toEqual({
      storedIdentities: [],
      insertFood: remoteOnly.food,
    });
    expect(
      favoriteMutationPlanForSearchResult(
        remoteOnly,
        true,
        new Set([remoteOnly.food.id]),
      ).storedIdentities,
    ).toEqual([
      {
        id: remoteOnly.food.id,
        provider: remoteOnly.food.provider,
        externalId: remoteOnly.food.externalId,
      },
    ]);
  });

  it("persists fresh content when the stored and displayed OFF identity match", () => {
    const fresh = rankedResult();
    fresh.isFavourite = false;
    fresh.food = {
      ...fresh.food,
      nutritionPerBasis: { carbohydrateGrams: 12.5 },
      catalogueObservedAt: 123_456,
    };
    fresh.provenance = [
      {
        candidateId: fresh.food.id,
        provider: fresh.food.provider,
        externalId: fresh.food.externalId,
        sourceLabel: "Open Food Facts",
        origins: ["cached", "remote-catalogue"],
      },
    ];

    const mutation = favoriteMutationPlanForSearchResult(fresh, false);
    expect(mutation.storedIdentities).toEqual([]);
    expect(mutation.insertFood).toBe(fresh.food);
    expect(mutation.insertFood?.nutritionPerBasis.carbohydrateGrams).toBe(12.5);
    expect(mutation.insertFood?.catalogueObservedAt).toBe(123_456);
  });

  it("clears every provenance identity known to be a favourite", () => {
    const grouped = rankedResult();
    grouped.provenance.push({
      candidateId: "second-favourite",
      provider: "user",
      externalId: "second-favourite",
      sourceLabel: "My foods",
      origins: ["custom", "favourite"],
    });

    expect(
      favoriteMutationPlanForSearchResult(grouped, true).storedIdentities,
    ).toEqual([
      {
        id: "saved-porridge",
        provider: "open-food-facts",
        externalId: "5000111000011",
      },
      {
        id: "second-favourite",
        provider: "user",
        externalId: "second-favourite",
      },
    ]);
  });

  it("mounts remote catalogue artwork for at most eight ranked rows", () => {
    const result = rankedResult();

    expect(shouldLoadRemoteProductImage(result, 0)).toBe(true);
    expect(shouldLoadRemoteProductImage(result, 7)).toBe(true);
    expect(shouldLoadRemoteProductImage(result, 8)).toBe(false);
    result.provenance[1]!.origins = ["cached"];
    expect(shouldLoadRemoteProductImage(result, 0)).toBe(false);
  });
});

describe("food logger barcode cache presentation", () => {
  it("uses fresh cached details immediately and revalidates stale details", () => {
    expect(barcodeCacheLookupPlan("fresh")).toBe("use-cache");
    expect(barcodeCacheLookupPlan("stale")).toBe("revalidate");
    expect(barcodeCacheLookupPlan(undefined)).toBe("revalidate");
  });

  it("only permits stale fallback for non-authoritative catalogue failures", () => {
    expect(canUseStaleBarcodeFallback("network")).toBe(true);
    expect(canUseStaleBarcodeFallback("rate_limited")).toBe(true);
    expect(canUseStaleBarcodeFallback("service")).toBe(true);
    expect(canUseStaleBarcodeFallback("not_found")).toBe(false);
    expect(canUseStaleBarcodeFallback("incomplete")).toBe(false);
    expect(staleBarcodeFallbackMessage("Porridge")).toContain("saved details");
    expect(staleBarcodeFallbackMessage("Porridge")).toContain(
      "need refreshing",
    );
  });
});
