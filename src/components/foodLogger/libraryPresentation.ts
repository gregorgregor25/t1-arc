import type { RankedFoodSearchResult } from '@/data/food/foodSearchRanking';
import type { FoodMealPreset, FoodRecipe } from '@/data/food/types';

export type FoodLibraryTab =
  | 'recent'
  | 'favourites'
  | 'my-foods'
  | 'meals'
  | 'recipes';

export interface FoodLibraryContent {
  foods: RankedFoodSearchResult[];
  meals: FoodMealPreset[];
  recipes: FoodRecipe[];
}

export interface FoodLibraryCounts {
  recent: number;
  favourites: number;
  'my-foods': number;
  meals: number;
  recipes: number;
}

export function foodLibraryCounts(
  foods: readonly RankedFoodSearchResult[],
  meals: readonly FoodMealPreset[],
  recipes: readonly FoodRecipe[],
): FoodLibraryCounts {
  return {
    recent: foods.filter((result) => result.isRecent).length,
    favourites:
      foods.filter((result) => result.isFavourite).length +
      meals.filter((meal) => meal.isFavorite).length +
      recipes.filter((recipe) => recipe.isFavorite).length,
    'my-foods': foods.filter((result) => result.isCustom).length,
    meals: meals.length,
    recipes: recipes.length,
  };
}

export function foodLibraryContent(
  tab: FoodLibraryTab,
  foods: readonly RankedFoodSearchResult[],
  meals: readonly FoodMealPreset[],
  recipes: readonly FoodRecipe[],
): FoodLibraryContent {
  switch (tab) {
    case 'recent':
      return {
        foods: foods.filter((result) => result.isRecent),
        meals: [],
        recipes: [],
      };
    case 'favourites':
      return {
        foods: foods.filter((result) => result.isFavourite),
        meals: meals.filter((meal) => meal.isFavorite),
        recipes: recipes.filter((recipe) => recipe.isFavorite),
      };
    case 'my-foods':
      return {
        foods: foods.filter((result) => result.isCustom),
        meals: [],
        recipes: [],
      };
    case 'meals':
      return { foods: [], meals: [...meals], recipes: [] };
    case 'recipes':
      return { foods: [], meals: [], recipes: [...recipes] };
  }
}

export function foodLibraryEmptyMessage(tab: FoodLibraryTab) {
  switch (tab) {
    case 'recent':
      return 'Foods you log will appear here for faster reuse.';
    case 'favourites':
      return 'Star foods, meals or recipes to keep them together here.';
    case 'my-foods':
      return 'Create a food from its label to keep it in My Foods.';
    case 'meals':
      return 'Logged meals will appear here so you can reuse their items.';
    case 'recipes':
      return 'Save a meal as a recipe to reuse a serving later.';
  }
}
