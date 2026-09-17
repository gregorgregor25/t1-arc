import { describe, expect, it } from 'vitest';

import {
  defaultFoodServingAmount,
  initialFoodPortionAmount,
  servingAmountFromRawPayload,
  servingMultiplierAmount,
} from '@/data/food/servings';
import { FoodCandidate } from '@/data/food/types';

const food: FoodCandidate = {
  id: 'test-food',
  provider: 'open-food-facts',
  externalId: '123',
  name: 'Test cereal bar',
  basisAmount: 100,
  basisUnit: 'g',
  nutritionPerBasis: { carbohydrateGrams: 60 },
  nutritionQuality: {
    carbohydrate: 'reported',
    energy: 'missing',
    protein: 'missing',
    fat: 'missing',
    fibre: 'missing',
    sugars: 'missing',
    saturatedFat: 'missing',
  },
  defaultServingAmount: 25,
  defaultServingUnit: 'g',
  sourceLabel: 'Test',
};

describe('food serving helpers', () => {
  it('converts explicit ounce and kilogram masses, never fluid ounces to grams', () => {
    expect(servingAmountFromRawPayload({ serving_size: '1 bar (2 oz)' }, 'g')).toBeCloseTo(56.69904625);
    expect(servingAmountFromRawPayload({ serving_size: '0.25 kg' }, 'g')).toBe(250);
    expect(servingAmountFromRawPayload({ serving_size: '8 fl oz' }, 'g')).toBeUndefined();
    expect(servingAmountFromRawPayload({ serving_size: '8 fluid ounces' }, 'g')).toBeUndefined();
    expect(servingAmountFromRawPayload({ serving_quantity: 2, serving_quantity_unit: 'oz' }, 'g')).toBeCloseTo(56.69904625);
  });

  it('uses a personal item definition while remembering the last total portion', () => {
    const personal = { ...food, personalServingAmount: 40, personalServingUnit: 'g' as const, lastPortionAmount: 80, lastPortionUnit: 'g' as const };
    expect(defaultFoodServingAmount(personal)).toBe(40);
    expect(initialFoodPortionAmount(personal)).toBe(80);
    expect(defaultFoodServingAmount({ ...personal, personalServingUnit: 'ml' })).toBe(25);
  });
  it('recovers an Open Food Facts serving from retained source data', () => {
    expect(
      servingAmountFromRawPayload(
        {
          serving_quantity: '30',
          serving_quantity_unit: 'g',
        },
        'g',
      ),
    ).toBe(30);
    expect(
      servingAmountFromRawPayload(
        { serving_quantity: 250, serving_quantity_unit: 'ml' },
        'g',
      ),
    ).toBeUndefined();
  });

  it('recovers a compatible amount from a human serving label', () => {
    expect(
      servingAmountFromRawPayload(
        { serving_size: '1 cereal bar (27,5 g)' },
        'g',
      ),
    ).toBe(27.5);
    expect(
      servingAmountFromRawPayload(
        { serving_size: 'Half a bottle (250 ml)' },
        'ml',
      ),
    ).toBe(250);
    expect(
      servingAmountFromRawPayload(
        { serving_size: 'Half a bottle (250 ml)' },
        'g',
      ),
    ).toBeUndefined();
  });

  it('uses the reported serving and scales common portions deterministically', () => {
    expect(defaultFoodServingAmount(food)).toBe(25);
    expect(servingMultiplierAmount(food, 0.5)).toBe(12.5);
    expect(servingMultiplierAmount(food, 2)).toBe(50);
  });

  it('prefills a personally used portion without changing labelled serving shortcuts', () => {
    const remembered = {
      ...food,
      lastPortionAmount: 37.5,
      lastPortionUnit: 'g' as const,
    };
    expect(initialFoodPortionAmount(remembered)).toBe(37.5);
    expect(defaultFoodServingAmount(remembered)).toBe(25);
    expect(servingMultiplierAmount(remembered, 2)).toBe(50);
  });

  it('ignores a remembered portion with an incompatible unit', () => {
    expect(
      initialFoodPortionAmount({
        ...food,
        lastPortionAmount: 250,
        lastPortionUnit: 'ml',
      }),
    ).toBe(25);
  });

  it('falls back to the nutrient basis when no compatible serving exists', () => {
    expect(
      defaultFoodServingAmount({
        ...food,
        defaultServingAmount: undefined,
        defaultServingUnit: undefined,
      }),
    ).toBe(100);
  });
});
