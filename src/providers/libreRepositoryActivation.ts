import { sameLibreLinkUpCredentials } from '@/data/libreLinkUp/credentialIdentity';
import type { DataMode } from '@/data/libreLinkUp/secureStore';
import type { LibreLinkUpCredentials } from '@/data/libreLinkUp/types';
import { isLocalDataWriteSupersededError } from '@/data/privacy/localDataWriteEpoch';
import { isSourceConnectionSupersededError } from '@/data/live/sourceConnectionOwnership';

async function ignorePublicationFailureUnlessSuperseded(
  work: Promise<unknown>,
) {
  try {
    await work;
  } catch (error) {
    if (
      isLocalDataWriteSupersededError(error) ||
      isSourceConnectionSupersededError(error)
    ) {
      throw error;
    }
  }
}

export interface ConfiguredLibreRepositoryState {
  credentials?: LibreLinkUpCredentials;
  mode: DataMode;
  ready: boolean;
}

export interface VerifiedLibrePublication {
  persist(): Promise<void>;
  assertCurrent?(): Promise<void>;
  authorizePublication?(task: () => Promise<void>): Promise<void>;
  invalidateApp(): void;
  publishNative(): Promise<unknown>;
  refreshBounds(): Promise<unknown>;
}

export async function publishVerifiedLibreSnapshotImmediately({
  persist,
  assertCurrent,
  authorizePublication,
  invalidateApp,
  publishNative,
  refreshBounds,
}: VerifiedLibrePublication) {
  await persist();
  await assertCurrent?.();
  if (authorizePublication) {
    await authorizePublication(async () => {
      invalidateApp();
      await publishNative();
    });
  } else {
    invalidateApp();
    // Verified replacement has already blanked the previous native owner
    // inside the activation boundary. A failed replacement publication must
    // remain visible to the caller so success is never reported over a blank
    // or stale native surface.
    await publishNative();
  }
  await ignorePublicationFailureUnlessSuperseded(refreshBounds());
}

export function libreActivationNeedsRefreshBarrier(
  state: ConfiguredLibreRepositoryState,
  verifiedCredentials: LibreLinkUpCredentials,
) {
  // Only a known, different live account can write incompatible Libre rows.
  // Missing/unready configuration has no old Libre owner to drain, and waiting
  // on the app-wide refresh lane would also wait for unrelated health sources.
  return (
    state.ready &&
    state.mode === 'live' &&
    state.credentials !== undefined &&
    !sameLibreLinkUpCredentials(state.credentials, verifiedCredentials)
  );
}

/** Every activation rotates its durable lease, including same-owner reauth. */
export async function installRepositoryForVerifiedLibreOwner(
  configureLive: () => Promise<void>,
) {
  await configureLive();
}
