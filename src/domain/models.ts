import type { SourceCapability } from './sourceCapabilities';

/** The device's IANA zone is the app's local-time basis. */
export const APP_TIME_ZONE = (() => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/London';
  } catch {
    return 'Europe/London';
  }
})();
export const MG_DL_PER_MMOL_L = 18.016;
export const TARGET_LOW_MMOL_L = 3.9;
export const TARGET_HIGH_MMOL_L = 10;

export type TrendDirection =
  | 'doubleDown'
  | 'down'
  | 'slightDown'
  | 'flat'
  | 'slightUp'
  | 'up'
  | 'doubleUp'
  | 'unknown';

export type DataQuality = 'measured' | 'estimated';

export interface GlucoseReading {
  id: string;
  timestamp: number;
  receivedAt: number;
  mmolL: number;
  trend: TrendDirection;
  quality: DataQuality;
  sourceId: string;
  /** Source-provided timestamps retained for provenance and diagnostics. */
  sourceFactoryTimestamp?: string;
  sourceLocalTimestamp?: string;
  timestampDiscrepancyMinutes?: number;
  /** Present for delayed/imported readings so every value can be audited. */
  importedAt?: number;
  sourceFile?: string;
  sourceRow?: number;
  sourceDeviceId?: string;
}

export interface BasalDelivery {
  id: string;
  /** Transient pre-device ID used only to migrate an existing local row. */
  legacyId?: string;
  start: number;
  end: number;
  rateUnitsPerHour: number;
  units: number;
  /** Glooko's delivery label, for example Scheduled. */
  deliveryType?: string;
  /** Present for percentage-based temporary basal rows. */
  percentage?: number;
  /** True when units were derived from rate x duration, not reported directly. */
  unitsEstimated?: boolean;
  sourceId: string;
  importedAt?: number;
  sourceFile?: string;
  sourceRow?: number;
  sourceDeviceId?: string;
}

export interface BolusDelivery {
  id: string;
  /** Transient pre-device ID used only to migrate an existing local row. */
  legacyId?: string;
  timestamp: number;
  units: number;
  deliveryType?: string;
  bloodGlucoseInputMmolL?: number;
  carbsInputGrams?: number;
  carbRatioGramsPerUnit?: number;
  initialUnits?: number;
  extendedUnits?: number;
  sourceId: string;
  importedAt?: number;
  sourceFile?: string;
  sourceRow?: number;
  sourceDeviceId?: string;
}

export interface InsulinDailyTotal {
  id: string;
  /** Transient pre-device ID used only to migrate an existing local row. */
  legacyId?: string;
  timestamp: number;
  dateKey: string;
  basalUnits?: number;
  bolusUnits?: number;
  totalUnits: number;
  sourceId: string;
  importedAt?: number;
  sourceFile?: string;
  sourceRow?: number;
  sourceDeviceId?: string;
}

export type PumpStateKind = 'activity-mode' | 'automated-pause';

export interface PumpStateInterval {
  id: string;
  start: number;
  end: number;
  kind: PumpStateKind;
  sourceId: string;
  importedAt?: number;
  sourceFile?: string;
  sourcePage?: number;
}

export type InsulinDelivery = BasalDelivery | BolusDelivery;

export interface TimeRange {
  start: number;
  end: number;
}

export type SourceFreshness = 'current' | 'delayed' | 'stale' | 'missing';
export type DataOrigin =
  | 'live'
  | 'delayed'
  | 'synthetic'
  | 'manual'
  | 'imported';

export interface DataSourceStatus {
  id: string;
  label: string;
  detail: string;
  freshness: SourceFreshness;
  origin: DataOrigin;
  lastAttemptAt?: number;
  lastUpdatedAt?: number;
  dataThrough?: number;
  recordCount?: number;
  errorCode?: string;
  capabilities?: readonly SourceCapability[];
  isLive: boolean;
}

export interface TimelineData {
  range: TimeRange;
  glucose: GlucoseReading[];
  basal: BasalDelivery[];
  boluses: BolusDelivery[];
  dailyInsulinTotals?: InsulinDailyTotal[];
  pumpStates?: PumpStateInterval[];
  context: HealthContextEvent[];
  sources: DataSourceStatus[];
}

export interface GlucoseStats {
  averageMmolL: number | null;
  standardDeviationMmolL: number | null;
  coefficientOfVariationPercent: number | null;
  timeBelowPercent: number;
  timeInRangePercent: number;
  timeAbovePercent: number;
  coveragePercent: number;
  observedMinutes: number;
}

export interface InsulinStats {
  basalUnits: number;
  bolusUnits: number;
  totalUnits: number;
}

export interface HealthContextBase {
  id: string;
  start: number;
  end?: number;
  sourceId: string;
  /** Human-readable provenance; sourceId remains the stable machine identity. */
  sourceLabel?: string;
  origin: 'synthetic' | 'manual' | 'imported';
  recordedAt?: number;
  sourceFile?: string;
  sourceRow?: number;
}

export interface MealFoodItem {
  id: string;
  name: string;
  brand?: string;
  amount: number;
  unit: 'g' | 'ml';
  carbohydrateGrams?: number;
  energyKcal?: number;
  proteinGrams?: number;
  fatGrams?: number;
  fibreGrams?: number;
  sugarsGrams?: number;
  saturatedFatGrams?: number;
  sourceLabel?: string;
}

export interface MealEvent extends HealthContextBase {
  kind: 'meal';
  title: string;
  mealType: 'breakfast' | 'lunch' | 'dinner' | 'snack';
  /** Undefined means the source did not supply carbohydrate, not zero. */
  carbsGrams?: number;
  energyKcal?: number;
  proteinGrams?: number;
  fatGrams?: number;
  fibreGrams?: number;
  sugarsGrams?: number;
  saturatedFatGrams?: number;
  servingQuantity?: number;
  servingCount?: number;
  /** Native T1 Arc logs retain exact foods; imported summaries never invent them. */
  nutritionDetail?: 'itemized' | 'summary';
  items?: MealFoodItem[];
}

export interface ActivityEvent extends HealthContextBase {
  kind: 'activity';
  title: string;
  activityType: 'walk' | 'run' | 'cycle' | 'strength' | 'other';
  durationMinutes: number;
  intensity: 'light' | 'moderate' | 'vigorous' | 'unspecified';
  caloriesBurned?: number;
  /** Other source records collapsed into this logical activity at read time. */
  corroboratingSourceIds?: string[];
  /** Provenance for a derived calorie value when it differs from sourceId. */
  caloriesBurnedSourceId?: string;
  /** Exact source detail retained for evidence-first strength-workout review. */
  strengthWorkout?: StrengthWorkoutDetail;
}

export interface StrengthWorkoutSet {
  index: number;
  type: 'normal' | 'warmup' | 'dropset' | 'failure' | string;
  weightKilograms?: number;
  reps?: number;
  distanceMetres?: number;
  durationSeconds?: number;
  rpe?: number;
  customMetric?: number;
}

export interface StrengthWorkoutExercise {
  index: number;
  title: string;
  notes?: string;
  exerciseTemplateId?: string;
  supersetId?: number;
  sets: StrengthWorkoutSet[];
}

export interface StrengthWorkoutDetail {
  provider: 'hevy';
  workoutId: string;
  description?: string;
  exercises: StrengthWorkoutExercise[];
}

export interface SleepEvent extends HealthContextBase {
  kind: 'sleep';
  title: string;
  end: number;
  durationMinutes: number;
  qualityPercent?: number;
}

export interface WeightEvent extends HealthContextBase {
  kind: 'weight';
  title: string;
  kilograms: number;
}

export interface MedicationEvent extends HealthContextBase {
  kind: 'medication';
  title: string;
  amount?: number;
  unit?: string;
  medicationType?: string;
}

export type ContextNoteCategory =
  | 'illness'
  | 'stress'
  | 'pump'
  | 'sensor'
  | 'hormones'
  | 'travel'
  | 'other';

/**
 * User-observed context that may help explain a period later. Notes are kept
 * deliberately factual: their presence is evidence of what the user recorded,
 * not evidence that the note caused a glucose outcome.
 */
export interface ContextNoteEvent extends HealthContextBase {
  kind: 'note';
  title: string;
  category: ContextNoteCategory;
  detail?: string;
  /** Canonical value for imported meter checks; presentation chooses mg/dL or mmol/L. */
  glucoseMmolL?: number;
  /** Explicit user-recorded start, never inferred from a glucose gap or note title. */
  sensorStarted?: boolean;
  /** The live glucose source selected when the sensor change was recorded. */
  sensorGlucoseSourceId?: string;
}

export type HealthContextEvent =
  | MealEvent
  | ActivityEvent
  | SleepEvent
  | WeightEvent
  | MedicationEvent
  | ContextNoteEvent;
