import { GlucoseSource } from '@/data/contracts';
import { glucoseFreshness } from '@/domain/freshness';
import {
  DataSourceStatus,
  GlucoseReading,
  TimeRange,
} from '@/domain/models';
import {
  addDays,
  DateKey,
  dayRange,
  toDateKey,
} from '@/domain/time';
import { trendFromDelta } from '@/domain/trend';

import { hashString, seededBetween } from './random';

const FIVE_MINUTES = 5 * 60_000;
const SOURCE_ID = 'demo-daymark-glucose';

const localTimeFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/London',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

function localMinuteOfDay(timestamp: number) {
  const parts = localTimeFormatter.formatToParts(timestamp);
  const hour = Number(parts.find((part) => part.type === 'hour')?.value ?? 0);
  const minute = Number(parts.find((part) => part.type === 'minute')?.value ?? 0);
  return hour * 60 + minute;
}

function gaussian(x: number, centre: number, width: number) {
  const distance = (x - centre) / width;
  return Math.exp(-(distance * distance));
}

function demoMmolL(
  timestamp: number,
  daySeed: number,
  index: number,
  daysAgo: number,
) {
  const minute = localMinuteOfDay(timestamp);
  const dayWave = Math.sin(((minute - 240) / 1_440) * Math.PI * 2) * 0.42;
  const dawn = gaussian(minute, 420, 90) * 0.75;
  const breakfast = gaussian(minute, 540, 72) * seededBetween(daySeed + 11, 2.0, 3.4);
  const lunch = gaussian(minute, 825, 92) * seededBetween(daySeed + 23, 1.4, 2.7);
  const evening = gaussian(minute, 1_185, 115) * seededBetween(daySeed + 37, 2.1, 3.7);
  const overnightDip = gaussian(minute, 255, 65) * seededBetween(daySeed + 41, 0.5, 1.25);
  const shortWave = Math.sin((minute / 46) * Math.PI * 2 + daySeed) * 0.14;
  const noise = seededBetween(daySeed + index * 7919, -0.18, 0.18);
  const dayOffset = seededBetween(daySeed + 97, -0.45, 0.55);
  const recentWeekOffset = daysAgo <= 6 ? 0.55 : daysAgo <= 13 ? -0.12 : 0;
  const recentEveningEffect =
    daysAgo <= 6 ? gaussian(minute, 1_265, 135) * 0.78 : 0;
  const value =
    6.1 +
    dayOffset +
    recentWeekOffset +
    recentEveningEffect +
    dayWave +
    dawn +
    breakfast +
    lunch +
    evening -
    overnightDip +
    shortWave +
    noise;
  return Math.round(Math.max(2.8, Math.min(15.8, value)) * 10) / 10;
}

function shouldCreateGap(timestamp: number, daySeed: number) {
  const minute = localMinuteOfDay(timestamp);
  const gapStart = 830 + (daySeed % 7) * 9;
  return minute >= gapStart && minute < gapStart + 25;
}

function generateDay(
  dateKey: DateKey,
  now: number,
  daysAgo: number,
): GlucoseReading[] {
  const range = dayRange(dateKey, now);
  const isToday = dateKey === toDateKey(now);
  const firstTimestamp = range.start + 2 * 60_000;
  const cutoff = isToday
    ? Math.min(now - 3 * 60_000, range.end - 3 * 60_000)
    : range.end - 3 * 60_000;
  const lastTimestamp =
    firstTimestamp +
    Math.floor((cutoff - firstTimestamp) / FIVE_MINUTES) * FIVE_MINUTES;
  if (lastTimestamp < firstTimestamp) return [];
  const daySeed = hashString(dateKey);
  const readings: GlucoseReading[] = [];
  let previous: GlucoseReading | undefined;

  for (
    let timestamp = firstTimestamp, index = 0;
    timestamp <= lastTimestamp;
    timestamp += FIVE_MINUTES, index += 1
  ) {
    if (shouldCreateGap(timestamp, daySeed)) {
      previous = undefined;
      continue;
    }
    const mmolL = demoMmolL(timestamp, daySeed, index, daysAgo);
    const trend =
      previous && timestamp - previous.timestamp <= 7 * 60_000
        ? trendFromDelta(mmolL - previous.mmolL)
        : 'unknown';
    const reading: GlucoseReading = {
      id: `${SOURCE_ID}:${timestamp}`,
      timestamp,
      receivedAt: timestamp + 25_000,
      mmolL,
      trend,
      quality: 'measured',
      sourceId: SOURCE_ID,
    };
    readings.push(reading);
    previous = reading;
  }

  return readings;
}

export class SyntheticGlucoseSource implements GlucoseSource {
  readonly sourceId = SOURCE_ID;
  private readings: GlucoseReading[] = [];
  private anchorNow: number;

  constructor(
    anchorNow = Date.now(),
    private readonly historyDays = 21,
  ) {
    this.anchorNow = anchorNow;
    this.regenerate(anchorNow);
  }

  private regenerate(now: number) {
    this.anchorNow = now;
    const today = toDateKey(now);
    this.readings = Array.from({ length: this.historyDays }, (_, index) =>
      generateDay(
        addDays(today, -(this.historyDays - index - 1)),
        now,
        this.historyDays - index - 1,
      ),
    )
      .flat()
      .sort((a, b) => a.timestamp - b.timestamp);
  }

  async refresh() {
    const now = Date.now();
    const latest = this.readings[this.readings.length - 1];
    if (
      !latest ||
      toDateKey(now) !== toDateKey(this.anchorNow) ||
      now - latest.timestamp >= FIVE_MINUTES + 3 * 60_000
    ) {
      this.regenerate(now);
    }
  }

  async getReadings(range: TimeRange) {
    return this.readings.filter(
      (reading) => reading.timestamp >= range.start && reading.timestamp < range.end,
    );
  }

  async getLatestReading() {
    return this.readings[this.readings.length - 1];
  }

  async getStatus(now = Date.now()): Promise<DataSourceStatus> {
    const latest = this.readings[this.readings.length - 1];
    return {
      id: SOURCE_ID,
      label: 'Glucose',
      detail: 'Synthetic Daymark glucose fixture',
      freshness: glucoseFreshness(latest?.timestamp, now),
      origin: 'synthetic',
      lastUpdatedAt: latest?.receivedAt,
      dataThrough: latest?.timestamp,
      recordCount: this.readings.length,
      isLive: true,
    };
  }
}
