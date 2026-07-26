import { GlucoseDisplayStatus } from './DaymarkGlucoseDisplay.types';

const unavailable: GlucoseDisplayStatus = {
  supported: false,
  enabled: false,
  notificationsAllowed: false,
  lockScreenVisible: false,
  serviceRunning: false,
  aodDesired: false,
  aodServiceEnabled: false,
  freshness: 'missing',
};

export default {
  async getStatusAsync() {
    return unavailable;
  },
  async enableAsync() {
    return unavailable;
  },
  async disableAsync() {
    return unavailable;
  },
  async setLockScreenVisibleAsync() {
    return unavailable;
  },
  async setAodDesiredAsync() {
    return unavailable;
  },
  async updateReadingAsync() {
    return unavailable;
  },
  async updateMissingAsync() {
    return unavailable;
  },
  async openNotificationSettingsAsync() {
    return false;
  },
  async openAppDetailsSettingsAsync() {
    return false;
  },
  async openAccessibilitySettingsAsync() {
    return false;
  },
};
