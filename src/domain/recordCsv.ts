import { isoUtc, isoWithOffset } from './exportTime';
import {
  type BasalDelivery,
  type BolusDelivery,
  type GlucoseReading,
  type HealthContextEvent,
  type InsulinDailyTotal,
  type MealEvent,
  MG_DL_PER_MMOL_L,
  type TimeRange,
} from './models';
import { recordSourceLabel } from './recordSourceLabels';
import type { T1ArcRegionalDefaults } from './regionalProfile';

export type CsvSettings = Pick<T1ArcRegionalDefaults, 'timeZone' | 'glucoseUnit'>;
export type CsvValue = string | number | boolean | undefined | null;

/** Text cells that a spreadsheet could run as a formula. */
const FORMULA_PREFIX = /^[=+\-@\t\r]/;

/**
 * One CSV cell (RFC 4180). Numbers are written with a full stop and no
 * grouping. Text that starts like a spreadsheet formula is prefixed with an
 * apostrophe so it opens as text.
 */
export function csvCell(value: CsvValue, options: { text?: boolean } = {}): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return '';
    return String(value);
  }
  let text = value;
  if (options.text !== false && FORMULA_PREFIX.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function csvRow(values: readonly CsvValue[]): string {
  return values.map((value) => csvCell(value)).join(',');
}

/** CRLF line endings, as most spreadsheet apps expect. */
export function csvDocument(header: readonly string[], rows: readonly (readonly CsvValue[])[]): string {
  return [csvRow(header), ...rows.map(csvRow)].join('\r\n') + '\r\n';
}

function roundTo(value: number, decimals: number) {
  const factor = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

export const GLUCOSE_CSV_HEADER = [
  'time_local',
  'time_utc',
  'time_zone',
  'glucose',
  'glucose_unit',
  'glucose_mmol_l',
  'glucose_mg_dl',
  'trend',
  'quality',
  'source',
  'source_id',
  'record_id',
  'received_at_utc',
  'imported_at_utc',
  'source_file',
  'source_row',
  'source_device_id',
  'source_local_time',
] as const;

function inRange(timestamp: number, range: TimeRange) {
  return timestamp >= range.start && timestamp < range.end;
}

/**
 * Glucose readings as stored. `glucose_mmol_l` is the canonical stored value;
 * `glucose_mg_dl` is converted with 18.016 and rounded to a whole number;
 * `glucose` repeats the value in the display unit.
 */
export function glucoseReadingsCsv(
  readings: readonly GlucoseReading[],
  range: TimeRange,
  settings: CsvSettings,
): string {
  const rows = readings
    .filter((reading) => inRange(reading.timestamp, range) && Number.isFinite(reading.mmolL))
    .sort((left, right) => left.timestamp - right.timestamp || (left.id < right.id ? -1 : 1))
    .map((reading) => {
      const mgDl = Math.round(reading.mmolL * MG_DL_PER_MMOL_L);
      const mmolL = roundTo(reading.mmolL, 3);
      return [
        isoWithOffset(reading.timestamp, settings.timeZone),
        isoUtc(reading.timestamp),
        settings.timeZone,
        settings.glucoseUnit === 'mgDl' ? mgDl : roundTo(reading.mmolL, 1),
        settings.glucoseUnit === 'mgDl' ? 'mg/dL' : 'mmol/L',
        mmolL,
        mgDl,
        reading.trend,
        reading.quality,
        recordSourceLabel(reading.sourceId),
        reading.sourceId,
        reading.id,
        Number.isFinite(reading.receivedAt) ? isoUtc(reading.receivedAt) : undefined,
        reading.importedAt === undefined ? undefined : isoUtc(reading.importedAt),
        reading.sourceFile,
        reading.sourceRow,
        reading.sourceDeviceId,
        reading.sourceLocalTimestamp,
      ];
    });
  return csvDocument(GLUCOSE_CSV_HEADER, rows);
}

export const TREATMENT_CSV_HEADER = [
  'record_type',
  'start_local',
  'end_local',
  'start_utc',
  'end_utc',
  'time_zone',
  'amount',
  'amount_unit',
  'basal_rate_units_per_hour',
  'basal_units',
  'bolus_units',
  'carbs_grams',
  'delivery_type',
  'description',
  'estimated',
  'source',
  'source_id',
  'record_id',
  'imported_at_utc',
  'source_file',
  'source_row',
  'source_device_id',
] as const;

export interface TreatmentCsvInput {
  basal: readonly BasalDelivery[];
  boluses: readonly BolusDelivery[];
  dailyInsulinTotals?: readonly InsulinDailyTotal[];
  context: readonly HealthContextEvent[];
}

type TreatmentRow = { sortAt: number; id: string; values: CsvValue[] };

/**
 * Insulin, daily insulin totals and logged carbohydrate as stored, one row
 * per record, oldest first. Nothing is calculated or merged.
 */
export function treatmentRecordsCsv(
  input: TreatmentCsvInput,
  range: TimeRange,
  settings: CsvSettings,
): string {
  const local = (timestamp: number | undefined) =>
    timestamp === undefined ? undefined : isoWithOffset(timestamp, settings.timeZone);
  const utc = (timestamp: number | undefined) =>
    timestamp === undefined ? undefined : isoUtc(timestamp);
  const provenance = (record: {
    sourceId: string;
    id: string;
    importedAt?: number;
    sourceFile?: string;
    sourceRow?: number;
    sourceDeviceId?: string;
  }): CsvValue[] => [
    recordSourceLabel(record.sourceId),
    record.sourceId,
    record.id,
    utc(record.importedAt),
    record.sourceFile,
    record.sourceRow,
    record.sourceDeviceId,
  ];
  const rows: TreatmentRow[] = [];
  input.boluses
    .filter((record) => inRange(record.timestamp, range))
    .forEach((record) => rows.push({
      sortAt: record.timestamp,
      id: record.id,
      values: [
        'bolus', local(record.timestamp), undefined, utc(record.timestamp), undefined, settings.timeZone,
        roundTo(record.units, 3), 'U', undefined, undefined, roundTo(record.units, 3), undefined,
        record.deliveryType, undefined, undefined, ...provenance(record),
      ],
    }));
  input.basal
    .filter((record) => record.start < range.end && record.end > range.start)
    .forEach((record) => rows.push({
      sortAt: record.start,
      id: record.id,
      values: [
        'basal', local(record.start), local(record.end), utc(record.start), utc(record.end), settings.timeZone,
        roundTo(record.units, 3), 'U', roundTo(record.rateUnitsPerHour, 3), roundTo(record.units, 3), undefined, undefined,
        record.deliveryType, undefined, record.unitsEstimated === true, ...provenance(record),
      ],
    }));
  (input.dailyInsulinTotals ?? [])
    .filter((record) => inRange(record.timestamp, range))
    .forEach((record) => rows.push({
      sortAt: record.timestamp,
      id: record.id,
      values: [
        'daily_insulin_total', local(record.timestamp), undefined, utc(record.timestamp), undefined, settings.timeZone,
        roundTo(record.totalUnits, 3), 'U', undefined,
        record.basalUnits === undefined ? undefined : roundTo(record.basalUnits, 3),
        record.bolusUnits === undefined ? undefined : roundTo(record.bolusUnits, 3),
        undefined, undefined, `Source total for ${record.dateKey}`, undefined, ...provenance(record),
      ],
    }));
  input.context
    .filter((event): event is MealEvent =>
      event.kind === 'meal' && inRange(event.start, range) &&
      typeof event.carbsGrams === 'number' && Number.isFinite(event.carbsGrams))
    .forEach((event) => rows.push({
      sortAt: event.start,
      id: event.id,
      values: [
        event.purpose === 'hypo-treatment' ? 'carbs_low_treatment' : 'carbs',
        local(event.start), local(event.end), utc(event.start), utc(event.end), settings.timeZone,
        roundTo(event.carbsGrams ?? 0, 1), 'g', undefined, undefined, undefined, roundTo(event.carbsGrams ?? 0, 1),
        event.mealType, event.title, undefined,
        ...provenance({ ...event, importedAt: event.origin === 'imported' ? event.recordedAt : undefined }),
      ],
    }));
  rows.sort((left, right) => left.sortAt - right.sortAt || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
  return csvDocument(TREATMENT_CSV_HEADER, rows.map((row) => row.values));
}
