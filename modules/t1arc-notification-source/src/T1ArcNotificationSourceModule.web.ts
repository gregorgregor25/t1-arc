import { NativeModule, registerWebModule } from 'expo';

import {
  CapturedNotificationEnvelope,
  CapturedNotificationReceipt,
  NotificationSourceConfiguration,
  NotificationSourceStatus,
} from './T1ArcNotificationSource.types';

const unsupported: NotificationSourceStatus = {
  supported: false,
  accessGranted: false,
  enabled: false,
  rules: [],
  pendingCount: 0,
};

class T1ArcNotificationSourceModule extends NativeModule<
  Record<string, never>
> {
  async getStatusAsync() {
    return unsupported;
  }

  async getConfigurationSnapshotAsync() {
    return {
      enabled: unsupported.enabled,
      rules: unsupported.rules,
      configurationRevision: 0,
    };
  }

  async setConfigurationAsync(
    _configuration: NotificationSourceConfiguration,
  ) {
    return unsupported;
  }

  async peekAsync(_limit = 100): Promise<CapturedNotificationEnvelope[]> {
    return [];
  }

  async acknowledgeAsync(_ids: string[]) {
    return 0;
  }

  async acknowledgeCapturedAsync(_receipts: CapturedNotificationReceipt[]) {
    return 0;
  }

  async clearPendingAsync() {
    return 0;
  }

  async disableAndClearAsync() {
    return 0;
  }

  async openNotificationAccessSettingsAsync() {
    return false;
  }

  async isPackageInstalledAsync(_packageName: string) {
    return false;
  }
}

export default registerWebModule(
  T1ArcNotificationSourceModule,
  'T1ArcNotificationSource',
);
