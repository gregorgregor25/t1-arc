import {
  DailyPumpModeSummary,
  GlookoPumpSettingsSnapshot,
  PumpModePercentSummary,
  PumpSettingScheduleSegment,
} from './glookoReport';
import { ImportRawRecord } from '@/data/persistence/HealthRecordStore';
import {
  EvidenceRecordPreview,
  EvidenceReference,
  InsightFinding,
} from '@/domain/insights';
import { TimeRange } from '@/domain/models';
import { formatRegionalNumber } from '@/domain/regionalFormat';
import { getRuntimeRegionalDefaults } from '@/domain/regionalProfileRuntime';
import { formatGlookoPumpScheduleSegment } from './glookoReportPresentation';

interface ReportPayloadRange {
  reportStart?: number;
  reportEnd?: number;
}

function parsePayload<T extends object>(
  record: ImportRawRecord,
): (T & ReportPayloadRange) | undefined {
  try {
    const value = JSON.parse(record.payloadJson) as unknown;
    return typeof value === 'object' && value !== null
      ? (value as T & ReportPayloadRange)
      : undefined;
  } catch {
    return undefined;
  }
}

function latest(
  records: ImportRawRecord[],
  kind: 'pump-mode-summary' | 'pump-settings',
) {
  return records
    .filter((record) => record.recordKind === kind)
    .sort((left, right) => right.importedAt - left.importedAt)[0];
}

function dailyModeRecords(records: ImportRawRecord[], range: TimeRange) {
  return records
    .filter(
      (record) =>
        record.recordKind === 'pump-mode-daily' &&
        record.timestamp !== undefined &&
        record.timestamp >= range.start &&
        record.timestamp < range.end,
    )
    .sort(
      (left, right) =>
        (left.timestamp ?? 0) - (right.timestamp ?? 0) ||
        right.importedAt - left.importedAt,
    );
}

function pumpStateRecords(records: ImportRawRecord[], range: TimeRange) {
  return records
    .filter((record) => {
      if (record.recordKind !== 'pump-state-interval') return false;
      const payload = parsePayload<{
        start?: number;
        end?: number;
        kind?: string;
      }>(record);
      return (
        payload?.start !== undefined &&
        payload.end !== undefined &&
        payload.start < range.end &&
        payload.end > range.start
      );
    })
    .sort(
      (left, right) =>
        (left.timestamp ?? 0) - (right.timestamp ?? 0),
    );
}

function evidenceRange(
  payload: ReportPayloadRange,
  record: ImportRawRecord,
  fallback: TimeRange,
) {
  const start = payload.reportStart ?? record.timestamp ?? fallback.start;
  const end = payload.reportEnd ?? (record.timestamp ?? fallback.end) + 1;
  return { start, end: Math.max(start + 1, end) };
}

function percent(value: number | undefined) {
  return value === undefined ? undefined : `${regionalNumber(value)}%`;
}

function regionalNumber(value: number, maximumFractionDigits = 2) {
  return formatRegionalNumber(value, getRuntimeRegionalDefaults().locale, {
    maximumFractionDigits,
  });
}

function modeSummary(payload: PumpModePercentSummary) {
  return [
    ['Automated', percent(payload.automatedPercent)],
    ['Activity', percent(payload.activityPercent)],
    ['Limited', percent(payload.limitedPercent)],
    ['Manual', percent(payload.manualPercent)],
  ]
    .filter((item): item is [string, string] => Boolean(item[1]))
    .map(([label, value]) => `${label} ${value}`)
    .join(' · ');
}

function scheduleSummary(
  label: string,
  segments: PumpSettingScheduleSegment[],
) {
  if (!segments.length) return undefined;
  return `${label}: ${segments
    .map((segment) =>
      formatGlookoPumpScheduleSegment(
        segment,
        getRuntimeRegionalDefaults(),
      ),
    )
    .join(', ')}`;
}

function settingsSummary(payload: GlookoPumpSettingsSnapshot) {
  const facts = [
    payload.activeCgm ? `CGM: ${payload.activeCgm}` : undefined,
    payload.activeInsulinHours === undefined
      ? undefined
      : `active insulin: ${regionalNumber(payload.activeInsulinHours)} h`,
    payload.activeBasalProgram
      ? `basal programme: ${payload.activeBasalProgram}`
      : undefined,
    payload.maxBasalRateUnitsPerHour === undefined
      ? undefined
      : `max basal: ${regionalNumber(payload.maxBasalRateUnitsPerHour)} U/h`,
    payload.maxBolusUnits === undefined
      ? undefined
      : `max bolus: ${regionalNumber(payload.maxBolusUnits)} U`,
    scheduleSummary('basal', payload.basalSchedule),
    scheduleSummary('carb ratio', payload.carbRatioSchedule),
    scheduleSummary('sensitivity', payload.sensitivitySchedule),
    scheduleSummary('target', payload.targetSchedule),
    scheduleSummary(
      'correction threshold',
      payload.correctionThresholdSchedule,
    ),
  ].filter((value): value is string => Boolean(value));
  return facts.join(' · ');
}

function sourcePreview(
  record: ImportRawRecord,
  timestamp: number,
  primary: string,
  secondary: string,
): EvidenceRecordPreview {
  return {
    id: record.id,
    kind: 'source-record',
    timestamp,
    primary,
    secondary,
    sourceId: record.sourceId,
  };
}

export function buildGlookoReportFindings(
  records: ImportRawRecord[],
  fallbackRange: TimeRange,
): InsightFinding[] {
  const findings: InsightFinding[] = [];
  const modeRecord = latest(records, 'pump-mode-summary');
  const dailyModes = dailyModeRecords(records, fallbackRange);
  const pumpStates = pumpStateRecords(records, fallbackRange);
  const payload = modeRecord
    ? parsePayload<PumpModePercentSummary>(modeRecord)
    : undefined;
  const summary = payload ? modeSummary(payload) : '';
  if (
    (modeRecord && payload && summary) ||
    dailyModes.length ||
    pumpStates.length
  ) {
    const range =
      modeRecord && payload
        ? evidenceRange(payload, modeRecord, fallbackRange)
        : fallbackRange;
    const evidence: EvidenceReference[] = [];
    if (modeRecord && payload && summary) {
      evidence.push({
        id: 'glooko-pump-mode-report',
        label: 'Pump operating-mode report',
        description:
          'Percentages extracted locally from the retained Glooko System Details PDF',
        range,
        recordIds: [modeRecord.id],
        examples: [
          sourcePreview(
            modeRecord,
            modeRecord.timestamp ?? range.end - 1,
            'Omnipod operating modes',
            summary,
          ),
        ],
      });
    }
    if (dailyModes.length) {
      evidence.push({
        id: 'glooko-daily-pump-modes',
        label: 'Daily pump operating modes',
        description:
          'Per-day percentages extracted locally from overlapping Glooko Daily Overview reports',
        range: fallbackRange,
        recordIds: dailyModes.map((record) => record.id),
        examples: dailyModes.slice(-7).map((record) => {
          const daily = parsePayload<
            DailyPumpModeSummary['summary'] & { dateKey?: string }
          >(record);
          return sourcePreview(
            record,
            record.timestamp ?? fallbackRange.end - 1,
            daily?.dateKey ?? 'Daily Omnipod modes',
            daily ? modeSummary(daily) : 'Mode percentages recorded',
          );
        }),
      });
    }
    if (pumpStates.length) {
      evidence.push({
        id: 'glooko-pump-state-intervals',
        label: 'Pump state timeline',
        description:
          'Exact Activity mode and automated-pause windows extracted locally from the Glooko Daily Overview tracks',
        range: fallbackRange,
        recordIds: pumpStates.map((record) => record.id),
        examples: pumpStates.slice(-12).map((record) => {
          const state = parsePayload<{
            start?: number;
            end?: number;
            kind?: string;
          }>(record);
          const start = state?.start ?? record.timestamp ?? fallbackRange.start;
          const end = state?.end ?? start;
          const minutes = Math.max(0, Math.round((end - start) / 60_000));
          return sourcePreview(
            record,
            start,
            state?.kind === 'activity-mode'
              ? 'Activity mode'
              : 'Automated pause',
            `${regionalNumber(minutes, 0)} minutes`,
          );
        }),
      });
    }
    findings.push({
      id: 'glooko-pump-modes',
      kind: 'context-clue',
      category: 'insulin',
      title: 'Omnipod operating modes are available for this report period',
      summary:
        summary
          ? `The Glooko System Details report records ${summary}. These percentages can be compared with glucose outcomes for the same period.`
          : pumpStates.length
            ? `${regionalNumber(pumpStates.length, 0)} exact Activity mode or automated-pause windows are available for this period.`
            : `Daily operating-mode evidence is available for ${regionalNumber(dailyModes.length, 0)} days in this period.`,
      caveat:
        pumpStates.length
          ? 'Daily percentages summarise the full day; the linked state timeline supplies the exact Activity mode and automated-pause windows shown in the graphs.'
          : 'Activity and Limited are available as daily percentages for this report period.',
      evidence,
    });
  }

  const settingsRecord = latest(records, 'pump-settings');
  if (settingsRecord) {
    const payload = parsePayload<GlookoPumpSettingsSnapshot>(settingsRecord);
    if (payload) {
      const range = evidenceRange(payload, settingsRecord, fallbackRange);
      const scheduleSegments =
        payload.basalSchedule.length +
        payload.carbRatioSchedule.length +
        payload.sensitivitySchedule.length +
        payload.targetSchedule.length +
        payload.correctionThresholdSchedule.length;
      findings.push({
        id: 'glooko-pump-settings',
        kind: 'observation',
        category: 'insulin',
        title: 'Pump settings are available as report evidence',
        summary: `The retained Glooko report contains the active pump configuration and ${regionalNumber(scheduleSegments, 0)} time-based basal, carb-ratio, sensitivity, target or correction-threshold entries.`,
        caveat:
          'This is a historical settings snapshot from the report, not a live view of the pump and not a record of automatic micro-delivery.',
        evidence: [
          {
            id: 'glooko-pump-settings-report',
            label: 'Pump settings report',
            description:
              'Settings and schedules extracted locally from the retained Glooko PDF',
            range,
            recordIds: [settingsRecord.id],
            examples: [
              sourcePreview(
                settingsRecord,
                settingsRecord.timestamp ?? range.end - 1,
                'Omnipod settings snapshot',
                settingsSummary(payload),
              ),
            ],
          },
        ],
      });
    }
  }
  return findings;
}
