import { NativeModule, requireNativeModule } from 'expo';

import {
  AodPosition,
  AodSize,
  GlucoseAppearanceSettings,
  GlucoseAlertKind,
  GlucoseDisplayHistoryPoint,
  GlucoseDisplayStatus,
  GlucoseDisplayTrendOrigin,
  HomeWidgetStatus,
  WearCompanionStatus,
} from './DaymarkGlucoseDisplay.types';

declare class DaymarkGlucoseDisplayModule extends NativeModule<Record<string, never>> {
  getStatusAsync(): Promise<GlucoseDisplayStatus>;
  getWearStatusAsync(): Promise<WearCompanionStatus>;
  getHomeWidgetStatusAsync(): Promise<HomeWidgetStatus>;
  requestPinHomeWidgetAsync(): Promise<boolean>;
  enableAsync(showOnLockScreen: boolean): Promise<GlucoseDisplayStatus>;
  disableAsync(): Promise<GlucoseDisplayStatus>;
  setLockScreenVisibleAsync(
    visible: boolean,
  ): Promise<GlucoseDisplayStatus>;
  setAodDesiredAsync(desired: boolean): Promise<GlucoseDisplayStatus>;
  setAodPositionAsync(position: AodPosition): Promise<GlucoseDisplayStatus>;
  setAodSizeAsync(size: AodSize): Promise<GlucoseDisplayStatus>;
  setAndroidAutoEnabledAsync(enabled: boolean): Promise<GlucoseDisplayStatus>;
  getAppearanceSettingsAsync(): Promise<GlucoseAppearanceSettings>;
  setAppearanceSettingsAsync(
    settings: GlucoseAppearanceSettings,
  ): Promise<GlucoseAppearanceSettings>;
  updateReadingAsync(
    mmolL: number,
    trend: string,
    timestampMs: number,
    sourceLabel: string,
    sourceHasError: boolean,
    trendOrigin: GlucoseDisplayTrendOrigin,
  ): Promise<GlucoseDisplayStatus>;
  updateMissingAsync(sourceLabel: string): Promise<GlucoseDisplayStatus>;
  updateHistoryAsync(
    readings: GlucoseDisplayHistoryPoint[],
  ): Promise<boolean>;
  showGlucoseAlertAsync(
    kind: GlucoseAlertKind,
    mmolL: number,
    trend: string,
    timestampMs: number,
  ): Promise<boolean>;
  cancelGlucoseAlertsAsync(): Promise<boolean>;
  glucoseAlertsAllowedAsync(): Promise<boolean>;
  openGlucoseAlertSettingsAsync(): Promise<boolean>;
  showReviewReadyNotificationAsync(): Promise<boolean>;
  cancelReviewReadyNotificationAsync(): Promise<boolean>;
  showGlookoSignInRequiredAsync(): Promise<boolean>;
  cancelGlookoSignInRequiredAsync(): Promise<boolean>;
  reviewNotificationsAllowedAsync(): Promise<boolean>;
  openReviewNotificationSettingsAsync(): Promise<boolean>;
  openNotificationSettingsAsync(): Promise<boolean>;
  openAppDetailsSettingsAsync(): Promise<boolean>;
  openAccessibilitySettingsAsync(): Promise<boolean>;
}

export default requireNativeModule<DaymarkGlucoseDisplayModule>(
  'DaymarkGlucoseDisplay',
);
