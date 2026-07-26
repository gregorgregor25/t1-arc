import { NativeModule, registerWebModule } from 'expo';

import {
  HealthConnectCategoryId,
  HealthConnectStatus,
} from './DaymarkHealthConnect.types';

const categories: HealthConnectCategoryId[] = [
  'steps',
  'distance',
  'active_calories',
  'workouts',
  'heart_rate',
  'sleep',
  'weight',
];

class DaymarkHealthConnectModule extends NativeModule<Record<string, never>> {
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
}

export default registerWebModule(
  DaymarkHealthConnectModule,
  'DaymarkHealthConnect',
);
