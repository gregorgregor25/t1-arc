import { createUserFoodCandidate } from './userFood';

export function createQuickCarbCandidate(
  carbohydrateGrams: number,
  label?: string,
  createdAt = Date.now(),
  entropy = Math.random().toString(36).slice(2, 10),
) {
  if (
    !Number.isFinite(carbohydrateGrams) ||
    carbohydrateGrams <= 0 ||
    carbohydrateGrams > 1_000
  ) {
    throw new Error('Carbohydrate must be between 0 and 1,000 g.');
  }
  const name = label?.replace(/\s+/g, ' ').trim() || 'Quick carbohydrate';
  const candidate = createUserFoodCandidate(
    {
      name,
      servingAmount: carbohydrateGrams,
      servingUnit: 'g',
      nutritionPerServing: { carbohydrateGrams },
    },
    createdAt,
    entropy,
  );
  return {
    ...candidate,
    sourceLabel: 'Quick carb entry',
    rawPayload: {
      createdAt,
      enteredOnDevice: true,
      quickCarbEntry: true,
    },
  };
}
