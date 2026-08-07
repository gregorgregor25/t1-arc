import { FoodLogItemDraft, FoodNutrition, FoodRecipe } from './types';

export function servingFromRecipe(recipe: FoodRecipe): FoodLogItemDraft[] {
  return recipe.ingredients.map((ingredient) => ({
    food: ingredient.food,
    amount: ingredient.amount / recipe.servings,
    unit: ingredient.unit,
  }));
}

export function recipeNutritionPerServing(
  recipe: FoodRecipe,
): FoodNutrition {
  const divide = (value: number | undefined) =>
    value === undefined ? undefined : value / recipe.servings;
  return {
    carbohydrateGrams: divide(recipe.nutrition.carbohydrateGrams),
    energyKcal: divide(recipe.nutrition.energyKcal),
    proteinGrams: divide(recipe.nutrition.proteinGrams),
    fatGrams: divide(recipe.nutrition.fatGrams),
    fibreGrams: divide(recipe.nutrition.fibreGrams),
    sugarsGrams: divide(recipe.nutrition.sugarsGrams),
    saturatedFatGrams: divide(recipe.nutrition.saturatedFatGrams),
  };
}
