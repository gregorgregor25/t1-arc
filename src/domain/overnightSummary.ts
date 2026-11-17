import { formatClock } from './exportTime';
import { presentGlucoseRangeStatistics } from './glucoseRangePresentation';
import {
  calculateGlucoseRangeSummary,
  CONSENSUS_GLUCOSE_THRESHOLDS,
  REPRESENTATIVE_COVERAGE_PERCENT,
  type GlucoseRangeSummary,
} from './glucoseRanges';
import { detectGlucoseEpisodes } from './insights';
import type { ContextNoteEvent, GlucoseReading, HealthContextEvent } from './models';
import type { OvernightWindow } from './overnightWindow';
import { formatGlucose, formatRegionalNumber } from './regionalFormat';
import type { T1ArcRegionalDefaults } from './regionalProfile';

export const OVERNIGHT_LOW_COVERAGE_MESSAGE = 'Not enough sensor data overnight to summarise';

const GLOOKO_ALARM_DETAIL = 'Recorded by Glooko from the connected diabetes device.';
const ALARM_TITLE = /\b(?:alarms?|alerts?|alarm event|urgent low)\b/i;

export interface OvernightExtreme {
  mmolL: number;
  timestamp: number;
}

export type OvernightSummary =
  | {
      status: 'withheld';
      window: OvernightWindow;
      coveragePercent: number;
      message: typeof OVERNIGHT_LOW_COVERAGE_MESSAGE;
    }
  | {
      status: 'shown';
      window: OvernightWindow;
      ranges: GlucoseRangeSummary;
      lowest: OvernightExtreme;
      highest: OvernightExtreme;
      lowEpisodes: number;
      /** Alarm or alert events recorded by a device or app during the night. */
      alarms: ContextNoteEvent[];
    };

/** Device or app alarm records only; the person's own notes are not alarms. */
export function isRecordedAlarmEvent(event: HealthContextEvent): event is ContextNoteEvent {
  if (event.kind !== 'note') return false;
  return event.detail === GLOOKO_ALARM_DETAIL || (event.origin === 'imported' && ALARM_TITLE.test(event.title));
}

function extreme(readings: readonly GlucoseReading[], pick: (left: number, right: number) => boolean): OvernightExtreme {
  // Earliest timestamp wins a tie so the result is stable.
  let chosen = readings[0]!;
  readings.forEach((reading) => {
    if (pick(reading.mmolL, chosen.mmolL)) chosen = reading;
  });
  return { mmolL: chosen.mmolL, timestamp: chosen.timestamp };
}

/**
 * Summarises the readings recorded during last night's window. Below 70%
 * sensor coverage nothing is calculated for display, only the withheld
 * message, so a partial night is never presented as the whole night.
 */
export function buildOvernightSummary(
  window: OvernightWindow,
  glucose: readonly GlucoseReading[],
  context: readonly HealthContextEvent[],
): OvernightSummary {
  const readings = glucose
    .filter((reading) => reading.timestamp >= window.range.start && reading.timestamp < window.range.end)
    .sort((left, right) => left.timestamp - right.timestamp);
  const ranges = calculateGlucoseRangeSummary({ readings, range: window.range });
  if (!readings.length || !ranges.representative || ranges.coveragePercent < REPRESENTATIVE_COVERAGE_PERCENT) {
    return { status: 'withheld', window, coveragePercent: ranges.coveragePercent, message: OVERNIGHT_LOW_COVERAGE_MESSAGE };
  }
  return {
    status: 'shown',
    window,
    ranges,
    lowest: extreme(readings, (value, current) => value < current),
    highest: extreme(readings, (value, current) => value > current),
    lowEpisodes: detectGlucoseEpisodes(readings, 'low').length,
    alarms: context
      .filter(isRecordedAlarmEvent)
      .filter((event) => event.start >= window.range.start && event.start < window.range.end)
      .sort((left, right) => left.start - right.start),
  };
}

type Settings = Pick<T1ArcRegionalDefaults, 'locale' | 'timeZone' | 'glucoseUnit'>;

export interface OvernightSummaryText {
  title: string;
  period: string;
  lines: string[];
}

/** Neutral, template-only wording for the Today card. */
export function overnightSummaryText(summary: OvernightSummary, settings: Settings): OvernightSummaryText {
  const { window } = summary;
  const title = window.inProgress ? 'Last night so far' : 'Last night';
  const period = `${formatClock(window.range.start, settings)}–${formatClock(window.range.end, settings)}${window.source === 'alarm-schedule' ? ' · your night alert hours' : ''}`;
  if (summary.status === 'withheld') return { title, period, lines: [`${summary.message}.`] };
  const presentation = presentGlucoseRangeStatistics(summary.ranges, settings);
  const count = (value: number) => formatRegionalNumber(value, settings.locale, { maximumFractionDigits: 0 });
  const low = formatGlucose(CONSENSUS_GLUCOSE_THRESHOLDS.rangeLower.mmolL, settings);
  const alarmLine = summary.alarms.length
    ? `Alarms recorded: ${count(summary.alarms.length)} (${summary.alarms.slice(0, 3).map((alarm) => `${alarm.title} at ${formatClock(alarm.start, settings)}`).join('; ')}${summary.alarms.length > 3 ? '; …' : ''}).`
    : undefined;
  return {
    title,
    period,
    lines: [
      `Sensor coverage: ${presentation.coverage} (${count(summary.ranges.sampleCount)} readings).`,
      `Time in each band: ${presentation.bands.map((band) => `${band.name.toLowerCase()} ${band.value}`).join(', ')}.`,
      `Lowest ${formatGlucose(summary.lowest.mmolL, settings)} at ${formatClock(summary.lowest.timestamp, settings)}. Highest ${formatGlucose(summary.highest.mmolL, settings)} at ${formatClock(summary.highest.timestamp, settings)}.`,
      `Low episodes (below ${low} for at least 15 minutes): ${count(summary.lowEpisodes)}.`,
      ...(alarmLine ? [alarmLine] : []),
    ],
  };
}
