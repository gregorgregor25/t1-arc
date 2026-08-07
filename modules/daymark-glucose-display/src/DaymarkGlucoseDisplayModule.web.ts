import { GlucoseDisplayStatus } from './DaymarkGlucoseDisplay.types';
import { DEFAULT_GLUCOSE_APPEARANCE } from '../../../src/domain/glucoseAppearance';

const unavailable: GlucoseDisplayStatus = {
  supported: false,
  enabled: false,
  notificationsAllowed: false,
  lockScreenVisible: false,
  serviceRunning: false,
  aodDesired: false,
  aodPosition: 'bottomCenter',
  aodSize: 'standard',
  aodServiceEnabled: false,
  aodOverlayVisible: false,
  androidAutoEnabled: false,
  freshness: 'missing',
};

export default {
  async getStatusAsync() {
    return unavailable;
  },
  async getWearStatusAsync() {
    return {
      supported: false,
      querySucceeded: false,
      pairedWatchCount: 0,
      companionWatchCount: 0,
      companionAvailable: false,
      watchNames: [],
    };
  },
  async getHomeWidgetStatusAsync() {
    return {
      supported: false,
      pinningSupported: false,
      installedCount: 0,
    };
  },
  async requestPinHomeWidgetAsync() {
    return false;
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
  async setAodPositionAsync() {
    return unavailable;
  },
  async setAodSizeAsync() {
    return unavailable;
  },
  async setAndroidAutoEnabledAsync() {
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
  async updateHistoryAsync() {
    return false;
  },
  async showGlucoseAlertAsync() {
    return false;
  },
  async cancelGlucoseAlertsAsync() {
    return false;
  },
  async glucoseAlertsAllowedAsync() {
    return false;
  },
  async openGlucoseAlertSettingsAsync() {
    return false;
  },
  async showReviewReadyNotificationAsync() {
    return false;
  },
  async cancelReviewReadyNotificationAsync() {
    return false;
  },
  async showGlookoSignInRequiredAsync() {
    return false;
  },
  async cancelGlookoSignInRequiredAsync() {
    return false;
  },
  async reviewNotificationsAllowedAsync() {
    return false;
  },
  async openReviewNotificationSettingsAsync() {
    return false;
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
