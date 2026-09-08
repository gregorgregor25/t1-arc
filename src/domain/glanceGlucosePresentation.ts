import type { GlucoseStats } from './models';
import { formatRegionalNumber } from './regionalFormat';

/** Presentation only: retain canonical TIR, but do not headline a sparse sample. */
export function presentGlanceGlucose(
  glucose: Pick<GlucoseStats, 'timeInRangePercent' | 'coveragePercent'>,
  periodLabel: string,
  locale: string,
) {
  const coverageKnown = Number.isFinite(glucose.coveragePercent) &&
    glucose.coveragePercent >= 0 && glucose.coveragePercent <= 100;
  const percentageKnown = Number.isFinite(glucose.timeInRangePercent) &&
    glucose.timeInRangePercent >= 0 && glucose.timeInRangePercent <= 100;
  // Match the existing daily summary and Insights coverage threshold.
  const limited = !coverageKnown || !percentageKnown || glucose.coveragePercent < 70;
  return {
    limited,
    value: limited ? 'Limited data' : `${formatRegionalNumber(glucose.timeInRangePercent, locale)}%`,
    detail: limited
      ? `${periodLabel} · ${coverageKnown
        ? `${formatRegionalNumber(glucose.coveragePercent, locale, { maximumFractionDigits: 1 })}% observed coverage`
        : 'Coverage unavailable'}`
      : periodLabel,
  };
}
