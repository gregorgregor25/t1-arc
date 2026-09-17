import * as SecureStore from "expo-secure-store";

import {
  LAST_ONBOARDING_TOUR_INDEX,
  ONBOARDING_WALKTHROUGH_VERSION,
  clampOnboardingTourIndex,
} from "@/screens/onboarding/tourModel";

const ONBOARDING_STATE_KEY = "t1arc.onboarding.walkthrough.v1";

export class OnboardingStateError extends Error {
  constructor() {
    super("The saved app-tour state could not be read safely.");
    this.name = "OnboardingStateError";
  }
}

export type OnboardingStatus = "in_progress" | "completed" | "skipped";

export interface OnboardingState {
  schemaVersion: 1;
  walkthroughVersion: number;
  status: OnboardingStatus;
  lastStep: number;
  updatedAt: number;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseOnboardingState(value: string): OnboardingState {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new OnboardingStateError();
  }

  if (
    !isObject(parsed) ||
    parsed.schemaVersion !== 1 ||
    !Number.isInteger(parsed.walkthroughVersion) ||
    (parsed.status !== "in_progress" &&
      parsed.status !== "completed" &&
      parsed.status !== "skipped") ||
    !Number.isInteger(parsed.lastStep) ||
    typeof parsed.updatedAt !== "number" ||
    !Number.isFinite(parsed.updatedAt)
  ) {
    throw new OnboardingStateError();
  }

  return {
    schemaVersion: 1,
    walkthroughVersion: parsed.walkthroughVersion as number,
    status: parsed.status,
    lastStep: clampOnboardingTourIndex(parsed.lastStep as number),
    updatedAt: parsed.updatedAt,
  };
}

function makeState(
  status: OnboardingStatus,
  lastStep: number,
  now = Date.now(),
): OnboardingState {
  return {
    schemaVersion: 1,
    walkthroughVersion: ONBOARDING_WALKTHROUGH_VERSION,
    status,
    lastStep: clampOnboardingTourIndex(lastStep),
    updatedAt: now,
  };
}

async function persistOnboardingState(state: OnboardingState) {
  await SecureStore.setItemAsync(ONBOARDING_STATE_KEY, JSON.stringify(state));
}

export async function loadOnboardingState(): Promise<
  OnboardingState | undefined
> {
  const stored = await SecureStore.getItemAsync(ONBOARDING_STATE_KEY);
  if (stored) return parseOnboardingState(stored);
  return undefined;
}

export async function loadOnboardingComplete() {
  const state = await loadOnboardingState();
  return state?.status === "completed" || state?.status === "skipped";
}

export async function saveOnboardingProgress(lastStep: number) {
  await persistOnboardingState(makeState("in_progress", lastStep));
}

export async function saveOnboardingComplete() {
  await persistOnboardingState(
    makeState("completed", LAST_ONBOARDING_TOUR_INDEX),
  );
}

export async function clearOnboardingState() {
  await SecureStore.deleteItemAsync(ONBOARDING_STATE_KEY);
}

export interface OnboardingWriteCoordinator {
  progress(lastStep: number): Promise<void>;
  complete(): Promise<void>;
}

/** Serializes metadata writes so an older progress write cannot win a race. */
export function createOnboardingWriteCoordinator(
  persistProgress: (lastStep: number) => Promise<void> = saveOnboardingProgress,
  persistComplete: () => Promise<void> = saveOnboardingComplete,
): OnboardingWriteCoordinator {
  let queue = Promise.resolve();
  return {
    progress(lastStep) {
      if (lastStep >= LAST_ONBOARDING_TOUR_INDEX) return queue;
      queue = queue
        .catch(() => undefined)
        .then(() => persistProgress(lastStep));
      return queue;
    },
    complete() {
      queue = queue.catch(() => undefined).then(persistComplete);
      return queue;
    },
  };
}
