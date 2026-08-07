import { describe, expect, it, vi } from 'vitest';

vi.mock('expo-crypto', () => ({
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  digestStringAsync: vi.fn(async () => '0'.repeat(64)),
}));

import { normalizeNightscoutTreatments } from '@/data/nightscout/NightscoutTreatmentImporter';

describe('Nightscout treatment normalization', () => {
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
