import { describe, expect, it } from 'vitest';

import { medicationPresets } from '@/domain/medications';
import { MedicationEvent } from '@/domain/models';

function medication(
  id: string,
  start: number,
  title: string,
  amount?: number,
  unit?: string,
): MedicationEvent {
  return {
    id,
    sourceId: 'daymark-manual',
    origin: 'manual',
    kind: 'medication',
    start,
    title,
    amount,
    unit,
  };
}

describe('medication quick-log presets', () => {
  it('groups equivalent medication records and ranks frequent ones first', () => {
    expect(
      medicationPresets([
        medication('1', 100, 'Vitamin D', 1, 'tablet'),
        medication('2', 200, 'vitamin d', 1, 'TABLET'),
        medication('3', 300, 'Antihistamine', 10, 'mg'),
      ]),
    ).toMatchObject([
      {
        title: 'vitamin d',
        amount: 1,
        unit: 'TABLET',
        lastLoggedAt: 200,
        useCount: 2,
      },
      {
        title: 'Antihistamine',
        amount: 10,
        unit: 'mg',
        lastLoggedAt: 300,
        useCount: 1,
      },
    ]);
  });

  it('keeps different strengths as separate repeat choices', () => {
    expect(
      medicationPresets([
        medication('1', 100, 'Medicine', 5, 'mg'),
        medication('2', 200, 'Medicine', 10, 'mg'),
      ]),
    ).toHaveLength(2);
  });
});
