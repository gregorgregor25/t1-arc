import { describe, expect, it } from 'vitest';

import {
  recipeNutritionPerServing,
  servingFromRecipe,
} from '@/data/food/recipes';
import { FoodCandidate, FoodRecipe } from '@/data/food/types';

const oats: FoodCandidate = {
  id: 'cofid:oats',
  provider: 'cofid',
  externalId: 'oats',
  name: 'Porridge oats',
  basisAmount: 100,
  basisUnit: 'g',
  nutritionPerBasis: {
    carbohydrateGrams: 60,
    energyKcal: 370,
  },
  nutritionQuality: {
    carbohydrate: 'reported',
    energy: 'reported',
    protein: 'missing',
    fat: 'missing',
    fibre: 'missing',
    sugars: 'missing',
    saturatedFat: 'missing',
  },
  sourceLabel: 'CoFID 2021',
};

const recipe: FoodRecipe = {
  id: 'recipe:overnight-oats',
  name: 'Overnight oats',
  mealType: 'breakfast',
  servings: 4,
  nutrition: {
    carbohydrateGrams: 120,
    energyKcal: 740,
    proteinGrams: 24,
  },
  ingredients: [{ food: oats, amount: 200, unit: 'g' }],
  isFavorite: true,
  createdAt: 1,
  updatedAt: 1,
};

describe('food recipes', () => {
  it('scales every ingredient by one recipe multiplier without changing the recipe', () => {
    expect(servingFromRecipe(recipe, 0.5)[0]?.amount).toBe(25);
    expect(servingFromRecipe(recipe, 2)[0]?.amount).toBe(100);
    expect(recipe.ingredients[0]?.amount).toBe(200);
    expect(() => servingFromRecipe(recipe, 0)).toThrow('greater than zero');
  });
  it('turns a batch into one-serving ingredient amounts', () => {
    expect(servingFromRecipe(recipe)).toEqual([
      { food: oats, amount: 50, unit: 'g' },
    ]);
  });

  it('calculates every reported nutrient per serving', () => {
    expect(recipeNutritionPerServing(recipe)).toEqual({
      carbohydrateGrams: 30,
      energyKcal: 185,
      proteinGrams: 6,
      fatGrams: undefined,
      fibreGrams: undefined,
      sugarsGrams: undefined,
      saturatedFatGrams: undefined,
    });
  });
});
