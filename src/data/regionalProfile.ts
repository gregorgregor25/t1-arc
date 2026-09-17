import * as SecureStore from 'expo-secure-store';

import {
  DEFAULT_REGIONAL_PROFILE,
  isT1ArcRegionalProfile,
  migrateRegionalProfile,
  type T1ArcRegionalProfile,
} from '@/domain/regionalProfile';
import {
  getRuntimeRegionalProfile,
  setRuntimeRegionalProfile,
} from '@/domain/regionalProfileRuntime';

const REGIONAL_PROFILE_KEY = 't1arc.regional-profile.v2';
type RegionalProfileListener = (profile: T1ArcRegionalProfile) => void;
type RegionalProfileErrorListener = (error: unknown) => void;
const listeners = new Set<RegionalProfileListener>();
let runtimeHydration: Promise<T1ArcRegionalProfile> | undefined;
let successfulSaveRevision = 0;

async function readStoredProfile(key: string) {
  const saved = await SecureStore.getItemAsync(key);
  if (!saved) return undefined;
  try {
    return migrateRegionalProfile(JSON.parse(saved) as unknown);
  } catch {
    return undefined;
  }
}

export function getCachedRegionalProfile() {
  return getRuntimeRegionalProfile();
}

export async function loadRegionalProfile() {
  const readRevision = successfulSaveRevision;
  const current = await readStoredProfile(REGIONAL_PROFILE_KEY);
  // A slow cold-start read must not undo a preference saved while it was pending.
  if (readRevision !== successfulSaveRevision) return getRuntimeRegionalProfile();
  if (current) {
    setRuntimeRegionalProfile(current);
    return current;
  }
  const defaults = { ...DEFAULT_REGIONAL_PROFILE };
  setRuntimeRegionalProfile(defaults);
  return defaults;
}

/**
 * Hydrates regional defaults once for the current JavaScript runtime.
 * Background/headless runtimes do not mount RegionalProfileProvider, so every
 * task entry point must await this before parsing, classifying, scheduling or
 * formatting regional data. A failed read is retryable on the next task.
 */
export function ensureRegionalProfileRuntimeHydrated() {
  if (!runtimeHydration) {
    runtimeHydration = loadRegionalProfile().catch((error) => {
      runtimeHydration = undefined;
      throw error;
    });
  }
  // The promise is a hydration fence, not a permanent snapshot. A screen can
  // subscribe again after a save or activity recreation within this runtime.
  return runtimeHydration.then(() => getRuntimeRegionalProfile());
}

export async function saveRegionalProfile(profile: T1ArcRegionalProfile) {
  if (!isT1ArcRegionalProfile(profile)) {
    throw new Error('The regional profile is invalid.');
  }
  await SecureStore.setItemAsync(REGIONAL_PROFILE_KEY, JSON.stringify(profile));
  successfulSaveRevision += 1;
  setRuntimeRegionalProfile(profile);
  for (const listener of listeners) {
    try {
      listener(profile);
    } catch {
      // A mounted view must not make a successful preference save fail.
    }
  }
  return profile;
}

export function observeRegionalProfile(
  listener: RegionalProfileListener,
  onError?: RegionalProfileErrorListener,
) {
  let active = true;
  let receivedChange = false;
  const onChange: RegionalProfileListener = (profile) => {
    if (!active) return;
    receivedChange = true;
    listener(profile);
  };
  listeners.add(onChange);
  void ensureRegionalProfileRuntimeHydrated()
    .then((profile) => {
      if (active && !receivedChange) listener(profile);
    })
    .catch((error: unknown) => {
      if (active && !receivedChange) onError?.(error);
    });
  return () => {
    active = false;
    listeners.delete(onChange);
  };
}

export function resetRegionalProfileRuntimeHydrationForTests() {
  runtimeHydration = undefined;
  successfulSaveRevision = 0;
}
