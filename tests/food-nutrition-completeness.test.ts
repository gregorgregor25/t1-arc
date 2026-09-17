import { describe, expect, it } from 'vitest';
import { nutritionCompleteness, totalNutrition } from '@/data/food/nutrition';
import { createUserFoodCandidate } from '@/data/food/userFood';

describe('meal nutrient completeness', () => {
  it('distinguishes a partial sum, known zero and wholly missing nutrients', () => {
    const items = [
      createUserFoodCandidate({ name: 'Known', servingAmount: 100, servingUnit: 'g', nutritionPerServing: { carbohydrateGrams: 10, energyKcal: 0 } }, 1, 'known'),
      createUserFoodCandidate({ name: 'Unknown energy', servingAmount: 100, servingUnit: 'g', nutritionPerServing: { carbohydrateGrams: 0 } }, 1, 'unknown'),
    ].map((food) => ({ food, amount: 100, unit: 'g' as const }));
    expect(totalNutrition(items)).toEqual({ carbohydrateGrams: 10, energyKcal: 0 });
    expect(nutritionCompleteness(items)).toMatchObject({ carbohydrateGrams: 'complete', energyKcal: 'partial', proteinGrams: 'missing' });
    expect(nutritionCompleteness([]).carbohydrateGrams).toBe('missing');
  });
});
