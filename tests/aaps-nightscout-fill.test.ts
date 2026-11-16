import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  gateNightscoutTreatments,
  loadNightscoutImportPolicy,
  nightscoutHistoryImporterForPolicy,
  resolveNightscoutImportPolicy,
  saveAapsNightscoutTreatmentFill,
  AAPS_NIGHTSCOUT_TREATMENT_FILL_KEY,
} from '@/data/aaps/aapsTreatmentFill';
import { NightscoutGlucoseSource } from '@/data/nightscout/NightscoutGlucoseSource';
import { NightscoutTreatmentImporter } from '@/data/nightscout/NightscoutTreatmentImporter';
import type { NightscoutTreatment } from '@/data/nightscout/types';
import { MemoryGlucoseHistoryStore } from '@/data/persistence/GlucoseHistoryStore';
import { MemoryHealthRecordStore } from '@/data/persistence/HealthRecordStore';
import { describeAapsInsulinProvenance } from '@/domain/aapsInsulinProvenance';
import { reconcileBolusSources } from '@/domain/insulinSourceReconciliation';
import type { BasalDelivery, BolusDelivery } from '@/domain/models';
import { dayRange } from '@/domain/time';

const { selected, secureValues } = vi.hoisted(() => ({
  selected: { value: undefined as string | undefined },
  secureValues: new Map<string, unknown>(),
}));

vi.mock('@/data/aaps/localAapsSource', () => ({
  getSelectedGlucoseSourceId: vi.fn(async () => selected.value),
}));

vi.mock('@/data/privacy/localDataWriteEpoch', () => ({
  acquireLocalDataWriteLease: vi.fn(async () => ({ epoch: 3 })),
  isLocalDataWriteSupersededError: () => false,
}));

vi.mock('@/data/privacy/localDataEpochSecureStore', () => ({
  saveEpochBoundSecureStoreValue: vi.fn(
    async (key: string, value: unknown, lease: { epoch: number }) => {
      secureValues.set(key, { epoch: lease.epoch, value });
    },
  ),
  loadEpochBoundSecureStoreValue: vi.fn(
    async (
      key: string,
      lease: { epoch: number },
      parse: (value: unknown) => unknown,
    ) => {
      const stored = secureValues.get(key) as
        | { epoch: number; value: unknown }
        | undefined;
      // A privacy erase advances the epoch and discards older values.
      return stored && stored.epoch === lease.epoch ? parse(stored.value) : undefined;
    },
  ),
}));

vi.mock('expo-crypto', () => ({
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  digestStringAsync: vi.fn(async (_algorithm: string, value: string) => {
    let hash = 0;
    for (let index = 0; index < value.length; index += 1) {
      hash = (Math.imul(hash, 31) + value.charCodeAt(index)) >>> 0;
    }
    return hash.toString(16).padStart(64, '0');
  }),
}));

const minute = 60_000;

beforeEach(() => {
  selected.value = undefined;
  secureValues.clear();
});

describe('Nightscout import policy', () => {
  it('keeps glucose and treatments for every source other than AAPS on this phone', () => {
    for (const selectedSourceId of [undefined, 'none', 'nightscout', 't1arc-librelinkup']) {
      expect(
        resolveNightscoutImportPolicy({ selectedSourceId, fillEnabled: false }),
      ).toEqual({
        importTreatments: true,
        importGlucose: true,
        reason: 'nightscout-or-other-source',
      });
    }
  });

  it('never reads Nightscout glucose while AAPS is selected, and honours the fill choice', () => {
    expect(
      resolveNightscoutImportPolicy({ selectedSourceId: 'aaps-local', fillEnabled: true }),
    ).toEqual({ importTreatments: true, importGlucose: false, reason: 'aaps-fill-on' });
    expect(
      resolveNightscoutImportPolicy({ selectedSourceId: 'aaps-local', fillEnabled: false }),
    ).toEqual({ importTreatments: false, importGlucose: false, reason: 'aaps-fill-off' });
    // Unset keeps the earlier behaviour: a connected site already filled treatments.
    expect(
      resolveNightscoutImportPolicy({ selectedSourceId: 'aaps-local', fillEnabled: undefined }),
    ).toMatchObject({ importTreatments: true, importGlucose: false });
  });

  it('loads the saved choice for AAPS and forgets it after a privacy erase', async () => {
    selected.value = 'aaps-local';
    await saveAapsNightscoutTreatmentFill(false, 1, { epoch: 3 } as never);
    expect(secureValues.has(AAPS_NIGHTSCOUT_TREATMENT_FILL_KEY)).toBe(true);
    expect(await loadNightscoutImportPolicy({ epoch: 3 } as never)).toMatchObject({
      reason: 'aaps-fill-off',
    });
    expect(await loadNightscoutImportPolicy({ epoch: 4 } as never)).toMatchObject({
      reason: 'aaps-fill-on',
    });
  });
});

describe('treatment refresh gate', () => {
  it('skips the Nightscout treatment request when the fill is off', async () => {
    const importer = { label: 'Nightscout', capabilities: [], refresh: vi.fn(async () => 'done') };
    const off = gateNightscoutTreatments(importer, async () =>
      resolveNightscoutImportPolicy({ selectedSourceId: 'aaps-local', fillEnabled: false }),
    );
    expect(await off.refresh()).toBeUndefined();
    expect(importer.refresh).not.toHaveBeenCalled();

    const on = gateNightscoutTreatments(importer, async () =>
      resolveNightscoutImportPolicy({ selectedSourceId: 'aaps-local', fillEnabled: true }),
    );
    expect(await on.refresh()).toBe('done');
    expect(importer.refresh).toHaveBeenCalledTimes(1);
  });
});

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('older history while AAPS supplies glucose', () => {
  const connection = { baseUrl: 'https://ns.example.test', accessToken: 'read-token' };
  const end = Date.parse('2026-11-10T12:00:00Z');
  const treatments: NightscoutTreatment[] = [
    {
      identifier: 'b1',
      eventType: 'Meal Bolus',
      created_at: new Date(end - 30 * minute).toISOString(),
      insulin: 2,
      enteredBy: 'openaps://AndroidAPS',
    },
  ];

  function setup() {
    const urls: string[] = [];
    const fetcher = vi.fn(async (url: string) => {
      urls.push(url);
      if (url.includes('/treatments.json')) return jsonResponse(treatments);
      if (url.includes('/entries')) {
        return jsonResponse([
          { _id: 'e1', type: 'sgv', sgv: 120, date: end - 5 * minute, direction: 'Flat' },
        ]);
      }
      return jsonResponse([]);
    }) as unknown as typeof fetch;
    const glucose = new MemoryGlucoseHistoryStore();
    const health = new MemoryHealthRecordStore();
    const treatmentImporter = new NightscoutTreatmentImporter(connection, health, fetcher, () => end);
    const glucoseSource = new NightscoutGlucoseSource(
      connection,
      glucose,
      fetcher,
      () => end,
      treatmentImporter,
      async () => undefined,
      async () => undefined,
    );
    return { urls, glucose, health, treatmentImporter, glucoseSource };
  }

  it('reads treatments only, so no Nightscout glucose is fetched or stored', async () => {
    const { urls, glucose, health, treatmentImporter, glucoseSource } = setup();
    const importer = nightscoutHistoryImporterForPolicy(
      resolveNightscoutImportPolicy({ selectedSourceId: 'aaps-local', fillEnabled: true }),
      { glucoseAndTreatments: glucoseSource, treatments: treatmentImporter },
    );
    await importer!.importHistoryRange(end - 86_400_000, end);
    expect(urls.some((url) => url.includes('/entries'))).toBe(false);
    expect(urls.some((url) => url.includes('/treatments.json'))).toBe(true);
    expect(await glucose.getReadings({ start: 0, end: end + 1 })).toEqual([]);
    expect(await health.getBolusDeliveries({ start: 0, end: end + 1 })).toEqual([
      expect.objectContaining({ id: 'nightscout:bolus:b1', sourceId: 'nightscout', units: 2 }),
    ]);
  });

  it('reads nothing when the fill is off, and keeps the full import for other sources', async () => {
    const off = setup();
    expect(
      nightscoutHistoryImporterForPolicy(
        resolveNightscoutImportPolicy({ selectedSourceId: 'aaps-local', fillEnabled: false }),
        { glucoseAndTreatments: off.glucoseSource, treatments: off.treatmentImporter },
      ),
    ).toBeUndefined();

    const other = setup();
    expect(
      nightscoutHistoryImporterForPolicy(
        resolveNightscoutImportPolicy({ selectedSourceId: 'nightscout', fillEnabled: false }),
        { glucoseAndTreatments: other.glucoseSource, treatments: other.treatmentImporter },
      ),
    ).toBe(other.glucoseSource);
  });
});

function bolus(id: string, sourceId: string, timestamp: number, units: number): BolusDelivery {
  return { id, sourceId, timestamp, units, deliveryType: 'Meal Bolus' };
}

function basal(id: string, sourceId: string, start: number, end: number, rate: number): BasalDelivery {
  return {
    id,
    sourceId,
    start,
    end,
    rateUnitsPerHour: rate,
    units: (rate * (end - start)) / 3_600_000,
  };
}

describe('Today insulin provenance while AAPS supplies glucose', () => {
  it('says nothing for other glucose sources', () => {
    const range = dayRange('2026-11-10', Date.parse('2026-11-10T18:00:00Z'));
    expect(
      describeAapsInsulinProvenance({
        selectedSourceId: 'nightscout',
        nightscoutFill: 'on',
        basal: [],
        boluses: [bolus('b', 'nightscout', range.start + minute, 1)],
        range,
      }),
    ).toBeUndefined();
  });

  it('labels Nightscout records, gives the latest record time and flags missing scheduled basal', () => {
    const now = Date.parse('2026-11-10T18:00:00Z');
    const range = dayRange('2026-11-10', now);
    const latest = Date.parse('2026-11-10T17:20:00Z');
    expect(
      describeAapsInsulinProvenance({
        selectedSourceId: 'aaps-local',
        nightscoutFill: 'on',
        basal: [basal('t', 'nightscout', Date.parse('2026-11-10T16:00:00Z'), Date.parse('2026-11-10T16:30:00Z'), 0.5)],
        boluses: [bolus('b', 'nightscout', latest, 0.4), bolus('m', 'manual-context', now - minute, 1)],
        range,
      }),
    ).toEqual({
      sourceLabel: 'AAPS records via Nightscout',
      dataThrough: latest,
      scheduledBasalMissing: true,
      emptyDetail: 'No AAPS insulin records for today yet',
    });
  });

  it('gives an honest empty state for each fill choice', () => {
    const range = dayRange('2026-11-10', Date.parse('2026-11-10T18:00:00Z'));
    const detail = (nightscoutFill: 'on' | 'off' | 'not-connected') =>
      describeAapsInsulinProvenance({
        selectedSourceId: 'aaps-local',
        nightscoutFill,
        basal: [],
        boluses: [],
        range,
      });
    expect(detail('on')).toMatchObject({ sourceLabel: undefined, dataThrough: undefined });
    expect(detail('off')?.emptyDetail).toBe('Nightscout insulin history is switched off for AAPS');
    expect(detail('not-connected')?.emptyDetail).toContain('connect Nightscout');
  });

  it('uses Europe/London day bounds on the 25-hour clock-change day', () => {
    // 25 October 2026: clocks go back at 02:00 BST.
    const range = dayRange('2026-10-25', Date.parse('2026-10-27T00:00:00Z'));
    const beforeMidnightLocal = Date.parse('2026-10-24T23:30:00+01:00');
    const lateLocal = Date.parse('2026-10-25T23:50:00Z');
    const boluses = reconcileBolusSources([
      bolus('previous-day', 'nightscout', beforeMidnightLocal, 2),
      bolus('late', 'nightscout', lateLocal, 1),
      bolus('late-glooko', 'glooko-export', lateLocal, 1),
    ]).boluses;
    const result = describeAapsInsulinProvenance({
      selectedSourceId: 'aaps-local',
      nightscoutFill: 'on',
      basal: [basal('g', 'glooko-export', range.start, range.end, 0.8)],
      boluses,
      range,
    });
    expect(range.end - range.start).toBe(25 * 60 * minute);
    // The Glooko copy wins, so no AAPS-made record remains from late evening.
    expect(result).toMatchObject({
      sourceLabel: undefined,
      dataThrough: undefined,
      scheduledBasalMissing: false,
    });
  });
});
