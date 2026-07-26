import { MealEvent } from '@/domain/models';

export type FoodProviderId = 'cofid' | 'open-food-facts' | 'user';
export type FoodBasisUnit = 'g' | 'ml';
export type NutrientQuality = 'reported' | 'trace' | 'missing';

export interface FoodNutrition {
  carbohydrateGrams?: number;
  energyKcal?: number;
  proteinGrams?: number;
  fatGrams?: number;
  fibreGrams?: number;
  sugarsGrams?: number;
  saturatedFatGrams?: number;
}

export interface FoodNutritionQuality {
  carbohydrate: NutrientQuality;
  energy: NutrientQuality;
  protein: NutrientQuality;
  fat: NutrientQuality;
  fibre: NutrientQuality;
  sugars: NutrientQuality;
  saturatedFat: NutrientQuality;
}

export interface FoodCandidate {
  id: string;
  provider: FoodProviderId;
  externalId: string;
  name: string;
  brand?: string;
  barcode?: string;
  imageUrl?: string;
  basisAmount: number;
  basisUnit: FoodBasisUnit;
  nutritionPerBasis: FoodNutrition;
  nutritionQuality: FoodNutritionQuality;
  defaultServingAmount?: number;
  defaultServingUnit?: FoodBasisUnit;
  sourceLabel: string;
  sourceUrl?: string;
  rawPayload?: unknown;
}

export interface FoodLogItemDraft {
  food: FoodCandidate;
  amount: number;
  unit: FoodBasisUnit;
}

export interface FoodLogDraft {
  timestamp: number;
  mealType: MealEvent['mealType'];
  title?: string;
  items: FoodLogItemDraft[];
}

export interface FoodLogItemSnapshot {
  id: string;
  foodId: string;
  provider: FoodProviderId;
  externalId: string;
  name: string;
  brand?: string;
  barcode?: string;
  amount: number;
  unit: FoodBasisUnit;
  nutrition: FoodNutrition;
  sourceLabel: string;
  sourceUrl?: string;
}

export interface FoodLog {
  id: string;
  contextEventId: string;
  timestamp: number;
  mealType: MealEvent['mealType'];
  title: string;
  nutrition: FoodNutrition;
  items: FoodLogItemSnapshot[];
  createdAt: number;
}
