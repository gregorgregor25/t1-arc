import type {
  HealthConnectCategoryId,
  HealthConnectRecord,
} from '../../../modules/daymark-health-connect';

import { HealthContextEvent } from '@/domain/models';
import { suggestedMealType } from '@/domain/mealTiming';

export const HEALTH_CONNECT_CATEGORIES: Array<{
  id: HealthConnectCategoryId;
  label: string;
  detail: string;
}> = [
  {
    id: 'steps',
    label: 'Steps',
    detail: 'Daily movement from your phone or wearable',
  },
  {
    id: 'workouts',
    label: 'Workouts',
    detail: 'Sessions, duration, speed, power and cadence',
  },
  {
    id: 'heart_rate',
    label: 'Heart rate',
    detail: 'Workout, resting and wearable heart rate',
  },
  {
    id: 'sleep',
    label: 'Sleep',
    detail: 'Sleep sessions and stages',
  },
  {
    id: 'weight',
    label: 'Weight',
    detail: 'Measurements from connected scales and apps',
  },
  {
    id: 'body_composition',
    label: 'Body composition',
    detail: 'Body fat, lean mass, water, bone, height and metabolism',
  },
  {
    id: 'blood_glucose',
    label: 'Health glucose',
    detail: 'Meter and other blood-glucose measurements from connected apps',
  },
  {
    id: 'vitals',
    label: 'Vitals',
    detail: 'Blood pressure, oxygen, breathing, HRV, VO₂ max and temperature',
  },
  {
    id: 'cycle',
    label: 'Cycle tracking',
    detail: 'Periods, flow, ovulation and related hormone context',
  },
  {
    id: 'hydration',
    label: 'Hydration',
    detail: 'Water and other logged drinks',
  },
  {
    id: 'nutrition',
    label: 'Nutrition',
    detail: 'Meals and carbohydrates logged by connected apps',
  },
  {
    id: 'distance',
    label: 'Distance',
    detail: 'Distance, elevation and floors climbed',
  },
  {
    id: 'active_calories',
    label: 'Active energy',
    detail: 'Active and total exercise energy from your source',
  },
];

export const DEFAULT_HEALTH_CONNECT_CATEGORIES =
  HEALTH_CONNECT_CATEGORIES.map(({ id }) => id);

const exerciseLabels: Record<number, string> = {
  0: 'Workout',
  2: 'Badminton',
  4: 'Baseball',
  5: 'Basketball',
  8: 'Cycling',
  9: 'Indoor cycling',
  10: 'Boot camp',
  11: 'Boxing',
  13: 'Calisthenics',
  14: 'Cricket',
  16: 'Dancing',
  25: 'Elliptical',
  26: 'Exercise class',
  27: 'Fencing',
  28: 'American football',
  29: 'Australian football',
  31: 'Disc sport',
  32: 'Golf',
  34: 'Gymnastics',
  35: 'Handball',
  36: 'HIIT',
  37: 'Hiking',
  38: 'Ice hockey',
  39: 'Ice skating',
  44: 'Martial arts',
  46: 'Paddling',
  48: 'Pilates',
  50: 'Racquetball',
  51: 'Rock climbing',
  53: 'Rowing',
  54: 'Rowing machine',
  55: 'Rugby',
  56: 'Running',
  57: 'Treadmill run',
  58: 'Sailing',
  60: 'Skating',
  61: 'Skiing',
  62: 'Snowboarding',
  64: 'Football',
  66: 'Squash',
  68: 'Stair climbing',
  69: 'Stair machine',
  70: 'Strength training',
  71: 'Stretching',
  72: 'Surfing',
  73: 'Open-water swim',
  74: 'Pool swim',
  75: 'Table tennis',
  76: 'Tennis',
  78: 'Volleyball',
  79: 'Walking',
  80: 'Water polo',
  81: 'Weightlifting',
  82: 'Wheelchair activity',
  83: 'Yoga',
};

export function healthConnectRecordId(record: HealthConnectRecord) {
  return `health-connect:${record.kind}:${record.sourcePackage}:${record.externalId}`;
}

function activityType(
  exerciseType: number | undefined,
): Extract<HealthContextEvent, { kind: 'activity' }>['activityType'] {
  if (exerciseType === 8 || exerciseType === 9) return 'cycle';
  if (exerciseType === 56 || exerciseType === 57) return 'run';
  if (exerciseType === 79 || exerciseType === 37) return 'walk';
  if (exerciseType === 70 || exerciseType === 81) return 'strength';
  return 'other';
}

function activityIntensity(
  effort: number | null | undefined,
): Extract<HealthContextEvent, { kind: 'activity' }>['intensity'] {
  if (effort == null) return 'moderate';
  if (effort <= 3) return 'light';
  if (effort >= 7) return 'vigorous';
  return 'moderate';
}

function mealType(
  value: number | undefined,
  timestamp: number,
): Extract<HealthContextEvent, { kind: 'meal' }>['mealType'] {
  if (value === 1) return 'breakfast';
  if (value === 2) return 'lunch';
  if (value === 3) return 'dinner';
  if (value === 4) return 'snack';
  return suggestedMealType(timestamp);
}

function menstruationFlowLabel(value: number | undefined) {
  if (value === 1) return 'Light';
  if (value === 2) return 'Medium';
  if (value === 3) return 'Heavy';
  return 'Recorded';
}

function ovulationResultLabel(value: number | undefined) {
  if (value === 1) return 'Positive';
  if (value === 2) return 'High';
  if (value === 3) return 'Negative';
  return 'Inconclusive';
}

function cervicalMucusAppearanceLabel(value: number | undefined) {
  if (value === 1) return 'Dry';
  if (value === 2) return 'Sticky';
  if (value === 3) return 'Creamy';
  if (value === 4) return 'Watery';
  if (value === 5) return 'Egg-white';
  if (value === 6) return 'Unusual';
  return undefined;
}

function cervicalMucusSensationLabel(value: number | undefined) {
  if (value === 1) return 'Light sensation';
  if (value === 2) return 'Medium sensation';
  if (value === 3) return 'Heavy sensation';
  return undefined;
}

export function healthConnectRecordToContext(
  record: HealthConnectRecord,
  importedAt: number,
): HealthContextEvent | undefined {
  const base = {
    id: healthConnectRecordId(record),
    sourceId: `health-connect:${record.sourcePackage}`,
    origin: 'imported' as const,
    start: record.startTimeMs,
    recordedAt: importedAt,
    sourceFile: 'Health Connect',
  };

  if (record.kind === 'workout') {
    const durationMinutes = Math.max(
      0,
      (record.endTimeMs - record.startTimeMs) / 60_000,
    );
    return {
      ...base,
      kind: 'activity',
      end: record.endTimeMs,
      title:
        record.title?.trim() ||
        exerciseLabels[record.exerciseType ?? 0] ||
        'Workout',
      activityType: activityType(record.exerciseType),
      durationMinutes,
      intensity: activityIntensity(record.rateOfPerceivedExertion),
    };
  }

  if (record.kind === 'sleep') {
    const durationMinutes = Math.max(
      0,
      (record.endTimeMs - record.startTimeMs) / 60_000,
    );
    return {
      ...base,
      kind: 'sleep',
      end: record.endTimeMs,
      title: record.title?.trim() || 'Sleep',
      durationMinutes,
    };
  }

  if (record.kind === 'weight' && record.value != null) {
    return {
      ...base,
      kind: 'weight',
      title: 'Weight',
      kilograms: record.value,
    };
  }

  if (record.kind === 'nutrition' && record.value != null) {
    const type = mealType(record.mealType, record.startTimeMs);
    return {
      ...base,
      kind: 'meal',
      title:
        record.title?.trim() ||
        `${type[0]!.toUpperCase()}${type.slice(1)}`,
      mealType: type,
      carbsGrams: Math.max(0, record.value),
    };
  }

  if (record.kind === 'menstruation_period') {
    return {
      ...base,
      kind: 'note',
      end: record.endTimeMs,
      title: 'Menstrual period',
      category: 'hormones',
      detail: 'Recorded through Health Connect',
    };
  }

  if (record.kind === 'menstruation_flow') {
    return {
      ...base,
      kind: 'note',
      title: 'Menstrual flow',
      category: 'hormones',
      detail: `${menstruationFlowLabel(record.flow)} flow`,
    };
  }

  if (record.kind === 'ovulation_test') {
    return {
      ...base,
      kind: 'note',
      title: 'Ovulation test',
      category: 'hormones',
      detail: `${ovulationResultLabel(record.result)} result`,
    };
  }

  if (
    record.kind === 'basal_body_temperature' &&
    record.value != null
  ) {
    return {
      ...base,
      kind: 'note',
      title: 'Basal body temperature',
      category: 'hormones',
      detail: `${record.value.toFixed(1)} °C`,
    };
  }

  if (record.kind === 'cervical_mucus') {
    const detail = [
      cervicalMucusAppearanceLabel(record.appearance),
      cervicalMucusSensationLabel(record.sensation),
    ]
      .filter(Boolean)
      .join(' · ');
    return {
      ...base,
      kind: 'note',
      title: 'Cervical mucus',
      category: 'hormones',
      detail: detail || 'Recorded through Health Connect',
    };
  }

  if (record.kind === 'intermenstrual_bleeding') {
    return {
      ...base,
      kind: 'note',
      title: 'Intermenstrual bleeding',
      category: 'hormones',
      detail: 'Recorded through Health Connect',
    };
  }

  return undefined;
}
