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
import { parseExternalAbsoluteTimestamp } from '@/domain/externalTimestamp';
import { getCachedDateTimeFormat } from '@/domain/intlFormatterCache';
import { formatRegionalNumber } from '@/domain/regionalFormat';
import { getRuntimeRegionalDefaults } from '@/domain/regionalProfileRuntime';
import {
  DateKey,
  isDateKey,
  toDateKey,
  zonedWallClockCandidates,
} from '@/domain/time';
import { ImportRawRecord } from '@/data/persistence/HealthRecordStore';
import { DecodeUTF8, strFromU8 } from 'fflate';

export const GLOOKO_SOURCE_ID = 'glooko-export';
export const GLOOKO_CGM_SOURCE_ID = 'glooko-cgm';

function regionalCount(value: number) {
  return formatRegionalNumber(value, getRuntimeRegionalDefaults().locale, {
    maximumFractionDigits: 0,
  });
}

export interface GlookoImportRegionalSettings {
  /** IANA zone used to turn Glooko's local wall-clock timestamps into instants. */
  timeZone: string;
  /** Numeric date order emitted by the selected Glooko service region. */
  dateOrder: 'day-first' | 'month-first';
}

export const DEFAULT_GLOOKO_IMPORT_REGIONAL_SETTINGS: GlookoImportRegionalSettings = {
  timeZone: 'Europe/London',
  dateOrder: 'day-first',
};

function usesLegacyUkImportContract(settings: GlookoImportRegionalSettings) {
  return settings.timeZone === 'Europe/London' && settings.dateOrder === 'day-first';
}

function oppositeDateOrderWarning(
  name: string,
  settings: GlookoImportRegionalSettings,
) {
  return usesLegacyUkImportContract(settings)
    ? `${name}: month/day/year timestamps are not supported; the file was not normalised.`
    : `${name}: the numeric date order does not match the selected Glooko import region; the file was not normalised.`;
}

function clockTransitionWarning(
  name: string,
  transition: 'nonexistent' | 'ambiguous',
  settings: GlookoImportRegionalSettings,
) {
  if (usesLegacyUkImportContract(settings)) {
    return transition === 'nonexistent'
      ? `${name}: a Europe/London local time was skipped by the spring clock change; the file was not normalised.`
      : `${name}: a repeated autumn Europe/London hour could not be uniquely disambiguated from source row order; the file was not normalised.`;
  }
  return transition === 'nonexistent'
    ? `${name}: a local time in ${settings.timeZone} was skipped by a clock change; the file was not normalised.`
    : `${name}: a repeated local hour in ${settings.timeZone} could not be uniquely disambiguated from source row order; the file was not normalised.`;
}

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
  /** Insulin deliveries/totals only; excludes context parsed from bolus rows. */
  insulinRecords?: number;
  /** Rows that looked like insulin rows but could not be normalised. */
  rejectedInsulinRows?: number;
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
  /** A locale or DST transition made at least one local timestamp unsafe. */
  unsafeTimestampLocale: boolean;
  skippedRows: number;
  duplicateRows: number;
  /** Immutable interpretation settings used for every local export timestamp. */
  regionalSettings: GlookoImportRegionalSettings;
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
const BASAL_DELIVERED_ALIASES = [
  'insulin delivered u',
  'delivered insulin units',
  'insulin delivered units',
  'delivered insulin',
  'basal amount',
];
const DURATION_ALIASES = ['duration min', 'duration minutes', 'duration'];
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
const BLOOD_GLUCOSE_INPUT_MMOL_ALIASES = [
  'blood glucose input mmol l',
  'bg input mmol l',
];
const BLOOD_GLUCOSE_INPUT_MG_DL_ALIASES = [
  'blood glucose input mg dl',
  'bg input mg dl',
];
const BLOOD_GLUCOSE_INPUT_GENERIC_ALIASES = [
  'blood glucose input',
  'bg input',
];
const BLOOD_GLUCOSE_INPUT_UNIT_ALIASES = [
  'blood glucose input unit',
  'bg input unit',
  'blood glucose unit',
];
const CARB_RATIO_ALIASES = [
  'carbs ratio',
  'carb ratio',
  'insulin carb ratio',
  'insulin to carb ratio',
];
const PERCENTAGE_ALIASES = ['percentage', 'percentage percent', 'percent'];
const ALARM_EVENT_ALIASES = ['alarm event', 'alarm', 'event', 'alarm name'];
const ENERGY_ALIASES = ['calories', 'energy kcal', 'energy'];
const PROTEIN_ALIASES = ['protein', 'protein g'];
const FAT_ALIASES = ['fat', 'fat g', 'total fat'];
const SERVING_QUANTITY_ALIASES = ['serving quantity', 'serving size'];
const SERVING_COUNT_ALIASES = [
  'number of servings',
  'servings',
  'serving count',
];
const CALORIES_BURNED_ALIASES = ['calories burned', 'energy burned'];
const MEDICATION_TYPE_ALIASES = ['medication type', 'medicine type'];

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

function canonicalGlucoseMmolL(
  row: string[],
  columns: {
    mmol: number;
    mgDl: number;
    generic: number;
    unit: number;
  },
) {
  if (columns.mmol >= 0) {
    return parseNumber(valueAt(row, columns.mmol));
  }
  if (columns.mgDl >= 0) {
    const mgDl = parseNumber(valueAt(row, columns.mgDl));
    return mgDl === undefined ? undefined : mgDl / MG_DL_PER_MMOL_L;
  }
  if (columns.generic < 0) return undefined;
  const value = parseNumber(valueAt(row, columns.generic));
  if (value === undefined) return undefined;
  const unit = normaliseHeader(valueAt(row, columns.unit));
  if (/\bmg\s*dl\b/.test(unit)) return value / MG_DL_PER_MMOL_L;
  if (/\bmmol\s*l\b/.test(unit)) return value;
  // An unlabelled medical value is not safe to guess from magnitude. A severe
  // low in mg/dL overlaps plausible mmol/L numbers, while a malformed mmol/L
  // value could otherwise become a plausible mg/dL conversion.
  return undefined;
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
  return (
    candidates
      .map((delimiter) => ({
        delimiter,
        score: lines.reduce((sum, line) => {
          const count = countDelimiter(line, delimiter);
          return sum + (count > 0 ? 100 + count : 0);
        }, 0),
      }))
      .sort((a, b) => b.score - a.score)[0]?.delimiter ?? ','
  );
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
    return completed.some((value) => value.length > 0) ? completed : undefined;
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
  let normalised = value
    .trim()
    .replace(/\s/g, '')
    .replace(/[^\d,.\-]/g, '');
  if (normalised.includes(',') && !normalised.includes('.')) {
    normalised = normalised.replace(',', '.');
  } else {
    normalised = normalised.replace(/,/g, '');
  }
  const number = Number(normalised);
  return Number.isFinite(number) ? number : undefined;
}

function timestampParts(
  value: string,
  settings: GlookoImportRegionalSettings,
) {
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
  const numeric = trimmed.match(
    /^(\d{1,2})[/.](\d{1,2})[/.](\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)?)?$/i,
  );
  if (numeric) {
    const first = Number(numeric[1]);
    const second = Number(numeric[2]);
    const day = settings.dateOrder === 'month-first' ? second : first;
    const month = settings.dateOrder === 'month-first' ? first : second;
    return {
      dateKey: `${numeric[3]}-${String(month).padStart(
        2,
        '0',
      )}-${String(day).padStart(2, '0')}` as DateKey,
      hour: hour24(numeric[4], numeric[7]),
      minute: Number(numeric[5] ?? 0),
      second: Number(numeric[6] ?? 0),
    };
  }
  return undefined;
}

function isDetectablyOppositeDateOrder(
  value: string | undefined,
  settings: GlookoImportRegionalSettings,
) {
  const match = value
    ?.trim()
    .match(/^(\d{1,2})[/.](\d{1,2})[/.](\d{4})(?:\D|$)/);
  if (!match) return false;
  const first = Number(match[1]);
  const second = Number(match[2]);
  return settings.dateOrder === 'day-first'
    ? first <= 12 && second > 12
    : first > 12 && second <= 12;
}

type GlookoTimestampCandidates = {
  candidates: number[];
  status: 'valid' | 'invalid' | 'nonexistent' | 'ambiguous';
};

function glookoTimestampCandidates(
  value: string | undefined,
  settings: GlookoImportRegionalSettings = DEFAULT_GLOOKO_IMPORT_REGIONAL_SETTINGS,
): GlookoTimestampCandidates {
  if (!value?.trim()) return { candidates: [], status: 'invalid' };
  const trimmed = value.trim();
  const absolute = parseExternalAbsoluteTimestamp(trimmed);
  if (absolute !== undefined) {
    return { candidates: [absolute], status: 'valid' };
  }
  if (
    /(?:Z|[+-]\d{2}:?\d{2})$/i.test(trimmed) ||
    /^[A-Za-z]{3},/.test(trimmed)
  ) {
    return { candidates: [], status: 'invalid' };
  }
  const parts = timestampParts(trimmed, settings);
  if (
    !parts ||
    !isDateKey(parts.dateKey) ||
    parts.hour < 0 ||
    parts.hour > 23 ||
    parts.minute < 0 ||
    parts.minute > 59 ||
    parts.second < 0 ||
    parts.second > 59
  ) {
    return { candidates: [], status: 'invalid' };
  }

  const candidates = zonedWallClockCandidates(
    parts.dateKey,
    parts.hour,
    parts.minute,
    parts.second,
    settings.timeZone,
  );
  if (candidates.length === 0) {
    return { candidates, status: 'nonexistent' };
  }
  if (candidates.length > 1) {
    return { candidates, status: 'ambiguous' };
  }
  return { candidates, status: 'valid' };
}

type TimestampSequenceResolution = {
  timestamps: (number | undefined)[];
  statuses: GlookoTimestampCandidates['status'][];
  unsafeTransition?: 'nonexistent' | 'ambiguous';
};

function monotonicTimestampSolution(
  candidates: number[][],
  direction: 'ascending' | 'descending',
) {
  type PathNode = { value: number; previous?: PathNode };
  type State = { count: number; path?: PathNode };
  let states = candidates[0]!.map<State>((candidate) => ({
    count: 1,
    path: { value: candidate },
  }));
  for (let index = 1; index < candidates.length; index += 1) {
    const previousCandidates = candidates[index - 1]!;
    states = candidates[index]!.map((candidate) => {
      let count = 0;
      let path: PathNode | undefined;
      states.forEach((state, previousIndex) => {
        const previous = previousCandidates[previousIndex]!;
        const ordered =
          direction === 'ascending'
            ? candidate >= previous
            : candidate <= previous;
        if (!ordered || state.count === 0) return;
        if (count === 0) path = { value: candidate, previous: state.path };
        count = Math.min(2, count + state.count);
      });
      return { count, path };
    });
  }
  const possible = states.filter((state) => state.count > 0);
  const count = Math.min(
    2,
    possible.reduce((total, state) => total + state.count, 0),
  );
  // Keep shared prefixes instead of copying the entire history for every row.
  // The candidate counts still decide ambiguity; reconstruct only a unique path.
  const path: number[] = [];
  if (count === 1) {
    for (let node = possible[0]!.path; node; node = node.previous) {
      path.push(node.value);
    }
    path.reverse();
  }
  return { count, path: count === 1 ? path : undefined };
}

/**
 * Resolves a file's repeated autumn hour only when row order yields one
 * monotonic instant sequence. A visible clock rollback can therefore retain
 * both folds; a lone 01:xx value (or unordered rows) fails closed.
 */
function resolveGlookoTimestampSequence(
  values: (string | undefined)[],
  settings: GlookoImportRegionalSettings = DEFAULT_GLOOKO_IMPORT_REGIONAL_SETTINGS,
): TimestampSequenceResolution {
  const parsed = values.map((value) => glookoTimestampCandidates(value, settings));
  const statuses = parsed.map((entry) => entry.status);
  if (parsed.some((entry) => entry.status === 'nonexistent')) {
    return {
      timestamps: parsed.map((entry) => entry.candidates[0]),
      statuses,
      unsafeTransition: 'nonexistent',
    };
  }
  const ambiguous = parsed.some((entry) => entry.status === 'ambiguous');
  if (!ambiguous) {
    return {
      timestamps: parsed.map((entry) => entry.candidates[0]),
      statuses,
    };
  }

  const validEntries = parsed.filter((entry) => entry.candidates.length > 0);
  const candidateRows = validEntries.map((entry) => entry.candidates);
  const solutions = [
    monotonicTimestampSolution(candidateRows, 'ascending'),
    monotonicTimestampSolution(candidateRows, 'descending'),
  ];
  if (solutions.some((solution) => solution.count > 1)) {
    return {
      timestamps: parsed.map((entry) =>
        entry.status === 'valid' ? entry.candidates[0] : undefined,
      ),
      statuses,
      unsafeTransition: 'ambiguous',
    };
  }
  const uniquePaths = new Map<string, number[]>();
  solutions.forEach((solution) => {
    if (solution.count === 1 && solution.path) {
      uniquePaths.set(solution.path.join(','), solution.path);
    }
  });
  if (uniquePaths.size !== 1) {
    return {
      timestamps: parsed.map((entry) =>
        entry.status === 'valid' ? entry.candidates[0] : undefined,
      ),
      statuses,
      unsafeTransition: 'ambiguous',
    };
  }

  const resolved = [...uniquePaths.values()][0]!;
  let validIndex = 0;
  return {
    timestamps: parsed.map((entry) => {
      if (!entry.candidates.length) return undefined;
      const timestamp = resolved[validIndex];
      validIndex += 1;
      return timestamp;
    }),
    statuses,
  };
}

export function parseGlookoTimestamp(
  value: string | undefined,
  settings: GlookoImportRegionalSettings = DEFAULT_GLOOKO_IMPORT_REGIONAL_SETTINGS,
) {
  const parsed = glookoTimestampCandidates(value, settings);
  return parsed.candidates.length === 1 ? parsed.candidates[0] : undefined;
}

function localHour(
  timestamp: number,
  settings: GlookoImportRegionalSettings,
) {
  return Number(
    getCachedDateTimeFormat('en-GB', {
      timeZone: settings.timeZone,
      hour: '2-digit',
      hourCycle: 'h23',
    }).format(timestamp),
  );
}

function mealType(
  title: string,
  timestamp: number,
  settings: GlookoImportRegionalSettings = DEFAULT_GLOOKO_IMPORT_REGIONAL_SETTINGS,
): MealEvent['mealType'] {
  const lower = title.toLowerCase();
  if (lower.includes('breakfast')) return 'breakfast';
  if (lower.includes('lunch')) return 'lunch';
  if (lower.includes('dinner') || lower.includes('evening meal'))
    return 'dinner';
  const hour = localHour(timestamp, settings);
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

function fingerprint(parts: (string | number | undefined)[]) {
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
  parts: (string | number | undefined)[],
) {
  return `${GLOOKO_SOURCE_ID}:${kind}:${timestamp}:${fingerprint(parts)}`;
}

function deviceAwareRecordId(
  kind: 'basal' | 'bolus' | 'daily-insulin',
  timestamp: number,
  parts: (string | number | undefined)[],
  sourceDeviceId: string,
) {
  const legacyId = recordId(kind, timestamp, parts);
  if (!sourceDeviceId) return { id: legacyId };
  return {
    id: recordId(kind, timestamp, [...parts, 'source-device', sourceDeviceId]),
    legacyId,
  };
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
  if (lower.includes('exercise') || lower.includes('activity'))
    return 'activity';
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
  regionalSettings: GlookoImportRegionalSettings = DEFAULT_GLOOKO_IMPORT_REGIONAL_SETTINGS,
  options: {
    deferTimestamp?: boolean;
    normalisedHeaders?: string[];
    recordKind?: ReturnType<typeof rawRecordKind>;
    timestampColumn?: number;
  } = {},
): ImportRawRecord | undefined {
  if (!row.some((value) => value.trim())) return undefined;
  const values = headers.map((_, index) => row[index] ?? '');
  const kind = options.recordKind ?? rawRecordKind(fileName);
  const timestamp = options.deferTimestamp
    ? undefined
    : parseGlookoTimestamp(
        valueAt(
          row,
          options.timestampColumn ?? findColumn(headers, TIMESTAMP_ALIASES),
        ),
        regionalSettings,
      );
  return {
    id: `${GLOOKO_SOURCE_ID}:raw:${kind}:${fingerprint([
      ...(options.normalisedHeaders ?? headers.map(normaliseHeader)),
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

function classifyFile(
  name: string,
  headers?: string[],
): SupportedFileKind | undefined {
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
  if (lower.includes('exercise') || lower.includes('activity'))
    return 'activity';
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

function supportsInsulinTableHeaders(
  headers: string[],
  kind: SupportedFileKind,
) {
  if (kind === 'bolus') {
    return (
      findColumn(headers, BOLUS_DOSE_ALIASES) >= 0 ||
      findColumn(headers, INITIAL_DOSE_ALIASES) >= 0 ||
      findColumn(headers, EXTENDED_DOSE_ALIASES) >= 0
    );
  }
  if (kind === 'basal') {
    return (
      findColumn(headers, BASAL_RATE_ALIASES) >= 0 ||
      findColumn(headers, BASAL_DELIVERED_ALIASES) >= 0
    );
  }
  if (kind === 'daily-insulin') {
    return (
      findColumn(headers, TOTAL_INSULIN_ALIASES) >= 0 ||
      (findColumn(headers, TOTAL_BASAL_ALIASES) >= 0 &&
        findColumn(headers, TOTAL_BOLUS_ALIASES) >= 0)
    );
  }
  return true;
}

function findHeaderIndex(rows: string[][], hintedKind?: SupportedFileKind) {
  return rows.slice(0, 12).findIndex((row) => {
    if (findColumn(row, TIMESTAMP_ALIASES) < 0) return false;
    const kind = hintedKind ?? classifyFile('unknown.csv', row);
    return kind !== undefined && supportsInsulinTableHeaders(row, kind);
  });
}

function valueAt(row: string[], index: number) {
  return index >= 0 ? (row[index]?.trim() ?? '') : '';
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
  regionalSettings: GlookoImportRegionalSettings,
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
  let nonEmptyDataRows = 0;
  let oppositeDateOrderDetected = false;
  const rawRecordKindValue = rawRecordKind(fileName);
  let normalisedHeaders: string[] = [];
  const pending: {
    rawTimestamp: string;
    mmolL?: number;
    rawValue: string;
    trend: string;
    device: string;
    rowNumber: number;
    nonEmpty: boolean;
    exact?: ImportRawRecord;
  }[] = [];

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
        normalisedHeaders = row.map(normaliseHeader);
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
    if (row.some((value) => value.trim())) nonEmptyDataRows += 1;
    if (isDetectablyOppositeDateOrder(rawTimestamp, regionalSettings)) {
      oppositeDateOrderDetected = true;
    }
    const exact = rawRecord(
      fileName,
      headers,
      row,
      rowNumber,
      importedAt,
      regionalSettings,
      {
        deferTimestamp: true,
        normalisedHeaders,
        recordKind: rawRecordKindValue,
        timestampColumn,
      },
    );
    const mmolL = canonicalGlucoseMmolL(row, {
      mmol: mmolColumn,
      mgDl: mgColumn,
      generic: genericColumn,
      unit: unitColumn,
    });

    const device = valueAt(row, deviceColumn);
    const rawValue =
      valueAt(
        row,
        mmolColumn >= 0 ? mmolColumn : mgColumn >= 0 ? mgColumn : genericColumn,
      ) || '';
    pending.push({
      rawTimestamp,
      mmolL,
      rawValue,
      trend: valueAt(row, trendColumn),
      device,
      rowNumber,
      nonEmpty: row.some(Boolean),
      exact,
    });
  }

  const resolution = resolveGlookoTimestampSequence(
    pending.map((row) => row.rawTimestamp),
    regionalSettings,
  );
  if (!oppositeDateOrderDetected && !resolution.unsafeTransition) {
    pending.forEach((row, index) => {
      const timestamp = resolution.timestamps[index];
      if (row.exact) {
        row.exact.timestamp = timestamp;
        if (
          timestamp !== undefined &&
          resolution.statuses[index] === 'ambiguous'
        ) {
          row.exact.id = `${row.exact.id}:instant:${timestamp}`;
        }
        rawRecords.push(row.exact);
      }
      if (
        timestamp === undefined ||
        row.mmolL === undefined ||
        row.mmolL < 1 ||
        row.mmolL > 40
      ) {
        if (row.nonEmpty) skipped += 1;
        return;
      }
      glucose.push({
        id: `${GLOOKO_CGM_SOURCE_ID}:${timestamp}:${fingerprint([
          'source-device',
          row.device || 'device-unspecified',
        ])}`,
        timestamp,
        receivedAt: importedAt,
        mmolL: Math.round(row.mmolL * 100) / 100,
        trend: cgmTrend(row.trend),
        quality: /[<>]/.test(row.rawValue) ? 'estimated' : 'measured',
        sourceId: GLOOKO_CGM_SOURCE_ID,
        importedAt,
        sourceFile: fileName,
        sourceRow: row.rowNumber,
        sourceDeviceId: row.device || undefined,
        sourceLocalTimestamp: row.rawTimestamp || undefined,
      });
    });
  }

  return {
    glucose:
      oppositeDateOrderDetected || resolution.unsafeTransition ? [] : glucose,
    rawRecords:
      oppositeDateOrderDetected || resolution.unsafeTransition ? [] : rawRecords,
    headers,
    headerRowNumber,
    skipped:
      oppositeDateOrderDetected || resolution.unsafeTransition
        ? nonEmptyDataRows
        : skipped,
    oppositeDateOrderDetected,
    unsafeTimestampTransition: resolution.unsafeTransition,
  };
}

function parseBolusRows(
  fileName: string,
  headers: string[],
  rows: string[][],
  firstRowNumber: number,
  importedAt: number,
  regionalSettings: GlookoImportRegionalSettings,
) {
  const timestampColumn = findColumn(headers, TIMESTAMP_ALIASES);
  const doseColumn = findColumn(headers, BOLUS_DOSE_ALIASES);
  const initialColumn = findColumn(headers, INITIAL_DOSE_ALIASES);
  const extendedColumn = findColumn(headers, EXTENDED_DOSE_ALIASES);
  const carbsColumn = findColumn(headers, CARB_ALIASES);
  const typeColumn = findColumn(headers, TYPE_ALIASES);
  const notesColumn = findColumn(headers, ['notes', 'comment', 'description']);
  const bloodGlucoseColumns = {
    mmol: findColumn(headers, BLOOD_GLUCOSE_INPUT_MMOL_ALIASES),
    mgDl: findColumn(headers, BLOOD_GLUCOSE_INPUT_MG_DL_ALIASES),
    generic: findColumn(headers, BLOOD_GLUCOSE_INPUT_GENERIC_ALIASES),
    unit: findColumn(headers, BLOOD_GLUCOSE_INPUT_UNIT_ALIASES),
  };
  const carbRatioColumn = findColumn(headers, CARB_RATIO_ALIASES);
  const deviceColumn = findColumn(headers, DEVICE_ALIASES);
  const boluses: BolusDelivery[] = [];
  const context: MealEvent[] = [];
  let skipped = 0;
  let rejectedInsulinRows = 0;

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
    const bloodGlucoseInput = canonicalGlucoseMmolL(
      row,
      bloodGlucoseColumns,
    );
    const carbRatio = parseNumber(valueAt(row, carbRatioColumn));
    const initialUnits = parseNumber(valueAt(row, initialColumn));
    const extendedUnits = parseNumber(valueAt(row, extendedColumn));
    const sourceDeviceId = valueAt(row, deviceColumn);
    const sourceRow = firstRowNumber + index;
    let accepted = false;

    const insulinAccepted = timestamp !== undefined && validDose(dose);
    if (insulinAccepted) {
      const identityParts = [
        dose!.toFixed(4),
        deliveryType,
        componentDose.toFixed(4),
      ];
      boluses.push({
        ...deviceAwareRecordId(
          'bolus',
          timestamp,
          identityParts,
          sourceDeviceId,
        ),
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

    if (!insulinAccepted && row.some(Boolean)) rejectedInsulinRows += 1;

    if (
      timestamp !== undefined &&
      carbs !== undefined &&
      carbs > 0 &&
      carbs <= 1000
    ) {
      const title = note || 'Pump carbohydrate entry';
      context.push({
        id: recordId('meal', timestamp, [
          carbs.toFixed(2),
          title,
          'pump-entry',
        ]),
        kind: 'meal',
        start: timestamp,
        title,
        mealType: mealType(title, timestamp, regionalSettings),
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
  return { boluses, context, skipped, rejectedInsulinRows };
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
  const unitsColumn = findColumn(headers, BASAL_DELIVERED_ALIASES);
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
    const reportedRate = parseNumber(valueAt(row, rateColumn));
    const delivered = parseNumber(valueAt(row, unitsColumn));
    const deliveryType = valueAt(row, typeColumn);
    const percentage = parseNumber(valueAt(row, percentageColumn));
    const sourceDeviceId = valueAt(row, deviceColumn);
    const rate =
      reportedRate ??
      (delivered !== undefined && duration !== undefined && duration > 0
        ? (delivered * 60) / duration
        : undefined);
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
    const identityParts = [end, rate.toFixed(5), units.toFixed(5)];
    basal.push({
      ...deviceAwareRecordId('basal', start, identityParts, sourceDeviceId),
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
  regionalSettings: GlookoImportRegionalSettings,
) {
  const timestampColumn = findColumn(headers, TIMESTAMP_ALIASES);
  const carbsColumn = findColumn(headers, CARB_ALIASES);
  const titleColumn = findColumn(headers, TITLE_ALIASES);
  const energyColumn = findColumn(headers, ENERGY_ALIASES);
  const proteinColumn = findColumn(headers, PROTEIN_ALIASES);
  const fatColumn = findColumn(headers, FAT_ALIASES);
  const servingQuantityColumn = findColumn(headers, SERVING_QUANTITY_ALIASES);
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
      mealType: mealType(title, timestamp, regionalSettings),
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
  const caloriesBurnedColumn = findColumn(headers, CALORIES_BURNED_ALIASES);
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
  const medicationTypeColumn = findColumn(headers, MEDICATION_TYPE_ALIASES);
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
      medicationType: valueAt(row, medicationTypeColumn) || undefined,
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
  const glucoseColumns = {
    mmol: findColumn(headers, GLUCOSE_MMOL_ALIASES),
    mgDl: findColumn(headers, GLUCOSE_MG_DL_ALIASES),
    generic: findColumn(headers, GLUCOSE_GENERIC_ALIASES),
    unit: findColumn(headers, GLUCOSE_UNIT_ALIASES),
  };
  const manualColumn = findColumn(headers, ['manual reading', 'manual']);
  const deviceColumn = findColumn(headers, DEVICE_ALIASES);
  const events: ContextNoteEvent[] = [];
  let skipped = 0;
  rows.forEach((row, index) => {
    const timestamp = parseGlookoTimestamp(valueAt(row, timestampColumn));
    const value = canonicalGlucoseMmolL(row, glucoseColumns);
    if (
      timestamp === undefined ||
      value === undefined ||
      value <= 0 ||
      value > 40
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
      title: 'Blood glucose check',
      glucoseMmolL: rounded,
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
  regionalSettings: GlookoImportRegionalSettings,
) {
  const timestampColumn = findColumn(headers, TIMESTAMP_ALIASES);
  const basalColumn = findColumn(headers, TOTAL_BASAL_ALIASES);
  const bolusColumn = findColumn(headers, TOTAL_BOLUS_ALIASES);
  const totalColumn = findColumn(headers, TOTAL_INSULIN_ALIASES);
  const deviceColumn = findColumn(headers, DEVICE_ALIASES);
  const totals: InsulinDailyTotal[] = [];
  let skipped = 0;
  rows.forEach((row, index) => {
    const timestamp = parseGlookoTimestamp(
      valueAt(row, timestampColumn),
      regionalSettings,
    );
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
    const sourceDeviceId = valueAt(row, deviceColumn);
    const identityParts = [
      basalUnits?.toFixed(4),
      bolusUnits?.toFixed(4),
      totalUnits.toFixed(4),
    ];
    totals.push({
      ...deviceAwareRecordId(
        'daily-insulin',
        timestamp,
        identityParts,
        sourceDeviceId,
      ),
      timestamp,
      dateKey: toDateKey(timestamp, regionalSettings.timeZone),
      basalUnits:
        basalUnits === undefined
          ? undefined
          : Math.round(basalUnits * 100) / 100,
      bolusUnits:
        bolusUnits === undefined
          ? undefined
          : Math.round(bolusUnits * 100) / 100,
      totalUnits: Math.round(totalUnits * 100) / 100,
      sourceId: GLOOKO_SOURCE_ID,
      importedAt,
      sourceFile: fileName,
      sourceRow: firstRowNumber + index,
      sourceDeviceId: sourceDeviceId || undefined,
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
  regionalSettings: GlookoImportRegionalSettings = DEFAULT_GLOOKO_IMPORT_REGIONAL_SETTINGS,
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
  let unsafeTimestampLocale = false;
  let skippedRows = 0;

  files.forEach((input) => {
    const rawRecordStart = rawRecords.length;
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
        regionalSettings,
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
      if (parsed.oppositeDateOrderDetected) {
        unsafeTimestampLocale = true;
        warnings.push(
          oppositeDateOrderWarning(name, regionalSettings),
        );
      } else if (parsed.unsafeTimestampTransition) {
        unsafeTimestampLocale = true;
        warnings.push(
          clockTransitionWarning(
            name,
            parsed.unsafeTimestampTransition,
            regionalSettings,
          ),
        );
      } else if (parsed.skipped > 0) {
        warnings.push(
          `${name}: ${regionalCount(parsed.skipped)} row${
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
          regionalSettings,
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
    let dataRows = rows.slice(headerIndex + 1);
    const firstRowNumber = headerIndex + 2;
    const timestampColumn = findColumn(headers, TIMESTAMP_ALIASES);
    if (
      dataRows.some((row) =>
        isDetectablyOppositeDateOrder(
          valueAt(row, timestampColumn),
          regionalSettings,
        ),
      )
    ) {
      unsafeTimestampLocale = true;
      rawRecords.splice(rawRecordStart);
      const rejectedRows = dataRows.filter((row) =>
        row.some((value) => value.trim()),
      ).length;
      recognisedFiles.push({
        name,
        kind,
        records: 0,
        skippedRows: rejectedRows,
        ...(kind === 'bolus' || kind === 'basal' || kind === 'daily-insulin'
          ? { insulinRecords: 0, rejectedInsulinRows: rejectedRows }
          : {}),
      });
      skippedRows += rejectedRows;
      warnings.push(
        oppositeDateOrderWarning(name, regionalSettings),
      );
      return;
    }
    const timestampResolution = resolveGlookoTimestampSequence(
      dataRows.map((row) => valueAt(row, timestampColumn)),
      regionalSettings,
    );
    const ambiguousTimestampRows = dataRows.map(
      (row) =>
        glookoTimestampCandidates(
          valueAt(row, timestampColumn),
          regionalSettings,
        ).status ===
        'ambiguous',
    );
    const endColumn = findColumn(headers, END_ALIASES);
    const endResolution =
      endColumn >= 0
        ? resolveGlookoTimestampSequence(
            dataRows.map((row) => valueAt(row, endColumn)),
            regionalSettings,
          )
        : undefined;
    const unsafeTransition =
      timestampResolution.unsafeTransition ??
      endResolution?.unsafeTransition;
    if (unsafeTransition) {
      unsafeTimestampLocale = true;
      rawRecords.splice(rawRecordStart);
      const rejectedRows = dataRows.filter((row) =>
        row.some((value) => value.trim()),
      ).length;
      recognisedFiles.push({
        name,
        kind,
        records: 0,
        skippedRows: rejectedRows,
        ...(kind === 'bolus' || kind === 'basal' || kind === 'daily-insulin'
          ? { insulinRecords: 0, rejectedInsulinRows: rejectedRows }
          : {}),
      });
      skippedRows += rejectedRows;
      warnings.push(
        clockTransitionWarning(name, unsafeTransition, regionalSettings),
      );
      return;
    }

    // Give the existing row parsers explicit instants while retaining the
    // exact local source text in rawRecords. This also makes record IDs from
    // the two autumn folds distinct rather than collapsing on wall time.
    dataRows = dataRows.map((row, index) => {
      const timestamp = timestampResolution.timestamps[index];
      const end = endResolution?.timestamps[index];
      if (timestamp === undefined && end === undefined) return row;
      const resolved = [...row];
      if (timestamp !== undefined) {
        resolved[timestampColumn] = new Date(timestamp).toISOString();
      }
      if (endColumn >= 0 && end !== undefined) {
        resolved[endColumn] = new Date(end).toISOString();
      }
      return resolved;
    });
    rawRecords.slice(rawRecordStart).forEach((record) => {
      const index = record.sourceRow - firstRowNumber;
      if (index >= 0 && index < timestampResolution.timestamps.length) {
        record.timestamp = timestampResolution.timestamps[index];
        if (record.timestamp !== undefined && ambiguousTimestampRows[index]) {
          record.id = `${record.id}:instant:${record.timestamp}`;
        }
      }
    });
    let records = 0;
    let skipped = 0;
    let insulinRecords: number | undefined;
    let rejectedInsulinRows: number | undefined;

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
        regionalSettings,
      );
      boluses.push(...parsed.boluses);
      context.push(...parsed.context);
      records = parsed.boluses.length + parsed.context.length;
      skipped = parsed.skipped;
      insulinRecords = parsed.boluses.length;
      rejectedInsulinRows = parsed.rejectedInsulinRows;
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
      insulinRecords = records;
      rejectedInsulinRows = skipped;
    } else if (kind === 'meal') {
      const parsed = parseMealRows(
        name,
        headers,
        dataRows,
        firstRowNumber,
        importedAt,
        regionalSettings,
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
        regionalSettings,
      );
      dailyInsulinTotals.push(...parsed.totals);
      records = parsed.totals.length;
      skipped = parsed.skipped;
      insulinRecords = records;
      rejectedInsulinRows = skipped;
    }

    recognisedFiles.push({
      name,
      kind,
      records,
      skippedRows: skipped,
      ...(insulinRecords === undefined
        ? {}
        : { insulinRecords, rejectedInsulinRows }),
    });
    skippedRows += skipped;
    if (skipped > 0) {
      warnings.push(
        `${name}: ${regionalCount(skipped)} row${skipped === 1 ? '' : 's'} could not be normalised.`,
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
      `${regionalCount(duplicateRows)} repeated record${duplicateRows === 1 ? '' : 's'} inside the selected export were collapsed.`,
    );
  }

  const timestamps = [
    ...uniqueGlucose.records.map((reading) => reading.timestamp),
    ...uniqueBasal.records.flatMap((delivery) => [
      delivery.start,
      delivery.end,
    ]),
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
      `${regionalCount(retainedFiles.length)} source file${
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
      (a, b) => (a.timestamp ?? a.importedAt) - (b.timestamp ?? b.importedAt),
    ),
    recognisedFiles,
    retainedFiles,
    ignoredFiles,
    unrecognisedFiles,
    warnings,
    unsafeTimestampLocale,
    skippedRows,
    duplicateRows,
    regionalSettings: Object.freeze({ ...regionalSettings }),
    dataStart: timestamps.length ? Math.min(...timestamps) : undefined,
    dataThrough: timestamps.length ? Math.max(...timestamps) : undefined,
  };
}

export function previewDateRange(preview: GlookoImportPreview) {
  if (preview.dataStart === undefined || preview.dataThrough === undefined) {
    return undefined;
  }
  const timeZone = preview.regionalSettings.timeZone;
  return {
    start: toDateKey(preview.dataStart, timeZone),
    end: toDateKey(preview.dataThrough, timeZone),
  };
}
