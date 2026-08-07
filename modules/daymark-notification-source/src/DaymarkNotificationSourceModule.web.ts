import { NativeModule, registerWebModule } from 'expo';

import {
  CapturedNotificationEnvelope,
  NotificationSourceConfiguration,
  NotificationSourceStatus,
} from './DaymarkNotificationSource.types';

const unsupported: NotificationSourceStatus = {
  supported: false,
  accessGranted: false,
  enabled: false,
  rules: [],
  pendingCount: 0,
};

class DaymarkNotificationSourceModule extends NativeModule<
  Record<string, never>
> {
  async getStatusAsync() {
    return unsupported;
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

  async clearPendingAsync() {
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
  DaymarkNotificationSourceModule,
  'DaymarkNotificationSource',
);
