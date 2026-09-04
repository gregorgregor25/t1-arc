export type HealthConnectAvailability =
  | 'available'
  | 'update_required'
  | 'unavailable';

export type HealthConnectCategoryId =
  | 'steps'
  | 'distance'
  | 'active_calories'
  | 'workouts'
  | 'heart_rate'
  | 'sleep'
  | 'weight'
  | 'body_composition'
  | 'blood_glucose'
  | 'vitals'
  | 'cycle'
  | 'hydration'
  | 'nutrition';

export interface HealthConnectCategoryStatus {
  id: HealthConnectCategoryId;
  granted: boolean;
  partiallyGranted: boolean;
}

export interface HealthConnectStatus {
  availability: HealthConnectAvailability;
  sdkStatus: number;
  historyGranted: boolean;
  backgroundGranted: boolean;
  backgroundAvailable: boolean;
  sourceDiscoveryAvailable: boolean;
  grantedPermissions: string[];
  categories: HealthConnectCategoryStatus[];
}

export interface HealthConnectSource {
  packageName: string;
  displayName: string;
}

export interface HealthConnectRecord {
  externalId: string;
  parentExternalId?: string | null;
  kind:
    | 'steps'
    | 'distance'
    | 'elevation_gained'
    | 'floors_climbed'
    | 'active_calories'
    | 'total_calories'
    | 'workout'
    | 'workout_power'
    | 'workout_speed'
    | 'walking_cadence'
    | 'cycling_cadence'
    | 'heart_rate'
    | 'resting_heart_rate'
    | 'sleep'
    | 'weight'
    | 'body_fat'
    | 'lean_body_mass'
    | 'body_water_mass'
    | 'bone_mass'
    | 'height'
    | 'basal_metabolic_rate'
    | 'blood_glucose'
    | 'menstruation_period'
    | 'menstruation_flow'
    | 'ovulation_test'
    | 'basal_body_temperature'
    | 'cervical_mucus'
    | 'intermenstrual_bleeding'
    | 'blood_pressure_systolic'
    | 'blood_pressure_diastolic'
    | 'oxygen_saturation'
    | 'respiratory_rate'
    | 'heart_rate_variability_rmssd'
    | 'vo2_max'
    | 'body_temperature'
    | 'hydration'
    | 'nutrition';
  sourcePackage: string;
  startTimeMs: number;
  endTimeMs: number;
  startZoneOffsetSeconds?: number | null;
  endZoneOffsetSeconds?: number | null;
  lastModifiedTimeMs: number;
  recordingMethod: number;
  clientRecordId?: string | null;
  clientRecordVersion: number;
  deviceManufacturer?: string | null;
  deviceModel?: string | null;
  deviceType?: number | null;
  value?: number;
  unit?:
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
    | 'litre'
    | 'g';
  exerciseType?: number;
  title?: string | null;
  notes?: string | null;
  rateOfPerceivedExertion?: number | null;
  mealType?: number;
  relationToMeal?: number;
  specimenSource?: number;
  flow?: number;
  result?: number;
  measurementLocation?: number;
  appearance?: number;
  sensation?: number;
  energyKcal?: number;
  proteinGrams?: number;
  fatGrams?: number;
  fibreGrams?: number;
  sugarGrams?: number;
  saturatedFatGrams?: number;
  segmentsCount?: number;
  lapsCount?: number;
  segments?: {
    startTimeMs: number;
    endTimeMs: number;
    segmentType: number;
    repetitions: number;
  }[];
  laps?: {
    startTimeMs: number;
    endTimeMs: number;
    lengthMetres?: number | null;
  }[];
  stages?: {
    startTimeMs: number;
    endTimeMs: number;
    stageType: number;
  }[];
}

export interface HealthConnectPage {
  records: HealthConnectRecord[];
  nextPageToken: string | null;
  sources: HealthConnectSource[];
}

export interface HealthConnectChangesPage {
  upserted: HealthConnectRecord[];
  deletedRecordIds: string[];
  nextChangesToken: string;
  hasMore: boolean;
  tokenExpired: boolean;
  sources: HealthConnectSource[];
}

export interface HealthConnectDiscoveryStatus {
  available: boolean;
  hasMatches: boolean;
  reason: 'unsupported' | 'no_new_sources' | null;
}

export interface HealthConnectOpenResult {
  opened: boolean;
  mode: 'matchmaking' | 'settings';
  completed?: boolean;
}
