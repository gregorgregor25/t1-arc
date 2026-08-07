import {
  ActivityEvent,
  BasalDelivery,
  BolusDelivery,
  ContextNoteEvent,
  GlucoseReading,
  HealthContextEvent,
  InsulinDailyTotal,
  MealEvent,
  MedicationEvent,
  MG_DL_PER_MMOL_L,
  TrendDirection,
} from '@/domain/models';
import {
  DateKey,
  toDateKey,
  zonedDateTimeToTimestamp,
} from '@/domain/time';
import { ImportRawRecord } from '@/data/persistence/HealthRecordStore';
import { DecodeUTF8, strFromU8 } from 'fflate';

export const GLOOKO_SOURCE_ID = 'glooko-export';
export const GLOOKO_CGM_SOURCE_ID = 'glooko-cgm';

export interface GlookoTextFile {
  name: string;
  text?: string;
  bytes?: Uint8Array;
  retainedOnly?: boolean;
  originalBytes?: number;
}

export interface GlookoRetainedFileSummary {
  name: string;
  originalBytes: number;
}

export interface GlookoFileSummary {
  name: string;
  kind:
    | 'cgm'
    | 'basal'
    | 'bolus'
    | 'meal'
    | 'activity'
    | 'medication'
    | 'note'
    | 'alarm'
    | 'blood-glucose'
    | 'manual-insulin'
    | 'daily-insulin';
  records: number;
  skippedRows: number;
}

export interface GlookoUnrecognisedFileSummary {
  name: string;
  headers: string[];
}

export interface GlookoImportPreview {
  glucose: GlucoseReading[];
  basal: BasalDelivery[];
  boluses: BolusDelivery[];
  dailyInsulinTotals: InsulinDailyTotal[];
  context: HealthContextEvent[];
  rawRecords: ImportRawRecord[];
  recognisedFiles: GlookoFileSummary[];
  retainedFiles: GlookoRetainedFileSummary[];
  ignoredFiles: string[];
  unrecognisedFiles: GlookoUnrecognisedFileSummary[];
  warnings: string[];
  skippedRows: number;
  duplicateRows: number;
  dataStart?: number;
  dataThrough?: number;
}

type SupportedFileKind = GlookoFileSummary['kind'];

const TIMESTAMP_ALIASES = [
  'timestamp',
  'date time',
  'date and time',
  'datetime',
  'device timestamp',
  'device time',
  'local timestamp',
  'local time',
  'event date',
  'recorded at',
  'time',
];
const BOLUS_DOSE_ALIASES = [
  'dose units',
  'dose',
  'delivered insulin units',
  'insulin delivered units',
  'insulin delivered',
  'delivered insulin',
  'bolus amount',
  'total insulin',
  'amount units',
];
const TOTAL_BASAL_ALIASES = [
  'total basal u',
  'total basal units',
  'basal total u',
  'basal insulin u',
];
const TOTAL_BOLUS_ALIASES = [
  'total bolus u',
  'total bolus units',
  'bolus total u',
  'bolus insulin u',
];
const TOTAL_INSULIN_ALIASES = [
  'total insulin u',
  'total insulin units',
  'daily insulin total u',
  'total daily dose u',
];
const INITIAL_DOSE_ALIASES = [
  'initial delivery units',
  'initial delivery',
  'bolus initial',
];
const EXTENDED_DOSE_ALIASES = [
  'extended delivery units',
  'extended delivery',
  'bolus extended',
];
const BASAL_RATE_ALIASES = [
  'basal rate units hr',
  'basal rate',
  'rate units hr',
  'rate',
];
const DURATION_ALIASES = [
  'duration min',
  'duration minutes',
  'duration',
];
const END_ALIASES = ['end timestamp', 'end time', 'ended at'];
const CARB_ALIASES = [
  'carbs g',
  'carbohydrate intake g',
  'carbs input g',
  'carbs input',
  'carbohydrates g',
  'carbohydrate g',
  'carbohydrates',
  'carbs',
];
const TITLE_ALIASES = [
  'title',
  'name',
  'food',
  'meal',
  'exercise',
  'medication',
  'description',
  'notes',
  'note',
  'type',
];
const NOTE_ALIASES = [
  'note',
  'notes',
  'comment',
  'comments',
  'description',
  'text',
  'value',
];
const TYPE_ALIASES = [
  'bolus type',
  'basal type',
  'insulin type',
  'delivery type',
  'type',
];
const INTENSITY_ALIASES = ['exercise intensity', 'intensity'];
const AMOUNT_ALIASES = [
  'amount',
  'dose',
  'dosage',
  'quantity',
  'medication amount',
];
const UNIT_ALIASES = ['unit', 'units', 'dose unit'];
const GLUCOSE_MMOL_ALIASES = [
  'glucose value mmol l',
  'cgm value mmol l',
  'value mmol l',
  'reading mmol l',
  'blood glucose mmol l',
  'glucose mmol l',
  'cgm glucose mmol l',
  'sensor glucose mmol l',
];
const GLUCOSE_MG_DL_ALIASES = [
  'glucose value mg dl',
  'cgm value mg dl',
  'value mg dl',
  'reading mg dl',
  'blood glucose mg dl',
  'glucose mg dl',
  'cgm glucose mg dl',
  'sensor glucose mg dl',
];
const GLUCOSE_GENERIC_ALIASES = [
  'glucose value',
  'cgm value',
  'glucose reading',
  'sensor reading',
  'sensor glucose',
  'cgm glucose',
  'glucose',
  'value',
];
const GLUCOSE_UNIT_ALIASES = ['glucose unit', 'glucose units', 'unit', 'units'];
const TREND_ALIASES = ['trend', 'trend arrow', 'direction'];
const DEVICE_ALIASES = [
  'serial number',
  'device serial number',
  'device id',
  'device',
];
const BLOOD_GLUCOSE_INPUT_ALIASES = [
  'blood glucose input mmol l',
  'blood glucose input',
  'bg input mmol l',
  'bg input',
];
const CARB_RATIO_ALIASES = [
  'carbs ratio',
  'carb ratio',
  'insulin carb ratio',
  'insulin to carb ratio',
];
const PERCENTAGE_ALIASES = [
  'percentage',
  'percentage percent',
  'percent',
];
const ALARM_EVENT_ALIASES = [
  'alarm event',
  'alarm',
  'event',
  'alarm name',
];
const ENERGY_ALIASES = ['calories', 'energy kcal', 'energy'];
const PROTEIN_ALIASES = ['protein', 'protein g'];
const FAT_ALIASES = ['fat', 'fat g', 'total fat'];
const SERVING_QUANTITY_ALIASES = [
  'serving quantity',
  'serving size',
];
const SERVING_COUNT_ALIASES = [
  'number of servings',
  'servings',
  'serving count',
];
const CALORIES_BURNED_ALIASES = [
  'calories burned',
  'energy burned',
];
const MEDICATION_TYPE_ALIASES = [
  'medication type',
  'medicine type',
];

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

function countDelimiter(line: string, delimiter: string) {
  let count = 0;
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    if (line[index] === '"') {
      if (quoted && line[index + 1] === '"') index += 1;
      else quoted = !quoted;
    } else if (!quoted && line[index] === delimiter) {
      count += 1;
    }
  }
  return count;
}

function detectDelimiter(text: string) {
  // Do not duplicate a multi-megabyte CGM export merely to inspect its header.
  const lines = text
    .slice(0, 64 * 1024)
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 8);
  const candidates = ['\t', ',', ';'];
  return candidates
    .map((delimiter) => ({
      delimiter,
      score: lines.reduce((sum, line) => {
        const count = countDelimiter(line, delimiter);
        return sum + (count > 0 ? 100 + count : 0);
      }, 0),
    }))
    .sort((a, b) => b.score - a.score)[0]?.delimiter ?? ',';
}

function createDelimitedRowParser(delimiter: string) {
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let pendingQuote = false;
  let skipLineFeed = false;

  const takeRow = () => {
    row.push(field.trim());
    field = '';
    const completed = row;
    row = [];
    return completed.some((value) => value.length > 0)
      ? completed
      : undefined;
  };

  const push = (text: string, final = false) => {
    const completedRows: string[][] = [];
    for (let index = 0; index < text.length; index += 1) {
      const character = text[index]!;
      if (skipLineFeed) {
        skipLineFeed = false;
        if (character === '\n') continue;
      }
      if (pendingQuote) {
        pendingQuote = false;
        if (character === '"') {
          field += '"';
          continue;
        }
        quoted = false;
      }
      if (quoted) {
        if (character === '"') pendingQuote = true;
        else if (character !== '\0') field += character;
      } else if (character === '"') {
        quoted = true;
      } else if (character === delimiter) {
        row.push(field.trim());
        field = '';
      } else if (character === '\n' || character === '\r') {
        if (character === '\r') skipLineFeed = true;
        const completed = takeRow();
        if (completed) completedRows.push(completed);
      } else if (character !== '\0') {
        field += character;
      }
    }
    if (final && (field.length || row.length)) {
      pendingQuote = false;
      const completed = takeRow();
      if (completed) completedRows.push(completed);
    }
    return completedRows;
  };

  return { push };
}

export function* parseDelimitedRows(input: string | Uint8Array) {
  const delimiter = detectDelimiter(
    typeof input === 'string'
      ? input
      : strFromU8(input.subarray(0, Math.min(input.byteLength, 64 * 1024))),
  );
  const parser = createDelimitedRowParser(delimiter);
  if (typeof input === 'string') {
    yield* parser.push(input, true);
    return;
  }

  const chunkBytes = 256 * 1024;
  const decodedChunks: string[] = [];
  const decoder = new DecodeUTF8((text) => decodedChunks.push(text));
  if (!input.byteLength) {
    yield* parser.push('', true);
    return;
  }
  for (let offset = 0; offset < input.byteLength; offset += chunkBytes) {
    const end = Math.min(input.byteLength, offset + chunkBytes);
    const final = end === input.byteLength;
    decoder.push(input.subarray(offset, end), final);
    while (decodedChunks.length) {
      const text = decodedChunks.shift()!;
      yield* parser.push(text, final && decodedChunks.length === 0);
    }
  }
  // Finalising an already-drained parser is harmless and also covers a
  // decoder implementation that emits no callback for an empty final chunk.
  yield* parser.push('', true);
}

export function parseDelimitedText(text: string) {
  return [...parseDelimitedRows(text)];
}

function parseNumber(value: string | undefined) {
  if (!value?.trim()) return undefined;
  let normalised = value.trim().replace(/\s/g, '').replace(/[^\d,.\-]/g, '');
  if (normalised.includes(',') && !normalised.includes('.')) {
    normalised = normalised.replace(',', '.');
  } else {
    normalised = normalised.replace(/,/g, '');
  }
  const number = Number(normalised);
  return Number.isFinite(number) ? number : undefined;
}

function timestampParts(value: string) {
  const trimmed = value.trim();
  const hour24 = (value: string | undefined, meridiem: string | undefined) => {
    const hour = Number(value ?? 0);
    if (!meridiem) return hour;
    if (hour < 1 || hour > 12) return Number.NaN;
    return (hour % 12) + (meridiem.toLowerCase() === 'pm' ? 12 : 0);
  };
  const iso = trimmed.match(
    /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)?)?$/i,
  );
  if (iso) {
    return {
      dateKey: `${iso[1]}-${String(iso[2]).padStart(2, '0')}-${String(
        iso[3],
      ).padStart(2, '0')}` as DateKey,
      hour: hour24(iso[4], iso[7]),
      minute: Number(iso[5] ?? 0),
      second: Number(iso[6] ?? 0),
    };
  }
  const dayFirst = trimmed.match(
    /^(\d{1,2})[/.](\d{1,2})[/.](\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)?)?$/i,
  );
  if (dayFirst) {
    return {
      dateKey: `${dayFirst[3]}-${String(dayFirst[2]).padStart(
        2,
        '0',
      )}-${String(dayFirst[1]).padStart(2, '0')}` as DateKey,
      hour: hour24(dayFirst[4], dayFirst[7]),
      minute: Number(dayFirst[5] ?? 0),
      second: Number(dayFirst[6] ?? 0),
    };
  }
  return undefined;
}

export function parseGlookoTimestamp(value: string | undefined) {
  if (!value?.trim()) return undefined;
  const trimmed = value.trim();
  if (
    /(?:Z|[+-]\d{2}:?\d{2})$/i.test(trimmed) ||
    /^[A-Za-z]{3},/.test(trimmed)
  ) {
    const parsed = Date.parse(trimmed);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  const parts = timestampParts(trimmed);
  if (!parts) return undefined;
  if (
    parts.hour < 0 ||
    parts.hour > 23 ||
    parts.minute < 0 ||
    parts.minute > 59 ||
    parts.second < 0 ||
    parts.second > 59
  ) {
    return undefined;
  }
  return zonedDateTimeToTimestamp(
    parts.dateKey,
    parts.hour,
    parts.minute,
    parts.second,
  );
}

function localHour(timestamp: number) {
  return Number(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/London',
      hour: '2-digit',
      hourCycle: 'h23',
    }).format(timestamp),
  );
}

function mealType(title: string, timestamp: number): MealEvent['mealType'] {
  const lower = title.toLowerCase();
  if (lower.includes('breakfast')) return 'breakfast';
  if (lower.includes('lunch')) return 'lunch';
  if (lower.includes('dinner') || lower.includes('evening meal')) return 'dinner';
  const hour = localHour(timestamp);
  if (hour < 10) return 'breakfast';
  if (hour < 15) return 'lunch';
  if (hour >= 17 && hour < 22) return 'dinner';
  return 'snack';
}

function activityType(value: string): ActivityEvent['activityType'] {
  const lower = value.toLowerCase();
  if (lower.includes('walk')) return 'walk';
  if (lower.includes('run') || lower.includes('jog')) return 'run';
  if (lower.includes('cycl') || lower.includes('bike')) return 'cycle';
  if (
    lower.includes('strength') ||
    lower.includes('weight') ||
    lower.includes('resistance')
  ) {
    return 'strength';
  }
  return 'other';
}

function intensity(value: string): ActivityEvent['intensity'] {
  const lower = value.toLowerCase();
  if (lower.includes('high') || lower.includes('vigorous')) return 'vigorous';
  if (lower.includes('low') || lower.includes('light')) return 'light';
  return 'moderate';
}

function safeName(value: string) {
  return value.split(/[\\/]/).pop()?.trim() || 'glooko.csv';
}

function fingerprint(parts: Array<string | number | undefined>) {
  const text = parts.map((part) => String(part ?? '')).join('|');
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    first = Math.imul(first ^ code, 0x01000193) >>> 0;
    second = Math.imul(second ^ code, 0x85ebca6b) >>> 0;
  }
  return `${first.toString(16).padStart(8, '0')}${second
    .toString(16)
    .padStart(8, '0')}`;
}

function recordId(
  kind:
    | 'basal'
    | 'bolus'
    | 'meal'
    | 'activity'
    | 'medication'
    | 'note'
    | 'daily-insulin',
  timestamp: number,
  parts: Array<string | number | undefined>,
) {
  return `${GLOOKO_SOURCE_ID}:${kind}:${timestamp}:${fingerprint(parts)}`;
}

function rawRecordKind(name: string) {
  const lower = safeName(name).toLowerCase();
  if (lower.includes('cgm_carbs')) return 'cgm-carbohydrate';
  if (isGlookoCgmFileName(lower)) return 'cgm';
  if (lower.includes('alarm')) return 'alarm';
  if (/^bg[_-]/.test(lower)) return 'blood-glucose';
  if (lower.includes('manual_insulin') || lower.includes('manual-insulin')) {
    return 'manual-insulin';
  }
  if (lower.includes('basal')) return 'basal';
  if (lower.includes('bolus')) return 'bolus';
  if (lower.includes('insulin_data') || lower.includes('insulin-data')) {
    return 'daily-insulin';
  }
  if (lower.includes('exercise') || lower.includes('activity')) return 'activity';
  if (lower.includes('food')) return 'meal';
  if (lower.includes('medication')) return 'medication';
  if (lower.includes('note')) return 'note';
  return 'other';
}

function rawRecord(
  fileName: string,
  headers: string[],
  row: string[],
  sourceRow: number,
  importedAt: number,
): ImportRawRecord | undefined {
  if (!row.some((value) => value.trim())) return undefined;
  const values = headers.map((_, index) => row[index] ?? '');
  const kind = rawRecordKind(fileName);
  const timestamp = parseGlookoTimestamp(
    valueAt(row, findColumn(headers, TIMESTAMP_ALIASES)),
  );
  return {
    id: `${GLOOKO_SOURCE_ID}:raw:${kind}:${fingerprint([
      ...headers.map(normaliseHeader),
      ...values,
    ])}`,
    sourceId: GLOOKO_SOURCE_ID,
    recordKind: kind,
    timestamp,
    sourceFile: fileName,
    sourceRow,
    payloadJson: JSON.stringify({ headers, values }),
    importedAt,
  };
}

function classifyFile(name: string, headers?: string[]): SupportedFileKind | undefined {
  const lower = safeName(name).toLowerCase();
  if (isGlookoCgmFileName(lower)) return 'cgm';
  if (lower.includes('manual_insulin') || lower.includes('manual-insulin')) {
    return 'manual-insulin';
  }
  if (/^bg[_-]/.test(lower)) return 'blood-glucose';
  // Glooko aggregate totals are verification records, never delivered boluses.
  if (lower.includes('insulin_data') || lower.includes('insulin-data')) {
    return 'daily-insulin';
  }
  if (lower.includes('basal')) return 'basal';
  if (lower.includes('bolus')) return 'bolus';
  if (lower.includes('exercise') || lower.includes('activity')) return 'activity';
  if (lower.includes('food') || lower.includes('carb')) return 'meal';
  if (lower.includes('medication')) return 'medication';
  if (lower.includes('note')) return 'note';
  if (lower.includes('alarm')) return 'alarm';
  if (isExplicitlyIgnoredGlookoFileName(lower)) {
    return undefined;
  }
  if (!headers) return undefined;
  // Aggregate files often contain columns named "Total Bolus" and
  // "Total Basal". Detect the overall total first so those columns can never
  // cause a daily summary row to be normalised as a delivered event.
  if (findColumn(headers, TOTAL_INSULIN_ALIASES) >= 0) return 'daily-insulin';
  if (findColumn(headers, BASAL_RATE_ALIASES) >= 0) return 'basal';
  if (findColumn(headers, BOLUS_DOSE_ALIASES) >= 0) return 'bolus';
  if (findColumn(headers, INTENSITY_ALIASES) >= 0) return 'activity';
  if (findColumn(headers, CARB_ALIASES) >= 0) return 'meal';
  if (findColumn(headers, NOTE_ALIASES) >= 0) return 'note';
  return undefined;
}

export function isExplicitlyIgnoredGlookoFileName(name: string) {
  const lower = safeName(name).toLowerCase();
  return (
    lower.includes('alarm') ||
    lower.includes('manual_insulin') ||
    lower.includes('manual-insulin') ||
    /^bg[_-]/.test(lower)
  );
}

export function isGlookoCgmFileName(name: string) {
  const lower = safeName(name).toLowerCase();
  return lower.includes('cgm') && !lower.includes('cgm_carbs');
}

function findHeaderIndex(rows: string[][], hintedKind?: SupportedFileKind) {
  return rows.slice(0, 12).findIndex((row) => {
    if (findColumn(row, TIMESTAMP_ALIASES) < 0) return false;
    const kind = hintedKind ?? classifyFile('unknown.csv', row);
    return kind !== undefined;
  });
}

function valueAt(row: string[], index: number) {
  return index >= 0 ? row[index]?.trim() ?? '' : '';
}

function validDose(value: number | undefined) {
  return value !== undefined && value > 0 && value <= 500;
}

function cgmTrend(value: string): TrendDirection {
  const normalised = value.toLowerCase().replace(/[\s_-]+/g, '');
  if (
    normalised.includes('doubledown') ||
    normalised.includes('rapidlyfalling') ||
    value.includes('⇊') ||
    value.includes('↓↓')
  ) {
    return 'doubleDown';
  }
  if (
    normalised.includes('fortyfivedown') ||
    normalised.includes('slightdown') ||
    normalised.includes('gentlyfalling') ||
    value.includes('↘')
  ) {
    return 'slightDown';
  }
  if (
    normalised === 'down' ||
    normalised.includes('singledown') ||
    normalised.includes('falling') ||
    value.includes('↓')
  ) {
    return 'down';
  }
  if (
    normalised.includes('doubleup') ||
    normalised.includes('rapidlyrising') ||
    value.includes('⇈') ||
    value.includes('↑↑')
  ) {
    return 'doubleUp';
  }
  if (
    normalised.includes('fortyfiveup') ||
    normalised.includes('slightup') ||
    normalised.includes('gentlyrising') ||
    value.includes('↗')
  ) {
    return 'slightUp';
  }
  if (
    normalised === 'up' ||
    normalised.includes('singleup') ||
    normalised.includes('rising') ||
    value.includes('↑')
  ) {
    return 'up';
  }
  if (
    normalised.includes('flat') ||
    normalised.includes('steady') ||
    value.includes('→')
  ) {
    return 'flat';
  }
  return 'unknown';
}

function parseCgmTextFile(
  fileName: string,
  input: string | Uint8Array,
  importedAt: number,
) {
  let headers: string[] | undefined;
  let headerRowNumber = 0;
  let rowNumber = 0;
  let skipped = 0;
  const glucose: GlucoseReading[] = [];
  const rawRecords: ImportRawRecord[] = [];
  let timestampColumn = -1;
  let mmolColumn = -1;
  let mgColumn = -1;
  let genericColumn = -1;
  let unitColumn = -1;
  let trendColumn = -1;
  let deviceColumn = -1;

  for (const row of parseDelimitedRows(input)) {
    rowNumber += 1;
    if (!headers) {
      const possibleTimestamp = findColumn(row, TIMESTAMP_ALIASES);
      const possibleMmol = findColumn(row, GLUCOSE_MMOL_ALIASES);
      const possibleMg = findColumn(row, GLUCOSE_MG_DL_ALIASES);
      const possibleGeneric = findColumn(row, GLUCOSE_GENERIC_ALIASES);
      if (
        possibleTimestamp >= 0 &&
        (possibleMmol >= 0 || possibleMg >= 0 || possibleGeneric >= 0)
      ) {
        headers = row;
        headerRowNumber = rowNumber;
        timestampColumn = possibleTimestamp;
        mmolColumn = possibleMmol;
        mgColumn = possibleMg;
        genericColumn = possibleGeneric;
        unitColumn = findColumn(row, GLUCOSE_UNIT_ALIASES);
        trendColumn = findColumn(row, TREND_ALIASES);
        deviceColumn = findColumn(row, DEVICE_ALIASES);
      } else if (rowNumber >= 12) {
        break;
      }
      continue;
    }

    const rawTimestamp = valueAt(row, timestampColumn);
    const exact = rawRecord(
      fileName,
      headers,
      row,
      rowNumber,
      importedAt,
    );
    if (exact) rawRecords.push(exact);
    const timestamp = parseGlookoTimestamp(rawTimestamp);
    let mmolL: number | undefined;
    if (mmolColumn >= 0) {
      mmolL = parseNumber(valueAt(row, mmolColumn));
    } else if (mgColumn >= 0) {
      const mgDl = parseNumber(valueAt(row, mgColumn));
      mmolL = mgDl === undefined ? undefined : mgDl / MG_DL_PER_MMOL_L;
    } else {
      const value = parseNumber(valueAt(row, genericColumn));
      const unit = valueAt(row, unitColumn).toLowerCase();
      const expressedAsMg =
        unit.includes('mg') ||
        (!unit.includes('mmol') && value !== undefined && value > 40);
      mmolL =
        value === undefined
          ? undefined
          : expressedAsMg
            ? value / MG_DL_PER_MMOL_L
            : value;
    }

    if (
      timestamp === undefined ||
      mmolL === undefined ||
      mmolL < 1 ||
      mmolL > 40
    ) {
      if (row.some(Boolean)) skipped += 1;
      continue;
    }
    const device = valueAt(row, deviceColumn);
    const rawValue =
      valueAt(
        row,
        mmolColumn >= 0
          ? mmolColumn
          : mgColumn >= 0
            ? mgColumn
            : genericColumn,
      ) || '';
    glucose.push({
      id: `${GLOOKO_CGM_SOURCE_ID}:${timestamp}`,
      timestamp,
      receivedAt: importedAt,
      mmolL: Math.round(mmolL * 100) / 100,
      trend: cgmTrend(valueAt(row, trendColumn)),
      quality: /[<>]/.test(rawValue) ? 'estimated' : 'measured',
      sourceId: GLOOKO_CGM_SOURCE_ID,
      importedAt,
      sourceFile: fileName,
      sourceRow: rowNumber,
      sourceDeviceId: device || undefined,
      sourceLocalTimestamp: rawTimestamp || undefined,
    });
  }

  return {
    glucose,
    rawRecords,
    headers,
    headerRowNumber,
    skipped,
  };
}

function parseBolusRows(
  fileName: string,
  headers: string[],
  rows: string[][],
  firstRowNumber: number,
  importedAt: number,
) {
  const timestampColumn = findColumn(headers, TIMESTAMP_ALIASES);
  const doseColumn = findColumn(headers, BOLUS_DOSE_ALIASES);
  const initialColumn = findColumn(headers, INITIAL_DOSE_ALIASES);
  const extendedColumn = findColumn(headers, EXTENDED_DOSE_ALIASES);
  const carbsColumn = findColumn(headers, CARB_ALIASES);
  const typeColumn = findColumn(headers, TYPE_ALIASES);
  const notesColumn = findColumn(headers, ['notes', 'comment', 'description']);
  const bloodGlucoseColumn = findColumn(
    headers,
    BLOOD_GLUCOSE_INPUT_ALIASES,
  );
  const carbRatioColumn = findColumn(headers, CARB_RATIO_ALIASES);
  const deviceColumn = findColumn(headers, DEVICE_ALIASES);
  const boluses: BolusDelivery[] = [];
  const context: MealEvent[] = [];
  let skipped = 0;

  rows.forEach((row, index) => {
    const timestamp = parseGlookoTimestamp(valueAt(row, timestampColumn));
    const directDose = parseNumber(valueAt(row, doseColumn));
    const componentDose =
      (parseNumber(valueAt(row, initialColumn)) ?? 0) +
      (parseNumber(valueAt(row, extendedColumn)) ?? 0);
    const dose = directDose ?? (componentDose > 0 ? componentDose : undefined);
    const carbs = parseNumber(valueAt(row, carbsColumn));
    const deliveryType = valueAt(row, typeColumn);
    const note = valueAt(row, notesColumn);
    const bloodGlucoseInput = parseNumber(
      valueAt(row, bloodGlucoseColumn),
    );
    const carbRatio = parseNumber(valueAt(row, carbRatioColumn));
    const initialUnits = parseNumber(valueAt(row, initialColumn));
    const extendedUnits = parseNumber(valueAt(row, extendedColumn));
    const sourceDeviceId = valueAt(row, deviceColumn);
    const sourceRow = firstRowNumber + index;
    let accepted = false;

    if (timestamp !== undefined && validDose(dose)) {
      boluses.push({
        id: recordId('bolus', timestamp, [
          dose!.toFixed(4),
          deliveryType,
          componentDose.toFixed(4),
        ]),
        timestamp,
        units: dose!,
        deliveryType: deliveryType || undefined,
        bloodGlucoseInputMmolL: bloodGlucoseInput,
        carbsInputGrams: carbs,
        carbRatioGramsPerUnit: carbRatio,
        initialUnits,
        extendedUnits,
        sourceId: GLOOKO_SOURCE_ID,
        importedAt,
        sourceFile: fileName,
        sourceRow,
        sourceDeviceId: sourceDeviceId || undefined,
      });
      accepted = true;
    }

    if (
      timestamp !== undefined &&
      carbs !== undefined &&
      carbs > 0 &&
      carbs <= 1000
    ) {
      const title = note || 'Pump carbohydrate entry';
      context.push({
        id: recordId('meal', timestamp, [carbs.toFixed(2), title, 'pump-entry']),
        kind: 'meal',
        start: timestamp,
        title,
        mealType: mealType(title, timestamp),
        carbsGrams: Math.round(carbs * 10) / 10,
        sourceId: GLOOKO_SOURCE_ID,
        origin: 'imported',
        recordedAt: importedAt,
        sourceFile: fileName,
        sourceRow,
      });
      accepted = true;
    }

    if (!accepted && row.some(Boolean)) skipped += 1;
  });
  return { boluses, context, skipped };
}

function parseBasalRows(
  fileName: string,
  headers: string[],
  rows: string[][],
  firstRowNumber: number,
  importedAt: number,
) {
  const timestampColumn = findColumn(headers, TIMESTAMP_ALIASES);
  const endColumn = findColumn(headers, END_ALIASES);
  const durationColumn = findColumn(headers, DURATION_ALIASES);
  const rateColumn = findColumn(headers, BASAL_RATE_ALIASES);
  const unitsColumn = findColumn(headers, [
    'delivered insulin units',
    'insulin delivered units',
    'delivered insulin',
    'basal amount',
  ]);
  const typeColumn = findColumn(headers, TYPE_ALIASES);
  const percentageColumn = findColumn(headers, PERCENTAGE_ALIASES);
  const deviceColumn = findColumn(headers, DEVICE_ALIASES);
  const parsedTimes = rows.map((row) =>
    parseGlookoTimestamp(valueAt(row, timestampColumn)),
  );
  const basal: BasalDelivery[] = [];
  let skipped = 0;

  rows.forEach((row, index) => {
    const start = parsedTimes[index];
    const explicitEnd = parseGlookoTimestamp(valueAt(row, endColumn));
    let duration = parseNumber(valueAt(row, durationColumn));
    if (
      (duration === undefined || duration <= 0) &&
      explicitEnd !== undefined &&
      start !== undefined
    ) {
      duration = (explicitEnd - start) / 60_000;
    }
    if (duration === undefined || duration <= 0) {
      const next = parsedTimes[index + 1];
      if (
        start !== undefined &&
        next !== undefined &&
        next > start &&
        next - start <= 24 * 60 * 60 * 1000
      ) {
        duration = (next - start) / 60_000;
      }
    }
    const rate = parseNumber(valueAt(row, rateColumn));
    const delivered = parseNumber(valueAt(row, unitsColumn));
    const deliveryType = valueAt(row, typeColumn);
    const percentage = parseNumber(valueAt(row, percentageColumn));
    const sourceDeviceId = valueAt(row, deviceColumn);
    if (
      start === undefined ||
      rate === undefined ||
      rate < 0 ||
      rate > 50 ||
      duration === undefined ||
      duration <= 0 ||
      duration > 1440
    ) {
      if (row.some(Boolean)) skipped += 1;
      return;
    }
    const end = explicitEnd ?? start + duration * 60_000;
    const units = delivered ?? (rate * duration) / 60;
    if (!Number.isFinite(units) || units < 0 || units > 500 || end <= start) {
      skipped += 1;
      return;
    }
    const sourceRow = firstRowNumber + index;
    basal.push({
      id: recordId('basal', start, [
        end,
        rate.toFixed(5),
        units.toFixed(5),
      ]),
      start,
      end,
      rateUnitsPerHour: rate,
      units,
      deliveryType: deliveryType || undefined,
      percentage,
      unitsEstimated: delivered === undefined,
      sourceId: GLOOKO_SOURCE_ID,
      importedAt,
      sourceFile: fileName,
      sourceRow,
      sourceDeviceId: sourceDeviceId || undefined,
    });
  });
  return { basal, skipped };
}

function parseMealRows(
  fileName: string,
  headers: string[],
  rows: string[][],
  firstRowNumber: number,
  importedAt: number,
) {
  const timestampColumn = findColumn(headers, TIMESTAMP_ALIASES);
  const carbsColumn = findColumn(headers, CARB_ALIASES);
  const titleColumn = findColumn(headers, TITLE_ALIASES);
  const energyColumn = findColumn(headers, ENERGY_ALIASES);
  const proteinColumn = findColumn(headers, PROTEIN_ALIASES);
  const fatColumn = findColumn(headers, FAT_ALIASES);
  const servingQuantityColumn = findColumn(
    headers,
    SERVING_QUANTITY_ALIASES,
  );
  const servingCountColumn = findColumn(headers, SERVING_COUNT_ALIASES);
  const events: MealEvent[] = [];
  let skipped = 0;
  rows.forEach((row, index) => {
    const timestamp = parseGlookoTimestamp(valueAt(row, timestampColumn));
    const carbs = parseNumber(valueAt(row, carbsColumn));
    if (
      timestamp === undefined ||
      carbs === undefined ||
      carbs < 0 ||
      carbs > 1000
    ) {
      if (row.some(Boolean)) skipped += 1;
      return;
    }
    const title = valueAt(row, titleColumn) || 'Imported meal';
    events.push({
      id: recordId('meal', timestamp, [
        carbs.toFixed(2),
        title,
        valueAt(row, energyColumn),
        valueAt(row, proteinColumn),
        valueAt(row, fatColumn),
        valueAt(row, servingQuantityColumn),
        valueAt(row, servingCountColumn),
      ]),
      kind: 'meal',
      start: timestamp,
      title,
      mealType: mealType(title, timestamp),
      carbsGrams: Math.round(carbs * 10) / 10,
      energyKcal: parseNumber(valueAt(row, energyColumn)),
      proteinGrams: parseNumber(valueAt(row, proteinColumn)),
      fatGrams: parseNumber(valueAt(row, fatColumn)),
      servingQuantity: parseNumber(valueAt(row, servingQuantityColumn)),
      servingCount: parseNumber(valueAt(row, servingCountColumn)),
      sourceId: GLOOKO_SOURCE_ID,
      origin: 'imported',
      recordedAt: importedAt,
      sourceFile: fileName,
      sourceRow: firstRowNumber + index,
    });
  });
  return { events, skipped };
}

function parseActivityRows(
  fileName: string,
  headers: string[],
  rows: string[][],
  firstRowNumber: number,
  importedAt: number,
) {
  const timestampColumn = findColumn(headers, TIMESTAMP_ALIASES);
  const durationColumn = findColumn(headers, DURATION_ALIASES);
  const titleColumn = findColumn(headers, TITLE_ALIASES);
  const intensityColumn = findColumn(headers, INTENSITY_ALIASES);
  const caloriesBurnedColumn = findColumn(
    headers,
    CALORIES_BURNED_ALIASES,
  );
  const events: ActivityEvent[] = [];
  let skipped = 0;
  rows.forEach((row, index) => {
    const timestamp = parseGlookoTimestamp(valueAt(row, timestampColumn));
    const duration = parseNumber(valueAt(row, durationColumn));
    if (
      timestamp === undefined ||
      duration === undefined ||
      duration <= 0 ||
      duration > 1440
    ) {
      if (row.some(Boolean)) skipped += 1;
      return;
    }
    const title = valueAt(row, titleColumn) || 'Imported activity';
    const intensityValue = valueAt(row, intensityColumn);
    events.push({
      id: recordId('activity', timestamp, [
        duration.toFixed(2),
        title,
        intensityValue,
        valueAt(row, caloriesBurnedColumn),
      ]),
      kind: 'activity',
      start: timestamp,
      end: timestamp + duration * 60_000,
      title,
      activityType: activityType(title),
      durationMinutes: Math.round(duration),
      intensity: intensity(intensityValue),
      caloriesBurned: parseNumber(valueAt(row, caloriesBurnedColumn)),
      sourceId: GLOOKO_SOURCE_ID,
      origin: 'imported',
      recordedAt: importedAt,
      sourceFile: fileName,
      sourceRow: firstRowNumber + index,
    });
  });
  return { events, skipped };
}

function parseMedicationRows(
  fileName: string,
  headers: string[],
  rows: string[][],
  firstRowNumber: number,
  importedAt: number,
) {
  const timestampColumn = findColumn(headers, TIMESTAMP_ALIASES);
  const titleColumn = findColumn(headers, TITLE_ALIASES);
  const amountColumn = findColumn(headers, AMOUNT_ALIASES);
  const unitColumn = findColumn(headers, UNIT_ALIASES);
  const medicationTypeColumn = findColumn(
    headers,
    MEDICATION_TYPE_ALIASES,
  );
  const events: MedicationEvent[] = [];
  let skipped = 0;
  rows.forEach((row, index) => {
    const timestamp = parseGlookoTimestamp(valueAt(row, timestampColumn));
    const title = valueAt(row, titleColumn);
    if (timestamp === undefined || !title) {
      if (row.some(Boolean)) skipped += 1;
      return;
    }
    const amount = parseNumber(valueAt(row, amountColumn));
    const unit = valueAt(row, unitColumn) || undefined;
    events.push({
      id: recordId('medication', timestamp, [
        title,
        amount?.toFixed(4),
        unit,
        valueAt(row, medicationTypeColumn),
      ]),
      kind: 'medication',
      start: timestamp,
      title,
      amount,
      unit,
      medicationType:
        valueAt(row, medicationTypeColumn) || undefined,
      sourceId: GLOOKO_SOURCE_ID,
      origin: 'imported',
      recordedAt: importedAt,
      sourceFile: fileName,
      sourceRow: firstRowNumber + index,
    });
  });
  return { events, skipped };
}

function parseNoteRows(
  fileName: string,
  headers: string[],
  rows: string[][],
  firstRowNumber: number,
  importedAt: number,
) {
  const timestampColumn = findColumn(headers, TIMESTAMP_ALIASES);
  const noteColumn = findColumn(headers, NOTE_ALIASES);
  const events: ContextNoteEvent[] = [];
  let skipped = 0;
  rows.forEach((row, index) => {
    const timestamp = parseGlookoTimestamp(valueAt(row, timestampColumn));
    const sourceText = valueAt(row, noteColumn).replace(/\s+/g, ' ').trim();
    if (timestamp === undefined || !sourceText) {
      if (row.some(Boolean)) skipped += 1;
      return;
    }
    const detail =
      sourceText.length > 2_000
        ? `${sourceText.slice(0, 1_999).trimEnd()}…`
        : sourceText;
    const title =
      detail.length > 80 ? `${detail.slice(0, 79).trimEnd()}…` : detail;
    events.push({
      id: recordId('note', timestamp, [sourceText]),
      kind: 'note',
      start: timestamp,
      title,
      category: 'other',
      detail,
      sourceId: GLOOKO_SOURCE_ID,
      origin: 'imported',
      recordedAt: importedAt,
      sourceFile: fileName,
      sourceRow: firstRowNumber + index,
    });
  });
  return { events, skipped };
}

function parseAlarmRows(
  fileName: string,
  headers: string[],
  rows: string[][],
  firstRowNumber: number,
  importedAt: number,
) {
  const timestampColumn = findColumn(headers, TIMESTAMP_ALIASES);
  const eventColumn = findColumn(headers, ALARM_EVENT_ALIASES);
  const events: ContextNoteEvent[] = [];
  let skipped = 0;
  rows.forEach((row, index) => {
    const timestamp = parseGlookoTimestamp(valueAt(row, timestampColumn));
    const title = valueAt(row, eventColumn).replace(/\s+/g, ' ').trim();
    if (timestamp === undefined || !title) {
      if (row.some(Boolean)) skipped += 1;
      return;
    }
    const lower = title.toLowerCase();
    const category: ContextNoteEvent['category'] =
      /(pod|pdm|insulin|delivery|automated|activity|manual mode)/.test(lower)
        ? 'pump'
        : /(cgm|sensor|glucose)/.test(lower)
          ? 'sensor'
          : 'other';
    events.push({
      id: recordId('note', timestamp, [title, category, 'glooko-alarm']),
      kind: 'note',
      start: timestamp,
      title,
      category,
      detail: 'Recorded by Glooko from the connected diabetes device.',
      sourceId: GLOOKO_SOURCE_ID,
      origin: 'imported',
      recordedAt: importedAt,
      sourceFile: fileName,
      sourceRow: firstRowNumber + index,
    });
  });
  return { events, skipped };
}

function parseBloodGlucoseRows(
  fileName: string,
  headers: string[],
  rows: string[][],
  firstRowNumber: number,
  importedAt: number,
) {
  const timestampColumn = findColumn(headers, TIMESTAMP_ALIASES);
  const mmolColumn = findColumn(headers, GLUCOSE_MMOL_ALIASES);
  const genericColumn = findColumn(headers, GLUCOSE_GENERIC_ALIASES);
  const manualColumn = findColumn(headers, ['manual reading', 'manual']);
  const deviceColumn = findColumn(headers, DEVICE_ALIASES);
  const events: ContextNoteEvent[] = [];
  let skipped = 0;
  rows.forEach((row, index) => {
    const timestamp = parseGlookoTimestamp(valueAt(row, timestampColumn));
    const value = parseNumber(
      valueAt(row, mmolColumn >= 0 ? mmolColumn : genericColumn),
    );
    if (
      timestamp === undefined ||
      value === undefined ||
      value <= 0 ||
      value > 60
    ) {
      if (row.some(Boolean)) skipped += 1;
      return;
    }
    const rounded = Math.round(value * 10) / 10;
    const manual = valueAt(row, manualColumn);
    const device = valueAt(row, deviceColumn);
    events.push({
      id: recordId('note', timestamp, [
        'blood-glucose-check',
        rounded,
        manual,
        device,
      ]),
      kind: 'note',
      start: timestamp,
      title: `Blood glucose check · ${rounded.toFixed(1)} mmol/L`,
      category: 'other',
      detail: [
        manual ? `Manual reading: ${manual}` : undefined,
        device ? 'Source device recorded by Glooko' : undefined,
      ]
        .filter(Boolean)
        .join(' · '),
      sourceId: GLOOKO_SOURCE_ID,
      origin: 'imported',
      recordedAt: importedAt,
      sourceFile: fileName,
      sourceRow: firstRowNumber + index,
    });
  });
  return { events, skipped };
}

function parseManualInsulinRows(
  fileName: string,
  headers: string[],
  rows: string[][],
  firstRowNumber: number,
  importedAt: number,
) {
  const timestampColumn = findColumn(headers, TIMESTAMP_ALIASES);
  const titleColumn = findColumn(headers, TITLE_ALIASES);
  const valueColumn = findColumn(headers, ['value', ...AMOUNT_ALIASES]);
  const typeColumn = findColumn(headers, TYPE_ALIASES);
  const events: MedicationEvent[] = [];
  let skipped = 0;
  rows.forEach((row, index) => {
    const timestamp = parseGlookoTimestamp(valueAt(row, timestampColumn));
    const amount = parseNumber(valueAt(row, valueColumn));
    const name = valueAt(row, titleColumn) || 'Manual insulin';
    const insulinType = valueAt(row, typeColumn);
    if (
      timestamp === undefined ||
      amount === undefined ||
      amount <= 0 ||
      amount > 500
    ) {
      if (row.some(Boolean)) skipped += 1;
      return;
    }
    events.push({
      id: recordId('medication', timestamp, [
        'manual-insulin',
        name,
        amount,
        insulinType,
      ]),
      kind: 'medication',
      start: timestamp,
      title: name,
      amount,
      unit: 'U',
      medicationType: insulinType || 'Insulin',
      sourceId: GLOOKO_SOURCE_ID,
      origin: 'imported',
      recordedAt: importedAt,
      sourceFile: fileName,
      sourceRow: firstRowNumber + index,
    });
  });
  return { events, skipped };
}

function parseDailyInsulinRows(
  fileName: string,
  headers: string[],
  rows: string[][],
  firstRowNumber: number,
  importedAt: number,
) {
  const timestampColumn = findColumn(headers, TIMESTAMP_ALIASES);
  const basalColumn = findColumn(headers, TOTAL_BASAL_ALIASES);
  const bolusColumn = findColumn(headers, TOTAL_BOLUS_ALIASES);
  const totalColumn = findColumn(headers, TOTAL_INSULIN_ALIASES);
  const deviceColumn = findColumn(headers, DEVICE_ALIASES);
  const totals: InsulinDailyTotal[] = [];
  let skipped = 0;
  rows.forEach((row, index) => {
    const timestamp = parseGlookoTimestamp(valueAt(row, timestampColumn));
    const basalUnits = parseNumber(valueAt(row, basalColumn));
    const bolusUnits = parseNumber(valueAt(row, bolusColumn));
    const reportedTotal = parseNumber(valueAt(row, totalColumn));
    const totalUnits =
      reportedTotal ??
      (basalUnits !== undefined && bolusUnits !== undefined
        ? basalUnits + bolusUnits
        : undefined);
    const values = [basalUnits, bolusUnits, totalUnits].filter(
      (value): value is number => value !== undefined,
    );
    if (
      timestamp === undefined ||
      totalUnits === undefined ||
      !values.every((value) => value >= 0 && value <= 500)
    ) {
      if (row.some(Boolean)) skipped += 1;
      return;
    }
    totals.push({
      id: recordId('daily-insulin', timestamp, [
        basalUnits?.toFixed(4),
        bolusUnits?.toFixed(4),
        totalUnits.toFixed(4),
      ]),
      timestamp,
      dateKey: toDateKey(timestamp),
      basalUnits:
        basalUnits === undefined ? undefined : Math.round(basalUnits * 100) / 100,
      bolusUnits:
        bolusUnits === undefined ? undefined : Math.round(bolusUnits * 100) / 100,
      totalUnits: Math.round(totalUnits * 100) / 100,
      sourceId: GLOOKO_SOURCE_ID,
      importedAt,
      sourceFile: fileName,
      sourceRow: firstRowNumber + index,
      sourceDeviceId: valueAt(row, deviceColumn) || undefined,
    });
  });
  return { totals, skipped };
}

function uniqueById<T extends { id: string }>(records: T[]) {
  const unique = new Map<string, T>();
  let duplicates = 0;
  records.forEach((record) => {
    if (unique.has(record.id)) duplicates += 1;
    else unique.set(record.id, record);
  });
  return { records: [...unique.values()], duplicates };
}

export function parseGlookoTextFiles(
  files: GlookoTextFile[],
  importedAt = Date.now(),
): GlookoImportPreview {
  const glucose: GlucoseReading[] = [];
  const basal: BasalDelivery[] = [];
  const boluses: BolusDelivery[] = [];
  const dailyInsulinTotals: InsulinDailyTotal[] = [];
  const context: HealthContextEvent[] = [];
  const rawRecords: ImportRawRecord[] = [];
  const recognisedFiles: GlookoFileSummary[] = [];
  const retainedFiles: GlookoRetainedFileSummary[] = [];
  const ignoredFiles: string[] = [];
  const unrecognisedFiles: GlookoUnrecognisedFileSummary[] = [];
  const warnings: string[] = [];
  let skippedRows = 0;

  files.forEach((input) => {
    const name = safeName(input.name);
    if (input.retainedOnly) {
      retainedFiles.push({
        name,
        originalBytes: input.originalBytes ?? 0,
      });
      return;
    }
    if (!name.toLowerCase().endsWith('.csv')) {
      ignoredFiles.push(name);
      return;
    }
    if (isGlookoCgmFileName(name)) {
      const parsed = parseCgmTextFile(
        name,
        input.bytes ?? input.text ?? '',
        importedAt,
      );
      if (!parsed.headers) {
        ignoredFiles.push(name);
        unrecognisedFiles.push({ name, headers: [] });
        warnings.push(`${name}: no supported CGM table header was found.`);
        return;
      }
      glucose.push(...parsed.glucose);
      rawRecords.push(...parsed.rawRecords);
      recognisedFiles.push({
        name,
        kind: 'cgm',
        records: parsed.glucose.length,
        skippedRows: parsed.skipped,
      });
      skippedRows += parsed.skipped;
      if (parsed.skipped > 0) {
        warnings.push(
          `${name}: ${parsed.skipped} row${
            parsed.skipped === 1 ? '' : 's'
          } could not be normalised.`,
        );
      }
      return;
    }
    const rows = parseDelimitedText(
      (input.text ?? (input.bytes ? strFromU8(input.bytes) : '')).replace(
        /\0/g,
        '',
      ),
    );
    const rawHeaderIndex = rows
      .slice(0, 12)
      .findIndex((row) => findColumn(row, TIMESTAMP_ALIASES) >= 0);
    if (rawHeaderIndex >= 0) {
      const rawHeaders = rows[rawHeaderIndex]!;
      rows.slice(rawHeaderIndex + 1).forEach((row, index) => {
        const exact = rawRecord(
          name,
          rawHeaders,
          row,
          rawHeaderIndex + index + 2,
          importedAt,
        );
        if (exact) rawRecords.push(exact);
      });
    }
    const hint = classifyFile(name);
    const headerIndex = findHeaderIndex(rows, hint);
    if (headerIndex < 0) {
      ignoredFiles.push(name);
      const possibleHeaders =
        rows
          .slice(0, 12)
          .find((row) => findColumn(row, TIMESTAMP_ALIASES) >= 0) ?? [];
      unrecognisedFiles.push({
        name,
        headers: possibleHeaders.slice(0, 10),
      });
      if (hint) warnings.push(`${name}: no supported table header was found.`);
      return;
    }
    const headers = rows[headerIndex]!;
    const kind = hint ?? classifyFile(name, headers);
    if (!kind) {
      ignoredFiles.push(name);
      unrecognisedFiles.push({ name, headers: headers.slice(0, 10) });
      return;
    }
    const dataRows = rows.slice(headerIndex + 1);
    const firstRowNumber = headerIndex + 2;
    let records = 0;
    let skipped = 0;

    if (kind === 'cgm') {
      // Named Glooko CGM files take the streaming path above. This protects
      // memory use for long exports; header-only classification remains here
      // for completeness without treating an unknown large file as CGM.
      ignoredFiles.push(name);
      unrecognisedFiles.push({ name, headers: headers.slice(0, 10) });
      return;
    } else if (kind === 'bolus') {
      const parsed = parseBolusRows(
        name,
        headers,
        dataRows,
        firstRowNumber,
        importedAt,
      );
      boluses.push(...parsed.boluses);
      context.push(...parsed.context);
      records = parsed.boluses.length + parsed.context.length;
      skipped = parsed.skipped;
    } else if (kind === 'basal') {
      const parsed = parseBasalRows(
        name,
        headers,
        dataRows,
        firstRowNumber,
        importedAt,
      );
      basal.push(...parsed.basal);
      records = parsed.basal.length;
      skipped = parsed.skipped;
    } else if (kind === 'meal') {
      const parsed = parseMealRows(
        name,
        headers,
        dataRows,
        firstRowNumber,
        importedAt,
      );
      context.push(...parsed.events);
      records = parsed.events.length;
      skipped = parsed.skipped;
    } else if (kind === 'activity') {
      const parsed = parseActivityRows(
        name,
        headers,
        dataRows,
        firstRowNumber,
        importedAt,
      );
      context.push(...parsed.events);
      records = parsed.events.length;
      skipped = parsed.skipped;
    } else if (kind === 'medication') {
      const parsed = parseMedicationRows(
        name,
        headers,
        dataRows,
        firstRowNumber,
        importedAt,
      );
      context.push(...parsed.events);
      records = parsed.events.length;
      skipped = parsed.skipped;
    } else if (kind === 'note') {
      const parsed = parseNoteRows(
        name,
        headers,
        dataRows,
        firstRowNumber,
        importedAt,
      );
      context.push(...parsed.events);
      records = parsed.events.length;
      skipped = parsed.skipped;
    } else if (kind === 'alarm') {
      const parsed = parseAlarmRows(
        name,
        headers,
        dataRows,
        firstRowNumber,
        importedAt,
      );
      context.push(...parsed.events);
      records = parsed.events.length;
      skipped = parsed.skipped;
    } else if (kind === 'blood-glucose') {
      const parsed = parseBloodGlucoseRows(
        name,
        headers,
        dataRows,
        firstRowNumber,
        importedAt,
      );
      context.push(...parsed.events);
      records = parsed.events.length;
      skipped = parsed.skipped;
    } else if (kind === 'manual-insulin') {
      const parsed = parseManualInsulinRows(
        name,
        headers,
        dataRows,
        firstRowNumber,
        importedAt,
      );
      context.push(...parsed.events);
      records = parsed.events.length;
      skipped = parsed.skipped;
    } else {
      const parsed = parseDailyInsulinRows(
        name,
        headers,
        dataRows,
        firstRowNumber,
        importedAt,
      );
      dailyInsulinTotals.push(...parsed.totals);
      records = parsed.totals.length;
      skipped = parsed.skipped;
    }

    recognisedFiles.push({ name, kind, records, skippedRows: skipped });
    skippedRows += skipped;
    if (skipped > 0) {
      warnings.push(
        `${name}: ${skipped} row${skipped === 1 ? '' : 's'} could not be normalised.`,
      );
    }
  });

  const uniqueGlucose = uniqueById(glucose);
  const uniqueBasal = uniqueById(basal);
  const uniqueBoluses = uniqueById(boluses);
  const uniqueDailyInsulinTotals = uniqueById(dailyInsulinTotals);
  const uniqueContext = uniqueById(context);
  const uniqueRawRecords = uniqueById(rawRecords);
  const duplicateRows =
    uniqueGlucose.duplicates +
    uniqueBasal.duplicates +
    uniqueBoluses.duplicates +
    uniqueDailyInsulinTotals.duplicates +
    uniqueContext.duplicates;
  if (duplicateRows) {
    warnings.push(
      `${duplicateRows} repeated record${duplicateRows === 1 ? '' : 's'} inside the selected export were collapsed.`,
    );
  }

  const timestamps = [
    ...uniqueGlucose.records.map((reading) => reading.timestamp),
    ...uniqueBasal.records.flatMap((delivery) => [delivery.start, delivery.end]),
    ...uniqueBoluses.records.map((delivery) => delivery.timestamp),
    ...uniqueDailyInsulinTotals.records.map((total) => total.timestamp),
    ...uniqueContext.records.flatMap((event) => [
      event.start,
      event.end ?? event.start,
    ]),
  ];
  if (!recognisedFiles.length) {
    warnings.push(
      'No supported Glooko glucose, basal, bolus or context table was found.',
    );
  }
  if (retainedFiles.length) {
    warnings.push(
      `${retainedFiles.length} source file${
        retainedFiles.length === 1 ? ' was' : 's were'
      } retained exactly in the encrypted source archive for future processing.`,
    );
  }

  return {
    glucose: uniqueGlucose.records.sort((a, b) => a.timestamp - b.timestamp),
    basal: uniqueBasal.records.sort((a, b) => a.start - b.start),
    boluses: uniqueBoluses.records.sort((a, b) => a.timestamp - b.timestamp),
    dailyInsulinTotals: uniqueDailyInsulinTotals.records.sort(
      (a, b) => a.timestamp - b.timestamp,
    ),
    context: uniqueContext.records.sort((a, b) => a.start - b.start),
    rawRecords: uniqueRawRecords.records.sort(
      (a, b) =>
        (a.timestamp ?? a.importedAt) -
        (b.timestamp ?? b.importedAt),
    ),
    recognisedFiles,
    retainedFiles,
    ignoredFiles,
    unrecognisedFiles,
    warnings,
    skippedRows,
    duplicateRows,
    dataStart: timestamps.length ? Math.min(...timestamps) : undefined,
    dataThrough: timestamps.length ? Math.max(...timestamps) : undefined,
  };
}

export function previewDateRange(preview: GlookoImportPreview) {
  if (preview.dataStart === undefined || preview.dataThrough === undefined) {
    return undefined;
  }
  return {
    start: toDateKey(preview.dataStart),
    end: toDateKey(preview.dataThrough),
  };
}
