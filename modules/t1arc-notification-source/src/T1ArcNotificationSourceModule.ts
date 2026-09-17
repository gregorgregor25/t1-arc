import { NativeModule, requireNativeModule } from 'expo';

import {
  CapturedNotificationEnvelope,
  CapturedNotificationReceipt,
  NotificationSourceConfiguration,
  NotificationSourceConfigurationSnapshot,
  NotificationSourceStatus,
} from './T1ArcNotificationSource.types';

declare class NativeT1ArcNotificationSourceModule extends NativeModule<
  Record<string, never>
> {
  getStatusAsync(): Promise<NotificationSourceStatus>;
  getConfigurationSnapshotAsync(): Promise<NotificationSourceConfigurationSnapshot>;
  setConfigurationAsync(
    enabled: boolean,
    rulesJson: string,
  ): Promise<NotificationSourceStatus>;
  peekAsync(limit: number): Promise<CapturedNotificationEnvelope[]>;
  acknowledgeAsync(ids: string[]): Promise<number>;
  acknowledgeCapturedAsync(receiptsJson: string): Promise<number>;
  clearPendingAsync(): Promise<number>;
  disableAndClearAsync(): Promise<number>;
  openNotificationAccessSettingsAsync(): Promise<boolean>;
  isPackageInstalledAsync(packageName: string): Promise<boolean>;
}

const nativeModule =
  requireNativeModule<NativeT1ArcNotificationSourceModule>(
    'T1ArcNotificationSource',
  );

export default {
  getStatusAsync() {
    return nativeModule.getStatusAsync();
  },
  getConfigurationSnapshotAsync() {
    return nativeModule.getConfigurationSnapshotAsync();
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
  acknowledgeCapturedAsync(receipts: CapturedNotificationReceipt[]) {
    return nativeModule.acknowledgeCapturedAsync(JSON.stringify(receipts));
  },
  clearPendingAsync() {
    return nativeModule.clearPendingAsync();
  },
  disableAndClearAsync() {
    return nativeModule.disableAndClearAsync();
  },
  openNotificationAccessSettingsAsync() {
    return nativeModule.openNotificationAccessSettingsAsync();
  },
  isPackageInstalledAsync(packageName: string) {
    return nativeModule.isPackageInstalledAsync(packageName);
  },
};
