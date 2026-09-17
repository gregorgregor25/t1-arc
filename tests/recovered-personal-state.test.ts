import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { rememberRecoveredOwner, reconcileRecoveredPersonalState, repairAuthenticatedRecoveredConversation } from '@/data/tarvis/recoveredPersonalState';
import type { SQLiteDatabase } from 'expo-sqlite';
import { RECOVERED_OWNER_PROOF_PREFIX, parseRecoveredOwnerProof } from '@/data/tarvis/recoveredOwnerProof';
import { resolveTarvisDatasetOwnerIdentity } from '@/data/tarvis/conversationScope';
import { rebindRecoveredTarvisConversationToDatasetOwner } from '@/data/tarvis/conversationMigration';
import { TARVIS_CONVERSATION_STORAGE_KEY, validateSerializedTarvisConversation } from '@/data/tarvis/conversationStore';
import { NOTEBOOK_STORAGE_KEY } from '@/domain/personalNotebook';
import { LOCAL_DATA_WRITE_EPOCH_KEY } from '@/data/privacy/localDataWriteEpoch';

const fixture = vi.hoisted(() => ({db:undefined as unknown as DatabaseSync}));
const adapter = {
  getFirstAsync: async <T>(sql:string,...args:SQLInputValue[]) => (fixture.db.prepare(sql).get(...args) ?? null) as T|null,
  getAllAsync: async <T>(sql:string,...args:SQLInputValue[]) => fixture.db.prepare(sql).all(...args) as T[],
  runAsync: async (sql:string,...args:SQLInputValue[]) => ({changes:Number(fixture.db.prepare(sql).run(...args).changes),lastInsertRowId:0}),
};
vi.mock('@/data/persistence/t1arcDatabase',() => ({
  openT1ArcDatabase: async () => adapter,
  withT1ArcTransaction: async (work:(db:typeof adapter)=>Promise<unknown>) => {
    fixture.db.exec('BEGIN');
    try { const result=await work(adapter); fixture.db.exec('COMMIT'); return result; }
    catch(error) { fixture.db.exec('ROLLBACK'); throw error; }
  },
}));
const digest='a'.repeat(64);
const fingerprint=`af1_${'b'.repeat(64)}`;
const owner=(epoch:number,libre=false,glooko=false) => resolveTarvisDatasetOwnerIdentity({
  dataMode:'live',localDataEpoch:epoch,
  ownedSources:libre?[{sourceId:'t1arc-librelinkup',identityDigest:digest}]:[],
  glookoFingerprint:glooko?fingerprint:undefined,
});
const origin=owner(0,true,true), recovered=owner(7);
function write(key:string,value:string) {
  fixture.db.prepare('INSERT INTO app_metadata VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key,value);
}
function read(key:string) { return (fixture.db.prepare('SELECT value FROM app_metadata WHERE key=?').get(key) as {value:string}|undefined)?.value; }
function conversation(ownerIdentity:string,id='restored-chat') {
  return JSON.stringify({schemaVersion:3,updatedAt:100,exchanges:[{id,threadId:id,createdAt:99,question:'My saved question',
    answer:{headline:'Recorded data',answer:'My preserved answer',confidence:'limited',evidenceIds:[],limitations:[]},evidence:[],
    scope:{kind:'live',identity:`live:live:${ownerIdentity}`,dataMode:'live',ownerIdentity}}]});
}
function connectLibre(identityDigest=digest) {
  write('glucose-source-connection-ownership-v1:t1arc-librelinkup',JSON.stringify({version:1,changeGeneration:1,ownerGeneration:1,connected:true,identityDigest}));
}
async function recover() {
  const source=conversation(origin);
  await rememberRecoveredOwner(adapter,TARVIS_CONVERSATION_STORAGE_KEY,source,recovered);
  write(TARVIS_CONVERSATION_STORAGE_KEY,rebindRecoveredTarvisConversationToDatasetOwner(source,recovered));
  const notebook={version:1,entries:[{id:'restored-note',ownerIdentity:origin,dataMode:'live',createdAt:99,title:'Saved',answer:'Original',note:'My note',limitations:[],evidence:[]}]};
  await rememberRecoveredOwner(adapter,NOTEBOOK_STORAGE_KEY,JSON.stringify(notebook),recovered);
  write(NOTEBOOK_STORAGE_KEY,JSON.stringify({...notebook,entries:notebook.entries.map(entry=>({...entry,ownerIdentity:recovered}))}));
}
beforeEach(() => {
  fixture.db=new DatabaseSync(':memory:');
  fixture.db.exec('CREATE TABLE app_metadata (key TEXT PRIMARY KEY,value TEXT NOT NULL)');
  write(LOCAL_DATA_WRITE_EPOCH_KEY,'7');
});
afterEach(() => fixture.db.close());

describe('authenticated restored-owner continuity', () => {
  it.each([
    {reorder:false, partialGlooko:false},
    {reorder:true, partialGlooko:false},
    {reorder:false, partialGlooko:true},
  ])('repairs an authenticated pre-proof restore after a normal resave (%j)', async ({reorder,partialGlooko}) => {
    const source = conversation(origin);
    const restored = JSON.parse(rebindRecoveredTarvisConversationToDatasetOwner(source, partialGlooko ? owner(7,false,true) : recovered));
    const exchange = restored.exchanges[0];
    const reordered = {...exchange, scope: Object.fromEntries(Object.entries(exchange.scope).reverse()),
      answer: Object.fromEntries(Object.entries(exchange.answer).reverse())};
    const reorderedExchange = Object.fromEntries(Object.entries(reordered).reverse());
    const newer = JSON.parse(validateSerializedTarvisConversation(conversation(owner(7,true,true),'new-chat'))).exchanges[0];
    const existing = JSON.stringify({...restored, updatedAt:200, exchanges:[reorder ? reorderedExchange : exchange, newer]});
    connectLibre(); write('glooko-sync-state-v1',JSON.stringify({verifiedAccountFingerprint:fingerprint}));
    const result = await repairAuthenticatedRecoveredConversation(adapter as unknown as SQLiteDatabase, source, existing, 7);
    expect(result).toBeDefined();
    const parsed = JSON.parse(result!);
    expect(parsed.exchanges[0].scope.ownerIdentity).toBe(owner(7,true,true));
    expect(parsed.exchanges[0].answer).toEqual(exchange.answer);
    expect(parsed.exchanges[1]).toEqual(newer);
  });

  it.each(['answer','account','epoch'] as const)('does not repair a pre-proof restore with changed %s', async change => {
    const source = conversation(origin);
    const restored = JSON.parse(rebindRecoveredTarvisConversationToDatasetOwner(source,recovered));
    if(change === 'answer') restored.exchanges[0].answer.answer = 'Different content';
    connectLibre(change === 'account' ? 'c'.repeat(64) : digest);
    write('glooko-sync-state-v1',JSON.stringify({verifiedAccountFingerprint:fingerprint}));
    expect(await repairAuthenticatedRecoveredConversation(adapter as unknown as SQLiteDatabase, source, JSON.stringify(restored), change === 'epoch' ? 8 : 7)).toBeUndefined();
  });

  it('survives sequential source reconnection, preserves new messages and edited notebook notes, and is idempotent', async () => {
    await recover(); connectLibre();
    await reconcileRecoveredPersonalState();
    const afterLibre=JSON.parse(read(TARVIS_CONVERSATION_STORAGE_KEY)!);
    expect(afterLibre.exchanges[0].scope.ownerIdentity).toBe(owner(7,true));
    const newer=JSON.parse(validateSerializedTarvisConversation(conversation(owner(7,true),'new-chat'))).exchanges[0];
    write(TARVIS_CONVERSATION_STORAGE_KEY,JSON.stringify({...afterLibre,exchanges:[...afterLibre.exchanges,newer]}));
    const note=JSON.parse(read(NOTEBOOK_STORAGE_KEY)!); note.entries[0].note='Edited after restoring';
    write(NOTEBOOK_STORAGE_KEY,JSON.stringify(note));
    write('glooko-sync-state-v1',JSON.stringify({verifiedAccountFingerprint:fingerprint}));
    await reconcileRecoveredPersonalState();
    const result=read(TARVIS_CONVERSATION_STORAGE_KEY)!;
    const parsed=JSON.parse(result);
    expect(parsed.exchanges[0].scope.ownerIdentity).toBe(owner(7,true,true));
    expect(parsed.exchanges[0].question).toBe('My saved question');
    expect(parsed.exchanges[0].answer.answer).toBe('My preserved answer');
    expect(parsed.exchanges[1]).toEqual(newer);
    expect(JSON.parse(read(NOTEBOOK_STORAGE_KEY)!).entries[0]).toMatchObject({ownerIdentity:owner(7,true,true),note:'Edited after restoring'});
    await reconcileRecoveredPersonalState();
    expect(read(TARVIS_CONVERSATION_STORAGE_KEY)).toBe(result);
  });

  it.each(['libre','glooko','erase','extra-source'] as const)('does not adopt records across %s changes', async change => {
    await recover();
    const before=read(TARVIS_CONVERSATION_STORAGE_KEY);
    if(change==='libre') connectLibre('c'.repeat(64));
    if(change==='glooko') write('glooko-sync-state-v1',JSON.stringify({verifiedAccountFingerprint:`af1_${'c'.repeat(64)}`}));
    if(change==='erase') { write(LOCAL_DATA_WRITE_EPOCH_KEY,'8'); connectLibre(); }
    if(change==='extra-source') write('glucose-source-connection-ownership-v1:nightscout',JSON.stringify({version:1,changeGeneration:1,ownerGeneration:1,connected:true,identityDigest:'c'.repeat(64)}));
    await reconcileRecoveredPersonalState();
    expect(read(TARVIS_CONVERSATION_STORAGE_KEY)).toBe(before);
  });

  it('does not invent proof for an older installation or malformed metadata', async () => {
    write(TARVIS_CONVERSATION_STORAGE_KEY,conversation(recovered)); connectLibre();
    const before=read(TARVIS_CONVERSATION_STORAGE_KEY);
    await reconcileRecoveredPersonalState();
    expect(read(TARVIS_CONVERSATION_STORAGE_KEY)).toBe(before);
    write(RECOVERED_OWNER_PROOF_PREFIX+TARVIS_CONVERSATION_STORAGE_KEY,'{"version":1}');
    await reconcileRecoveredPersonalState();
    expect(read(TARVIS_CONVERSATION_STORAGE_KEY)).toBe(before);
  });

  it('fails closed on corrupt connection state, without partially rebinding either document', async () => {
    await recover(); connectLibre(); write('glooko-sync-state-v1','null');
    const before=read(TARVIS_CONVERSATION_STORAGE_KEY);
    await expect(reconcileRecoveredPersonalState()).rejects.toThrow(/owner cannot be verified/);
    expect(read(TARVIS_CONVERSATION_STORAGE_KEY)).toBe(before);
  });

  it('records only identifiers and rejects a non-empty recovery identity', async () => {
    await recover();
    const proof=read(RECOVERED_OWNER_PROOF_PREFIX+TARVIS_CONVERSATION_STORAGE_KEY)!;
    expect(proof).not.toContain('My saved question');
    expect(parseRecoveredOwnerProof(proof)?.originOwner).toBe(origin);
    expect(parseRecoveredOwnerProof(JSON.stringify({...JSON.parse(proof),recoveryOwner:owner(7,true)}))).toBeUndefined();
  });

  it('rolls back a conversation rebind if the following notebook write fails', async () => {
    await recover(); connectLibre();
    const beforeChat = read(TARVIS_CONVERSATION_STORAGE_KEY);
    const beforeNote = read(NOTEBOOK_STORAGE_KEY);
    fixture.db.exec(`CREATE TRIGGER fail_note BEFORE UPDATE ON app_metadata
      WHEN NEW.key = '${NOTEBOOK_STORAGE_KEY}' BEGIN SELECT RAISE(ABORT, 'simulated write failure'); END`);
    await expect(reconcileRecoveredPersonalState()).rejects.toThrow('simulated write failure');
    expect(read(TARVIS_CONVERSATION_STORAGE_KEY)).toBe(beforeChat);
    expect(read(NOTEBOOK_STORAGE_KEY)).toBe(beforeNote);
  });
});
