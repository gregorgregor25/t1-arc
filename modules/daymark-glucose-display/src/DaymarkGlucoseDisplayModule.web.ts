import { GlucoseDisplayStatus } from './DaymarkGlucoseDisplay.types';
import { DEFAULT_GLUCOSE_APPEARANCE } from '../../../src/domain/glucoseAppearance';

const unavailable: GlucoseDisplayStatus = {
  supported: false,
  enabled: false,
  notificationsAllowed: false,
  lockScreenVisible: false,
  serviceRunning: false,
  aodDesired: false,
  aodServiceEnabled: false,
  aodOverlayVisible: false,
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
  async getAppearanceSettingsAsync() {
    return DEFAULT_GLUCOSE_APPEARANCE;
  },
  async setAppearanceSettingsAsync() {
    return DEFAULT_GLUCOSE_APPEARANCE;
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
