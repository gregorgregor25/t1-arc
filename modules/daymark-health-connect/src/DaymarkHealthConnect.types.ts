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
  | 'weight';

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
    | 'active_calories'
    | 'workout'
    | 'heart_rate'
    | 'resting_heart_rate'
    | 'sleep'
    | 'weight';
  sourcePackage: string;
  startTimeMs: number;
  endTimeMs: number;
  lastModifiedTimeMs: number;
  recordingMethod: number;
  clientRecordId?: string | null;
  clientRecordVersion: number;
  deviceManufacturer?: string | null;
  deviceModel?: string | null;
  deviceType?: number | null;
  value?: number;
  unit?: 'count' | 'm' | 'kcal' | 'bpm' | 'kg';
  exerciseType?: number;
  title?: string | null;
  notes?: string | null;
  rateOfPerceivedExertion?: number | null;
  segmentsCount?: number;
  lapsCount?: number;
  stages?: Array<{
    startTimeMs: number;
    endTimeMs: number;
    stageType: number;
  }>;
}

export interface HealthConnectPage {
  records: HealthConnectRecord[];
  nextPageToken: string | null;
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
