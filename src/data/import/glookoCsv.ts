import {
  ActivityEvent,
  BasalDelivery,
  BolusDelivery,
  HealthContextEvent,
  MealEvent,
  MedicationEvent,
} from '@/domain/models';
import {
  DateKey,
  toDateKey,
  zonedDateTimeToTimestamp,
} from '@/domain/time';

export const GLOOKO_SOURCE_ID = 'glooko-export';

export interface GlookoTextFile {
  name: string;
  text: string;
  retainedOnly?: boolean;
  originalBytes?: number;
}

export interface GlookoRetainedFileSummary {
  name: string;
  originalBytes: number;
}

export interface GlookoFileSummary {
  name: string;
  kind: 'basal' | 'bolus' | 'meal' | 'activity' | 'medication';
  records: number;
  skippedRows: number;
}

export interface GlookoUnrecognisedFileSummary {
  name: string;
  headers: string[];
}

export interface GlookoImportPreview {
  basal: BasalDelivery[];
  boluses: BolusDelivery[];
  context: HealthContextEvent[];
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
  'datetime',
  'device timestamp',
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
  'type',
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
  const lines = text
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

export function parseDelimitedText(text: string) {
  const delimiter = detectDelimiter(text);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;

  const pushField = () => {
    row.push(field.trim());
    field = '';
  };
  const pushRow = () => {
    pushField();
    if (row.some((value) => value.length > 0)) rows.push(row);
    row = [];
  };

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]!;
    if (character === '"') {
      if (quoted && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === delimiter && !quoted) {
      pushField();
    } else if ((character === '\n' || character === '\r') && !quoted) {
      if (character === '\r' && text[index + 1] === '\n') index += 1;
      pushRow();
    } else {
      field += character;
    }
  }
  if (field.length || row.length) pushRow();
  return rows;
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
  const iso = trimmed.match(
    /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/,
  );
  if (iso) {
    return {
      dateKey: `${iso[1]}-${String(iso[2]).padStart(2, '0')}-${String(
        iso[3],
      ).padStart(2, '0')}` as DateKey,
      hour: Number(iso[4] ?? 0),
      minute: Number(iso[5] ?? 0),
      second: Number(iso[6] ?? 0),
    };
  }
  const dayFirst = trimmed.match(
    /^(\d{1,2})[/.](\d{1,2})[/.](\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/,
  );
  if (dayFirst) {
    return {
      dateKey: `${dayFirst[3]}-${String(dayFirst[2]).padStart(
        2,
        '0',
      )}-${String(dayFirst[1]).padStart(2, '0')}` as DateKey,
      hour: Number(dayFirst[4] ?? 0),
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
  kind: 'basal' | 'bolus' | 'meal' | 'activity' | 'medication',
  timestamp: number,
  parts: Array<string | number | undefined>,
) {
  return `${GLOOKO_SOURCE_ID}:${kind}:${timestamp}:${fingerprint(parts)}`;
}

function classifyFile(name: string, headers?: string[]): SupportedFileKind | undefined {
  const lower = safeName(name).toLowerCase();
  // Glooko uses insulin_data for aggregate daily totals and, in some export
  // variants, manual insulin. Neither is an individual delivered pump bolus.
  // Load it for inspection and future support, but never mislabel it as one.
  if (lower.includes('insulin_data') || lower.includes('insulin-data')) {
    return undefined;
  }
  if (lower.includes('basal')) return 'basal';
  if (lower.includes('bolus')) return 'bolus';
  if (lower.includes('exercise') || lower.includes('activity')) return 'activity';
  if (lower.includes('food') || lower.includes('carb')) return 'meal';
  if (lower.includes('medication')) return 'medication';
  if (isExplicitlyIgnoredGlookoFileName(lower)) {
    return undefined;
  }
  if (!headers) return undefined;
  if (findColumn(headers, BASAL_RATE_ALIASES) >= 0) return 'basal';
  if (findColumn(headers, BOLUS_DOSE_ALIASES) >= 0) return 'bolus';
  if (findColumn(headers, INTENSITY_ALIASES) >= 0) return 'activity';
  if (findColumn(headers, CARB_ALIASES) >= 0) return 'meal';
  return undefined;
}

export function isExplicitlyIgnoredGlookoFileName(name: string) {
  const lower = safeName(name).toLowerCase();
  return (
    lower.includes('cgm') ||
    lower.includes('alarm') ||
    lower.includes('note') ||
    lower.includes('manual_insulin') ||
    lower.includes('manual-insulin') ||
    /^bg[_-]/.test(lower)
  );
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
        sourceId: GLOOKO_SOURCE_ID,
        importedAt,
        sourceFile: fileName,
        sourceRow,
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
      sourceId: GLOOKO_SOURCE_ID,
      importedAt,
      sourceFile: fileName,
      sourceRow,
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
      id: recordId('meal', timestamp, [carbs.toFixed(2), title]),
      kind: 'meal',
      start: timestamp,
      title,
      mealType: mealType(title, timestamp),
      carbsGrams: Math.round(carbs * 10) / 10,
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
      ]),
      kind: 'activity',
      start: timestamp,
      end: timestamp + duration * 60_000,
      title,
      activityType: activityType(title),
      durationMinutes: Math.round(duration),
      intensity: intensity(intensityValue),
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
      ]),
      kind: 'medication',
      start: timestamp,
      title,
      amount,
      unit,
      sourceId: GLOOKO_SOURCE_ID,
      origin: 'imported',
      recordedAt: importedAt,
      sourceFile: fileName,
      sourceRow: firstRowNumber + index,
    });
  });
  return { events, skipped };
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
  const basal: BasalDelivery[] = [];
  const boluses: BolusDelivery[] = [];
  const context: HealthContextEvent[] = [];
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
    const rows = parseDelimitedText(input.text.replace(/\0/g, ''));
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

    if (kind === 'bolus') {
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
    } else {
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
    }

    recognisedFiles.push({ name, kind, records, skippedRows: skipped });
    skippedRows += skipped;
    if (skipped > 0) {
      warnings.push(
        `${name}: ${skipped} row${skipped === 1 ? '' : 's'} could not be normalised.`,
      );
    }
  });

  const uniqueBasal = uniqueById(basal);
  const uniqueBoluses = uniqueById(boluses);
  const uniqueContext = uniqueById(context);
  const duplicateRows =
    uniqueBasal.duplicates + uniqueBoluses.duplicates + uniqueContext.duplicates;
  if (duplicateRows) {
    warnings.push(
      `${duplicateRows} repeated record${duplicateRows === 1 ? '' : 's'} inside the selected export were collapsed.`,
    );
  }

  const timestamps = [
    ...uniqueBasal.records.flatMap((delivery) => [delivery.start, delivery.end]),
    ...uniqueBoluses.records.map((delivery) => delivery.timestamp),
    ...uniqueContext.records.flatMap((event) => [
      event.start,
      event.end ?? event.start,
    ]),
  ];
  if (!recognisedFiles.length) {
    warnings.push(
      'No supported Glooko basal, bolus or context table was found.',
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
    basal: uniqueBasal.records.sort((a, b) => a.start - b.start),
    boluses: uniqueBoluses.records.sort((a, b) => a.timestamp - b.timestamp),
    context: uniqueContext.records.sort((a, b) => a.start - b.start),
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
