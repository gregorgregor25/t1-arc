import { ImportRawRecord } from '@/data/persistence/HealthRecordStore';
import { GLOOKO_SOURCE_ID } from '@/data/import/glookoCsv';
import {
  addDays,
  DateKey,
  dayRange,
  zonedDateTimeToTimestamp,
} from '@/domain/time';
import { PumpStateInterval, PumpStateKind } from '@/domain/models';

export interface PumpModePercentSummary {
  automatedPercent?: number;
  activityPercent?: number;
  limitedPercent?: number;
  manualPercent?: number;
}

export interface DailyPumpModeSummary {
  dateKey: DateKey;
  timestamp: number;
  summary: PumpModePercentSummary;
}

export interface PumpSettingScheduleSegment {
  startTime: string;
  durationMinutes: number;
  value: number;
  unit: 'U/h' | 'g/U' | 'mmol/L';
}

export interface GlookoPumpSettingsSnapshot {
  activeCgm?: string;
  activeInsulinHours?: number;
  activeBasalProgram?: string;
  maxBasalRateUnitsPerHour?: number;
  temporaryBasalEnabled?: boolean;
  extendedBolusEnabled?: boolean;
  maxBolusUnits?: number;
  minimumBgForBolusCalculationMmolL?: number;
  reverseCorrectionEnabled?: boolean;
  glucoseHighAlertEnabled?: boolean;
  glucoseHighAlertLimitMmolL?: number;
  glucoseLowAlertEnabled?: boolean;
  glucoseLowAlertLimitMmolL?: number;
  signalLossAlertEnabled?: boolean;
  basalSchedule: PumpSettingScheduleSegment[];
  carbRatioSchedule: PumpSettingScheduleSegment[];
  sensitivitySchedule: PumpSettingScheduleSegment[];
  targetSchedule: PumpSettingScheduleSegment[];
  correctionThresholdSchedule: PumpSettingScheduleSegment[];
}

export interface GlookoReportPreview {
  reportStart?: number;
  reportEnd?: number;
  modeSummary?: PumpModePercentSummary;
  dailyModeSummaries: DailyPumpModeSummary[];
  pumpStateIntervals: PumpStateInterval[];
  settings?: GlookoPumpSettingsSnapshot;
  warnings: string[];
}

export interface PumpTrackIntervalInput {
  dateLabel: string;
  startMinute: number;
  endMinute: number;
  kind: PumpStateKind;
  pageNumber: number;
}

const MONTHS: Record<string, number> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  oct: 10,
  nov: 11,
  dec: 12,
};

function reportDate(day: string, month: string, year: string): DateKey | undefined {
  const monthNumber = MONTHS[month.toLowerCase().slice(0, 3)];
  if (!monthNumber) return undefined;
  return `${year}-${String(monthNumber).padStart(2, '0')}-${String(day).padStart(
    2,
    '0',
  )}` as DateKey;
}

function reportDateWithinRange(
  day: string,
  month: string,
  startDate: DateKey | undefined,
  endDate: DateKey | undefined,
) {
  if (!startDate || !endDate) return undefined;
  const startYear = Number(startDate.slice(0, 4));
  const endYear = Number(endDate.slice(0, 4));
  for (let year = startYear; year <= endYear; year += 1) {
    const candidate = reportDate(day, month, String(year));
    if (candidate && candidate >= startDate && candidate <= endDate) {
      return candidate;
    }
  }
  return undefined;
}

function percent(text: string, label: RegExp) {
  const match = text.match(
    new RegExp(`${label.source}\\s+(\\d{1,3}(?:\\.\\d+)?)%`, 'i'),
  );
  const value = match ? Number(match[1]) : undefined;
  return value !== undefined && value >= 0 && value <= 100
    ? value
    : undefined;
}

function scalarText(text: string, label: string) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return text
    .match(
      new RegExp(
        `(?:^|\\s{2,})${escaped}\\s{2,}(.+?)(?:\\s{2,}|$)`,
        'im',
      ),
    )?.[1]
    ?.trim();
}

function scalarNumber(text: string, label: string) {
  const value = scalarText(text, label)?.match(/-?\d+(?:\.\d+)?/)?.[0];
  return value === undefined ? undefined : Number(value);
}

function scalarBoolean(text: string, label: string) {
  const value = scalarText(text, label)?.toUpperCase();
  return value === 'ON' ? true : value === 'OFF' ? false : undefined;
}

function section(text: string, start: string, end?: string) {
  const from = text.indexOf(start);
  if (from < 0) return '';
  const to = end ? text.indexOf(end, from + start.length) : -1;
  return text.slice(from, to < 0 ? undefined : to);
}

function schedule(
  text: string,
  sourceUnit: 'Units/hr' | 'g/Unit' | 'mmol/L',
  unit: PumpSettingScheduleSegment['unit'],
) {
  const escapedUnit = sourceUnit.replace('/', '\\/');
  const pattern = new RegExp(
    `(\\d{2}:\\d{2})\\s+\\((\\d+(?:\\.\\d+)?)\\s*(?:hr|hrs|hours?)\\)\\s+` +
      `(\\d+(?:\\.\\d+)?)(?:\\s+\\([^)]*\\))?\\s+${escapedUnit}`,
    'gi',
  );
  return [...text.matchAll(pattern)].map((match) => ({
    startTime: match[1]!,
    durationMinutes: Math.round(Number(match[2]) * 60),
    value: Number(match[3]),
    unit,
  }));
}

function parseSettings(text: string): GlookoPumpSettingsSnapshot | undefined {
  const page = text
    .split('\f')
    .find(
      (candidate) =>
        candidate.includes('Active basal program') &&
        candidate.includes('Insulin: Carb Ratios'),
    );
  if (!page) return undefined;
  const sensitivity = section(
    page,
    'Sensitivity (ISF, correction)',
    'Insulin: Carb Ratios',
  );
  const ratiosAndTargets = section(
    page,
    'Insulin: Carb Ratios',
    'BG correction threshold',
  );
  const correction = section(page, 'BG correction threshold', 'Confidential');
  const activeInsulin = scalarNumber(page, 'Active Insulin Time');
  return {
    activeCgm: scalarText(page, 'Active CGM'),
    activeInsulinHours: activeInsulin,
    activeBasalProgram: scalarText(page, 'Active basal program'),
    maxBasalRateUnitsPerHour: scalarNumber(page, 'Max Basal Rate'),
    temporaryBasalEnabled: scalarBoolean(page, 'Temporary Basal Enabled'),
    extendedBolusEnabled: scalarBoolean(page, 'Extended Bolus'),
    maxBolusUnits: scalarNumber(page, 'Max Bolus'),
    minimumBgForBolusCalculationMmolL: scalarNumber(
      page,
      'Min BG for Bolus Calc',
    ),
    reverseCorrectionEnabled: scalarBoolean(page, 'Reverse Correction'),
    glucoseHighAlertEnabled: scalarBoolean(
      page,
      'Glucose High Alert Enabled',
    ),
    glucoseHighAlertLimitMmolL: scalarNumber(
      page,
      'Glucose High Alert Limit',
    ),
    glucoseLowAlertEnabled: scalarBoolean(page, 'Glucose Low Alert Enabled'),
    glucoseLowAlertLimitMmolL: scalarNumber(page, 'Glucose Low Alert Limit'),
    signalLossAlertEnabled: scalarBoolean(page, 'Signal Loss Alert'),
    basalSchedule: schedule(page, 'Units/hr', 'U/h'),
    carbRatioSchedule: schedule(ratiosAndTargets, 'g/Unit', 'g/U'),
    sensitivitySchedule: schedule(sensitivity, 'mmol/L', 'mmol/L'),
    targetSchedule: schedule(ratiosAndTargets, 'mmol/L', 'mmol/L'),
    correctionThresholdSchedule: schedule(
      correction,
      'mmol/L',
      'mmol/L',
    ),
  };
}

function parseDailyModeSummaries(
  text: string,
  startDate: DateKey | undefined,
  endDate: DateKey | undefined,
): DailyPumpModeSummary[] {
  const byDate = new Map<DateKey, DailyPumpModeSummary>();
  for (const page of text.split('\f')) {
    if (
      !page.includes('Daily Overview') ||
      !page.includes('System Details') ||
      !page.includes('Automated Mode')
    ) {
      continue;
    }
    const dateMatch = page.match(
      /System Details[\s\S]{0,240}?(\d{1,2})\/([A-Za-z]{3})\b/i,
    );
    const dateKey = dateMatch
      ? reportDateWithinRange(
          dateMatch[1]!,
          dateMatch[2]!,
          startDate,
          endDate,
        )
      : undefined;
    if (!dateKey) continue;
    const summary: PumpModePercentSummary = {
      automatedPercent: percent(page, /Automated Mode/),
      activityPercent: percent(page, /Automated:\s*Activity/),
      limitedPercent: percent(page, /Automated:\s*Limited/),
      manualPercent: percent(page, /Manual(?:\s+Mode)?/),
    };
    if (
      !Object.values(summary).some((value) => value !== undefined)
    ) {
      continue;
    }
    byDate.set(dateKey, {
      dateKey,
      timestamp: dayRange(dateKey).end - 1,
      summary,
    });
  }
  return [...byDate.values()].sort((left, right) =>
    left.dateKey.localeCompare(right.dateKey),
  );
}

function pumpStateIntervals(
  tracks: PumpTrackIntervalInput[],
  startDate: DateKey | undefined,
  endDate: DateKey | undefined,
) {
  if (!startDate || !endDate) return [];
  return tracks.flatMap((track): PumpStateInterval[] => {
    const match = track.dateLabel.match(/^(\d{1,2})\/([A-Za-z]{3})$/);
    const dateKey = match
      ? reportDateWithinRange(
          match[1]!,
          match[2]!,
          startDate,
          endDate,
        )
      : undefined;
    const validMinutes =
      Number.isInteger(track.startMinute) &&
      Number.isInteger(track.endMinute) &&
      track.startMinute >= 0 &&
      track.endMinute <= 24 * 60 &&
      track.endMinute > track.startMinute;
    if (!dateKey || !validMinutes) return [];
    const start = zonedDateTimeToTimestamp(
      dateKey,
      Math.floor(track.startMinute / 60),
      track.startMinute % 60,
    );
    const end =
      track.endMinute === 24 * 60
        ? zonedDateTimeToTimestamp(addDays(dateKey, 1))
        : zonedDateTimeToTimestamp(
            dateKey,
            Math.floor(track.endMinute / 60),
            track.endMinute % 60,
          );
    if (end <= start) return [];
    return [
      {
        id: `${GLOOKO_SOURCE_ID}:pump-state:${track.kind}:${start}`,
        start,
        end,
        kind: track.kind,
        sourceId: GLOOKO_SOURCE_ID,
        sourcePage: track.pageNumber,
      },
    ];
  });
}

export function parseGlookoReportText(
  text: string,
  tracks: PumpTrackIntervalInput[] = [],
): GlookoReportPreview {
  const normalised = text.replace(/\u00a0/g, ' ');
  const range = normalised.match(
    /(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun),\s*(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})\s*-\s*(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun),\s*(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})/i,
  );
  const startDate = range
    ? reportDate(range[1]!, range[2]!, range[3]!)
    : undefined;
  const endDate = range
    ? reportDate(range[4]!, range[5]!, range[6]!)
    : undefined;
  const modeSummary: PumpModePercentSummary = {
    automatedPercent: percent(normalised, /Automated Mode/),
    activityPercent: percent(normalised, /Automated:\s*Activity/),
    limitedPercent: percent(normalised, /Automated:\s*Limited/),
    manualPercent: percent(normalised, /Manual Mode/),
  };
  const hasModeSummary = Object.values(modeSummary).some(
    (value) => value !== undefined,
  );
  const dailyModeSummaries = parseDailyModeSummaries(
    normalised,
    startDate,
    endDate,
  );
  const settings = parseSettings(normalised);
  const exactPumpStates = pumpStateIntervals(tracks, startDate, endDate);
  const warnings: string[] = [];
  if (!hasModeSummary) {
    warnings.push('No Omnipod operating-mode summary was found in this report.');
  }
  if (!settings) {
    warnings.push('No Omnipod device-settings page was found in this report.');
  }
  return {
    reportStart:
      startDate === undefined
        ? undefined
        : zonedDateTimeToTimestamp(startDate, 0),
    reportEnd: endDate === undefined ? undefined : dayRange(endDate).end,
    modeSummary: hasModeSummary ? modeSummary : undefined,
    dailyModeSummaries,
    pumpStateIntervals: exactPumpStates,
    settings,
    warnings,
  };
}

function stableHash(value: string) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash = Math.imul(hash ^ value.charCodeAt(index), 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

export function glookoReportRawRecords(
  preview: GlookoReportPreview,
  sourceFile: string,
  importedAt: number,
): ImportRawRecord[] {
  const timestamp = preview.reportEnd ?? importedAt;
  const items: Array<{
    recordKind: string;
    value:
      | PumpModePercentSummary
      | (PumpModePercentSummary & { dateKey: DateKey })
      | GlookoPumpSettingsSnapshot;
  }> = [];
  if (preview.modeSummary) {
    items.push({
      recordKind: 'pump-mode-summary',
      value: preview.modeSummary,
    });
  }
  preview.dailyModeSummaries.forEach((daily) => {
    items.push({
      recordKind: 'pump-mode-daily',
      value: {
        dateKey: daily.dateKey,
        ...daily.summary,
      },
    });
  });
  if (preview.settings) {
    items.push({
      recordKind: 'pump-settings',
      value: preview.settings,
    });
  }
  const summaryRecords = items.map((item, index) => {
    const dailyDate =
      item.recordKind === 'pump-mode-daily' &&
      'dateKey' in item.value &&
      typeof item.value.dateKey === 'string'
        ? (item.value.dateKey as DateKey)
        : undefined;
    const dailyRange =
      dailyDate === undefined ? undefined : dayRange(dailyDate);
    const payloadJson = JSON.stringify({
      reportStart: dailyRange?.start ?? preview.reportStart,
      reportEnd: dailyRange?.end ?? preview.reportEnd,
      ...item.value,
    });
    return {
      id: `${GLOOKO_SOURCE_ID}:raw:${item.recordKind}:${stableHash(
        payloadJson,
      )}`,
      sourceId: GLOOKO_SOURCE_ID,
      recordKind: item.recordKind,
      timestamp:
        dailyDate === undefined ? timestamp : dayRange(dailyDate).end - 1,
      sourceFile,
      sourceRow: index + 1,
      payloadJson,
      importedAt,
    };
  });
  const stateRecords = preview.pumpStateIntervals.map((state, index) => {
    const payloadJson = JSON.stringify({
      start: state.start,
      end: state.end,
      kind: state.kind,
      sourcePage: state.sourcePage,
    });
    return {
      id: state.id,
      sourceId: GLOOKO_SOURCE_ID,
      recordKind: 'pump-state-interval',
      timestamp: state.start,
      sourceFile,
      sourceRow: summaryRecords.length + index + 1,
      payloadJson,
      importedAt,
    } satisfies ImportRawRecord;
  });
  return [...summaryRecords, ...stateRecords];
}
