import { GlucoseDisplayStatus } from './T1ArcGlucoseDisplay.types';
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
  androidAutoProjected: false,
  freshness: 'missing',
};

let privateGlucoseWriteEpoch = 0;

function validWriteEpoch(value: number) {
  return Number.isSafeInteger(value) && value >= 0;
}

export default {
  async getStatusAsync() {
    return unavailable;
  },
  async getPrivateGlucoseWriteEpochAsync() {
    return privateGlucoseWriteEpoch;
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
  async getWatchFaceStatusAsync() {
    return [];
  },
  async installBundledWatchFaceAsync() {
    return { code: 'unsupported' as const, supported: false };
  },
  async openWatchFaceActivationAsync() {
    return false;
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
  async setRegionalDisplayPreferencesAsync() {
    return false;
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
  async updatePrivateGlucoseForWriteEpochAsync(writeEpoch: number) {
    if (!validWriteEpoch(writeEpoch) || writeEpoch !== privateGlucoseWriteEpoch) {
      throw new Error(
        'This glucose publication was superseded by a privacy erase.',
      );
    }
    return false;
  },
  async clearPrivateGlucoseForWriteEpochAsync(writeEpoch: number) {
    if (!validWriteEpoch(writeEpoch) || writeEpoch < privateGlucoseWriteEpoch) {
      throw new Error('A stale glucose privacy clear cannot replace a newer epoch.');
    }
    privateGlucoseWriteEpoch = writeEpoch;
    return unavailable;
  },
  async showGlucoseAlertAsync() {
    return false;
  },
  async setGlucoseAlertMonitoringEnabledAsync() {
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
  async getGlucoseAlertChannelStatusesAsync() {
    return [];
  },
  async showGlucoseTestAlertAsync() {
    return false;
  },
  async openGlucoseAlertChannelSettingsAsync() {
    return false;
  },
  async openGlucoseAlertAppSettingsAsync() {
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
