import { describe, expect, it } from 'vitest';

import { isoWithOffset, timeZoneOffsetMinutes } from '@/domain/exportTime';
import { exportFileStem, exportPeriodRange } from '@/domain/exportPeriod';
import type { BasalDelivery, BolusDelivery, GlucoseReading, MealEvent } from '@/domain/models';
import {
  csvCell,
  csvDocument,
  GLUCOSE_CSV_HEADER,
  glucoseReadingsCsv,
  TREATMENT_CSV_HEADER,
  treatmentRecordsCsv,
} from '@/domain/recordCsv';

const LONDON = { timeZone: 'Europe/London', glucoseUnit: 'mmolL' } as const;
const LONDON_MG = { timeZone: 'Europe/London', glucoseUnit: 'mgDl' } as const;

function reading(id: string, iso: string, mmolL: number, extra: Partial<GlucoseReading> = {}): GlucoseReading {
  const timestamp = Date.parse(iso);
  return { id, timestamp, receivedAt: timestamp + 60_000, mmolL, trend: 'flat', quality: 'measured', sourceId: 't1arc-librelinkup', ...extra };
}

function parseCsv(text: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]!;
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') { cell += '"'; index += 1; }
      else if (character === '"') quoted = false;
      else cell += character;
    } else if (character === '"') quoted = true;
    else if (character === ',') { row.push(cell); cell = ''; }
    else if (character === '\r' && text[index + 1] === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; index += 1; }
    else cell += character;
  }
  return rows;
}

describe('CSV cells', () => {
  it('quotes commas, quotes and line breaks and doubles embedded quotes', () => {
    expect(csvCell('plain')).toBe('plain');
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('two\nlines')).toBe('"two\nlines"');
    expect(csvCell(undefined)).toBe('');
    expect(csvCell(null)).toBe('');
    expect(csvCell(Number.NaN)).toBe('');
    expect(csvCell(3.885)).toBe('3.885');
    expect(csvCell(true)).toBe('true');
  });

  it('opens text that looks like a spreadsheet formula as text', () => {
    expect(csvCell('=HYPERLINK("x")')).toBe('"\'=HYPERLINK(""x"")"');
    expect(csvCell('+44')).toBe("'+44");
    expect(csvCell('@sum')).toBe("'@sum");
    expect(csvCell('-snack')).toBe("'-snack");
    // Numbers are never altered.
    expect(csvCell(-1)).toBe('-1');
  });

  it('round-trips through a standard parser with CRLF rows', () => {
    const text = csvDocument(['a', 'b'], [['x, y', 'line\nbreak'], ['"q"', 2]]);
    expect(text.endsWith('\r\n')).toBe(true);
    expect(parseCsv(text)).toEqual([['a', 'b'], ['x, y', 'line\nbreak'], ['"q"', '2']]);
  });
});

describe('ISO timestamps with offset', () => {
  it('writes Europe/London across the spring clock change', () => {
    expect(isoWithOffset(Date.parse('2026-03-29T00:30:00Z'), 'Europe/London')).toBe('2026-03-29T00:30:00+00:00');
    expect(isoWithOffset(Date.parse('2026-03-29T01:30:00Z'), 'Europe/London')).toBe('2026-03-29T02:30:00+01:00');
  });

  it('distinguishes the repeated hour on the autumn clock change', () => {
    expect(isoWithOffset(Date.parse('2026-10-25T00:30:00Z'), 'Europe/London')).toBe('2026-10-25T01:30:00+01:00');
    expect(isoWithOffset(Date.parse('2026-10-25T01:30:00Z'), 'Europe/London')).toBe('2026-10-25T01:30:00+00:00');
  });

  it('handles negative and half-hour offsets', () => {
    expect(isoWithOffset(Date.parse('2026-07-01T12:00:00Z'), 'America/New_York')).toBe('2026-07-01T08:00:00-04:00');
    expect(timeZoneOffsetMinutes(Date.parse('2026-07-01T12:00:00Z'), 'Asia/Kolkata')).toBe(330);
    expect(isoWithOffset(Date.parse('2026-07-01T12:00:00Z'), 'Asia/Kolkata')).toBe('2026-07-01T17:30:00+05:30');
  });
});

describe('glucose CSV', () => {
  const readings = [
    reading('b', '2026-03-29T01:30:00Z', 10.05),
    reading('a', '2026-03-29T00:30:00Z', 70 / 18.016, {
      sourceId: 'glooko-cgm', importedAt: Date.parse('2026-04-01T09:00:00Z'), sourceFile: 'export, March.csv', sourceRow: 12, sourceDeviceId: 'device-1',
    }),
    reading('outside', '2026-03-30T00:00:00Z', 6),
  ];
  const range = { start: Date.parse('2026-03-29T00:00:00Z'), end: Date.parse('2026-03-29T12:00:00Z') };

  it('writes one row per reading in the period, oldest first, with units and provenance', () => {
    const rows = parseCsv(glucoseReadingsCsv(readings, range, LONDON));
    expect(rows[0]).toEqual([...GLUCOSE_CSV_HEADER]);
    expect(rows).toHaveLength(3);
    const header = rows[0]!;
    const first = Object.fromEntries(header.map((name, index) => [name, rows[1]![index]]));
    expect(first).toMatchObject({
      time_local: '2026-03-29T00:30:00+00:00',
      time_utc: '2026-03-29T00:30:00.000Z',
      time_zone: 'Europe/London',
      glucose: '3.9',
      glucose_unit: 'mmol/L',
      glucose_mmol_l: '3.885',
      glucose_mg_dl: '70',
      source: 'Glooko glucose history',
      source_id: 'glooko-cgm',
      record_id: 'a',
      imported_at_utc: '2026-04-01T09:00:00.000Z',
      source_file: 'export, March.csv',
      source_row: '12',
      source_device_id: 'device-1',
    });
    const second = Object.fromEntries(header.map((name, index) => [name, rows[2]![index]]));
    expect(second).toMatchObject({ time_local: '2026-03-29T02:30:00+01:00', source: 'LibreLinkUp', glucose_mg_dl: '181' });
  });

  it('uses mg/dL in the display column when that is the chosen unit', () => {
    const rows = parseCsv(glucoseReadingsCsv(readings, range, LONDON_MG));
    const header = rows[0]!;
    const value = (row: number, name: string) => rows[row]![header.indexOf(name)];
    expect(value(1, 'glucose')).toBe('70');
    expect(value(1, 'glucose_unit')).toBe('mg/dL');
    expect(value(1, 'glucose_mmol_l')).toBe('3.885');
  });

  it('writes a header only for an empty period', () => {
    expect(parseCsv(glucoseReadingsCsv([], range, LONDON))).toEqual([[...GLUCOSE_CSV_HEADER]]);
  });
});

describe('treatment CSV', () => {
  const bolus: BolusDelivery = { id: 'bolus-1', timestamp: Date.parse('2026-10-25T01:30:00Z'), units: 3.25, deliveryType: 'Normal', sourceId: 'glooko-export', importedAt: Date.parse('2026-10-26T08:00:00Z'), sourceFile: 'pump.csv', sourceRow: 4 };
  const basal: BasalDelivery = { id: 'basal-1', start: Date.parse('2026-10-25T00:00:00Z'), end: Date.parse('2026-10-25T02:00:00Z'), rateUnitsPerHour: 0.8, units: 1.6, unitsEstimated: true, sourceId: 'aaps-local' };
  const meal: MealEvent = { id: 'meal-1', kind: 'meal', title: '=Toast, jam', mealType: 'breakfast', start: Date.parse('2026-10-25T07:00:00Z'), carbsGrams: 42.5, sourceId: 't1arc-manual', origin: 'manual' };
  const hypo: MealEvent = { ...meal, id: 'meal-2', title: 'Glucose tablets', purpose: 'hypo-treatment', carbsGrams: 15, start: Date.parse('2026-10-25T03:00:00Z') };
  const noCarbs: MealEvent = { ...meal, id: 'meal-3', carbsGrams: undefined };
  const range = { start: Date.parse('2026-10-24T23:00:00Z'), end: Date.parse('2026-10-26T00:00:00Z') };

  it('lists insulin and carbohydrate records oldest first with provenance and units', () => {
    const rows = parseCsv(treatmentRecordsCsv({
      basal: [basal], boluses: [bolus], context: [meal, hypo, noCarbs],
      dailyInsulinTotals: [{ id: 'total-1', timestamp: Date.parse('2026-10-25T00:00:00Z'), dateKey: '2026-10-25', basalUnits: 10, bolusUnits: 12, totalUnits: 22, sourceId: 'glooko-export' }],
    }, range, LONDON));
    expect(rows[0]).toEqual([...TREATMENT_CSV_HEADER]);
    const header = rows[0]!;
    const records = rows.slice(1).map((row) => Object.fromEntries(header.map((name, index) => [name, row[index]])));
    expect(records.map((record) => record.record_type)).toEqual(['basal', 'daily_insulin_total', 'bolus', 'carbs_low_treatment', 'carbs']);
    expect(records[0]).toMatchObject({ start_local: '2026-10-25T01:00:00+01:00', end_local: '2026-10-25T02:00:00+00:00', amount: '1.6', amount_unit: 'U', basal_rate_units_per_hour: '0.8', estimated: 'true', source: 'AAPS on this phone', source_id: 'aaps-local' });
    expect(records[1]).toMatchObject({ amount: '22', basal_units: '10', bolus_units: '12', source: 'Glooko' });
    expect(records[2]).toMatchObject({ start_local: '2026-10-25T01:30:00+00:00', amount: '3.25', bolus_units: '3.25', delivery_type: 'Normal', source_file: 'pump.csv', source_row: '4', imported_at_utc: '2026-10-26T08:00:00.000Z' });
    expect(records[4]).toMatchObject({ amount: '42.5', amount_unit: 'g', carbs_grams: '42.5', description: "'=Toast, jam", source: 'Entered in T1 Arc' });
  });
});

describe('export periods', () => {
  const now = Date.parse('2026-11-16T10:00:00Z');
  it('uses rolling days ending now, or everything from the earliest record', () => {
    expect(exportPeriodRange(14, now, undefined)).toEqual({ start: now - 14 * 86_400_000, end: now });
    expect(exportPeriodRange('all', now, Date.parse('2025-01-01T00:00:00Z'))).toEqual({ start: Date.parse('2025-01-01T00:00:00Z'), end: now });
    expect(exportPeriodRange('all', now, undefined).end).toBe(now);
  });
  it('names files by local dates', () => {
    expect(exportFileStem('glucose', exportPeriodRange(14, now, undefined), 'Europe/London')).toBe('T1-Arc-glucose-2026-11-02-to-2026-11-16');
  });
});
