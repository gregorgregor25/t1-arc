import { GlucoseReading, TimeRange } from './models';
import { getRuntimeRegionalDefaults } from './regionalProfileRuntime';
import {
  addDays,
  DateKey,
  getZonedDateTimeParts,
  toDateKey,
  zonedDateTimeToTimestamp,
} from './time';

export interface GlucoseProfileBin {
  index: number;
  startMinute: number;
  readingCount: number;
  representedDays: number;
  p10?: number;
  p25?: number;
  median?: number;
  p75?: number;
  p90?: number;
  recordIds: string[];
}

export interface GlucoseProfile {
  binMinutes: number;
  expectedDays: number;
  minimumDaysPerBin: number;
  representedBins: number;
  bins: GlucoseProfileBin[];
}

function localMinute(timestamp: number) {
  const regional = getRuntimeRegionalDefaults();
  const parts = getZonedDateTimeParts(timestamp, regional.timeZone);
  return parts.hour * 60 + parts.minute;
}

function expectedDateKeys(range: TimeRange) {
  const dates: DateKey[] = [];
  let date = toDateKey(range.start);
  while (zonedDateTimeToTimestamp(date) < range.end) {
    dates.push(date);
    date = addDays(date, 1);
  }
  return dates;
}

function quantile(sorted: number[], probability: number) {
  if (!sorted.length) return undefined;
  if (sorted.length === 1) return sorted[0];
  const position = (sorted.length - 1) * probability;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  const fraction = position - lower;
  return sorted[lower]! * (1 - fraction) + sorted[upper]! * fraction;
}

function round(value: number | undefined) {
  return value === undefined ? undefined : Math.round(value * 10) / 10;
}

export function buildGlucoseProfile(
  readings: GlucoseReading[],
  range: TimeRange,
  binMinutes = 30,
): GlucoseProfile {
  const safeBinMinutes =
    Number.isFinite(binMinutes) &&
    binMinutes >= 5 &&
    binMinutes <= 180 &&
    1440 % binMinutes === 0
      ? Math.round(binMinutes)
      : 30;
  const binCount = 1440 / safeBinMinutes;
  const expectedDays = expectedDateKeys(range).length;
  const minimumDaysPerBin = Math.max(
    2,
    Math.ceil(Math.max(1, expectedDays) * 0.4),
  );
  const buckets = Array.from({ length: binCount }, () => ({
    readings: [] as GlucoseReading[],
    dates: new Set<DateKey>(),
  }));

  readings
    .filter(
      (reading) =>
        reading.timestamp >= range.start && reading.timestamp < range.end,
    )
    .forEach((reading) => {
      const index = Math.min(
        binCount - 1,
        Math.floor(localMinute(reading.timestamp) / safeBinMinutes),
      );
      buckets[index]!.readings.push(reading);
      buckets[index]!.dates.add(toDateKey(reading.timestamp));
    });

  const bins = buckets.map((bucket, index): GlucoseProfileBin => {
    const values = bucket.readings
      .map((reading) => reading.mmolL)
      .sort((a, b) => a - b);
    const enoughDays = bucket.dates.size >= minimumDaysPerBin;
    return {
      index,
      startMinute: index * safeBinMinutes,
      readingCount: bucket.readings.length,
      representedDays: bucket.dates.size,
      ...(enoughDays
        ? {
            p10: round(quantile(values, 0.1)),
            p25: round(quantile(values, 0.25)),
            median: round(quantile(values, 0.5)),
            p75: round(quantile(values, 0.75)),
            p90: round(quantile(values, 0.9)),
          }
        : {}),
      recordIds: bucket.readings.map((reading) => reading.id),
    };
  });

  return {
    binMinutes: safeBinMinutes,
    expectedDays,
    minimumDaysPerBin,
    representedBins: bins.filter((bin) => bin.median !== undefined).length,
    bins,
  };
}
