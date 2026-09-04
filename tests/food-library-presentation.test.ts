import { describe, expect, it } from 'vitest';

import {
  foodLibraryContent,
  foodLibraryCounts,
  foodLibraryEmptyMessage,
} from '@/components/foodLogger/libraryPresentation';
import type { RankedFoodSearchResult } from '@/data/food/foodSearchRanking';
import type { FoodCandidate, FoodMealPreset, FoodRecipe } from '@/data/food/types';

const food = (id: string, provider: FoodCandidate['provider']): FoodCandidate => ({
  id,
  provider,
  externalId: id,
  name: id,
  basisAmount: 100,
  basisUnit: 'g',
  nutritionPerBasis: { carbohydrateGrams: 10 },
  nutritionQuality: {
    carbohydrate: 'reported',
    energy: 'missing',
    protein: 'missing',
    fat: 'missing',
    fibre: 'missing',
    sugars: 'missing',
    saturatedFat: 'missing',
  },
  sourceLabel: 'Test',
});

const result = (
  id: string,
  options: Partial<Pick<RankedFoodSearchResult, 'isRecent' | 'isFavourite' | 'isCustom'>>,
): RankedFoodSearchResult => ({
  food: food(id, options.isCustom ? 'user' : 'cofid'),
  match: 'suggestion',
  score: 1,
  isFavourite: options.isFavourite ?? false,
  isRecent: options.isRecent ?? false,
  isCustom: options.isCustom ?? false,
  useCount: options.isRecent ? 1 : 0,
  provenance: [],
});

const meal = (id: string, isFavorite: boolean): FoodMealPreset => ({
  id,
  title: id,
  mealType: 'lunch',
  nutrition: { carbohydrateGrams: 10 },
  items: [],
  isFavorite,
});

const recipe = (id: string, isFavorite: boolean): FoodRecipe => ({
  id,
  name: id,
  mealType: 'dinner',
  servings: 2,
  nutrition: { carbohydrateGrams: 20 },
  ingredients: [],
  isFavorite,
  createdAt: 1,
  updatedAt: 1,
});

describe('food library presentation', () => {
  const foods = [
    result('recent', { isRecent: true }),
    result('favourite', { isFavourite: true }),
    result('custom', { isCustom: true }),
  ];
  const meals = [meal('saved-meal', true), meal('recent-meal', false)];
  const recipes = [recipe('saved-recipe', true), recipe('other-recipe', false)];

  it('counts each discoverable section without changing food identities', () => {
    expect(foodLibraryCounts(foods, meals, recipes)).toEqual({
      recent: 1,
      favourites: 3,
      'my-foods': 1,
      meals: 2,
      recipes: 2,
    });
  });

  it('keeps favourites from foods, meals and recipes together', () => {
    const content = foodLibraryContent('favourites', foods, meals, recipes);
    expect(content.foods.map((entry) => entry.food.id)).toEqual(['favourite']);
    expect(content.meals.map((entry) => entry.id)).toEqual(['saved-meal']);
    expect(content.recipes.map((entry) => entry.id)).toEqual(['saved-recipe']);
  });

  it('separates personal foods, saved meals and recipes', () => {
    expect(foodLibraryContent('my-foods', foods, meals, recipes).foods[0]?.food.id).toBe(
      'custom',
    );
    expect(foodLibraryContent('meals', foods, meals, recipes).meals).toHaveLength(2);
    expect(foodLibraryContent('recipes', foods, meals, recipes).recipes).toHaveLength(2);
  });

  it('gives every empty section an actionable explanation', () => {
    for (const tab of ['recent', 'favourites', 'my-foods', 'meals', 'recipes'] as const) {
      expect(foodLibraryEmptyMessage(tab).length).toBeGreaterThan(20);
    }
  });
});
