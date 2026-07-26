import { describe, expect, it } from 'vitest';

import {
  COFID_CATALOG_INFO,
  searchCofidFoods,
} from '@/data/food/cofidCatalog';
import {
  nutritionForFoodAmount,
  totalNutrition,
} from '@/data/food/nutrition';

describe('offline UK food catalogue', () => {
  it('ships a substantial, attributable CoFID catalogue', () => {
    expect(COFID_CATALOG_INFO.foodCount).toBeGreaterThan(2_500);
    expect(COFID_CATALOG_INFO.dataset).toContain('CoFID 2021');
    expect(COFID_CATALOG_INFO.licence).toContain(
      'Open Government Licence',
    );
    expect(COFID_CATALOG_INFO.sourceSha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it('ranks exact and prefix matches before loose token matches', () => {
    const results = searchCofidFoods('banana', 10);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]!.name.toLocaleLowerCase('en-GB')).toMatch(
      /^banana/,
    );
    expect(
      results.every((result) =>
        result.name.toLocaleLowerCase('en-GB').includes('banana'),
      ),
    ).toBe(true);
  });

  it('supports order-independent multi-word queries', () => {
    const results = searchCofidFoods('toast white', 10);
    expect(results.length).toBeGreaterThan(0);
    expect(
      results.some((result) => {
        const name = result.name.toLocaleLowerCase('en-GB');
        return name.includes('toast') && name.includes('white');
      }),
    ).toBe(true);
  });
});

describe('food nutrition calculation', () => {
  const porridge = searchCofidFoods('porridge made with milk', 1)[0]!;

  it('scales nutrients from the source basis without inventing values', () => {
    const nutrition = nutritionForFoodAmount({
      food: porridge,
      amount: 50,
      unit: porridge.basisUnit,
    });
    const sourceCarbs = porridge.nutritionPerBasis.carbohydrateGrams;
    expect(sourceCarbs).toBeTypeOf('number');
    expect(nutrition.carbohydrateGrams).toBeCloseTo(sourceCarbs! / 2, 2);
  });

  it('totals multiple logged foods deterministically', () => {
    const banana = searchCofidFoods('banana', 1)[0]!;
    const one = nutritionForFoodAmount({
      food: banana,
      amount: 100,
      unit: banana.basisUnit,
    });
    const total = totalNutrition([
      { food: banana, amount: 100, unit: banana.basisUnit },
      { food: banana, amount: 50, unit: banana.basisUnit },
    ]);
    expect(total.carbohydrateGrams).toBeCloseTo(
      one.carbohydrateGrams! * 1.5,
      2,
    );
  });

  it('rejects invalid amounts and incompatible units', () => {
    expect(() =>
      nutritionForFoodAmount({
        food: porridge,
        amount: 0,
        unit: porridge.basisUnit,
      }),
    ).toThrow('greater than zero');
    expect(() =>
      nutritionForFoodAmount({
        food: porridge,
        amount: 100,
        unit: porridge.basisUnit === 'g' ? 'ml' : 'g',
      }),
    ).toThrow('measured');
  });
});
