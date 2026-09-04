import { NativeModule, requireNativeModule } from 'expo';

import {
  AodPosition,
  AodSize,
  GlucoseAppearanceSettings,
  GlucoseAlertKind,
  GlucoseAlertChannelStatus,
  GlucoseDisplayHistoryPoint,
  GlucoseDisplayPublicationSnapshot,
  GlucoseDisplayStatus,
  GlucoseDisplayTrendOrigin,
  HomeWidgetStatus,
  WearCompanionStatus,
} from './T1ArcGlucoseDisplay.types';

declare class T1ArcGlucoseDisplayModule extends NativeModule<
  Record<string, never>
> {
  getStatusAsync(): Promise<GlucoseDisplayStatus>;
  getPrivateGlucoseWriteEpochAsync(): Promise<number>;
  getWearStatusAsync(): Promise<WearCompanionStatus>;
  getHomeWidgetStatusAsync(): Promise<HomeWidgetStatus>;
  requestPinHomeWidgetAsync(): Promise<boolean>;
  enableAsync(): Promise<GlucoseDisplayStatus>;
  disableAsync(): Promise<GlucoseDisplayStatus>;
  setLockScreenVisibleAsync(visible: boolean): Promise<GlucoseDisplayStatus>;
  setAodDesiredAsync(desired: boolean): Promise<GlucoseDisplayStatus>;
  setAodPositionAsync(position: AodPosition): Promise<GlucoseDisplayStatus>;
  setAodSizeAsync(size: AodSize): Promise<GlucoseDisplayStatus>;
  setAndroidAutoEnabledAsync(enabled: boolean): Promise<GlucoseDisplayStatus>;
  setRegionalDisplayPreferencesAsync(
    glucoseUnit: 'mmolL' | 'mgDl',
    localeTag: string,
    timeZone: string,
  ): Promise<boolean>;
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
  updateHistoryAsync(readings: GlucoseDisplayHistoryPoint[]): Promise<boolean>;
  updatePrivateGlucoseForWriteEpochAsync(
    writeEpoch: number,
    snapshot: GlucoseDisplayPublicationSnapshot | null,
    readings: GlucoseDisplayHistoryPoint[],
    missingSourceLabel: string,
  ): Promise<boolean>;
  clearPrivateGlucoseForWriteEpochAsync(
    writeEpoch: number,
    missingSourceLabel: string,
  ): Promise<GlucoseDisplayStatus>;
  showGlucoseAlertAsync(
    kind: GlucoseAlertKind,
    mmolL: number,
    trend: string,
    timestampMs: number,
  ): Promise<boolean>;
  setGlucoseAlertMonitoringEnabledAsync?(enabled: boolean): Promise<boolean>;
  cancelGlucoseAlertsAsync(): Promise<boolean>;
  glucoseAlertsAllowedAsync(): Promise<boolean>;
  openGlucoseAlertSettingsAsync(): Promise<boolean>;
  getGlucoseAlertChannelStatusesAsync(): Promise<GlucoseAlertChannelStatus[]>;
  showGlucoseTestAlertAsync(kind: GlucoseAlertKind): Promise<boolean>;
  openGlucoseAlertChannelSettingsAsync(
    kind: GlucoseAlertKind,
  ): Promise<boolean>;
  openGlucoseAlertAppSettingsAsync(): Promise<boolean>;
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

export default requireNativeModule<T1ArcGlucoseDisplayModule>(
  'T1ArcGlucoseDisplay',
);
