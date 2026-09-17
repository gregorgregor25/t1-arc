import { describe, expect, it } from 'vitest';

import { nutritionForFoodAmount } from '@/data/food/nutrition';
import { createUserFoodCandidate } from '@/data/food/userFood';

describe('user food candidate', () => {
  it('keeps nutrition tied to the serving the user entered', () => {
    const food = createUserFoodCandidate(
      {
        name: '  Granola bowl  ',
        brand: ' Kitchen ',
        servingAmount: 45,
        servingUnit: 'g',
        nutritionPerServing: {
          carbohydrateGrams: 28,
          energyKcal: 210,
          proteinGrams: 6,
        },
      },
      1_700_000_000_000,
      'fixture',
    );

    expect(food).toMatchObject({
      id: 'user:1700000000000-fixture',
      name: 'Granola bowl',
      brand: 'Kitchen',
      basisAmount: 45,
      sourceLabel: 'My foods',
    });
    expect(
      nutritionForFoodAmount({ food, amount: 90, unit: 'g' }),
    ).toMatchObject({
      carbohydrateGrams: 56,
      energyKcal: 420,
      proteinGrams: 12,
    });
  });

  it('requires a valid name, serving and carbohydrate value', () => {
    expect(() =>
      createUserFoodCandidate({
        name: '',
        servingAmount: 100,
        servingUnit: 'g',
        nutritionPerServing: { carbohydrateGrams: 10 },
      }),
    ).toThrow('Enter a food name');

    expect(() =>
      createUserFoodCandidate({
        name: 'Unknown',
        servingAmount: 0,
        servingUnit: 'g',
        nutritionPerServing: { carbohydrateGrams: 10 },
      }),
    ).toThrow('Serving amount');

    expect(() =>
      createUserFoodCandidate({
        name: 'Unknown',
        servingAmount: 100,
        servingUnit: 'g',
        nutritionPerServing: {},
      }),
    ).toThrow('Enter carbohydrate');
  });

  it('preserves explicit zero values without inventing missing nutrients', () => {
    const food = createUserFoodCandidate({
      name: 'Sugar-free drink',
      servingAmount: 330,
      servingUnit: 'ml',
      nutritionPerServing: {
        carbohydrateGrams: 0,
        energyKcal: 0,
      },
    });

    expect(food.nutritionQuality.carbohydrate).toBe('reported');
    expect(food.nutritionQuality.energy).toBe('reported');
    expect(food.nutritionQuality.protein).toBe('missing');
  });

  it('links a label-entered food to a stable reusable barcode', () => {
    const food = createUserFoodCandidate(
      {
        name: 'Breakfast cereal',
        barcode: ' 5000-1570-71644 ',
        servingAmount: 30,
        servingUnit: 'g',
        nutritionPerServing: { carbohydrateGrams: 21 },
      },
      1_700_000_000_000,
      'ignored-for-barcodes',
    );

    expect(food).toMatchObject({
      id: 'user:barcode:5000157071644',
      externalId: 'barcode:5000157071644',
      barcode: '5000157071644',
    });
  });

  it('rejects malformed custom-food barcodes', () => {
    expect(() =>
      createUserFoodCandidate({
        name: 'Unknown product',
        barcode: '12A',
        servingAmount: 100,
        servingUnit: 'g',
        nutritionPerServing: { carbohydrateGrams: 10 },
      }),
    ).toThrow('Barcode must contain 7–14 digits');
  });
});
