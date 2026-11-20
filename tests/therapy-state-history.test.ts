import { describe, expect, it, vi } from 'vitest';

import { ImportedInsulinSource } from '@/data/live/ImportedInsulinSource';
import {
  MemoryHealthRecordStore,
  type ImportRawRecord,
} from '@/data/persistence/HealthRecordStore';
import { normalizeNightscoutTreatments } from '@/data/nightscout/NightscoutTreatmentImporter';

vi.mock('@/data/persistence/SqliteHealthRecordStore', () => ({
  SqliteHealthRecordStore: class {},
}));
vi.mock('expo-crypto', () => ({
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  digestStringAsync: vi.fn(async () => '0'.repeat(64)),
}));

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const NOW = Date.parse('2030-02-18T15:00:00Z');
const range = { start: NOW - DAY, end: NOW };

async function save(
  store: MemoryHealthRecordStore,
  rows: Record<string, unknown>[],
  sourceId = 'nightscout',
  importedAt = NOW,
) {
  const origin = {
    sourceId, sourceFile: sourceId === 'nightscout' ? 'treatments.json' : 'phone sender unverified',
    rawRecordKind: sourceId === 'nightscout' ? 'nightscout-treatment' : 'aaps-local-treatment',
  };
  const normalized = normalizeNightscoutTreatments(rows, [], importedAt, origin);
  await store.writeImport(
    { id: `batch:${sourceId}:${importedAt}`, sourceId, fileName: 'synthetic.json',
      fileSha256: String(importedAt).padEnd(64, '0'), importedAt, skippedCount: 0, warnings: [] },
    normalized.basal, normalized.boluses, normalized.context, undefined, [],
    normalized.rawRecords, { revisedRecordIds: normalized.revisedRecordIds },
  );
}

function record(_id: string, daysAgo: number, extra: Record<string, unknown>) {
  return { _id, date: NOW - daysAgo * DAY, ...extra };
}

function source(store: MemoryHealthRecordStore) {
  return new ImportedInsulinSource(store, undefined, [], () => NOW);
}

describe('therapy history before the recent window', () => {
  it('keeps multiweek until-changed mode and profile with their original source times', async () => {
    const store = new MemoryHealthRecordStore();
    await save(store, [
      record('open', 35, { eventType: 'OpenAPS Offline', mode: 'OPEN_LOOP', duration: 0 }),
      record('profile', 25, { eventType: 'Profile Switch', profile: 'Example', percentage: 80, originalDuration: 0 }),
    ]);
    const states = await source(store).getTherapyStates(range);
    expect(states).toHaveLength(2);
    expect(states).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'loop-mode', loopMode: 'open-loop', start: NOW - 35 * DAY, end: NOW, endBasis: 'open' }),
      expect.objectContaining({ kind: 'profile-switch', percentage: 80, start: NOW - 25 * DAY, endBasis: 'open' }),
    ]));
  });

  it('retains ongoing loop mode beneath an older finite overlay without resurrecting the overlay', async () => {
    const store = new MemoryHealthRecordStore();
    await save(store, [
      record('open', 35, { eventType: 'OpenAPS Offline', mode: 'OPEN_LOOP', duration: 0 }),
      record('overlay', 20, { eventType: 'OpenAPS Offline', mode: 'SUSPENDED_BY_USER', duration: 30 }),
    ]);
    expect(await source(store).getTherapyStates(range)).toEqual([
      expect.objectContaining({ kind: 'loop-mode', loopMode: 'open-loop' }),
    ]);
  });

  it('uses an older resume and baseline to end prior suspensions and changed settings', async () => {
    const store = new MemoryHealthRecordStore();
    await save(store, [
      record('suspend', 35, { eventType: 'Pump Suspend' }),
      record('resume', 20, { eventType: 'Pump Resume' }),
      record('open', 35, { eventType: 'OpenAPS Offline', mode: 'OPEN_LOOP', duration: 0 }),
      record('closed', 20, { eventType: 'OpenAPS Offline', mode: 'CLOSED_LOOP', duration: 0 }),
      record('profile-old', 35, { eventType: 'Profile Switch', profile: 'Example', percentage: 80, originalDuration: 0 }),
      record('profile-new', 20, { eventType: 'Profile Switch', profile: 'Example', percentage: 100, originalDuration: 0 }),
    ]);
    const states = await source(store).getTherapyStates(range);
    expect(states).toHaveLength(2);
    expect(states.every(state => state.baseline)).toBe(true);
  });

  it('retains a long-running target until an explicit cancel from the other route', async () => {
    const store = new MemoryHealthRecordStore();
    await save(store, [
      record('target', 30, { eventType: 'Temporary Target', targetBottom: 144.144, targetTop: 144.144, duration: 10 * 365 * 24 * 60 }),
    ]);
    expect(await source(store).getTherapyStates(range)).toEqual([
      expect.objectContaining({ kind: 'temporary-target', endBasis: 'open' }),
    ]);
    await save(store, [record('cancel', 15, { eventType: 'Temporary Target', duration: 0 })], 'aaps-local');
    expect(await source(store).getTherapyStates(range)).toEqual([]);
  });

  it('uses corrected archive records and skips withdrawn evidence', async () => {
    const store = new MemoryHealthRecordStore();
    const target = record('target', 30, {
      eventType: 'Temporary Target', targetBottom: 144.144, targetTop: 144.144, duration: 10 * 365 * 24 * 60,
    });
    await save(store, [target], 'nightscout', NOW - HOUR);
    await save(store, [{ ...target, duration: 45 }], 'nightscout', NOW);
    expect(await source(store).getTherapyStates(range)).toEqual([]);
    await save(store, [
      record('open', 28, { eventType: 'OpenAPS Offline', mode: 'OPEN_LOOP', duration: 0 }),
      record('withdrawn', 12, { eventType: 'OpenAPS Offline', mode: 'CLOSED_LOOP', isValid: false }),
    ], 'nightscout', NOW + 1);
    expect(await source(store).getTherapyStates(range)).toEqual([
      expect.objectContaining({ loopMode: 'open-loop' }),
    ]);
  });

  it('leaves range-only raw reads bounded while predecessor reads return a small selection', async () => {
    const store = new MemoryHealthRecordStore();
    await save(store, Array.from({ length: 70 }, (_, index) =>
      record(`old-${index}`, 100 - index, { eventType: 'OpenAPS Offline', mode: 'OPEN_LOOP', duration: 0 })));
    expect(await store.getTherapyStateRecords(range)).toEqual([]);
    const records: ImportRawRecord[] = await store.getTherapyStateRecords(range, true);
    expect(records).toHaveLength(1);
    expect(records[0]?.timestamp).toBe(NOW - 31 * DAY);
  });
});
