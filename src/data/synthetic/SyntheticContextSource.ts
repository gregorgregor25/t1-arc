import { ContextSource } from '@/data/contracts';
import {
  ActivityEvent,
  DataSourceStatus,
  HealthContextEvent,
  MealEvent,
  SleepEvent,
  TimeRange,
  WeightEvent,
} from '@/domain/models';
import {
  addDays,
  DateKey,
  toDateKey,
  zonedDateTimeToTimestamp,
} from '@/domain/time';

import { hashString, seededBetween } from './random';

const SOURCE_ID = 'demo-daymark-context';

function round(value: number, decimals = 0) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function mealEvents(dateKey: DateKey, daysAgo: number): MealEvent[] {
  const seed = hashString(`${dateKey}:meals`);
  const recentWeek = daysAgo <= 6;
  const templates = [
    {
      mealType: 'breakfast' as const,
      title: 'Breakfast',
      hour: 8,
      minute: 18,
      carbs: recentWeek ? 48 : 43,
    },
    {
      mealType: 'lunch' as const,
      title: 'Lunch',
      hour: 12,
      minute: 52,
      carbs: recentWeek ? 58 : 53,
    },
    {
      mealType: 'dinner' as const,
      title: recentWeek ? 'Later dinner' : 'Dinner',
      hour: recentWeek ? 20 : 18,
      minute: recentWeek ? 14 : 48,
      carbs: recentWeek ? 76 : 59,
    },
  ];

  const meals: MealEvent[] = templates.map((template, index) => {
    const start = zonedDateTimeToTimestamp(
      dateKey,
      template.hour,
      template.minute,
    );
    return {
      id: `${SOURCE_ID}:meal:${start}`,
      kind: 'meal',
      start,
      title: template.title,
      mealType: template.mealType,
      carbsGrams: round(
        template.carbs + seededBetween(seed + index * 109, -6, 7),
      ),
      sourceId: SOURCE_ID,
      origin: 'synthetic',
    };
  });

  if (recentWeek && seed % 3 !== 0) {
    const start = zonedDateTimeToTimestamp(dateKey, 21, 42);
    meals.push({
      id: `${SOURCE_ID}:meal:${start}`,
      kind: 'meal',
      start,
      title: 'Evening snack',
      mealType: 'snack',
      carbsGrams: round(seededBetween(seed + 809, 14, 27)),
      sourceId: SOURCE_ID,
      origin: 'synthetic',
    });
  }
  return meals;
}

function sleepEvent(dateKey: DateKey, daysAgo: number): SleepEvent {
  const seed = hashString(`${dateKey}:sleep`);
  const recentWeek = daysAgo <= 6;
  const durationMinutes = round(
    seededBetween(
      seed,
      recentWeek ? 365 : 425,
      recentWeek ? 410 : 465,
    ),
  );
  const end = zonedDateTimeToTimestamp(
    dateKey,
    6,
    round(seededBetween(seed + 13, 30, 58)),
  );
  return {
    id: `${SOURCE_ID}:sleep:${end}`,
    kind: 'sleep',
    start: end - durationMinutes * 60_000,
    end,
    title: 'Sleep',
    durationMinutes,
    qualityPercent: round(
      seededBetween(seed + 31, recentWeek ? 72 : 81, recentWeek ? 84 : 92),
    ),
    sourceId: SOURCE_ID,
    origin: 'synthetic',
  };
}

function activityEvents(dateKey: DateKey, daysAgo: number): ActivityEvent[] {
  const seed = hashString(`${dateKey}:activity`);
  const recentWeek = daysAgo <= 6;
  const activeToday = recentWeek ? daysAgo % 3 === 0 : daysAgo % 2 === 0;
  if (!activeToday) return [];
  const start = zonedDateTimeToTimestamp(dateKey, recentWeek ? 18 : 17, 24);
  const durationMinutes = round(
    seededBetween(seed, recentWeek ? 18 : 31, recentWeek ? 32 : 51),
  );
  return [
    {
      id: `${SOURCE_ID}:activity:${start}`,
      kind: 'activity',
      start,
      end: start + durationMinutes * 60_000,
      title: 'Outdoor walk',
      activityType: 'walk',
      durationMinutes,
      intensity: 'moderate',
      sourceId: SOURCE_ID,
      origin: 'synthetic',
    },
  ];
}

function weightEvent(dateKey: DateKey, daysAgo: number): WeightEvent {
  const seed = hashString(`${dateKey}:weight`);
  const start = zonedDateTimeToTimestamp(dateKey, 7, 18);
  return {
    id: `${SOURCE_ID}:weight:${start}`,
    kind: 'weight',
    start,
    title: 'Morning weight',
    kilograms: round(
      82.2 - (20 - daysAgo) * 0.018 + seededBetween(seed, -0.22, 0.22),
      1,
    ),
    sourceId: SOURCE_ID,
    origin: 'synthetic',
  };
}

export class SyntheticContextSource implements ContextSource {
  readonly sourceId = SOURCE_ID;
  private readonly events: HealthContextEvent[];

  constructor(anchorNow = Date.now(), historyDays = 21) {
    const today = toDateKey(anchorNow);
    this.events = Array.from({ length: historyDays }, (_, index) => {
      const daysAgo = historyDays - index - 1;
      const dateKey = addDays(today, -daysAgo);
      return [
        sleepEvent(dateKey, daysAgo),
        ...mealEvents(dateKey, daysAgo),
        ...activityEvents(dateKey, daysAgo),
        weightEvent(dateKey, daysAgo),
      ];
    })
      .flat()
      .sort((a, b) => a.start - b.start);
  }

  async getEvents(range: TimeRange) {
    return this.events.filter(
      (event) =>
        event.start < range.end && (event.end ?? event.start) >= range.start,
    );
  }

  async getStatus(): Promise<DataSourceStatus> {
    const latest = this.events[this.events.length - 1];
    return {
      id: this.sourceId,
      label: 'Health context',
      detail: 'Synthetic meals, activity, sleep and weight',
      freshness: latest ? 'current' : 'missing',
      origin: 'synthetic',
      dataThrough: latest?.end ?? latest?.start,
      recordCount: this.events.length,
      isLive: false,
    };
  }
}
