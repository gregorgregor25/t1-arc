import type {
  HealthConnectRecord,
} from '../../../modules/daymark-health-connect';

import type { StoredHealthConnectRecord } from './sourceRecords';

export type HealthConnectRecordGroup =
  | 'movement'
  | 'workout'
  | 'recovery'
  | 'body'
  | 'glucose'
  | 'vitals'
  | 'cycle'
  | 'nutrition';

export interface HealthConnectRecordPresentation {
  group: HealthConnectRecordGroup;
  title: string;
  detail?: string;
}

const labels: Record<HealthConnectRecord['kind'], string> = {
  steps: 'Steps',
  distance: 'Distance',
  elevation_gained: 'Elevation gained',
  floors_climbed: 'Floors climbed',
  active_calories: 'Active energy',
  total_calories: 'Total energy',
  workout: 'Workout',
  workout_power: 'Workout power',
  workout_speed: 'Workout speed',
  walking_cadence: 'Walking cadence',
  cycling_cadence: 'Cycling cadence',
  heart_rate: 'Heart rate',
  resting_heart_rate: 'Resting heart rate',
  sleep: 'Sleep',
  weight: 'Weight',
  body_fat: 'Body fat',
  lean_body_mass: 'Lean body mass',
  body_water_mass: 'Body water mass',
  bone_mass: 'Bone mass',
  height: 'Height',
  basal_metabolic_rate: 'Basal metabolic rate',
  blood_glucose: 'Health Connect glucose',
  menstruation_period: 'Menstrual period',
  menstruation_flow: 'Menstrual flow',
  ovulation_test: 'Ovulation test',
  basal_body_temperature: 'Basal body temperature',
  cervical_mucus: 'Cervical mucus',
  intermenstrual_bleeding: 'Intermenstrual bleeding',
  blood_pressure_systolic: 'Systolic blood pressure',
  blood_pressure_diastolic: 'Diastolic blood pressure',
  oxygen_saturation: 'Blood oxygen',
  respiratory_rate: 'Respiratory rate',
  heart_rate_variability_rmssd: 'Heart-rate variability',
  vo2_max: 'VO₂ max',
  body_temperature: 'Body temperature',
  hydration: 'Hydration',
  nutrition: 'Nutrition',
};

function compact(parts: Array<string | undefined>) {
  const present = parts.filter((value): value is string => Boolean(value));
  return present.length ? present.join(' · ') : undefined;
}

function durationLabel(start: number, end: number) {
  const minutes = Math.max(0, Math.round((end - start) / 60_000));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder ? `${hours} hr ${remainder} min` : `${hours} hr`;
}

function number(value: number, digits = 1) {
  return value.toLocaleString('en-GB', {
    maximumFractionDigits: digits,
  });
}

function groupForKind(
  kind: HealthConnectRecord['kind'],
): HealthConnectRecordGroup {
  if (
    kind === 'steps' ||
    kind === 'distance' ||
    kind === 'elevation_gained' ||
    kind === 'floors_climbed' ||
    kind === 'active_calories' ||
    kind === 'total_calories'
  ) {
    return 'movement';
  }
  if (
    kind === 'workout' ||
    kind === 'workout_power' ||
    kind === 'workout_speed' ||
    kind === 'walking_cadence' ||
    kind === 'cycling_cadence'
  ) {
    return 'workout';
  }
  if (
    kind === 'heart_rate' ||
    kind === 'resting_heart_rate' ||
    kind === 'sleep'
  ) {
    return 'recovery';
  }
  if (
    kind === 'weight' ||
    kind === 'body_fat' ||
    kind === 'lean_body_mass' ||
    kind === 'body_water_mass' ||
    kind === 'bone_mass' ||
    kind === 'height' ||
    kind === 'basal_metabolic_rate'
  ) {
    return 'body';
  }
  if (kind === 'blood_glucose') return 'glucose';
  if (
    kind === 'menstruation_period' ||
    kind === 'menstruation_flow' ||
    kind === 'ovulation_test' ||
    kind === 'basal_body_temperature' ||
    kind === 'cervical_mucus' ||
    kind === 'intermenstrual_bleeding'
  ) {
    return 'cycle';
  }
  if (kind === 'hydration' || kind === 'nutrition') {
    return 'nutrition';
  }
  return 'vitals';
}

function numericTitle(record: StoredHealthConnectRecord) {
  const value = record.value;
  if (value === undefined) return labels[record.kind];
  switch (record.kind) {
    case 'steps':
      return `${Math.round(value).toLocaleString('en-GB')} steps`;
    case 'distance':
      return value >= 1_000
        ? `${number(value / 1_000, 2)} km`
        : `${number(value)} m`;
    case 'elevation_gained':
      return `${number(value)} m elevation gained`;
    case 'floors_climbed':
      return `${number(value)} floors climbed`;
    case 'active_calories':
      return `${number(value)} kcal active energy`;
    case 'total_calories':
      return `${number(value)} kcal total energy`;
    case 'workout_power':
      return `${number(value)} W workout power`;
    case 'workout_speed':
      return `${number(value * 3.6)} km/h workout speed`;
    case 'walking_cadence':
      return `${number(value)} steps/min walking cadence`;
    case 'cycling_cadence':
      return `${number(value)} rpm cycling cadence`;
    case 'heart_rate':
      return `${number(value)} bpm heart rate`;
    case 'resting_heart_rate':
      return `${number(value)} bpm resting heart rate`;
    case 'weight':
      return `${number(value)} kg weight`;
    case 'body_fat':
      return `${number(value)}% body fat`;
    case 'lean_body_mass':
      return `${number(value)} kg lean body mass`;
    case 'body_water_mass':
      return `${number(value)} kg body water`;
    case 'bone_mass':
      return `${number(value)} kg bone mass`;
    case 'height':
      return `${number(value * 100, 0)} cm height`;
    case 'basal_metabolic_rate':
      return `${number(value, 0)} kcal/day basal metabolism`;
    case 'blood_glucose':
      return `${number(value)} mmol/L Health Connect glucose`;
    case 'basal_body_temperature':
      return `${number(value)} °C basal body temperature`;
    case 'blood_pressure_systolic':
      return `${number(value, 0)} mmHg systolic`;
    case 'blood_pressure_diastolic':
      return `${number(value, 0)} mmHg diastolic`;
    case 'oxygen_saturation':
      return `${number(value)}% blood oxygen`;
    case 'respiratory_rate':
      return `${number(value)} breaths/min`;
    case 'heart_rate_variability_rmssd':
      return `${number(value, 0)} ms HRV (RMSSD)`;
    case 'vo2_max':
      return `${number(value)} ml/kg/min VO₂ max`;
    case 'body_temperature':
      return `${number(value)} °C body temperature`;
    case 'hydration':
      return `${number(value, 2)} L hydration`;
    default:
      return labels[record.kind];
  }
}

function flowLabel(value?: number) {
  if (value === 1) return 'Light';
  if (value === 2) return 'Medium';
  if (value === 3) return 'Heavy';
  return 'Recorded';
}

function ovulationLabel(value?: number) {
  if (value === 1) return 'Positive';
  if (value === 2) return 'High';
  if (value === 3) return 'Negative';
  return 'Inconclusive';
}

function cervicalMucusDetail(record: StoredHealthConnectRecord) {
  const appearance =
    record.appearance === 1
      ? 'Dry'
      : record.appearance === 2
        ? 'Sticky'
        : record.appearance === 3
          ? 'Creamy'
          : record.appearance === 4
            ? 'Watery'
            : record.appearance === 5
              ? 'Egg-white'
              : record.appearance === 6
                ? 'Unusual'
                : undefined;
  const sensation =
    record.sensation === 1
      ? 'Light sensation'
      : record.sensation === 2
        ? 'Medium sensation'
        : record.sensation === 3
          ? 'Heavy sensation'
          : undefined;
  return compact([appearance, sensation]);
}

function glucoseContext(record: StoredHealthConnectRecord) {
  const relation =
    record.relationToMeal === 2
      ? 'Fasting'
      : record.relationToMeal === 3
        ? 'Before meal'
        : record.relationToMeal === 4
          ? 'After meal'
          : record.relationToMeal === 1
            ? 'General'
            : undefined;
  const specimen =
    record.specimenSource === 1
      ? 'Interstitial fluid'
      : record.specimenSource === 2
        ? 'Capillary blood'
        : record.specimenSource === 3
          ? 'Plasma'
          : record.specimenSource === 4
            ? 'Serum'
            : record.specimenSource === 5
              ? 'Tears'
              : record.specimenSource === 6
                ? 'Whole blood'
                : undefined;
  return compact([specimen, relation]);
}

export function presentHealthConnectSourceRecord(
  record: StoredHealthConnectRecord,
): HealthConnectRecordPresentation {
  const group = groupForKind(record.kind);
  if (record.kind === 'workout') {
    return {
      group,
      title: record.title?.trim() || labels.workout,
      detail: compact([
        durationLabel(record.startTimeMs, record.endTimeMs),
        record.rateOfPerceivedExertion != null
          ? `RPE ${record.rateOfPerceivedExertion}`
          : undefined,
        record.segmentsCount
          ? `${record.segmentsCount} segments`
          : undefined,
        record.lapsCount ? `${record.lapsCount} laps` : undefined,
      ]),
    };
  }
  if (record.kind === 'sleep') {
    return {
      group,
      title: record.title?.trim() || labels.sleep,
      detail: compact([
        durationLabel(record.startTimeMs, record.endTimeMs),
        record.stages?.length
          ? `${record.stages.length} stages retained`
          : undefined,
      ]),
    };
  }
  if (record.kind === 'nutrition') {
    return {
      group,
      title: record.title?.trim() || labels.nutrition,
      detail: compact([
        record.value === undefined
          ? undefined
          : `${number(record.value)} g carbohydrate`,
        record.energyKcal === undefined
          ? undefined
          : `${number(record.energyKcal, 0)} kcal`,
        record.proteinGrams === undefined
          ? undefined
          : `${number(record.proteinGrams)} g protein`,
        record.fatGrams === undefined
          ? undefined
          : `${number(record.fatGrams)} g fat`,
      ]),
    };
  }
  if (record.kind === 'menstruation_period') {
    return {
      group,
      title: labels.menstruation_period,
      detail: durationLabel(record.startTimeMs, record.endTimeMs),
    };
  }
  if (record.kind === 'menstruation_flow') {
    return {
      group,
      title: labels.menstruation_flow,
      detail: `${flowLabel(record.flow)} flow`,
    };
  }
  if (record.kind === 'ovulation_test') {
    return {
      group,
      title: labels.ovulation_test,
      detail: `${ovulationLabel(record.result)} result`,
    };
  }
  if (record.kind === 'cervical_mucus') {
    return {
      group,
      title: labels.cervical_mucus,
      detail: cervicalMucusDetail(record),
    };
  }
  if (record.kind === 'intermenstrual_bleeding') {
    return {
      group,
      title: labels.intermenstrual_bleeding,
      detail: 'Recorded',
    };
  }
  return {
    group,
    title: numericTitle(record),
    detail:
      record.kind === 'blood_glucose'
        ? glucoseContext(record)
        : undefined,
  };
}

export const HEALTH_CONNECT_SOURCE_RECORD_KINDS = Object.keys(
  labels,
) as HealthConnectRecord['kind'][];
