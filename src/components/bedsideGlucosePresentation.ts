import { glucoseFreshness } from '@/domain/freshness';
import type { GlucoseReading, SourceFreshness, TrendDirection } from '@/domain/models';
import {
  formatGlucose,
  formatGlucoseAccessible,
  glucoseUnitLabel,
} from '@/domain/regionalFormat';
import type { T1ArcRegionalDefaults } from '@/domain/regionalProfile';
import { relativeAge } from '@/domain/time';
import { presentTrend } from '@/domain/trend';

/**
 * Past this age the bedside view stops showing a number at all. A struck
 * value from hours ago is easy to misread across a dark room.
 */
export const BEDSIDE_NO_RECENT_AFTER_MS = 60 * 60_000;

export type BedsidePresentation =
  | {
      kind: 'reading';
      value: string;
      unit: string;
      arrow: string;
      status: string;
      freshness: SourceFreshness;
      /** Shown struck through, as on Today. */
      stale: boolean;
      accessibilityLabel: string;
    }
  | {
      kind: 'none';
      message: 'No recent reading';
      detail: string;
      accessibilityLabel: string;
    };

export function bedsideGlucosePresentation(
  reading: Pick<GlucoseReading, 'mmolL' | 'timestamp'> | undefined,
  trend: TrendDirection,
  now: number,
  regional: Pick<T1ArcRegionalDefaults, 'locale' | 'glucoseUnit'>,
): BedsidePresentation {
  if (!reading || now - reading.timestamp > BEDSIDE_NO_RECENT_AFTER_MS) {
    const detail = reading
      ? `Last reading ${relativeAge(reading.timestamp, now)}`
      : 'Waiting for a glucose reading';
    return {
      kind: 'none',
      message: 'No recent reading',
      detail,
      accessibilityLabel: `No recent reading. ${detail}. Tap to close.`,
    };
  }
  const freshness = glucoseFreshness(reading.timestamp, now);
  const stale = freshness === 'stale';
  const age = relativeAge(reading.timestamp, now);
  const trendCopy = presentTrend(trend);
  const status = stale ? `Last known · ${age}`
    : freshness === 'delayed' ? `Delayed · ${age}` : age;
  const spokenValue = formatGlucoseAccessible(reading.mmolL, regional);
  return {
    kind: 'reading',
    value: formatGlucose(reading.mmolL, regional, { withUnit: false }),
    unit: glucoseUnitLabel(regional.glucoseUnit),
    arrow: trendCopy.arrow,
    status,
    freshness,
    stale,
    accessibilityLabel: stale
      ? `Last known glucose ${spokenValue}, shown struck through because it is stale. Updated ${age}. Tap to close.`
      : `Glucose ${spokenValue}, ${trendCopy.label}. Updated ${age}. Tap to close.`,
  };
}
