import { formatClockNear } from './exportTime';
import { presentGlucoseRangeStatistics } from './glucoseRangePresentation';
import {
  CONSENSUS_GLUCOSE_THRESHOLDS,
  type GlucoseTargetRange,
} from './glucoseRanges';
import { detectGlucoseEpisodes } from './insights';
import type { TimeRange } from './models';
import { lastNightWindow, type NightSchedule } from './overnightWindow';
import {
  summarizePeriod,
  type PeriodSummary,
  type PeriodSummaryTimeline,
} from './periodSummary';
import {
  carbSummaryLines,
  formatGlucoseSpread,
  insulinSummaryLines,
  periodLabel,
  type SummarySettings,
} from './periodSummaryText';
import { formatGlucose, formatRegionalNumber } from './regionalFormat';
import { addDays, toDateKey, zonedDateTimeToTimestamp } from './time';

export type PeriodSummaryChoice = 'today' | 'last-night' | '7' | '14' | '30';

export const PERIOD_SUMMARY_CHOICES: readonly {
  value: PeriodSummaryChoice;
  label: string;
  accessibilityLabel: string;
}[] = [
  { value: 'today', label: 'Today', accessibilityLabel: 'Today so far' },
  { value: 'last-night', label: 'Night', accessibilityLabel: 'Last night' },
  { value: '7', label: '7D', accessibilityLabel: 'Last 7 complete days' },
  { value: '14', label: '14D', accessibilityLabel: 'Last 14 complete days' },
  { value: '30', label: '30D', accessibilityLabel: 'Last 30 complete days' },
];

export interface PeriodSummaryRequest {
  choice: PeriodSummaryChoice;
  title: string;
  range: TimeRange;
}

/**
 * Today runs from local midnight to now. Last night uses the alarm night
 * schedule when one is set, otherwise 00:00–06:00. Multi-day choices are
 * complete local calendar days ending at midnight today, as in Insights.
 */
export function periodSummaryRequest(
  choice: PeriodSummaryChoice,
  now: number,
  timeZone: string,
  nightSchedule?: NightSchedule | null,
): PeriodSummaryRequest {
  const today = toDateKey(now, timeZone);
  const midnight = zonedDateTimeToTimestamp(today, 0, 0, 0, timeZone);
  if (choice === 'today') {
    return { choice, title: 'Today so far', range: { start: midnight, end: Math.max(midnight, now) } };
  }
  if (choice === 'last-night') {
    const night = lastNightWindow(now, timeZone, nightSchedule);
    return { choice, title: night.inProgress ? 'Last night so far' : 'Last night', range: night.range };
  }
  const days = Number(choice);
  return {
    choice,
    title: `Last ${days} complete days`,
    range: {
      start: zonedDateTimeToTimestamp(addDays(today, -days), 0, 0, 0, timeZone),
      end: midnight,
    },
  };
}

export interface PeriodNarrativeSection {
  title: string;
  lines: string[];
}

export interface PeriodNarrative {
  title: string;
  period: string;
  sections: PeriodNarrativeSection[];
  footer: string;
  summary: PeriodSummary;
  lowEpisodes: number;
  highEpisodes: number;
}

function count(value: number, settings: SummarySettings) {
  return formatRegionalNumber(value, settings.locale, { maximumFractionDigits: 0 });
}

function decimal(value: number, settings: SummarySettings) {
  return formatRegionalNumber(value, settings.locale, { minimumFractionDigits: 0, maximumFractionDigits: 1 });
}

function plural(value: number, one: string, many: string, settings: SummarySettings) {
  return `${count(value, settings)} ${value === 1 ? one : many}`;
}

export const PERIOD_SUMMARY_FOOTER =
  'Prepared on this phone from your records. No AI service was used. Figures describe the recorded readings only and are not treatment advice.';

/**
 * Key-free, template-only plain-language summary of a period. Every figure
 * names its range; GMI appears only under the GMI rules; coverage below 70%
 * is stated before the figures. No wording judges the result.
 */
export function buildPeriodNarrative(
  request: Pick<PeriodSummaryRequest, 'title' | 'range'>,
  timeline: Omit<PeriodSummaryTimeline, 'range'>,
  personalRange: GlucoseTargetRange | null,
  settings: SummarySettings,
  now: number,
): PeriodNarrative {
  const summary = summarizePeriod({ ...timeline, range: request.range }, personalRange);
  const presentation = presentGlucoseRangeStatistics(summary.ranges, settings);
  const glucose = timeline.glucose.filter(
    (reading) => reading.timestamp >= request.range.start && reading.timestamp < request.range.end,
  );
  const lowEpisodes = glucose.length ? detectGlucoseEpisodes(glucose, 'low').length : 0;
  const highEpisodes = glucose.length ? detectGlucoseEpisodes(glucose, 'high').length : 0;
  const sections: PeriodNarrativeSection[] = [];

  const coverageLines: string[] = [];
  if (!presentation.observed) {
    coverageLines.push('No sensor readings were recorded in this period, so glucose figures are not available.');
  } else {
    coverageLines.push(
      `Sensor readings cover ${presentation.coverage} of this period (${plural(summary.ranges.sampleCount, 'reading', 'readings', settings)}).`,
    );
    if (presentation.coverageNotice) coverageLines.push(presentation.coverageNotice);
    if (summary.glucoseSourceLabels.length) {
      coverageLines.push(`Glucose source: ${summary.glucoseSourceLabels.join(', ')}.`);
    }
    if (summary.glucoseThrough !== undefined) {
      coverageLines.push(`Readings through ${formatClockNear(summary.glucoseThrough, Math.min(now, request.range.end), settings)}.`);
    }
  }
  sections.push({ title: 'Coverage', lines: coverageLines });

  if (presentation.observed) {
    const [standard, tight, personal] = presentation.ranges;
    sections.push({
      title: 'Time in ranges',
      lines: [
        `${standard!.label}: ${standard!.value} of recorded time in range.`,
        ...presentation.bands.map((band) => `${band.name} (${band.bounds}): ${band.value}`),
        `${tight!.label}: ${tight!.value} in range.`,
        ...(personal ? [`${personal.label} (your own setting): ${personal.value} in range.`] : []),
      ],
    });

    const stats = summary.statistics;
    const glucoseLines: string[] = [];
    if (stats.arithmeticMeanMmolL !== null) {
      glucoseLines.push(`Average glucose: ${formatGlucose(stats.arithmeticMeanMmolL, settings)}.`);
    }
    glucoseLines.push(
      summary.gmi.status === 'shown'
        ? `GMI: ${decimal(summary.gmi.percent, settings)}% (${count(summary.gmi.mmolMol, settings)} mmol/mol).`
        : `GMI not shown. ${summary.gmi.reason}`,
    );
    if (stats.populationStandardDeviationMmolL !== null && stats.coefficientOfVariationPercent !== null) {
      glucoseLines.push(
        `Variability: standard deviation ${formatGlucoseSpread(stats.populationStandardDeviationMmolL, settings)}, coefficient of variation ${decimal(stats.coefficientOfVariationPercent, settings)}%.`,
      );
    }
    sections.push({ title: 'Glucose', lines: glucoseLines });

    const low = formatGlucose(CONSENSUS_GLUCOSE_THRESHOLDS.rangeLower.mmolL, settings);
    const high = formatGlucose(CONSENSUS_GLUCOSE_THRESHOLDS.rangeUpper.mmolL, settings);
    sections.push({
      title: 'Episodes',
      lines: [
        `Low episodes (below ${low} for at least 15 minutes): ${count(lowEpisodes, settings)}.`,
        `High episodes (above ${high} for at least 15 minutes): ${count(highEpisodes, settings)}.`,
      ],
    });
  }

  const insulin = insulinSummaryLines(summary, now, settings).map((line) => line.trim());
  sections.push({
    title: 'Insulin',
    lines: insulin.length ? insulin : ['No insulin records were found for this period.'],
  });
  const carbs = carbSummaryLines(summary, now, settings).map((line) => line.trim());
  if (carbs.length) sections.push({ title: 'Carbohydrate', lines: carbs });

  return {
    title: request.title,
    period: periodLabel(summary, settings),
    sections,
    footer: PERIOD_SUMMARY_FOOTER,
    summary,
    lowEpisodes,
    highEpisodes,
  };
}

/** Plain text of a narrative, for copying. */
export function periodNarrativeText(narrative: PeriodNarrative) {
  return [
    `${narrative.title} · ${narrative.period}`,
    ...narrative.sections.flatMap((section) => ['', `${section.title}:`, ...section.lines]),
    '',
    narrative.footer,
  ].join('\n');
}
