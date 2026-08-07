import { describe, expect, it } from 'vitest';

import {
  foodLogDraftFromLog,
  revisedFoodLog,
} from '@/data/food/foodLogEditing';
import { FoodCandidate, FoodLog } from '@/data/food/types';

const banana: FoodCandidate = {
  id: 'cofid:banana',
  provider: 'cofid',
  externalId: 'banana',
  name: 'Banana',
  basisAmount: 100,
  basisUnit: 'g',
  nutritionPerBasis: {
    carbohydrateGrams: 20,
    energyKcal: 90,
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

const yoghurt: FoodCandidate = {
  ...banana,
  id: 'user:yoghurt',
  provider: 'user',
  externalId: 'yoghurt',
  name: 'Greek yoghurt',
  nutritionPerBasis: {
    carbohydrateGrams: 4,
    energyKcal: 120,
    proteinGrams: 9,
  },
  sourceLabel: 'My food',
};

function existingLog(title = 'Banana'): FoodLog {
  return {
    id: 'food-log:1',
    contextEventId: 'daymark-food:meal:food-log:1',
    timestamp: 1_780_000_000_000,
    mealType: 'breakfast',
    title,
    nutrition: {
      carbohydrateGrams: 20,
      energyKcal: 90,
    },
    items: [
      {
        id: 'food-log:1:item:0',
        foodId: banana.id,
        provider: banana.provider,
        externalId: banana.externalId,
        name: banana.name,
        amount: 100,
        unit: 'g',
        nutrition: { ...banana.nutritionPerBasis },
        sourceLabel: banana.sourceLabel,
      },
    ],
    createdAt: 1_780_000_001_000,
    isFavorite: true,
  };
}

describe('food log correction', () => {
  it('prefills source snapshots without inventing a custom meal label', () => {
    const draft = foodLogDraftFromLog(existingLog());

    expect(draft.title).toBeUndefined();
    expect(draft.items).toHaveLength(1);
    expect(draft.items[0]).toMatchObject({
      amount: 100,
      unit: 'g',
      food: {
        id: banana.id,
        basisAmount: 100,
        nutritionPerBasis: {
          carbohydrateGrams: 20,
          energyKcal: 90,
        },
      },
    });
  });

  it('keeps stable meal and existing-item IDs while replacing the contents', () => {
    const log = existingLog();
    const draft = foodLogDraftFromLog(log);
    const revised = revisedFoodLog(
      log,
      {
        ...draft,
        timestamp: log.timestamp + 30 * 60_000,
        mealType: 'lunch',
        items: [
          { ...draft.items[0]!, amount: 120 },
          { food: yoghurt, amount: 150, unit: 'g' },
        ],
      },
      'new',
    );

    expect(revised).toMatchObject({
      id: log.id,
      contextEventId: log.contextEventId,
      createdAt: log.createdAt,
      isFavorite: true,
      timestamp: log.timestamp + 30 * 60_000,
      mealType: 'lunch',
      title: 'Lunch · 2 items',
      nutrition: {
        carbohydrateGrams: 30,
        energyKcal: 288,
        proteinGrams: 13.5,
      },
    });
    expect(revised.items[0]!.id).toBe('food-log:1:item:0');
    expect(revised.items[1]!.id).toBe('food-log:1:item:new-1');
  });

  it('preserves a genuinely custom label during correction', () => {
    const log = existingLog('Pre-run breakfast');
    const draft = foodLogDraftFromLog(log);

    expect(draft.title).toBe('Pre-run breakfast');
    expect(revisedFoodLog(log, draft).title).toBe('Pre-run breakfast');
  });

  it('removes an item without replacing the surviving item or meal identity', () => {
    const original = existingLog('Breakfast · 2 items');
    const withTwoItems = revisedFoodLog(
      original,
      {
        ...foodLogDraftFromLog(original),
        items: [
          ...foodLogDraftFromLog(original).items,
          { food: yoghurt, amount: 150, unit: 'g' },
        ],
      },
      'added',
    );
    const survivingItem = withTwoItems.items[1]!;
    const corrected = revisedFoodLog(withTwoItems, {
      ...foodLogDraftFromLog(withTwoItems),
      title: undefined,
      items: [foodLogDraftFromLog(withTwoItems).items[1]!],
    });

    expect(corrected).toMatchObject({
      id: original.id,
      contextEventId: original.contextEventId,
      createdAt: original.createdAt,
      title: 'Greek yoghurt',
      nutrition: {
        carbohydrateGrams: 6,
        energyKcal: 180,
        proteinGrams: 13.5,
      },
    });
    expect(corrected.items).toHaveLength(1);
    expect(corrected.items[0]!.id).toBe(survivingItem.id);
  });
});
