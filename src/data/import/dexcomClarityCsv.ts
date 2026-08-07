import {
  parseDelimitedRows,
  parseGlookoTimestamp,
} from './glookoCsv';
import {
  GlucoseReading,
  MG_DL_PER_MMOL_L,
  TrendDirection,
} from '@/domain/models';

export const DEXCOM_CLARITY_SOURCE_ID = 'dexcom-clarity-export';
export const DEXCOM_CGM_SOURCE_ID = 'dexcom-cgm';

export interface DexcomClarityImportPreview {
  glucose: GlucoseReading[];
  warnings: string[];
  skippedRows: number;
  duplicateRows: number;
  dataStart?: number;
  dataThrough?: number;
}

function normaliseHeader(value: string) {
  return value
    .replace(/^\uFEFF/, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[/_-]+/g, ' ')
    .replace(/[()]/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function findColumn(headers: string[], aliases: string[]) {
  const normalised = headers.map(normaliseHeader);
  const wanted = aliases.map(normaliseHeader);
  for (const alias of wanted) {
    const exact = normalised.indexOf(alias);
    if (exact >= 0) return exact;
  }
  for (const alias of wanted.filter((item) => item.length >= 5)) {
    const partial = normalised.findIndex((header) => header.includes(alias));
    if (partial >= 0) return partial;
  }
  return -1;
}

function parseNumber(value: string | undefined) {
  if (!value?.trim()) return undefined;
  let normalised = value.trim().replace(/\s/g, '').replace(/[^\d,.\-]/g, '');
  if (normalised.includes(',') && !normalised.includes('.')) {
    normalised = normalised.replace(',', '.');
  } else {
    normalised = normalised.replace(/,/g, '');
  }
  const parsed = Number(normalised);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function trendFromText(value: string | undefined): TrendDirection | undefined {
  if (!value?.trim()) return undefined;
  const normalised = normaliseHeader(value);
  if (normalised.includes('double up')) return 'doubleUp';
  if (normalised.includes('forty five up') || normalised.includes('slight up')) {
    return 'slightUp';
  }
  if (normalised === 'single up' || normalised === 'up') return 'up';
  if (normalised === 'flat' || normalised === 'steady') return 'flat';
  if (
    normalised.includes('forty five down') ||
    normalised.includes('slight down')
  ) {
    return 'slightDown';
  }
  if (normalised === 'single down' || normalised === 'down') return 'down';
  if (normalised.includes('double down')) return 'doubleDown';
  return undefined;
}

function trendFromRate(rateMgDlPerMinute: number | undefined): TrendDirection {
  if (rateMgDlPerMinute === undefined) return 'unknown';
  if (rateMgDlPerMinute >= 3) return 'doubleUp';
  if (rateMgDlPerMinute >= 2) return 'up';
  if (rateMgDlPerMinute >= 1) return 'slightUp';
  if (rateMgDlPerMinute > -1) return 'flat';
  if (rateMgDlPerMinute > -2) return 'slightDown';
  if (rateMgDlPerMinute > -3) return 'down';
  return 'doubleDown';
}

function sourceFileName(value: string) {
  return value.split(/[\\/]/).pop()?.trim() || 'dexcom-clarity.csv';
}

function glucoseUnitFromHeader(header: string) {
  const normalised = normaliseHeader(header);
  if (normalised.includes('mmol l')) return 'mmol/L' as const;
  return 'mg/dL' as const;
}

function rateUnitFromHeader(header: string) {
  const normalised = normaliseHeader(header);
  if (normalised.includes('mmol l')) return 'mmol/L/min' as const;
  return 'mg/dL/min' as const;
}

function isHeaderRow(row: string[]) {
  return (
    findColumn(row, ['timestamp', 'date time', 'datetime']) >= 0 &&
    findColumn(row, [
      'glucose value mg dl',
      'glucose value mmol l',
      'glucose value',
      'sensor glucose',
      'estimated glucose value',
    ]) >= 0
  );
}

export function parseDexcomClarityCsv(
  input: string | Uint8Array,
  fileName = 'dexcom-clarity.csv',
  importedAt = Date.now(),
): DexcomClarityImportPreview {
  const iterator = parseDelimitedRows(input);
  let header: string[] | undefined;
  let headerRow = 0;
  for (let index = 0; index < 50; index += 1) {
    const next = iterator.next();
    if (next.done) break;
    if (isHeaderRow(next.value)) {
      header = next.value;
      headerRow = index + 1;
      break;
    }
  }
  if (!header) {
    throw new Error(
      'This does not look like a Dexcom Clarity CSV export. The timestamp and glucose columns were not found.',
    );
  }

  const timestampColumn = findColumn(header, [
    'timestamp',
    'date time',
    'datetime',
  ]);
  const glucoseColumn = findColumn(header, [
    'glucose value mg dl',
    'glucose value mmol l',
    'glucose value',
    'sensor glucose',
    'estimated glucose value',
  ]);
  const eventTypeColumn = findColumn(header, ['event type', 'record type']);
  const trendColumn = findColumn(header, [
    'trend',
    'trend arrow',
    'trend direction',
  ]);
  const rateColumn = findColumn(header, [
    'glucose rate of change mg dl min',
    'glucose rate of change mmol l min',
    'glucose rate of change',
    'trend rate',
  ]);
  const sourceDeviceColumn = findColumn(header, [
    'source device id',
    'device id',
    'transmitter id',
  ]);
  const glucoseUnit = glucoseUnitFromHeader(header[glucoseColumn] ?? '');
  const rateUnit =
    rateColumn >= 0
      ? rateUnitFromHeader(header[rateColumn] ?? '')
      : 'mg/dL/min';
  const safeFile = sourceFileName(fileName);
  const readings = new Map<number, GlucoseReading>();
  let skippedRows = 0;
  let duplicateRows = 0;
  let rowNumber = headerRow;

  for (const row of iterator) {
    rowNumber += 1;
    const eventType =
      eventTypeColumn >= 0
        ? normaliseHeader(row[eventTypeColumn] ?? '')
        : 'egv';
    if (
      eventType &&
      eventType !== 'egv' &&
      !eventType.includes('estimated glucose') &&
      !eventType.includes('sensor glucose')
    ) {
      continue;
    }
    const timestamp = parseGlookoTimestamp(row[timestampColumn]);
    const sourceValue = parseNumber(row[glucoseColumn]);
    if (
      timestamp === undefined ||
      sourceValue === undefined ||
      sourceValue <= 0
    ) {
      skippedRows += 1;
      continue;
    }
    const mmolL =
      glucoseUnit === 'mmol/L'
        ? sourceValue
        : sourceValue / MG_DL_PER_MMOL_L;
    if (mmolL < 1 || mmolL > 30) {
      skippedRows += 1;
      continue;
    }
    const sourceRate =
      rateColumn >= 0 ? parseNumber(row[rateColumn]) : undefined;
    const rateMgDlPerMinute =
      sourceRate === undefined
        ? undefined
        : rateUnit === 'mmol/L/min'
          ? sourceRate * MG_DL_PER_MMOL_L
          : sourceRate;
    const trend =
      trendFromText(trendColumn >= 0 ? row[trendColumn] : undefined) ??
      trendFromRate(rateMgDlPerMinute);
    if (readings.has(timestamp)) duplicateRows += 1;
    readings.set(timestamp, {
      id: `${DEXCOM_CGM_SOURCE_ID}:${timestamp}`,
      timestamp,
      receivedAt: importedAt,
      mmolL: Math.round(mmolL * 100) / 100,
      trend,
      quality: 'measured',
      sourceId: DEXCOM_CGM_SOURCE_ID,
      sourceLocalTimestamp: row[timestampColumn]?.trim() || undefined,
      importedAt,
      sourceFile: safeFile,
      sourceRow: rowNumber,
      sourceDeviceId:
        sourceDeviceColumn >= 0
          ? row[sourceDeviceColumn]?.trim() || undefined
          : undefined,
    });
  }

  const glucose = [...readings.values()].sort(
    (left, right) => left.timestamp - right.timestamp,
  );
  if (!glucose.length) {
    throw new Error(
      'No Dexcom estimated glucose rows could be read from this export.',
    );
  }
  const warnings: string[] = [];
  if (skippedRows) {
    warnings.push(
      `${skippedRows} glucose ${skippedRows === 1 ? 'row was' : 'rows were'} incomplete or outside the supported sensor range.`,
    );
  }
  if (duplicateRows) {
    warnings.push(
      `${duplicateRows} duplicate ${duplicateRows === 1 ? 'timestamp was' : 'timestamps were'} replaced by the last value in the export.`,
    );
  }
  return {
    glucose,
    warnings,
    skippedRows,
    duplicateRows,
    dataStart: glucose[0]?.timestamp,
    dataThrough: glucose[glucose.length - 1]?.timestamp,
  };
}
