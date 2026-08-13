import type { GlookoCredentialStatus } from '../../../modules/daymark-glooko-export';
import {
  glookoFailureDisposition,
  type GlookoSyncState,
} from './glookoSyncPolicy';

/**
 * A portable backup intentionally omits device-local sync metadata. Restored
 * Glooko rows therefore need the same explicit same-person confirmation as a
 * pre-fingerprint installation before a fresh authenticated export can bind
 * them to this installation.
 */
export function needsGlookoLegacyContinuityConfirmation(
  syncState: GlookoSyncState,
  hasExistingGlookoData: boolean,
) {
  return (
    syncState.verifiedAccountFingerprint === undefined &&
    (syncState.verifiedCredentialGeneration !== undefined ||
      hasExistingGlookoData)
  );
}

/** Routes an unbound store through the only path allowed to create a binding. */
export function runSavedGlookoConnectionCheck<T>(
  credentialStatus: GlookoCredentialStatus,
  syncState: GlookoSyncState,
  verify: (
    credentialGeneration: number,
    legacyCredentialContinuity: boolean,
  ) => Promise<T>,
  refresh: () => Promise<T>,
) {
  const explicitVerificationRequired =
    syncState.verifiedAccountFingerprint === undefined ||
    !syncState.automaticEnabled ||
    syncState.sessionStatus !== 'ready' ||
    glookoFailureDisposition(syncState.lastErrorCode) === 'action-required';
  return credentialStatus.configured && explicitVerificationRequired
    ? verify(
        credentialStatus.credentialGeneration,
        syncState.pendingLegacyCredentialContinuity === true,
      )
    : refresh();
}
