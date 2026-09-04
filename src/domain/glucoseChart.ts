import {
  GlucoseAppearanceSettings,
  GlucoseRange,
  glucoseRangeForValue,
} from './glucoseAppearance';

export interface GlucoseChartPoint {
  mmolL: number;
  timestamp: number;
}

export interface GlucoseChartScale {
  maximum: number;
  minimum: number;
  ticks: number[];
}

export interface ColouredGlucoseSegment {
  points: GlucoseChartPoint[];
  range: Exclude<GlucoseRange, 'stale'>;
}

function niceStep(span: number, desiredTicks = 4) {
  const rough = span / Math.max(1, desiredTicks);
  const power = 10 ** Math.floor(Math.log10(Math.max(rough, 0.1)));
  const fraction = rough / power;
  const niceFraction =
    fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 2.5 ? 2.5 : 5;
  return niceFraction * power;
}

/**
 * Keeps every visible reading and the configured target range on screen.
 * Bounds use stable, human-readable increments instead of following every
 * tenth-of-a-unit change in the trace.
 */
export function buildGlucoseChartScale(
  points: GlucoseChartPoint[],
  appearance: GlucoseAppearanceSettings,
): GlucoseChartScale {
  const values = points
    .map((point) => point.mmolL)
    .filter(Number.isFinite);
  const rawMinimum = Math.min(
    appearance.targetMin,
    ...(values.length ? values : [appearance.targetMin]),
  );
  const rawMaximum = Math.max(
    appearance.targetMax,
    ...(values.length ? values : [appearance.targetMax]),
  );
  const rawSpan = Math.max(1, rawMaximum - rawMinimum);
  const padding = Math.max(0.6, rawSpan * 0.08);
  const step = niceStep(rawSpan + padding * 2);
  const minimum = Math.max(0, Math.floor((rawMinimum - padding) / step) * step);
  const maximum = Math.max(
    minimum + step,
    Math.ceil((rawMaximum + padding) / step) * step,
  );
  const ticks: number[] = [];
  for (let value = minimum; value <= maximum + step / 2; value += step) {
    ticks.push(Number(value.toFixed(2)));
  }
  return { minimum, maximum, ticks };
}

function samePoint(left: GlucoseChartPoint, right: GlucoseChartPoint) {
  return left.timestamp === right.timestamp && left.mmolL === right.mmolL;
}

function rangeAt(
  value: number,
  appearance: GlucoseAppearanceSettings,
): Exclude<GlucoseRange, 'stale'> {
  return glucoseRangeForValue(
    value,
    'current',
    appearance,
  ) as Exclude<GlucoseRange, 'stale'>;
}

/**
 * Splits a trace exactly where it crosses a configured glucose boundary.
 * This prevents a whole five-minute segment inheriting the colour of only
 * its first or final reading.
 */
export function buildColouredGlucoseSegments(
  points: GlucoseChartPoint[],
  appearance: GlucoseAppearanceSettings,
  gapThresholdMs: number,
): ColouredGlucoseSegment[] {
  const ordered = [...points]
    .filter(
      (point) =>
        Number.isFinite(point.timestamp) && Number.isFinite(point.mmolL),
    )
    .sort((left, right) => left.timestamp - right.timestamp);
  const segments: ColouredGlucoseSegment[] = [];
  const thresholds = [
    appearance.veryLowMax,
    appearance.targetMin,
    appearance.targetMax,
    appearance.veryHighMin,
  ];

  function append(
    range: ColouredGlucoseSegment['range'],
    start: GlucoseChartPoint,
    end: GlucoseChartPoint,
  ) {
    const previous = segments[segments.length - 1];
    if (
      previous?.range === range &&
      samePoint(previous.points[previous.points.length - 1]!, start)
    ) {
      previous.points.push(end);
    } else {
      segments.push({ range, points: [start, end] });
    }
  }

  for (let index = 1; index < ordered.length; index += 1) {
    const start = ordered[index - 1]!;
    const end = ordered[index]!;
    if (
      end.timestamp <= start.timestamp ||
      end.timestamp - start.timestamp > gapThresholdMs
    ) {
      continue;
    }
    const delta = end.mmolL - start.mmolL;
    const crossings =
      delta === 0
        ? []
        : thresholds
            .map((threshold) => ({
              threshold,
              fraction: (threshold - start.mmolL) / delta,
            }))
            .filter(
              ({ fraction }) => fraction > 0 && fraction < 1,
            )
            .sort((left, right) => left.fraction - right.fraction)
            .map(({ threshold, fraction }) => ({
              mmolL: threshold,
              timestamp:
                start.timestamp +
                Math.round((end.timestamp - start.timestamp) * fraction),
            }));
    const pieces = [start, ...crossings, end];
    for (let piece = 1; piece < pieces.length; piece += 1) {
      const pieceStart = pieces[piece - 1]!;
      const pieceEnd = pieces[piece]!;
      append(
        rangeAt((pieceStart.mmolL + pieceEnd.mmolL) / 2, appearance),
        pieceStart,
        pieceEnd,
      );
    }
  }
  return segments;
}
