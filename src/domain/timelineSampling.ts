import { GlucoseReading } from './models';

export const DEFAULT_GLUCOSE_GAP_THRESHOLD_MS = 12 * 60_000;
export const MAX_TIMELINE_GLUCOSE_MARKERS = 180;

/**
 * Reduces the number of points drawn without hiding clinically interesting
 * short-lived highs, lows, or the readings on either side of a data gap.
 *
 * Statistics and the timeline inspector continue to use the complete series.
 * This function is only for the visual path rendered by the chart.
 */
export function sampleGlucoseForChart(
  readings: GlucoseReading[],
  maximum = 760,
  gapThresholdMs = DEFAULT_GLUCOSE_GAP_THRESHOLD_MS,
) {
  if (readings.length <= maximum || maximum < 3) return readings;

  const required = new Set<number>([0, readings.length - 1]);
  for (let index = 1; index < readings.length; index += 1) {
    if (
      readings[index]!.timestamp - readings[index - 1]!.timestamp >
      gapThresholdMs
    ) {
      required.add(index - 1);
      required.add(index);
    }
  }

  const remaining = maximum - required.size;
  if (remaining <= 0) {
    return [...required]
      .sort((left, right) => left - right)
      .map((index) => readings[index]!);
  }

  // Two points per bucket retain its minimum and maximum. This is preferable
  // to selecting every Nth reading, which can make a short hypo disappear.
  const bucketCount = Math.max(1, Math.floor(remaining / 2));
  const interiorCount = readings.length - 2;
  for (let bucket = 0; bucket < bucketCount; bucket += 1) {
    const start = 1 + Math.floor((bucket * interiorCount) / bucketCount);
    const end = Math.min(
      readings.length - 1,
      1 + Math.floor(((bucket + 1) * interiorCount) / bucketCount),
    );
    if (start >= end) continue;

    let minimumIndex = start;
    let maximumIndex = start;
    for (let index = start + 1; index < end; index += 1) {
      if (readings[index]!.mmolL < readings[minimumIndex]!.mmolL) {
        minimumIndex = index;
      }
      if (readings[index]!.mmolL > readings[maximumIndex]!.mmolL) {
        maximumIndex = index;
      }
    }
    required.add(minimumIndex);
    required.add(maximumIndex);
  }

  return [...required]
    .sort((left, right) => left - right)
    .slice(0, maximum)
    .map((index) => readings[index]!);
}

/**
 * Keeps decorative point markers below a native-view budget. The denser line
 * path and every statistic continue to use their existing complete/sampled
 * series; exact readings remain available through the timeline inspector.
 */
export function sampleGlucoseMarkersForChart(
  readings: GlucoseReading[],
  maximum = MAX_TIMELINE_GLUCOSE_MARKERS,
  gapThresholdMs = DEFAULT_GLUCOSE_GAP_THRESHOLD_MS,
) {
  return sampleGlucoseForChart(readings, maximum, gapThresholdMs);
}
