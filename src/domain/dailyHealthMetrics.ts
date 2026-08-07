import type { TimeRange } from './models';

export type DailyMetricCategory =
  | 'steps'
  | 'distance'
  | 'active_calories'
  | 'workouts'
  | 'heart_rate'
  | 'weight'
  | 'body_composition'
  | 'blood_glucose'
  | 'vitals'
  | 'hydration';

export interface DailyMetricRecord {
  id: string;
  kind:
    | 'steps'
    | 'distance'
    | 'elevation_gained'
    | 'floors_climbed'
    | 'active_calories'
    | 'total_calories'
    | 'workout_power'
    | 'workout_speed'
    | 'walking_cadence'
    | 'cycling_cadence'
    | 'heart_rate'
    | 'resting_heart_rate'
    | 'weight'
    | 'body_fat'
    | 'lean_body_mass'
    | 'body_water_mass'
    | 'bone_mass'
    | 'height'
    | 'basal_metabolic_rate'
    | 'blood_glucose'
    | 'blood_pressure_systolic'
    | 'blood_pressure_diastolic'
    | 'oxygen_saturation'
    | 'respiratory_rate'
    | 'heart_rate_variability_rmssd'
    | 'vo2_max'
    | 'body_temperature'
    | 'hydration';
  sourcePackage: string;
  sourceLabel: string;
  start: number;
  end: number;
  value: number;
  unit:
    | 'count'
    | 'm'
    | 'floors'
    | 'kcal'
    | 'kcal/day'
    | 'mmol/L'
    | 'w'
    | 'm/s'
    | 'rpm'
    | 'bpm'
    | 'kg'
    | 'percent'
    | 'mmHg'
    | 'breaths/min'
    | 'ms'
    | 'ml/kg/min'
    | 'celsius'
    | 'litre';
  mealType?: number;
  relationToMeal?: number;
  specimenSource?: number;
}

export interface DailyHealthMetrics {
  steps?: number;
  distanceKilometres?: number;
  elevationGainedMetres?: number;
  floorsClimbed?: number;
  activeCaloriesKcal?: number;
  totalCaloriesKcal?: number;
  averageWorkoutPowerWatts?: number;
  maximumWorkoutPowerWatts?: number;
  averageWorkoutSpeedMetresPerSecond?: number;
  maximumWorkoutSpeedMetresPerSecond?: number;
  averageWalkingCadencePerMinute?: number;
  averageCyclingCadenceRpm?: number;
  averageHeartRateBpm?: number;
  restingHeartRateBpm?: number;
  minimumHeartRateBpm?: number;
  maximumHeartRateBpm?: number;
  weightKilograms?: number;
  bodyFatPercent?: number;
  leanBodyMassKilograms?: number;
  bodyWaterMassKilograms?: number;
  boneMassKilograms?: number;
  heightMetres?: number;
  basalMetabolicRateKcalPerDay?: number;
  bloodGlucoseMmolL?: number;
  bloodPressureSystolic?: number;
  bloodPressureDiastolic?: number;
  oxygenSaturationPercent?: number;
  respiratoryRatePerMinute?: number;
  heartRateVariabilityRmssdMs?: number;
  vo2MaxMillilitresPerKilogramMinute?: number;
  bodyTemperatureCelsius?: number;
  hydrationLitres?: number;
  sourceLabels: string[];
  needsSource: DailyMetricCategory[];
  recordCount: number;
  selectedRecordIds: string[];
}

const CATEGORY_KINDS: Record<
  DailyMetricCategory,
  DailyMetricRecord['kind'][]
> = {
  steps: ['steps'],
  distance: ['distance', 'elevation_gained', 'floors_climbed'],
  active_calories: ['active_calories', 'total_calories'],
  workouts: [
    'workout_power',
    'workout_speed',
    'walking_cadence',
    'cycling_cadence',
  ],
  heart_rate: ['heart_rate', 'resting_heart_rate'],
  weight: ['weight'],
  body_composition: [
    'body_fat',
    'lean_body_mass',
    'body_water_mass',
    'bone_mass',
    'height',
    'basal_metabolic_rate',
  ],
  blood_glucose: ['blood_glucose'],
  vitals: [
    'blood_pressure_systolic',
    'blood_pressure_diastolic',
    'oxygen_saturation',
    'respiratory_rate',
    'heart_rate_variability_rmssd',
    'vo2_max',
    'body_temperature',
  ],
  hydration: ['hydration'],
};

function overlapFraction(record: DailyMetricRecord, range: TimeRange) {
  if (record.end <= record.start) {
    return record.start >= range.start && record.start < range.end ? 1 : 0;
  }
  const overlap = Math.max(
    0,
    Math.min(record.end, range.end) - Math.max(record.start, range.start),
  );
  return overlap / (record.end - record.start);
}

function roundedAverage(values: number[]) {
  if (!values.length) return undefined;
  return Math.round(
    values.reduce((total, value) => total + value, 0) / values.length,
  );
}

function average(values: number[]) {
  if (!values.length) return undefined;
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function latestValue(
  records: DailyMetricRecord[],
  kind: DailyMetricRecord['kind'],
) {
  const matches = records
    .filter((record) => record.kind === kind)
    .sort((left, right) => left.start - right.start);
  return matches[matches.length - 1]?.value;
}

export function aggregateDailyHealthMetrics(
  records: DailyMetricRecord[],
  range: TimeRange,
  preferredSources: Partial<Record<DailyMetricCategory, string>> = {},
): DailyHealthMetrics {
  const selected = new Map<DailyMetricCategory, DailyMetricRecord[]>();
  const needsSource: DailyMetricCategory[] = [];
  const sourceLabels = new Set<string>();

  for (const category of Object.keys(CATEGORY_KINDS) as DailyMetricCategory[]) {
    const candidates = records.filter((record) =>
      CATEGORY_KINDS[category].includes(record.kind),
    );
    const preferred = preferredSources[category];
    const packages = new Set(candidates.map((record) => record.sourcePackage));
    const categoryRecords = preferred
      ? candidates.filter((record) => record.sourcePackage === preferred)
      : packages.size <= 1
        ? candidates
        : [];
    if (!preferred && packages.size > 1) needsSource.push(category);
    categoryRecords.forEach((record) => sourceLabels.add(record.sourceLabel));
    selected.set(category, categoryRecords);
  }

  const steps = selected
    .get('steps')!
    .reduce(
      (total, record) => total + record.value * overlapFraction(record, range),
      0,
    );
  const distanceRecords = selected.get('distance')!;
  const distanceMetres = distanceRecords
    .filter((record) => record.kind === 'distance')
    .reduce(
      (total, record) => total + record.value * overlapFraction(record, range),
      0,
    );
  const elevationMetres = distanceRecords
    .filter((record) => record.kind === 'elevation_gained')
    .reduce(
      (total, record) => total + record.value * overlapFraction(record, range),
      0,
    );
  const floorsClimbed = distanceRecords
    .filter((record) => record.kind === 'floors_climbed')
    .reduce(
      (total, record) => total + record.value * overlapFraction(record, range),
      0,
    );
  const energyRecords = selected.get('active_calories')!;
  const activeEnergyRecords = energyRecords.filter(
    (record) => record.kind === 'active_calories',
  );
  const totalEnergyRecords = energyRecords.filter(
    (record) => record.kind === 'total_calories',
  );
  const activeCalories = activeEnergyRecords.reduce(
    (total, record) =>
      total + record.value * overlapFraction(record, range),
    0,
  );
  const totalCalories = totalEnergyRecords.reduce(
    (total, record) => total + record.value * overlapFraction(record, range),
    0,
  );
  const workouts = selected.get('workouts')!;
  const workoutPowers = workouts
    .filter((record) => record.kind === 'workout_power')
    .map((record) => record.value);
  const workoutSpeeds = workouts
    .filter((record) => record.kind === 'workout_speed')
    .map((record) => record.value);
  const walkingCadences = workouts
    .filter((record) => record.kind === 'walking_cadence')
    .map((record) => record.value);
  const cyclingCadences = workouts
    .filter((record) => record.kind === 'cycling_cadence')
    .map((record) => record.value);
  const heartRates = selected
    .get('heart_rate')!
    .filter((record) => record.kind === 'heart_rate')
    .map((record) => record.value);
  const restingHeartRates = selected
    .get('heart_rate')!
    .filter((record) => record.kind === 'resting_heart_rate')
    .map((record) => record.value);
  const weights = selected.get('weight')!;
  const bodyComposition = selected.get('body_composition')!;
  const bloodGlucose = selected.get('blood_glucose')!;
  const vitals = selected.get('vitals')!;
  const hydration = selected
    .get('hydration')!
    .reduce(
      (total, record) => total + record.value * overlapFraction(record, range),
      0,
    );
  const selectedRecords = [...selected.values()].flat();

  return {
    steps: selected.get('steps')!.length ? Math.round(steps) : undefined,
    distanceKilometres: distanceRecords.some(
      (record) => record.kind === 'distance',
    )
      ? Math.round((distanceMetres / 1_000) * 10) / 10
      : undefined,
    elevationGainedMetres: distanceRecords.some(
      (record) => record.kind === 'elevation_gained',
    )
      ? Math.round(elevationMetres)
      : undefined,
    floorsClimbed: distanceRecords.some(
      (record) => record.kind === 'floors_climbed',
    )
      ? Math.round(floorsClimbed * 10) / 10
      : undefined,
    activeCaloriesKcal: activeEnergyRecords.length
      ? Math.round(activeCalories)
      : undefined,
    totalCaloriesKcal: totalEnergyRecords.length
      ? Math.round(totalCalories)
      : undefined,
    averageWorkoutPowerWatts: roundedAverage(workoutPowers),
    maximumWorkoutPowerWatts: workoutPowers.length
      ? Math.round(Math.max(...workoutPowers))
      : undefined,
    averageWorkoutSpeedMetresPerSecond:
      average(workoutSpeeds) === undefined
        ? undefined
        : Math.round(average(workoutSpeeds)! * 100) / 100,
    maximumWorkoutSpeedMetresPerSecond: workoutSpeeds.length
      ? Math.round(Math.max(...workoutSpeeds) * 100) / 100
      : undefined,
    averageWalkingCadencePerMinute: roundedAverage(walkingCadences),
    averageCyclingCadenceRpm: roundedAverage(cyclingCadences),
    averageHeartRateBpm: roundedAverage(heartRates),
    restingHeartRateBpm: roundedAverage(restingHeartRates),
    minimumHeartRateBpm: heartRates.length
      ? Math.min(...heartRates)
      : undefined,
    maximumHeartRateBpm: heartRates.length
      ? Math.max(...heartRates)
      : undefined,
    weightKilograms: latestValue(weights, 'weight'),
    bodyFatPercent: latestValue(bodyComposition, 'body_fat'),
    leanBodyMassKilograms: latestValue(
      bodyComposition,
      'lean_body_mass',
    ),
    bodyWaterMassKilograms: latestValue(
      bodyComposition,
      'body_water_mass',
    ),
    boneMassKilograms: latestValue(bodyComposition, 'bone_mass'),
    heightMetres: latestValue(bodyComposition, 'height'),
    basalMetabolicRateKcalPerDay: latestValue(
      bodyComposition,
      'basal_metabolic_rate',
    ),
    bloodGlucoseMmolL: latestValue(bloodGlucose, 'blood_glucose'),
    bloodPressureSystolic: latestValue(
      vitals,
      'blood_pressure_systolic',
    ),
    bloodPressureDiastolic: latestValue(
      vitals,
      'blood_pressure_diastolic',
    ),
    oxygenSaturationPercent: latestValue(vitals, 'oxygen_saturation'),
    respiratoryRatePerMinute: latestValue(vitals, 'respiratory_rate'),
    heartRateVariabilityRmssdMs: latestValue(
      vitals,
      'heart_rate_variability_rmssd',
    ),
    vo2MaxMillilitresPerKilogramMinute: latestValue(vitals, 'vo2_max'),
    bodyTemperatureCelsius: latestValue(vitals, 'body_temperature'),
    hydrationLitres: selected.get('hydration')!.length
      ? Math.round(hydration * 100) / 100
      : undefined,
    sourceLabels: [...sourceLabels].sort(),
    needsSource,
    recordCount: selectedRecords.length,
    selectedRecordIds: selectedRecords.map((record) => record.id),
  };
}
