import type { SQLiteDatabase } from 'expo-sqlite';
import { openT1ArcDatabase } from '@/data/persistence/t1arcDatabase';
import { acquireLocalDataWriteLease, withLocalDataWriteLeaseTransaction } from '@/data/privacy/localDataWriteEpoch';
import { OWNED_GLUCOSE_SOURCE_IDS, readSourceConnectionOwnershipStateInTransaction } from '@/data/live/sourceConnectionOwnership';
import { NOTEBOOK_STORAGE_KEY, parseNotebook, validateSerializedNotebook } from '@/domain/personalNotebook';
import { TARVIS_CONVERSATION_STORAGE_KEY, validateSerializedTarvisConversation, type StoredTarvisExchange } from './conversationStore';
import { rebindRecoveredTarvisConversationToDatasetOwner } from './conversationMigration';
import { isTarvisDatasetOwnerIdentity, resolveTarvisDatasetOwnerIdentity } from './conversationScope';
import { RECOVERED_OWNER_PROOF_PREFIX, canReconnectRecoveredOwner, parseRecoveredOwnerProof, type RecoveredOwnerProof } from './recoveredOwnerProof';

interface Database {
  getFirstAsync<T>(sql: string, ...args: (string | number | null)[]): Promise<T | null>;
  runAsync(sql: string, ...args: (string | number | null)[]): Promise<{changes:number}>;
}
const KEYS = [TARVIS_CONVERSATION_STORAGE_KEY, NOTEBOOK_STORAGE_KEY];

/** JSON object member order is not content. Array order and every value are. */
function sameJsonContent(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (left === null || right === null || typeof left !== 'object' || typeof right !== 'object') return false;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right) && left.length === right.length &&
      left.every((value, index) => sameJsonContent(value, right[index]));
  }
  const a = left as Record<string, unknown>;
  const b = right as Record<string, unknown>;
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every(key =>
    Object.prototype.hasOwnProperty.call(b, key) && sameJsonContent(a[key], b[key]));
}

/** Authenticated empty-store recovery, or exact-content repair of such a restore. */
export async function rememberRecoveredOwner(
  database: Database, key: string, value: unknown, recoveryOwner: string,
) {
  if (!KEYS.includes(key)) return;
  const entries: {id: string; owner: string}[] = key === TARVIS_CONVERSATION_STORAGE_KEY
    ? (JSON.parse(validateSerializedTarvisConversation(value)).exchanges as StoredTarvisExchange[])
      .flatMap(exchange => exchange.scope && exchange.scope.kind !== 'legacy-unknown' && exchange.scope.dataMode === 'live'
        ? [{id:exchange.id,owner:exchange.scope.ownerIdentity}] : [])
    : parseNotebook(JSON.parse(validateSerializedNotebook(String(value)))).entries
      .filter(entry => entry.dataMode === 'live').map(entry => ({id:entry.id,owner:entry.ownerIdentity}));
  const owners = new Set(entries.map(entry => entry.owner));
  if (!entries.length) return;
  const originOwner = entries[0]!.owner;
  if (!isTarvisDatasetOwnerIdentity(recoveryOwner)) throw new Error('The recovery owner is invalid.');
  // Multiple account histories are valid portable data. They keep their own
  // account bindings during recovery; never grant one proof over all of them.
  if (owners.size !== 1 || !isTarvisDatasetOwnerIdentity(originOwner)) return;
  const proof: RecoveredOwnerProof = {version:1,originOwner,recoveryOwner,ids:entries.map(entry => entry.id)};
  await database.runAsync('INSERT INTO app_metadata (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    RECOVERED_OWNER_PROOF_PREFIX+key, JSON.stringify(proof));
}

export function reconnectRecoveredState(key: string, value: string, proof: RecoveredOwnerProof, currentOwner: string): string {
  const ids = new Set(proof.ids);
  if (key === TARVIS_CONVERSATION_STORAGE_KEY) {
    const document = JSON.parse(validateSerializedTarvisConversation(value)) as {exchanges:StoredTarvisExchange[]};
    let changed = false;
    const exchanges = document.exchanges.map(exchange => {
      const scope = exchange.scope;
      if (!ids.has(exchange.id) || !scope || scope.kind === 'legacy-unknown' || scope.dataMode !== 'live' ||
        scope.ownerIdentity === currentOwner || !canReconnectRecoveredOwner(proof,scope.ownerIdentity,currentOwner)) return exchange;
      changed = true;
      const rebound = JSON.parse(rebindRecoveredTarvisConversationToDatasetOwner(
        JSON.stringify({...document,exchanges:[exchange]}),currentOwner));
      return rebound.exchanges[0] as StoredTarvisExchange;
    });
    return changed ? validateSerializedTarvisConversation(JSON.stringify({...document,exchanges})) : value;
  }
  if (key === NOTEBOOK_STORAGE_KEY) {
    const notebook = parseNotebook(JSON.parse(validateSerializedNotebook(value)));
    let changed = false;
    const entries = notebook.entries.map(entry => {
      if (!ids.has(entry.id) || entry.dataMode !== 'live' || entry.ownerIdentity === currentOwner ||
        !canReconnectRecoveredOwner(proof,entry.ownerIdentity,currentOwner)) return entry;
      changed = true;
      return {...entry,ownerIdentity:currentOwner};
    });
    return changed ? validateSerializedNotebook(JSON.stringify({...notebook,entries})) : value;
  }
  return value;
}

async function readCommittedOwner(database: SQLiteDatabase, epoch: number) {
  const ownedSources = [];
  for (const sourceId of OWNED_GLUCOSE_SOURCE_IDS) {
    const state = await readSourceConnectionOwnershipStateInTransaction(database,sourceId);
    if (state?.connected && state.identityDigest) ownedSources.push({sourceId,identityDigest:state.identityDigest});
  }
  const row = await database.getFirstAsync<{value:string}>('SELECT value FROM app_metadata WHERE key = ?','glooko-sync-state-v1');
  const glooko = row ? JSON.parse(row.value) : undefined;
  if (row && (!glooko || typeof glooko !== 'object' || Array.isArray(glooko))) {
    throw new Error('The current Glooko owner cannot be verified.');
  }
  return resolveTarvisDatasetOwnerIdentity({dataMode:'live',localDataEpoch:epoch,ownedSources,
    glookoFingerprint:glooko?.verifiedAccountFingerprint});
}

/**
 * Repair a pre-proof restore ONLY when the owner unlocks and merges its backup
 * again. Match the complete validated exchange (including answer and evidence)
 * to the exact empty-store recovery transformation. Neither an unbound scope
 * nor a coincidentally reused ID is sufficient. Keep all newer local messages.
 * The caller holds the ordinary authenticated backup-merge transaction.
 */
export async function repairAuthenticatedRecoveredConversation(
  database: SQLiteDatabase, incoming: string, existing: string, epoch: number,
): Promise<string | undefined> {
  const recoveryOwner = resolveTarvisDatasetOwnerIdentity({dataMode:'live',localDataEpoch:epoch,ownedSources:[]});
  const currentOwner = await readCommittedOwner(database,epoch);
  if (currentOwner === recoveryOwner) return undefined;
  const source = JSON.parse(validateSerializedTarvisConversation(incoming)) as {exchanges:StoredTarvisExchange[]};
  let rebound: {exchanges:StoredTarvisExchange[]};
  try {
    rebound = JSON.parse(rebindRecoveredTarvisConversationToDatasetOwner(incoming,recoveryOwner));
  } catch { return undefined; } // Legacy/ambiguous backup is not proof.
  const local = JSON.parse(validateSerializedTarvisConversation(existing)) as {exchanges:StoredTarvisExchange[]};
  const originScope = source.exchanges.find(exchange => exchange.scope?.kind !== 'legacy-unknown' && exchange.scope?.dataMode === 'live')?.scope;
  if (!originScope || originScope.kind === 'legacy-unknown') return undefined;
  const baseProof: RecoveredOwnerProof = {version:1,originOwner:originScope.ownerIdentity,recoveryOwner,ids:[]};
  const candidatesByOwner = new Map<string, Map<string, StoredTarvisExchange>>([
    [recoveryOwner, new Map(rebound.exchanges.map(exchange=>[exchange.id,exchange]))],
  ]);
  const matchingIds = new Set(local.exchanges.filter(exchange => {
    const scope=exchange.scope;
    if (!scope || scope.kind === 'legacy-unknown' || scope.dataMode !== 'live' || scope.ownerIdentity === currentOwner ||
      !canReconnectRecoveredOwner(baseProof,scope.ownerIdentity,currentOwner)) return false;
    // Older releases could strengthen the empty restored owner with Glooko
    // before Libre reconnected. Require the same authenticated full exchange
    // at that exact permitted intermediate owner, never just a matching ID.
    let candidates = candidatesByOwner.get(scope.ownerIdentity);
    if (!candidates) {
      const intermediate = JSON.parse(rebindRecoveredTarvisConversationToDatasetOwner(incoming,scope.ownerIdentity)) as {exchanges:StoredTarvisExchange[]};
      candidates = new Map(intermediate.exchanges.map(item=>[item.id,item]));
      candidatesByOwner.set(scope.ownerIdentity,candidates);
    }
    return sameJsonContent(exchange, candidates.get(exchange.id));
  }).map(exchange=>exchange.id));
  const matched = source.exchanges.filter(exchange=>matchingIds.has(exchange.id));
  if (!matched.length) return undefined;
  const scope = matched[0]!.scope!;
  if (scope.kind === 'legacy-unknown') return undefined;
  const proof: RecoveredOwnerProof = {version:1,originOwner:scope.ownerIdentity,recoveryOwner,ids:[...matchingIds]};
  if (!canReconnectRecoveredOwner(proof,recoveryOwner,currentOwner)) return undefined;
  const next = reconnectRecoveredState(TARVIS_CONVERSATION_STORAGE_KEY,existing,proof,currentOwner);
  if (next === existing) return undefined;
  await rememberRecoveredOwner(database,TARVIS_CONVERSATION_STORAGE_KEY,JSON.stringify({...source,exchanges:matched}),recoveryOwner);
  return next;
}

/** Resolve ownership from committed state, not credentials or a stale UI closure. */
export async function reconcileRecoveredPersonalState() {
  const initial = await openT1ArcDatabase();
  const candidates = await Promise.all(KEYS.map(async key => parseRecoveredOwnerProof(
    (await initial.getFirstAsync<{value:string}>('SELECT value FROM app_metadata WHERE key = ?',RECOVERED_OWNER_PROOF_PREFIX+key))?.value,
  )));
  if (!candidates.some(Boolean)) return;
  const lease = await acquireLocalDataWriteLease();
  await withLocalDataWriteLeaseTransaction(lease, async database => {
    const currentOwner = await readCommittedOwner(database,lease.epoch);
    for (const key of KEYS) {
      const proof = parseRecoveredOwnerProof((await database.getFirstAsync<{value:string}>(
        'SELECT value FROM app_metadata WHERE key = ?',RECOVERED_OWNER_PROOF_PREFIX+key))?.value);
      if (!proof) continue;
      const row = await database.getFirstAsync<{value:string}>('SELECT value FROM app_metadata WHERE key = ?',key);
      if (!row) continue;
      const next = reconnectRecoveredState(key,row.value,proof,currentOwner);
      if (next !== row.value) await database.runAsync('INSERT INTO app_metadata (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',key,next);
    }
  });
}
