import { BasalDelivery, BolusDelivery } from '@/domain/models';

export type NormalizedGlookoInsulinRow =
  | {
      externalId: string;
      kind: 'bolus';
      deliveredAt: string;
      units: number;
    }
  | {
      externalId: string;
      kind: 'basal';
      deliveredAt: string;
      endAt: string;
      units: number;
      rateUnitsPerHour: number;
    };

export function normalizeGlookoInsulinRow(
  row: NormalizedGlookoInsulinRow,
  sourceId = 'glooko-export',
): BasalDelivery | BolusDelivery {
  const start = Date.parse(row.deliveredAt);
  if (!Number.isFinite(start)) {
    throw new Error('Normalised Glooko row has an invalid deliveredAt timestamp.');
  }
  if (!Number.isFinite(row.units) || row.units < 0) {
    throw new Error('Normalised Glooko row has invalid delivered units.');
  }

  if (row.kind === 'bolus') {
    return {
      id: `${sourceId}:${row.externalId}`,
      timestamp: start,
      units: row.units,
      sourceId,
    };
  }

  const end = Date.parse(row.endAt);
  if (!Number.isFinite(end) || end <= start) {
    throw new Error('Normalised basal row must end after it starts.');
  }
  if (!Number.isFinite(row.rateUnitsPerHour) || row.rateUnitsPerHour < 0) {
    throw new Error('Normalised basal row has an invalid delivery rate.');
  }

  return {
    id: `${sourceId}:${row.externalId}`,
    start,
    end,
    units: row.units,
    rateUnitsPerHour: row.rateUnitsPerHour,
    sourceId,
  };
}
