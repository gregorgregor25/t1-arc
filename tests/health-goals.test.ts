import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  loadStepGoal,
  observeStepGoal,
  saveStepGoal,
  subscribeToStepGoalChanges,
} from '@/data/healthGoals';

const secureStore = vi.hoisted(() => ({
  deleteItemAsync: vi.fn(),
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
}));

vi.mock('expo-secure-store', () => secureStore);

describe('health goals', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('loads a valid stored step goal', async () => {
    secureStore.getItemAsync.mockResolvedValue('8000');
    await expect(loadStepGoal()).resolves.toBe(8000);
  });

  it('ignores invalid stored values', async () => {
    secureStore.getItemAsync.mockResolvedValue('not-a-goal');
    await expect(loadStepGoal()).resolves.toBeUndefined();
  });

  it('saves a rounded goal', async () => {
    const listener = vi.fn();
    const unsubscribe = subscribeToStepGoalChanges(listener);
    await saveStepGoal(8123.6);
    expect(secureStore.setItemAsync).toHaveBeenCalledWith(
      't1arc.health-goals.steps.v1',
      '8124',
    );
    expect(listener).toHaveBeenCalledWith(8124);
    unsubscribe();
  });

  it('removes a goal without writing a replacement', async () => {
    const listener = vi.fn();
    const unsubscribe = subscribeToStepGoalChanges(listener);
    await saveStepGoal(undefined);
    expect(secureStore.deleteItemAsync).toHaveBeenCalledWith(
      't1arc.health-goals.steps.v1',
    );
    expect(secureStore.setItemAsync).not.toHaveBeenCalled();
    expect(listener).toHaveBeenCalledWith(undefined);
    unsubscribe();
  });

  it('stops updating an unmounted health view after unsubscribe', async () => {
    const listener = vi.fn();
    const unsubscribe = subscribeToStepGoalChanges(listener);
    unsubscribe();

    await saveStepGoal(9_000);

    expect(listener).not.toHaveBeenCalled();
  });

  it('keeps an already-mounted health view in sync with saved goals', async () => {
    secureStore.getItemAsync.mockResolvedValue('8000');
    const listener = vi.fn();
    const stopObserving = observeStepGoal(listener);

    await vi.waitFor(() => expect(listener).toHaveBeenCalledWith(8_000));
    await saveStepGoal(9_250);
    expect(listener).toHaveBeenLastCalledWith(9_250);

    stopObserving();
    await saveStepGoal(10_000);
    expect(listener).not.toHaveBeenCalledWith(10_000);
  });

  it('does not let a stale initial load replace a restored goal', async () => {
    let resolveLoad!: (value: string) => void;
    secureStore.getItemAsync.mockReturnValue(
      new Promise<string>((resolve) => {
        resolveLoad = resolve;
      }),
    );
    const listener = vi.fn();
    const stopObserving = observeStepGoal(listener);

    await saveStepGoal(9_000);
    resolveLoad('8000');
    await Promise.resolve();

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(9_000);
    stopObserving();
  });

  it('rejects unreasonable goals', async () => {
    await expect(saveStepGoal(100)).rejects.toThrow(
      'between 500 and 100,000',
    );
  });
});
