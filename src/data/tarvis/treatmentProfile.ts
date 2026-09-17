import * as SecureStore from 'expo-secure-store';

const STORAGE_KEY = 't1arc.tarvis-treatment-profile.v1';

export interface CarbRatioScheduleSegment {
  id: string;
  /** Minutes after local midnight in the selected analysis/home time zone. */
  startMinute: number;
  /** Grams of carbohydrate per unit of insulin, entered by the user. */
  gramsPerUnit: number;
}

export interface TarvisTreatmentProfile {
  schemaVersion: 1;
  carbRatioSchedule: CarbRatioScheduleSegment[];
  confirmedAt: number;
  source: 'manual';
}

type Listener = (profile: TarvisTreatmentProfile | undefined) => void;
const listeners = new Set<Listener>();

export async function loadTarvisTreatmentProfile() {
  const stored = await SecureStore.getItemAsync(STORAGE_KEY);
  if (!stored) return undefined;
  try {
    return validateProfile(JSON.parse(stored));
  } catch {
    throw new Error('The saved Tarv1s treatment profile could not be read safely.');
  }
}

export async function saveTarvisTreatmentProfile(
  schedule: readonly CarbRatioScheduleSegment[],
) {
  const profile = validateProfile({
    schemaVersion: 1,
    carbRatioSchedule: schedule,
    confirmedAt: Date.now(),
    source: 'manual',
  });
  await SecureStore.setItemAsync(STORAGE_KEY, JSON.stringify(profile));
  publish(profile);
  return profile;
}

export async function clearTarvisTreatmentProfile() {
  await SecureStore.deleteItemAsync(STORAGE_KEY);
  publish(undefined);
}

export function observeTarvisTreatmentProfile(listener: Listener) {
  let active = true;
  let changed = false;
  const wrapped: Listener = (profile) => {
    if (!active) return;
    changed = true;
    listener(profile);
  };
  listeners.add(wrapped);
  void loadTarvisTreatmentProfile()
    .then((profile) => {
      if (active && !changed) listener(profile);
    })
    .catch(() => undefined);
  return () => {
    active = false;
    listeners.delete(wrapped);
  };
}

export function carbRatioAtLocalMinute(
  profile: TarvisTreatmentProfile,
  localMinute: number,
) {
  const minute = Math.max(0, Math.min(1_439, Math.floor(localMinute)));
  return [...profile.carbRatioSchedule]
    .sort((left, right) => left.startMinute - right.startMinute)
    .filter(({ startMinute }) => startMinute <= minute)
    .at(-1) ?? profile.carbRatioSchedule.at(-1);
}

function validateProfile(value: unknown): TarvisTreatmentProfile {
  if (!record(value) || value.schemaVersion !== 1 || value.source !== 'manual') {
    throw new Error('The treatment profile format is invalid.');
  }
  if (!Number.isSafeInteger(value.confirmedAt) || Number(value.confirmedAt) <= 0) {
    throw new Error('The treatment profile confirmation time is invalid.');
  }
  if (!Array.isArray(value.carbRatioSchedule) || value.carbRatioSchedule.length > 12) {
    throw new Error('Add no more than 12 insulin-to-carb ratio periods.');
  }
  const starts = new Set<number>();
  const schedule = value.carbRatioSchedule.map((candidate, index) => {
    if (!record(candidate)) throw new Error('A ratio period is invalid.');
    const startMinute = Number(candidate.startMinute);
    const gramsPerUnit = Number(candidate.gramsPerUnit);
    if (!Number.isInteger(startMinute) || startMinute < 0 || startMinute > 1_439) {
      throw new Error('Each ratio period needs a valid start time.');
    }
    if (!Number.isFinite(gramsPerUnit) || gramsPerUnit < 1 || gramsPerUnit > 100) {
      throw new Error('Enter a ratio between 1 and 100 grams per unit.');
    }
    if (starts.has(startMinute)) {
      throw new Error('Two ratio periods cannot start at the same time.');
    }
    starts.add(startMinute);
    return {
      id:
        typeof candidate.id === 'string' && candidate.id.trim()
          ? candidate.id.slice(0, 80)
          : `ratio-${startMinute}-${index}`,
      startMinute,
      gramsPerUnit: Math.round(gramsPerUnit * 10) / 10,
    };
  });
  schedule.sort((left, right) => left.startMinute - right.startMinute);
  return {
    schemaVersion: 1,
    carbRatioSchedule: schedule,
    confirmedAt: Number(value.confirmedAt),
    source: 'manual',
  };
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function publish(profile: TarvisTreatmentProfile | undefined) {
  listeners.forEach((listener) => {
    try {
      listener(profile);
    } catch {
      // A mounted view must not make a successful local save fail.
    }
  });
}
