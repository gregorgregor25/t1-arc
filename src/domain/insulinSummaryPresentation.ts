import { InsulinRangeSummary } from './timelineInsulinSummary';
import { formatRegionalFixedNumber } from './regionalFormat';
import type { T1ArcRegionalDefaults } from './regionalProfile';
import { getRuntimeRegionalDefaults } from './regionalProfileRuntime';
import { formatTime } from './time';

export interface InsulinSummaryPresentation {
  rangeLabel: string;
  sourceDetail?: string;
  /** Source-reported total minus the available basal and bolus components. */
  sourceMinusBreakdownUnits: number;
  /** True when the components exceed the source total and cannot be its split. */
  separateBreakdown: boolean;
}

/** Keeps source-derived and partial totals explicit in every stats-card view. */
export function presentInsulinRangeSummary(
  summary: InsulinRangeSummary | undefined,
  rangeLabel: string,
  regional: T1ArcRegionalDefaults = getRuntimeRegionalDefaults(),
): InsulinSummaryPresentation {
  if (!summary?.sourceTotals.length) {
    return {
      rangeLabel,
      sourceMinusBreakdownUnits: 0,
      separateBreakdown: false,
    };
  }
  const basis = summary.sourceCoversEveryDay
    ? 'Source-reported daily total'
    : 'Source totals plus detailed delivery records';
  const sourceMinusBreakdownUnits =
    Math.round(
      (summary.stats.totalUnits -
        summary.stats.basalUnits -
        summary.stats.bolusUnits) *
        10,
    ) / 10;
  const separateBreakdown = sourceMinusBreakdownUnits <= -0.05;
  const unsplitUnits = Math.max(0, sourceMinusBreakdownUnits);
  const componentMismatch = separateBreakdown
    ? ` · basal + bolus is ${formatRegionalFixedNumber(Math.abs(sourceMinusBreakdownUnits), regional.locale, 1)} U above the source total; components shown separately`
    : undefined;
  const breakdown =
    componentMismatch ??
    (summary.sourceProvidesBasalEveryDay &&
    summary.sourceProvidesBolusEveryDay
      ? ''
      : unsplitUnits >= 0.05
        ? ` · ${formatRegionalFixedNumber(unsplitUnits, regional.locale, 1)} U not split into basal or bolus by the available source records`
        : ' · missing source breakdown filled from same-source delivery records');
  const conflict = summary.sourceConflictCount
    ? ` · latest shown; ${summary.sourceConflictCount} other source/device total${summary.sourceConflictCount === 1 ? '' : 's'} available`
    : '';
  const common = {
    rangeLabel,
    sourceMinusBreakdownUnits,
    separateBreakdown,
  };
  if (!summary.partial) {
    return {
      ...common,
      sourceDetail: `${basis}${breakdown}${conflict}`,
    };
  }
  return {
    ...common,
    sourceDetail:
      summary.sourceAsOf === undefined
        ? `${basis}${breakdown}${conflict} · partial range`
        : `${basis}${breakdown}${conflict} · source data as of ${formatTime(summary.sourceAsOf)}`,
  };
}
