import {
  CONSENSUS_GLUCOSE_BAND_NAMES,
  CONSENSUS_GLUCOSE_BANDS,
  type ConsensusGlucoseBand,
  consensusGlucoseBandBounds,
  type GlucoseRangeShare,
  type GlucoseRangeSummary,
  glucoseTargetRangeLabel,
  REPRESENTATIVE_COVERAGE_PERCENT,
} from './glucoseRanges';
import { formatRegionalNumber } from './regionalFormat';
import type { T1ArcRegionalDefaults } from './regionalProfile';

type PresentationSettings = Pick<T1ArcRegionalDefaults, 'locale' | 'glucoseUnit'>;

export interface GlucoseBandRow {
  band: ConsensusGlucoseBand;
  name: string;
  bounds: string;
  /** Raw share for proportional bars; null when nothing was observed. */
  percent: number | null;
  value: string;
  accessibilityLabel: string;
}

export interface GlucoseTargetRangeRow {
  kind: GlucoseRangeShare['range']['kind'];
  label: string;
  value: string;
  detail: string;
  accessibilityLabel: string;
}

export interface GlucoseRangeStatisticsPresentation {
  observed: boolean;
  coverage: string;
  /** Plain notice when coverage is below the 70% consensus minimum. */
  coverageNotice?: string;
  bands: GlucoseBandRow[];
  ranges: GlucoseTargetRangeRow[];
  riskIndex:
    | { status: 'available'; value: string; detail: string; explanation: string }
    | { status: 'withheld'; detail: string; explanation: string };
}

const GRI_EXPLANATION =
  'Glycemia Risk Index (GRI, Klonoff 2023): one 0–100 figure that combines time low and time high, counting lows more heavily. Higher numbers mean more time outside range.';

function percentText(value: number | null, settings: PresentationSettings) {
  return value === null
    ? '—'
    : `${formatRegionalNumber(value, settings.locale, {
        minimumFractionDigits: 0,
        maximumFractionDigits: 1,
      })}%`;
}

function rangeRow(
  share: GlucoseRangeShare,
  settings: PresentationSettings,
): GlucoseTargetRangeRow {
  const label = glucoseTargetRangeLabel(share.range, settings);
  const value = percentText(share.inRange.percent, settings);
  const detail = `Below ${percentText(share.below.percent, settings)} · Above ${percentText(share.above.percent, settings)}`;
  return {
    kind: share.range.kind,
    label,
    value,
    detail,
    accessibilityLabel: `${label}: ${value} of observed time in range. ${detail}.`,
  };
}

/**
 * Plain presentation of a range summary. Every figure names its range, and
 * coverage below 70% is stated next to the figures rather than hidden.
 */
export function presentGlucoseRangeStatistics(
  summary: GlucoseRangeSummary,
  settings: PresentationSettings,
): GlucoseRangeStatisticsPresentation {
  const observed = summary.observedMilliseconds > 0;
  const coverage = percentText(summary.coveragePercent, settings);
  const minimum = formatRegionalNumber(
    REPRESENTATIVE_COVERAGE_PERCENT,
    settings.locale,
    { maximumFractionDigits: 0 },
  );
  const coverageNotice = !observed
    ? 'No sensor readings were recorded in this period, so time in ranges is unavailable.'
    : summary.representative
      ? undefined
      : `Sensor readings cover ${coverage} of this period, so these figures describe the recorded time only. Consensus reports use at least ${minimum}% coverage.`;
  const bands = CONSENSUS_GLUCOSE_BANDS.map((band): GlucoseBandRow => {
    const percent = summary.bands[band].percent;
    const name = CONSENSUS_GLUCOSE_BAND_NAMES[band];
    const bounds = consensusGlucoseBandBounds(band, settings);
    const value = percentText(percent, settings);
    return {
      band,
      name,
      bounds,
      percent,
      value,
      accessibilityLabel: `${name}, ${bounds}: ${value} of observed time.`,
    };
  });
  const ranges = [
    summary.standard,
    summary.tight,
    ...(summary.personal ? [summary.personal] : []),
  ].map((share) => rangeRow(share, settings));
  const gri = summary.glycemiaRiskIndex;
  const riskIndex: GlucoseRangeStatisticsPresentation['riskIndex'] =
    gri && summary.representative
      ? {
          status: 'available',
          value: formatRegionalNumber(gri.value, settings.locale, {
            minimumFractionDigits: 1,
            maximumFractionDigits: 1,
          }),
          detail: `Low component ${formatRegionalNumber(gri.hypoglycaemiaComponent, settings.locale, { maximumFractionDigits: 1 })} · high component ${formatRegionalNumber(gri.hyperglycaemiaComponent, settings.locale, { maximumFractionDigits: 1 })}`,
          explanation: GRI_EXPLANATION,
        }
      : {
          status: 'withheld',
          detail: `Shown when sensor coverage is at least ${minimum}%.`,
          explanation: GRI_EXPLANATION,
        };
  return {
    observed,
    coverage,
    ...(coverageNotice ? { coverageNotice } : {}),
    bands,
    ranges,
    riskIndex,
  };
}
