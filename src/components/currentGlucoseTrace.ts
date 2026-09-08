import { DEFAULT_OBSERVATION_GAP_MS } from '@/domain/glucoseStatistics';
import type { GlucoseReading } from '@/domain/models';

export const TRACE_WIDTH = 100;
export const TRACE_HEIGHT = 60;
const TRACE_WINDOW_MS = 4 * 3_600_000;
const HORIZONTAL_INSET = 1;

interface TracePoint {
  timestamp: number;
  value: number;
  x: number;
  y: number;
}

/** Each area belongs to one observed run, never to the empty time between runs. */
export function glucoseTraceGeometry(
  readings: readonly GlucoseReading[],
  endTimestamp: number,
) {
  if (!Number.isFinite(endTimestamp)) return undefined;
  const startTimestamp = endTimestamp - TRACE_WINDOW_MS;
  const points = readings
    .filter(
      (item) =>
        Number.isFinite(item.mmolL) &&
        item.mmolL > 0 &&
        Number.isFinite(item.timestamp) &&
        item.timestamp >= startTimestamp &&
        item.timestamp <= endTimestamp,
    )
    .sort((left, right) => left.timestamp - right.timestamp);
  if (points.length === 0) return undefined;

  const firstTimestamp = points[0]!.timestamp;
  const duration = points.at(-1)!.timestamp - firstTimestamp;
  const values = points.map((item) => item.mmolL);
  const observedMin = Math.min(...values);
  const observedMax = Math.max(...values);
  const padding = Math.max((observedMax - observedMin) * 0.2, 0.6);
  const min = Math.max(0, observedMin - padding);
  const max = observedMax + padding;
  const range = Math.max(max - min, 1);
  const chartPoints = points.map((item): TracePoint => ({
    timestamp: item.timestamp,
    value: item.mmolL,
    x: duration > 0
      ? HORIZONTAL_INSET +
        ((item.timestamp - firstTimestamp) / duration) *
          (TRACE_WIDTH - 2 * HORIZONTAL_INSET)
      : TRACE_WIDTH - HORIZONTAL_INSET,
    y: 5 + ((max - item.mmolL) / range) * (TRACE_HEIGHT - 13),
  }));

  const runs: TracePoint[][] = [];
  for (const point of chartPoints) {
    const previousRun = runs.at(-1);
    const previous = previousRun?.at(-1);
    const gap = previous ? point.timestamp - previous.timestamp : undefined;
    // Equal timestamps are not a time interval. Keep conflicting observations
    // separate rather than averaging their values or inventing a vertical run.
    if (!previousRun || gap === undefined || gap <= 0 || gap > DEFAULT_OBSERVATION_GAP_MS) {
      runs.push([point]);
    } else {
      previousRun.push(point);
    }
  }

  const areas: string[] = [];
  const segments: { path: string; value: number }[] = [];
  const isolatedPoints: TracePoint[] = [];
  for (const run of runs) {
    const first = run[0]!;
    if (run.length === 1) {
      isolatedPoints.push(first);
      continue;
    }
    let line = `M ${first.x.toFixed(2)} ${first.y.toFixed(2)}`;
    for (let index = 1; index < run.length; index += 1) {
      const previous = run[index - 1]!;
      const current = run[index]!;
      const middle = (previous.x + current.x) / 2;
      const curve = `C ${middle.toFixed(2)} ${previous.y.toFixed(2)}, ${middle.toFixed(2)} ${current.y.toFixed(2)}, ${current.x.toFixed(2)} ${current.y.toFixed(2)}`;
      line += ` ${curve}`;
      segments.push({
        path: `M ${previous.x.toFixed(2)} ${previous.y.toFixed(2)} ${curve}`,
        value: current.value,
      });
    }
    const last = run.at(-1)!;
    areas.push(`${line} L ${last.x.toFixed(2)} ${TRACE_HEIGHT} L ${first.x.toFixed(2)} ${TRACE_HEIGHT} Z`);
  }

  return { areas, duration, isolatedPoints, readingCount: points.length, segments };
}
