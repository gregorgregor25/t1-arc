import { NativeModule, requireNativeModule } from 'expo';

import {
  CapturedNotificationEnvelope,
  NotificationSourceConfiguration,
  NotificationSourceStatus,
} from './DaymarkNotificationSource.types';

declare class NativeDaymarkNotificationSourceModule extends NativeModule<
  Record<string, never>
> {
  getStatusAsync(): Promise<NotificationSourceStatus>;
  setConfigurationAsync(
    enabled: boolean,
    rulesJson: string,
  ): Promise<NotificationSourceStatus>;
  peekAsync(limit: number): Promise<CapturedNotificationEnvelope[]>;
  acknowledgeAsync(ids: string[]): Promise<number>;
  clearPendingAsync(): Promise<number>;
  openNotificationAccessSettingsAsync(): Promise<boolean>;
  isPackageInstalledAsync(packageName: string): Promise<boolean>;
}

const nativeModule =
  requireNativeModule<NativeDaymarkNotificationSourceModule>(
    'DaymarkNotificationSource',
  );

export default {
  getStatusAsync() {
    return nativeModule.getStatusAsync();
  },
  setConfigurationAsync(configuration: NotificationSourceConfiguration) {
    return nativeModule.setConfigurationAsync(
      configuration.enabled,
      JSON.stringify(configuration.rules),
    );
  },
  peekAsync(limit = 100) {
    return nativeModule.peekAsync(limit);
  },
  acknowledgeAsync(ids: string[]) {
    return nativeModule.acknowledgeAsync(ids);
  },
  clearPendingAsync() {
    return nativeModule.clearPendingAsync();
  },
  openNotificationAccessSettingsAsync() {
    return nativeModule.openNotificationAccessSettingsAsync();
  },
  isPackageInstalledAsync(packageName: string) {
    return nativeModule.isPackageInstalledAsync(packageName);
  },
};
