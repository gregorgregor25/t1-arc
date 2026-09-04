import { afterEach, describe, expect, it, vi } from 'vitest';

import { normalizeNightscoutTreatments } from '@/data/nightscout/NightscoutTreatmentImporter';
import { DEFAULT_REGIONAL_PROFILE } from '@/domain/regionalProfile';
import { setRuntimeRegionalProfile } from '@/domain/regionalProfileRuntime';

vi.mock('expo-crypto', () => ({
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  digestStringAsync: vi.fn(async () => '0'.repeat(64)),
}));

afterEach(() => {
  setRuntimeRegionalProfile({ ...DEFAULT_REGIONAL_PROFILE });
});

describe('Nightscout treatment normalization', () => {
  it('rejects offsetless treatment times rather than using the phone timezone', () => {
    const normalized = normalizeNightscoutTreatments(
      [
        {
          _id: 'offsetless',
          created_at: '2026-08-01T12:00:00',
          eventType: 'Meal Bolus',
          insulin: 4,
          carbs: 40,
        },
      ],
      [],
    );

    expect(normalized.boluses).toEqual([]);
    expect(normalized.context).toEqual([]);
    expect(normalized.skipped).toBe(1);
  });

  it('buckets meals correctly with a locale that renders Arabic digits', () => {
    setRuntimeRegionalProfile({
      ...DEFAULT_REGIONAL_PROFILE,
      region: 'other',
      countryCode: 'EG',
      languageTag: 'ar-EG',
      analysisTimeZone: 'Africa/Cairo',
      followDeviceTimeZone: false,
    });
    const normalized = normalizeNightscoutTreatments(
      [
        {
          _id: 'arabic-lunch',
          created_at: '2026-08-01T09:00:00Z',
          eventType: 'Meal Bolus',
          carbs: 40,
        },
      ],
      [],
    );

    expect(normalized.context).toEqual([
      expect.objectContaining({ kind: 'meal', mealType: 'lunch' }),
    ]);
  });

  it('imports exact bolus, carb and temporary-basal events without inventing profile delivery', () => {
    const start = Date.parse('2026-08-01T12:00:00.000Z');
    const normalized = normalizeNightscoutTreatments(
      [
        {
          _id: 'meal-bolus',
          created_at: '2026-08-01T12:00:00.000Z',
          eventType: 'Meal Bolus',
          insulin: 4.2,
          carbs: 48,
          notes: 'Lunch',
          enteredBy: 'loop',
        },
        {
          _id: 'temp-basal',
          created_at: '2026-08-01T12:30:00.000Z',
          eventType: 'Temp Basal',
          absolute: 0.8,
          duration: 30,
        },
        {
          _id: 'activity',
          created_at: '2026-08-01T13:00:00.000Z',
          eventType: 'Temporary Target',
          reason: 'Exercise target',
          duration: 60,
        },
      ],
      [
        {
          _id: 'profile-1',
          defaultProfile: 'Default',
          store: {
            Default: { basal: [{ time: '00:00', value: 0.7 }] },
          },
        },
      ],
      start,
    );

    expect(normalized.boluses).toMatchObject([
      { units: 4.2, deliveryType: 'Meal Bolus', sourceId: 'nightscout' },
    ]);
    expect(normalized.context).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'meal', carbsGrams: 48, title: 'Lunch' }),
        expect.objectContaining({ kind: 'note', title: 'Temporary Target' }),
      ]),
    );
    expect(normalized.basal).toMatchObject([
      {
        rateUnitsPerHour: 0.8,
        units: 0.4,
        unitsEstimated: true,
        sourceId: 'nightscout',
      },
    ]);
    expect(normalized.rawRecords).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ recordKind: 'nightscout-profile' }),
        expect.objectContaining({ recordKind: 'pump-state-interval' }),
      ]),
    );
    expect(
      normalized.basal.some((delivery) => delivery.id.includes('profile')),
    ).toBe(false);
  });

  it('pairs pump suspend and resume as a visible pause interval', () => {
    const normalized = normalizeNightscoutTreatments(
      [
        {
          _id: 'suspend',
          created_at: '2026-08-01T01:00:00.000Z',
          eventType: 'Pump Suspend',
        },
        {
          _id: 'resume',
          created_at: '2026-08-01T01:25:00.000Z',
          eventType: 'Pump Resume',
        },
      ],
      [],
    );
    const pause = normalized.rawRecords.find(
      (record) => record.recordKind === 'pump-state-interval',
    );
    expect(JSON.parse(pause!.payloadJson)).toMatchObject({
      kind: 'automated-pause',
      start: Date.parse('2026-08-01T01:00:00.000Z'),
      end: Date.parse('2026-08-01T01:25:00.000Z'),
    });
  });
});
