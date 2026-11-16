import { describe, expect, it, vi } from 'vitest';

import {
  NightscoutTreatmentImporter,
  normalizeNightscoutTreatments,
} from '@/data/nightscout/NightscoutTreatmentImporter';
import { MemoryHealthRecordStore } from '@/data/persistence/HealthRecordStore';
import type { NightscoutTreatment } from '@/data/nightscout/types';

vi.mock('expo-crypto', () => ({
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  digestStringAsync: vi.fn(async (_algorithm: string, value: string) => {
    // Deterministic, payload-dependent stand-in for SHA-256.
    let hash = 0;
    for (let index = 0; index < value.length; index += 1) {
      hash = (Math.imul(hash, 31) + value.charCodeAt(index)) >>> 0;
    }
    return hash.toString(16).padStart(64, '0');
  }),
}));

const T0 = Date.parse('2026-11-10T08:00:00.000Z');
const minutes = (value: number) => value * 60_000;

/** Shapes AAPS 4.0 NSClient V3 uploads, per the public AndroidAPS source. */
function aapsBolus(overrides: Partial<NightscoutTreatment> = {}): NightscoutTreatment {
  return {
    identifier: 'bolus-1',
    eventType: 'Meal Bolus',
    created_at: new Date(T0).toISOString(),
    date: T0,
    insulin: 3.5,
    type: 'NORMAL',
    isSMB: false,
    isValid: true,
    pumpType: 'OMNIPOD_DASH',
    enteredBy: 'openaps://AndroidAPS',
    ...overrides,
  };
}

describe('Nightscout treatments uploaded by AAPS', () => {
  it('labels SMBs and keeps AAPS provenance on every record', () => {
    const normalized = normalizeNightscoutTreatments(
      [
        aapsBolus(),
        aapsBolus({
          identifier: 'smb-1',
          eventType: 'Correction Bolus',
          date: T0 + minutes(5),
          created_at: new Date(T0 + minutes(5)).toISOString(),
          insulin: 0.3,
          type: 'SMB',
          isSMB: true,
        }),
      ],
      [],
      T0 + minutes(10),
    );
    expect(normalized.boluses).toEqual([
      expect.objectContaining({
        id: 'nightscout:bolus:bolus-1',
        units: 3.5,
        deliveryType: 'Meal Bolus',
        sourceId: 'nightscout',
        sourceDeviceId: 'openaps://AndroidAPS',
        sourceFile: 'treatments.json',
      }),
      expect.objectContaining({
        id: 'nightscout:bolus:smb-1',
        units: 0.3,
        deliveryType: 'SMB',
      }),
    ]);
  });

  it('does not count withdrawn records or priming insulin, but keeps both as raw evidence', () => {
    const normalized = normalizeNightscoutTreatments(
      [
        aapsBolus({ identifier: 'deleted', isValid: false }),
        aapsBolus({ identifier: 'prime', type: 'PRIMING', insulin: 0.5 }),
      ],
      [],
    );
    expect(normalized.boluses).toEqual([]);
    expect(normalized.withdrawn).toBe(1);
    expect(normalized.skipped).toBe(0);
    expect(
      normalized.rawRecords.filter((record) => record.recordKind === 'nightscout-treatment'),
    ).toHaveLength(2);
    expect(normalized.revisedRecordIds).toEqual(
      expect.arrayContaining(['nightscout:bolus:deleted', 'nightscout:bolus:prime']),
    );
  });

  it('records an extended bolus once with its immediate and extended parts', () => {
    const normalized = normalizeNightscoutTreatments(
      [
        {
          identifier: 'eb-1',
          eventType: 'Combo Bolus',
          created_at: new Date(T0).toISOString(),
          duration: 60,
          durationInMilliseconds: minutes(60),
          splitNow: 0,
          splitExt: 100,
          enteredinsulin: 2,
          relative: 2,
          isEmulatingTempBasal: false,
          isValid: true,
        },
        {
          identifier: 'eb-emulated',
          eventType: 'Combo Bolus',
          created_at: new Date(T0 + minutes(90)).toISOString(),
          enteredinsulin: 1,
          isEmulatingTempBasal: true,
        },
      ],
      [],
    );
    expect(normalized.boluses).toEqual([
      expect.objectContaining({
        id: 'nightscout:bolus:eb-1',
        units: 2,
        initialUnits: 0,
        extendedUnits: 2,
        deliveryType: 'Combo Bolus (extended over 60 min)',
      }),
    ]);
  });

  it('ends a temporary basal at the next one or at a cancel, using exact AAPS durations', () => {
    const normalized = normalizeNightscoutTreatments(
      [
        {
          identifier: 'tb-1',
          eventType: 'Temp Basal',
          created_at: new Date(T0).toISOString(),
          rate: 1.2,
          absolute: 1.2,
          duration: 30,
          durationInMilliseconds: minutes(30),
        },
        {
          identifier: 'tb-2',
          eventType: 'Temp Basal',
          created_at: new Date(T0 + minutes(10)).toISOString(),
          rate: 0,
          absolute: 0,
          duration: 120,
          durationInMilliseconds: minutes(120),
        },
        {
          identifier: 'cancel',
          eventType: 'Temp Basal',
          created_at: new Date(T0 + minutes(25)).toISOString(),
          duration: 0,
        },
      ],
      [],
    );
    expect(normalized.basal.map(({ id, start, end, units }) => ({ id, start, end, units }))).toEqual([
      { id: 'nightscout:basal:tb-1', start: T0, end: T0 + minutes(10), units: 0.2 },
      { id: 'nightscout:basal:tb-2', start: T0 + minutes(10), end: T0 + minutes(25), units: 0 },
    ]);
    expect(normalized.basal.every((record) => record.unitsEstimated)).toBe(true);
    expect(normalized.skipped).toBe(0);
  });

  it('keeps temporary targets, profile switches and therapy events as dated context', () => {
    const normalized = normalizeNightscoutTreatments(
      [
        {
          identifier: 'tt',
          eventType: 'Temporary Target',
          created_at: new Date(T0).toISOString(),
          duration: 60,
          reason: 'Activity',
          targetBottom: 140,
          targetTop: 140,
          units: 'mg/dl',
        },
        {
          identifier: 'ps',
          eventType: 'Profile Switch',
          created_at: new Date(T0 + minutes(1)).toISOString(),
          profile: 'Weekday',
          percentage: 90,
          duration: 0,
        },
        { identifier: 'site', eventType: 'Site Change', created_at: new Date(T0 + minutes(2)).toISOString() },
        { identifier: 'sensor', eventType: 'Sensor Change', created_at: new Date(T0 + minutes(3)).toISOString() },
      ],
      [],
    );
    expect(normalized.context).toEqual([
      expect.objectContaining({
        id: 'nightscout:note:tt',
        title: 'Temporary Target',
        detail: 'Activity · target 140 mg/dl as recorded',
        end: T0 + minutes(60),
      }),
      expect.objectContaining({ id: 'nightscout:note:ps', detail: 'Weekday · 90%' }),
      expect.objectContaining({ id: 'nightscout:note:site', category: 'pump', title: 'Site Change' }),
      expect.objectContaining({ id: 'nightscout:note:sensor', category: 'sensor', title: 'Sensor Change' }),
    ]);
  });
});

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('Nightscout treatment import into local storage', () => {
  const connection = { baseUrl: 'https://ns.example.test', accessToken: 'read-token' };

  it('replaces a record that AAPS later edits or withdraws instead of keeping both', async () => {
    const store = new MemoryHealthRecordStore();
    let treatments: NightscoutTreatment[] = [aapsBolus({ insulin: 4 })];
    const fetcher = vi.fn(async (url: string) =>
      url.includes('/treatments.json') ? jsonResponse(treatments) : jsonResponse([]),
    ) as unknown as typeof fetch;
    const importer = new NightscoutTreatmentImporter(connection, store, fetcher, () => T0 + minutes(30));
    await importer.refresh();
    const range = { start: T0 - minutes(60), end: T0 + minutes(60) };
    expect((await store.getBolusDeliveries(range)).map((record) => record.units)).toEqual([4]);

    treatments = [aapsBolus({ insulin: 3 })];
    await importer.refresh();
    expect((await store.getBolusDeliveries(range)).map((record) => record.units)).toEqual([3]);

    treatments = [aapsBolus({ insulin: 3, isValid: false })];
    const result = await importer.refresh();
    expect(await store.getBolusDeliveries(range)).toEqual([]);
    expect(result.batch.warnings).toContain(
      '1 Nightscout treatment was marked withdrawn and is not counted.',
    );
  });

  it('reads further pages instead of leaving older treatments out of a full response', async () => {
    const store = new MemoryHealthRecordStore();
    const page = (count: number, offset: number) =>
      Array.from({ length: count }, (_, index) => {
        const timestamp = T0 - (offset + index) * 1_000;
        return aapsBolus({
          identifier: `p-${offset + index}`,
          date: timestamp,
          created_at: new Date(timestamp).toISOString(),
          insulin: 0.1,
        });
      });
    const urls: string[] = [];
    const fetcher = vi.fn(async (url: string) => {
      if (!url.includes('/treatments.json')) return jsonResponse([]);
      urls.push(url);
      return jsonResponse(urls.length === 1 ? page(5_000, 0) : page(10, 4_999));
    }) as unknown as typeof fetch;
    const importer = new NightscoutTreatmentImporter(connection, store, fetcher, () => T0);
    await importer.importRange(T0 - 86_400_000, T0 + 1);

    expect(urls).toHaveLength(2);
    expect(urls[0]).toContain('find%5Bcreated_at%5D%5B%24lt%5D=');
    expect(urls[1]).toContain(
      `find%5Bcreated_at%5D%5B%24lte%5D=${encodeURIComponent(new Date(T0 - 4_999_000).toISOString())}`,
    );
    const stored = await store.getBolusDeliveries({ start: 0, end: T0 + 1 });
    // 5,000 from the first page plus 9 new ones; the boundary record is not duplicated.
    expect(stored).toHaveLength(5_009);
  });
});
