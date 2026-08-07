import { FoodLog, FoodLogItemSnapshot } from '@/data/food/types';
import { HealthContextEvent, MealEvent } from '@/domain/models';

interface DemoItem {
  name: string;
  amount: number;
  carbohydrateShare: number;
  proteinGrams: number;
  fatGrams: number;
  fibreGrams: number;
}

const TEMPLATES: Record<MealEvent['mealType'], DemoItem[]> = {
  breakfast: [
    {
      name: 'Porridge oats',
      amount: 55,
      carbohydrateShare: 0.62,
      proteinGrams: 7,
      fatGrams: 4,
      fibreGrams: 5,
    },
    {
      name: 'Greek yoghurt',
      amount: 120,
      carbohydrateShare: 0.13,
      proteinGrams: 11,
      fatGrams: 2,
      fibreGrams: 0,
    },
    {
      name: 'Blueberries',
      amount: 85,
      carbohydrateShare: 0.25,
      proteinGrams: 1,
      fatGrams: 0,
      fibreGrams: 2,
    },
  ],
  lunch: [
    {
      name: 'Wholemeal chicken wrap',
      amount: 185,
      carbohydrateShare: 0.72,
      proteinGrams: 28,
      fatGrams: 10,
      fibreGrams: 6,
    },
    {
      name: 'Apple',
      amount: 135,
      carbohydrateShare: 0.28,
      proteinGrams: 0,
      fatGrams: 0,
      fibreGrams: 3,
    },
  ],
  dinner: [
    {
      name: 'Basmati rice, cooked',
      amount: 210,
      carbohydrateShare: 0.78,
      proteinGrams: 6,
      fatGrams: 1,
      fibreGrams: 2,
    },
    {
      name: 'Chicken curry',
      amount: 260,
      carbohydrateShare: 0.18,
      proteinGrams: 34,
      fatGrams: 16,
      fibreGrams: 3,
    },
    {
      name: 'Green vegetables',
      amount: 120,
      carbohydrateShare: 0.04,
      proteinGrams: 3,
      fatGrams: 0,
      fibreGrams: 4,
    },
  ],
  snack: [
    {
      name: 'Oat bar',
      amount: 42,
      carbohydrateShare: 0.84,
      proteinGrams: 4,
      fatGrams: 6,
      fibreGrams: 3,
    },
    {
      name: 'Semi-skimmed milk',
      amount: 100,
      carbohydrateShare: 0.16,
      proteinGrams: 4,
      fatGrams: 2,
      fibreGrams: 0,
    },
  ],
};

function round(value: number, decimals = 1) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function itemSnapshots(meal: MealEvent): FoodLogItemSnapshot[] {
  const template = TEMPLATES[meal.mealType];
  let allocatedCarbs = 0;
  return template.map((item, index) => {
    const carbohydrateGrams =
      index === template.length - 1
        ? round(meal.carbsGrams - allocatedCarbs)
        : round(meal.carbsGrams * item.carbohydrateShare);
    allocatedCarbs = round(allocatedCarbs + carbohydrateGrams);
    const energyKcal = round(
      carbohydrateGrams * 4 +
        item.proteinGrams * 4 +
        item.fatGrams * 9,
    );
    return {
      id: `demo-food:${meal.id}:${index}`,
      foodId: `demo-food-catalog:${meal.mealType}:${index}`,
      provider: 'user',
      externalId: `synthetic-${meal.mealType}-${index}`,
      name: item.name,
      amount: item.amount,
      unit: item.name.includes('milk') ? 'ml' : 'g',
      nutrition: {
        carbohydrateGrams,
        energyKcal,
        proteinGrams: item.proteinGrams,
        fatGrams: item.fatGrams,
        fibreGrams: item.fibreGrams,
      },
      sourceLabel: 'Synthetic demo food',
    };
  });
}

export function createDemoFoodLogs(
  events: HealthContextEvent[],
): FoodLog[] {
  return events
    .filter((event): event is MealEvent => event.kind === 'meal')
    .map((meal) => {
      const items = itemSnapshots(meal);
      return {
        id: `demo-food-log:${meal.id}`,
        contextEventId: meal.id,
        timestamp: meal.start,
        mealType: meal.mealType,
        title: meal.title,
        nutrition: {
          carbohydrateGrams: round(
            items.reduce(
              (total, item) =>
                total + (item.nutrition.carbohydrateGrams ?? 0),
              0,
            ),
          ),
          energyKcal: round(
            items.reduce(
              (total, item) => total + (item.nutrition.energyKcal ?? 0),
              0,
            ),
          ),
          proteinGrams: round(
            items.reduce(
              (total, item) => total + (item.nutrition.proteinGrams ?? 0),
              0,
            ),
          ),
          fatGrams: round(
            items.reduce(
              (total, item) => total + (item.nutrition.fatGrams ?? 0),
              0,
            ),
          ),
          fibreGrams: round(
            items.reduce(
              (total, item) => total + (item.nutrition.fibreGrams ?? 0),
              0,
            ),
          ),
        },
        items,
        createdAt: meal.start,
      };
    })
    .sort((a, b) => b.timestamp - a.timestamp);
}
