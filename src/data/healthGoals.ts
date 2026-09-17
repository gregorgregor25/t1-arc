import * as SecureStore from 'expo-secure-store';

const STEP_GOAL_KEY = 't1arc.health-goals.steps.v1';

type StepGoalListener = (value: number | undefined) => void;

const stepGoalListeners = new Set<StepGoalListener>();

export function subscribeToStepGoalChanges(listener: StepGoalListener) {
  stepGoalListeners.add(listener);
  return () => {
    stepGoalListeners.delete(listener);
  };
}

export function observeStepGoal(listener: StepGoalListener) {
  let active = true;
  let receivedChange = false;
  const unsubscribe = subscribeToStepGoalChanges((value) => {
    if (!active) return;
    receivedChange = true;
    listener(value);
  });
  void loadStepGoal()
    .then((value) => {
      if (active && !receivedChange) listener(value);
    })
    .catch(() => undefined);
  return () => {
    active = false;
    unsubscribe();
  };
}

function publishStepGoal(value?: number) {
  for (const listener of stepGoalListeners) {
    try {
      listener(value);
    } catch {
      // A mounted view must not make an otherwise successful save fail.
    }
  }
}

export async function loadStepGoal() {
  const stored = await SecureStore.getItemAsync(STEP_GOAL_KEY);
  if (!stored) return undefined;
  const value = Number(stored);
  return Number.isFinite(value) && value >= 500 && value <= 100_000
    ? Math.round(value)
    : undefined;
}

export async function saveStepGoal(value?: number) {
  if (value === undefined) {
    await SecureStore.deleteItemAsync(STEP_GOAL_KEY);
    publishStepGoal(undefined);
    return;
  }
  if (!Number.isFinite(value) || value < 500 || value > 100_000) {
    throw new Error('Choose a daily step goal between 500 and 100,000.');
  }
  const rounded = Math.round(value);
  await SecureStore.setItemAsync(STEP_GOAL_KEY, String(rounded));
  publishStepGoal(rounded);
}
