import { isTarvisDatasetOwnerIdentity } from './conversationScope';

export const RECOVERED_OWNER_PROOF_PREFIX = 'recovered-owner-proof-v1:';
export interface RecoveredOwnerProof {
  version: 1;
  originOwner: string;
  recoveryOwner: string;
  ids: string[];
}

export function parseRecoveredOwnerProof(value: string | undefined): RecoveredOwnerProof | undefined {
  if (!value) return undefined;
  try {
    const proof = JSON.parse(value) as RecoveredOwnerProof;
    if (proof.version !== 1 || !isTarvisDatasetOwnerIdentity(proof.originOwner) ||
      !isTarvisDatasetOwnerIdentity(proof.recoveryOwner) ||
      proof.recoveryOwner.split('|').length !== 3 || !proof.recoveryOwner.endsWith('|glooko:none') || !Array.isArray(proof.ids) ||
      proof.ids.length > 150 || !proof.ids.every(id => typeof id === 'string' && id.length > 0) ||
      new Set(proof.ids).size !== proof.ids.length) return undefined;
    return proof;
  } catch { return undefined; }
}

/** An authenticated recovery is not permission to adopt a different account. */
export function canReconnectRecoveredOwner(proof: RecoveredOwnerProof, previous: string, next: string) {
  if (!isTarvisDatasetOwnerIdentity(previous) || !isTarvisDatasetOwnerIdentity(next)) return false;
  const origin = new Set(proof.originOwner.split('|').slice(2));
  const epoch = proof.recoveryOwner.split('|')[1];
  const sameRecoveredDataset = (owner: string) => {
    const parts = owner.split('|');
    return parts[1] === epoch && parts.slice(2).every(part => part === 'glooko:none' || origin.has(part));
  };
  if (!sameRecoveredDataset(previous) || !sameRecoveredDataset(next)) return false;
  // Permit adding the originally verified sources, never removing/replacing a
  // source already bound to this recovered item. An erase changes the epoch.
  const nextParts = new Set(next.split('|').slice(2));
  return previous.split('|').slice(2).every(part => part === 'glooko:none' || nextParts.has(part));
}
