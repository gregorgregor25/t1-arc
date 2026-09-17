import { describe, expect, it } from 'vitest';

import {
  customFoodDraftFromForm,
  customFoodFormFromCandidate,
  myFoodSelectionUnitIsCompatible,
} from '@/components/foodLogger/myFoodPresentation';
import type { FoodCandidate } from '@/data/food/types';

const food: FoodCandidate = {
  id: 'user:test',
  provider: 'user',
  externalId: 'test',
  name: 'Test food',
  basisAmount: 100,
  basisUnit: 'g',
  nutritionPerBasis: {
    carbohydrateGrams: 12.5,
    energyKcal: 100,
    proteinGrams: 3,
  },
  nutritionQuality: {
    carbohydrate: 'reported',
    energy: 'reported',
    protein: 'reported',
    fat: 'missing',
    fibre: 'missing',
    sugars: 'missing',
    saturatedFat: 'missing',
  },
  sourceLabel: 'My foods',
};

describe('My Foods regional edit presentation', () => {
  it('resets selected amounts only when an edit crosses mass and volume', () => {
    expect(myFoodSelectionUnitIsCompatible('oz', 'g')).toBe(true);
    expect(myFoodSelectionUnitIsCompatible('lb', 'g')).toBe(true);
    expect(myFoodSelectionUnitIsCompatible('fl oz', 'ml')).toBe(true);
    expect(myFoodSelectionUnitIsCompatible('cup', 'ml')).toBe(true);
    expect(myFoodSelectionUnitIsCompatible('fl oz', 'g')).toBe(false);
    expect(myFoodSelectionUnitIsCompatible('g', 'ml')).toBe(false);
  });

  it('converts canonical mass for an imperial form without changing nutrition', () => {
    const form = customFoodFormFromCandidate(food, {
      countryCode: 'US',
      measurementSystem: 'imperial',
      energyUnit: 'kcal',
      locale: 'en-US',
    });

    expect(form.unit).toBe('oz');
    expect(Number(form.serving)).toBeCloseTo(3.53, 2);
    expect(form.carbs).toBe('12.5');
    expect(form.energy).toBe('100');
    expect(form.fat).toBe('');
  });

  it('presents energy in kJ while the stored candidate remains kcal', () => {
    const form = customFoodFormFromCandidate(food, {
      countryCode: 'GB',
      measurementSystem: 'metric',
      energyUnit: 'kJ',
      locale: 'en-GB',
    });

    expect(form.unit).toBe('g');
    expect(form.serving).toBe('100');
    expect(form.energy).toBe('418.4');
    expect(food.nutritionPerBasis.energyKcal).toBe(100);
  });

  it('preserves exact canonical values when a rounded regional edit form is unchanged', () => {
    const precise: FoodCandidate = {
      ...food,
      basisAmount: 100.123456,
      nutritionPerBasis: {
        carbohydrateGrams: 12.345678,
        energyKcal: 123.456789,
        proteinGrams: 3.456789,
        fatGrams: 4.567891,
        fibreGrams: 5.678912,
        sugarsGrams: 6.789123,
        saturatedFatGrams: 7.891234,
      },
    };
    const regional = {
      countryCode: 'US',
      measurementSystem: 'imperial' as const,
      energyUnit: 'kJ' as const,
      locale: 'en-US',
    };

    const form = customFoodFormFromCandidate(precise, regional);
    const draft = customFoodDraftFromForm(form, '', regional);

    expect(draft.servingAmount).toBe(precise.basisAmount);
    expect(draft.servingUnit).toBe(precise.basisUnit);
    expect(draft.nutritionPerServing).toEqual(precise.nutritionPerBasis);
  });

  it('converts only fields changed by the user and keeps the remaining snapshot exact', () => {
    const regional = {
      countryCode: 'US',
      measurementSystem: 'imperial' as const,
      energyUnit: 'kJ' as const,
      locale: 'en-US',
    };
    const form = customFoodFormFromCandidate(food, regional);
    const draft = customFoodDraftFromForm(
      { ...form, serving: '4', energy: '500' },
      '00123',
      regional,
    );

    expect(draft.servingAmount).toBeCloseTo(4 * 28.349523125, 10);
    expect(draft.servingUnit).toBe('g');
    expect(draft.nutritionPerServing.energyKcal).toBeCloseTo(500 / 4.184, 10);
    expect(draft.nutritionPerServing.carbohydrateGrams).toBe(12.5);
    expect(draft.barcode).toBe('00123');
  });

  it.each([
    ['ar-EG', '١٢٥٫٥', '١٢٫٥'],
    ['fa-IR', '۱۲۵٫۵', '۱۲٫۵'],
  ])('stores %s custom-food digits as canonical numbers', (locale, serving, carbs) => {
    const regional = {
      countryCode: 'EG',
      energyUnit: 'kcal' as const,
      locale,
    };
    const draft = customFoodDraftFromForm(
      {
        name: 'Regional food',
        brand: '',
        serving,
        unit: 'g',
        carbs,
        energy: '',
        protein: '',
        fat: '',
        fibre: '',
      },
      '',
      regional,
    );

    expect(draft.servingAmount).toBe(125.5);
    expect(draft.nutritionPerServing.carbohydrateGrams).toBe(12.5);
  });

  it('prefills an Arabic My Foods editor with regional digits and preserves its canonical baseline', () => {
    const regional = {
      countryCode: 'EG',
      measurementSystem: 'metric' as const,
      energyUnit: 'kcal' as const,
      locale: 'ar-EG',
    };
    const form = customFoodFormFromCandidate(food, regional);

    expect(form.serving).toBe('١٠٠');
    expect(form.carbs).toBe('١٢٫٥');
    expect(customFoodDraftFromForm(form, '', regional).nutritionPerServing)
      .toEqual(food.nutritionPerBasis);
  });
});
