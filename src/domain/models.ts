import type { SourceCapability } from './sourceCapabilities';

export const APP_TIME_ZONE = 'Europe/London';
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
export type DataOrigin = 'live' | 'delayed' | 'synthetic' | 'manual' | 'imported';

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
  origin: 'synthetic' | 'manual' | 'imported';
  recordedAt?: number;
  sourceFile?: string;
  sourceRow?: number;
}

export interface MealEvent extends HealthContextBase {
  kind: 'meal';
  title: string;
  mealType: 'breakfast' | 'lunch' | 'dinner' | 'snack';
  carbsGrams: number;
  energyKcal?: number;
  proteinGrams?: number;
  fatGrams?: number;
  servingQuantity?: number;
  servingCount?: number;
}

export interface ActivityEvent extends HealthContextBase {
  kind: 'activity';
  title: string;
  activityType: 'walk' | 'run' | 'cycle' | 'strength' | 'other';
  durationMinutes: number;
  intensity: 'light' | 'moderate' | 'vigorous';
  caloriesBurned?: number;
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
}

export type HealthContextEvent =
  | MealEvent
  | ActivityEvent
  | SleepEvent
  | WeightEvent
  | MedicationEvent
  | ContextNoteEvent;
