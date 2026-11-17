import { gmiSummary } from '@/domain/gmiSummary';
import type { GlucoseReading, TimeRange } from '@/domain/models';
import { formatRegionalNumber } from '@/domain/regionalFormat';

export const HISTORY_GMI_EXPLANATION =
  'GMI is a sensor-based estimate expressed like HbA1c. It can differ from a measured laboratory result.';
export const HISTORY_GMI_SHORT_PERIOD =
  'This period is shorter than 14 days, so this is not comparable with a lab HbA1c.';
export const HISTORY_GMI_LOW_COVERAGE =
  'Sensor coverage is below 70% for this period, so no estimate is shown.';

/** Same 70% convention as the rest of the app's glucose summaries. */
export const HISTORY_GMI_MIN_COVERAGE_PERCENT = 70;
const COMPARABLE_PERIOD_MS = 14 * 86_400_000;

export interface HistoryGmiPresentation {
  /** For example "6.8% · 51 mmol/mol", or a dash when there is no estimate. */
  value: string;
  /** Sensor coverage for the period, always shown next to the estimate. */
  coverage: string;
  /** Shown when the period is shorter than 14 days or coverage is below 70%. */
  limitedNotice?: string;
  accessibilityLabel: string;
}

/**
 * GMI for the History period on screen, using the existing `gmiSummary`
 * calculation unchanged. Below 70% sensor coverage a dash is shown with the
 * coverage, because the readings do not describe the period well enough.
 * Periods shorter than 14 days keep the estimate but say plainly that it is
 * not comparable with a laboratory HbA1c.
 */
export function presentHistoryGmi(
  readings: readonly GlucoseReading[],
  range: TimeRange,
  locale: string,
): HistoryGmiPresentation {
  const summary = gmiSummary(readings, range);
  const number = (value: number, digits = 0) =>
    formatRegionalNumber(value, locale, {
      maximumFractionDigits: digits,
      minimumFractionDigits: digits,
    });
  const coverage = `${number(summary.coveragePercent)}% sensor coverage`;
  const label = (parts: (string | undefined)[]) =>
    `${[...parts, HISTORY_GMI_EXPLANATION]
      .filter((part): part is string => Boolean(part))
      .map((part) => part.replace(/\.$/, ''))
      .join('. ')}.`;
  if (summary.percent === null || summary.mmolMol === null) {
    return {
      value: '—',
      coverage,
      accessibilityLabel: label(['GMI not available for this period', coverage]),
    };
  }
  if (summary.coveragePercent < HISTORY_GMI_MIN_COVERAGE_PERCENT) {
    return {
      value: '—',
      coverage,
      limitedNotice: HISTORY_GMI_LOW_COVERAGE,
      accessibilityLabel: label(['GMI not shown for this period', coverage, HISTORY_GMI_LOW_COVERAGE]),
    };
  }
  const value = `${number(summary.percent, 1)}% · ${number(summary.mmolMol)} mmol/mol`;
  const limitedNotice = range.end - range.start < COMPARABLE_PERIOD_MS ? HISTORY_GMI_SHORT_PERIOD : undefined;
  return {
    value,
    coverage,
    limitedNotice,
    accessibilityLabel: label([`GMI ${value}`, coverage, limitedNotice]),
  };
}
