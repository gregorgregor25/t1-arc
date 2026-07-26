import { NativeModule, requireNativeModule } from 'expo';

import {
  HealthConnectCategoryId,
  HealthConnectDiscoveryStatus,
  HealthConnectOpenResult,
  HealthConnectPage,
  HealthConnectStatus,
} from './DaymarkHealthConnect.types';

declare class DaymarkHealthConnectModule extends NativeModule<Record<string, never>> {
  getStatusAsync(): Promise<HealthConnectStatus>;
  requestPermissionsAsync(
    categories: HealthConnectCategoryId[],
    requestHistory: boolean,
    requestBackground: boolean,
  ): Promise<HealthConnectStatus>;
  checkSourceDiscoveryAsync(
    categories: HealthConnectCategoryId[],
  ): Promise<HealthConnectDiscoveryStatus>;
  openSourceDiscoveryAsync(
    categories: HealthConnectCategoryId[],
  ): Promise<HealthConnectOpenResult>;
  openSettingsAsync(): Promise<boolean>;
  openInstallAsync(): Promise<boolean>;
  readRecordsPageAsync(
    category: HealthConnectCategoryId,
    startTimeMs: number,
    endTimeMs: number,
    sourcePackages: string[],
    pageToken: string | null,
  ): Promise<HealthConnectPage>;
}

export default requireNativeModule<DaymarkHealthConnectModule>(
  'DaymarkHealthConnect',
);
