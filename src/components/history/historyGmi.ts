import { gmiSummary } from '@/domain/gmiSummary';
import type { GlucoseReading, TimeRange } from '@/domain/models';
import { formatRegionalNumber } from '@/domain/regionalFormat';

export const HISTORY_GMI_EXPLANATION =
  'GMI is a sensor-based estimate expressed like HbA1c. It can differ from a measured laboratory result.';
export const HISTORY_GMI_LIMITED =
  'Limited data: aim for at least 14 days with 70% sensor coverage before comparing this estimate.';

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
 * calculation unchanged. Short or sparse periods keep the estimate but say
 * plainly that it is not representative.
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
  if (summary.percent === null || summary.mmolMol === null) {
    return {
      value: '—',
      coverage,
      accessibilityLabel: `GMI not available for this period. ${coverage}.`,
    };
  }
  const value = `${number(summary.percent, 1)}% · ${number(summary.mmolMol)} mmol/mol`;
  const limitedNotice = summary.representative ? undefined : HISTORY_GMI_LIMITED;
  return {
    value,
    coverage,
    limitedNotice,
    accessibilityLabel: [`GMI ${value}`, coverage, limitedNotice].filter(Boolean).join('. '),
  };
}
