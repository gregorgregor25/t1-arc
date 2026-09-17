import { beforeEach, describe, expect, it, vi } from 'vitest';

import { saveFoodLog } from '@/data/food/foodLogRepository';

const state = vi.hoisted(() => ({
  epoch: '4',
  events: [] as string[],
}));

const database = vi.hoisted(() => ({
  getFirstAsync: vi.fn(async (_sql: string, key: string) => {
    state.events.push(
      key === 'local-data-erase-intent-v1' ? 'intent' : 'epoch',
    );
    return key === 'local-data-erase-intent-v1'
      ? null
      : { value: state.epoch };
  }),
  runAsync: vi.fn(async () => {
    state.events.push('write');
    return { changes: 1 };
  }),
}));

vi.mock('@/data/persistence/t1arcDatabase', () => ({
  openT1ArcDatabase: vi.fn(async () => database),
  withT1ArcTransaction: vi.fn(
    async (operation: (value: typeof database) => Promise<unknown>) =>
      operation(database),
  ),
}));

const draft = {
  timestamp: Date.parse('2026-08-25T08:00:00+01:00'),
  mealType: 'breakfast' as const,
  items: [
    {
      amount: 30,
      unit: 'g' as const,
      food: {
        id: 'user:test-food',
        provider: 'user' as const,
        externalId: 'test-food',
        name: 'Test food',
        basisAmount: 30,
        basisUnit: 'g' as const,
        nutritionPerBasis: { carbohydrateGrams: 12 },
        nutritionQuality: {
          carbohydrate: 'reported' as const,
          energy: 'missing' as const,
          protein: 'missing' as const,
          fat: 'missing' as const,
          fibre: 'missing' as const,
          sugars: 'missing' as const,
          saturatedFat: 'missing' as const,
        },
        sourceLabel: 'My foods',
      },
    },
  ],
};

describe('food-log erase epoch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.epoch = '4';
    state.events.length = 0;
  });

  it('asserts the captured epoch before the first sensitive write', async () => {
    await saveFoodLog(draft, { epoch: 4 });

    expect(state.events.slice(0, 2)).toEqual(['intent', 'epoch']);
    expect(state.events.slice(2)).toContain('write');
  });

  it('rejects a superseded log without writing any food or timeline row', async () => {
    state.epoch = '5';

    await expect(saveFoodLog(draft, { epoch: 4 })).rejects.toMatchObject({
      name: 'LocalDataWriteSupersededError',
    });
    expect(database.runAsync).not.toHaveBeenCalled();
  });
});
