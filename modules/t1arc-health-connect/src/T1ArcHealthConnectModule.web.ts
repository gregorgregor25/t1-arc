import { NativeModule, registerWebModule } from 'expo';

import {
  HealthConnectCategoryId,
  HealthConnectChangesPage,
  HealthConnectPage,
  HealthConnectStatus,
} from './T1ArcHealthConnect.types';

const categories: HealthConnectCategoryId[] = [
  'steps',
  'distance',
  'active_calories',
  'workouts',
  'heart_rate',
  'sleep',
  'weight',
  'body_composition',
  'vitals',
  'hydration',
  'nutrition',
];

class T1ArcHealthConnectModule extends NativeModule<Record<string, never>> {
  async getStatusAsync(): Promise<HealthConnectStatus> {
    return {
      availability: 'unavailable',
      sdkStatus: 1,
      historyGranted: false,
      backgroundGranted: false,
      backgroundAvailable: false,
      sourceDiscoveryAvailable: false,
      grantedPermissions: [],
      categories: categories.map((id) => ({
        id,
        granted: false,
        partiallyGranted: false,
      })),
    };
  }

  async getChangesTokenAsync(): Promise<string> {
    throw new Error('Health Connect is unavailable on the web.');
  }

  async readChangesPageAsync(): Promise<HealthConnectChangesPage> {
    throw new Error('Health Connect is unavailable on the web.');
  }

  async readRecordsPageAsync(): Promise<HealthConnectPage> {
    throw new Error('Health Connect is unavailable on the web.');
  }
}

export default registerWebModule(
  T1ArcHealthConnectModule,
  'T1ArcHealthConnect',
);
