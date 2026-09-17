import { InsulinSource } from '@/data/contracts';
import {
  BasalDelivery,
  BolusDelivery,
  DataSourceStatus,
  TimeRange,
} from '@/domain/models';
import {
  addDays,
  DateKey,
  dayRange,
  toDateKey,
  zonedDateTimeToTimestamp,
} from '@/domain/time';

import { hashString, seededBetween } from './random';

const SOURCE_ID = 'demo-glooko';
const THIRTY_MINUTES = 30 * 60_000;

function round(value: number, decimals = 2) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function basalRateForHour(hour: number, seed: number, index: number) {
  let base = 0.55;
  if (hour < 4) base = 0.42;
  else if (hour < 8) base = 0.68;
  else if (hour < 12) base = 0.58;
  else if (hour < 17) base = 0.63;
  else if (hour < 22) base = 0.72;
  else base = 0.5;

  const automationWave = Math.sin(index * 0.92 + seed) * 0.12;
  const variation = seededBetween(seed + index * 193, -0.08, 0.08);
  return round(Math.max(0.08, Math.min(1.15, base + automationWave + variation)));
}

function generateBasalForDay(
  dateKey: DateKey,
  dataThrough: number,
  now: number,
): BasalDelivery[] {
  const range = dayRange(dateKey, now);
  const effectiveEnd = Math.min(range.end, dataThrough);
  if (effectiveEnd <= range.start) return [];
  const daySeed = hashString(`${dateKey}:basal`);
  const deliveries: BasalDelivery[] = [];

  for (
    let start = range.start, index = 0;
    start < effectiveEnd;
    start += THIRTY_MINUTES, index += 1
  ) {
    const end = Math.min(start + THIRTY_MINUTES, effectiveEnd);
    const hour = Math.floor(index / 2) % 24;
    const rateUnitsPerHour = basalRateForHour(hour, daySeed, index);
    const hours = (end - start) / 3_600_000;
    deliveries.push({
      id: `${SOURCE_ID}:basal:${start}`,
      start,
      end,
      rateUnitsPerHour,
      units: round(rateUnitsPerHour * hours),
      sourceId: SOURCE_ID,
    });
  }
  return deliveries;
}

function generateBolusesForDay(
  dateKey: DateKey,
  dataThrough: number,
): BolusDelivery[] {
  const daySeed = hashString(`${dateKey}:bolus`);
  const templates = [
    { hour: 8, minute: 12, baseUnits: 3.4 },
    { hour: 12, minute: 47, baseUnits: 4.1 },
    { hour: 18, minute: 38, baseUnits: 5.2 },
    { hour: 21, minute: 14, baseUnits: 1.1 },
  ];

  return templates
    .map((template, index) => {
      const timestamp = zonedDateTimeToTimestamp(
        dateKey,
        template.hour,
        template.minute,
      );
      return {
        id: `${SOURCE_ID}:bolus:${timestamp}`,
        timestamp,
        units: round(
          template.baseUnits + seededBetween(daySeed + index * 131, -0.55, 0.65),
          1,
        ),
        sourceId: SOURCE_ID,
      };
    })
    .filter((delivery) => delivery.timestamp < dataThrough);
}

export class SyntheticInsulinSource implements InsulinSource {
  readonly sourceId = SOURCE_ID;
  private readonly basal: BasalDelivery[];
  private readonly boluses: BolusDelivery[];
  private readonly importedAt: number;
  private readonly dataThrough: number;

  constructor(
    private readonly anchorNow = Date.now(),
    historyDays = 21,
  ) {
    this.dataThrough = anchorNow - 95 * 60_000;
    this.importedAt = anchorNow - 45 * 60_000;
    const today = toDateKey(anchorNow);
    const dateKeys = Array.from({ length: historyDays }, (_, index) =>
      addDays(today, -(historyDays - index - 1)),
    );
    this.basal = dateKeys
      .flatMap((dateKey) => generateBasalForDay(dateKey, this.dataThrough, anchorNow))
      .sort((a, b) => a.start - b.start);
    this.boluses = dateKeys
      .flatMap((dateKey) => generateBolusesForDay(dateKey, this.dataThrough))
      .sort((a, b) => a.timestamp - b.timestamp);
  }

  async getBasalDeliveries(range: TimeRange) {
    return this.basal.filter(
      (delivery) => delivery.end > range.start && delivery.start < range.end,
    );
  }

  async getBolusDeliveries(range: TimeRange) {
    return this.boluses.filter(
      (delivery) =>
        delivery.timestamp >= range.start && delivery.timestamp < range.end,
    );
  }

  async getStatus(): Promise<DataSourceStatus> {
    return {
      id: SOURCE_ID,
      label: 'Insulin',
      detail: 'Synthetic Glooko export fixture',
      freshness: 'delayed',
      origin: 'synthetic',
      lastUpdatedAt: this.importedAt,
      dataThrough: this.dataThrough,
      recordCount: this.basal.length + this.boluses.length,
      isLive: false,
    };
  }
}
