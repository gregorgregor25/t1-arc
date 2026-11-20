import { presentGlucoseRangeStatistics } from './glucoseRangePresentation';
import {
  describeTimeZone,
  formatClockNear,
  formatDay,
} from './exportTime';
import type { PeriodSummary } from './periodSummary';
import { formatGlucose, formatRegionalNumber } from './regionalFormat';
import type { T1ArcRegionalDefaults } from './regionalProfile';
import { MG_DL_PER_MMOL_L } from './models';

export type SummarySettings = Pick<T1ArcRegionalDefaults, 'locale' | 'timeZone' | 'glucoseUnit'>;

function number(value: number, settings: SummarySettings, digits = 1) {
  return formatRegionalNumber(value, settings.locale, {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
  });
}

function units(value: number, settings: SummarySettings) {
  return `${formatRegionalNumber(value, settings.locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} U`;
}

/** "9 Nov 2026 – 15 Nov 2026 (7 days)" in the person's time zone. */
export function periodLabel(summary: Pick<PeriodSummary, 'range' | 'lengthDays'>, settings: SummarySettings) {
  const start = formatDay(summary.range.start, settings);
  const end = formatDay(Math.max(summary.range.start, summary.range.end - 1), settings);
  const span = summary.lengthDays >= 1
    ? `${number(summary.lengthDays, settings)} ${summary.lengthDays === 1 ? 'day' : 'days'}`
    : `${number(Math.max(0, (summary.range.end - summary.range.start) / 3_600_000), settings, 0)} hours`;
  return `${start === end ? start : `${start} – ${end}`} (${span})`;
}

/** Standard deviation in the display unit, for example "2.9 mmol/L" or "52 mg/dL". */
export function formatGlucoseSpread(mmolL: number, settings: SummarySettings) {
  return settings.glucoseUnit === 'mgDl'
    ? `${formatRegionalNumber(Math.round(mmolL * MG_DL_PER_MMOL_L), settings.locale, { maximumFractionDigits: 0 })} mg/dL`
    : `${formatRegionalNumber(mmolL, settings.locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} mmol/L`;
}

export function insulinSummaryLines(summary: PeriodSummary, now: number, settings: SummarySettings): string[] {
  const insulin = summary.insulin;
  if (!insulin) return [];
  const stats = insulin.summary.stats;
  const lines = [
    `Insulin recorded: ${units(stats.totalUnits, settings)} total · basal ${units(stats.basalUnits, settings)} · bolus ${units(stats.bolusUnits, settings)}${insulin.summary.extraInjectionUnits ? ` · extra injections ${units(insulin.summary.extraInjectionUnits, settings)}` : ''}`,
  ];
  const detail: string[] = [];
  if (insulin.sourceLabels.length) detail.push(`Source: ${insulin.sourceLabels.join(', ')}`);
  if (insulin.through !== undefined) {
    detail.push(`records through ${formatClockNear(insulin.through, Math.min(now, summary.range.end), settings)}`);
  }
  if (detail.length) lines.push(`  ${detail.join(' · ')}`);
  if (insulin.summary.partial) {
    lines.push('  Some days have incomplete insulin records; totals include recorded insulin only.');
  }
  return lines;
}

export function carbSummaryLines(summary: PeriodSummary, now: number, settings: SummarySettings): string[] {
  const carbs = summary.carbs;
  if (!carbs) return [];
  return [
    `Carbohydrate logged: ${formatRegionalNumber(carbs.grams, settings.locale, { maximumFractionDigits: 0 })} g across ${formatRegionalNumber(carbs.mealCount, settings.locale, { maximumFractionDigits: 0 })} ${carbs.mealCount === 1 ? 'entry' : 'entries'}`,
    `  Source: ${carbs.sourceLabels.join(', ')} · records through ${formatClockNear(carbs.through, Math.min(now, summary.range.end), settings)}`,
  ];
}

/**
 * Plain-text period summary for copying or sharing. Neutral wording; every
 * range is named; GMI only under the GMI rules, otherwise the reason.
 */
export function buildPeriodSummaryText(
  summary: PeriodSummary,
  settings: SummarySettings,
  now: number,
): string {
  const presentation = presentGlucoseRangeStatistics(summary.ranges, settings);
  const lines: string[] = [];
  lines.push('T1 Arc glucose summary');
  lines.push(`Period: ${periodLabel(summary, settings)}`);
  lines.push(`Times: ${describeTimeZone(settings.timeZone, settings.locale, summary.range.end)}`);
  lines.push(`Sensor coverage: ${presentation.coverage}`);
  if (presentation.coverageNotice) lines.push(presentation.coverageNotice);
  if (presentation.observed) {
    const [standard, tight, personal] = presentation.ranges;
    lines.push('');
    lines.push(`Time in ranges (${standard!.label}):`);
    presentation.bands.forEach((band) => {
      lines.push(`  ${band.name} (${band.bounds}): ${band.value}`);
    });
    lines.push(`${tight!.label}: ${tight!.value} in range`);
    if (personal) lines.push(`${personal.label} (your own setting): ${personal.value} in range`);
    lines.push('');
    const stats = summary.statistics;
    if (stats.arithmeticMeanMmolL !== null) {
      lines.push(`Average glucose: ${formatGlucose(stats.arithmeticMeanMmolL, settings)}`);
    }
    lines.push(
      summary.gmi.status === 'shown'
        ? `GMI: ${number(summary.gmi.percent, settings)}% (${formatRegionalNumber(summary.gmi.mmolMol, settings.locale, { maximumFractionDigits: 0 })} mmol/mol)`
        : `GMI: not shown. ${summary.gmi.reason}`,
    );
    if (stats.populationStandardDeviationMmolL !== null && stats.coefficientOfVariationPercent !== null) {
      lines.push(
        `Standard deviation: ${formatGlucoseSpread(stats.populationStandardDeviationMmolL, settings)} · Coefficient of variation: ${number(stats.coefficientOfVariationPercent, settings)}%`,
      );
    }
    if (summary.glucoseSourceLabels.length) {
      lines.push(`Glucose source: ${summary.glucoseSourceLabels.join(', ')}`);
    }
  }
  const insulin = insulinSummaryLines(summary, now, settings);
  const carbs = carbSummaryLines(summary, now, settings);
  if (insulin.length || carbs.length) lines.push('');
  lines.push(...insulin, ...carbs);
  lines.push('');
  lines.push('Figures describe the recorded readings only. They are not treatment advice.');
  lines.push(`Prepared on this phone by T1 Arc on ${formatDay(now, settings)}.`);
  return lines.join('\n');
}
