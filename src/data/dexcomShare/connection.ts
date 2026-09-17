import {
  DexcomShareConnection,
  DexcomShareError,
  DexcomShareRegion,
} from './types';

const REGION_LABELS: Record<DexcomShareRegion, string> = {
  international: 'International / Europe',
  us: 'United States',
  japan: 'Japan',
};

export function normalizeDexcomShareConnection(
  username: string,
  password: string,
  region: DexcomShareRegion,
): DexcomShareConnection {
  const normalizedUsername = username.trim();
  if (!normalizedUsername) {
    throw new DexcomShareError(
      'invalid-connection',
      'Enter the username, email address or phone number used by the Dexcom publisher account.',
    );
  }
  if (!password) {
    throw new DexcomShareError(
      'invalid-connection',
      'Enter the password for the Dexcom publisher account.',
    );
  }
  if (!Object.hasOwn(REGION_LABELS, region)) {
    throw new DexcomShareError(
      'invalid-connection',
      'Choose the region used by the Dexcom account.',
    );
  }
  return { username: normalizedUsername, password, region };
}

export function isSameDexcomShareIdentity(
  saved: DexcomShareConnection | undefined,
  username: string,
  region: DexcomShareRegion,
) {
  return (
    saved !== undefined &&
    saved.username.trim() === username.trim() &&
    saved.region === region
  );
}

export function resolveDexcomSharePassword(
  saved: DexcomShareConnection | undefined,
  username: string,
  region: DexcomShareRegion,
  enteredPassword: string,
) {
  if (enteredPassword) return enteredPassword;
  return isSameDexcomShareIdentity(saved, username, region)
    ? saved!.password
    : '';
}

export function dexcomShareDraftFromSaved(saved: DexcomShareConnection) {
  return {
    username: saved.username,
    region: saved.region,
    password: '',
  } as const;
}

export function dexcomShareRegionLabel(region: DexcomShareRegion) {
  return REGION_LABELS[region];
}
