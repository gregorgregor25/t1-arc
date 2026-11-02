import { NativeModule, requireNativeModule } from 'expo';

import {
  AodPosition,
  AodSize,
  GlucoseAppearanceSettings,
  GlucoseAlertKind,
  GlucoseAlertChannelStatus,
  GlucoseAlarmConfiguration,
  GlucoseAlarmCustomSound,
  GlucoseAlarmStatus,
  GlucoseDisplayHistoryPoint,
  GlucoseDisplayPublicationSnapshot,
  AapsLocalReading,
  AapsLocalStatus,
  GlucoseDisplayStatus,
  GlucoseDisplayTrendOrigin,
  HomeWidgetStatus,
  WearCompanionStatus,
  WatchFaceDeviceStatus,
  WatchFaceId,
  WatchFaceResult,
} from './T1ArcGlucoseDisplay.types';

declare class T1ArcGlucoseDisplayModule extends NativeModule<{
  onAapsReading: (event: { changed: boolean }) => void;
}> {
  getStatusAsync(): Promise<GlucoseDisplayStatus>;
  getPrivateGlucoseWriteEpochAsync(): Promise<number>;
  getAapsLocalStatusAsync(): Promise<AapsLocalStatus>;
  setLocalGlucoseSourceAsync(sourceId: string, writeEpoch: number): Promise<AapsLocalStatus>;
  peekAapsReadingsAsync(limit: number): Promise<AapsLocalReading[]>;
  acknowledgeAapsReadingsAsync(ids: string[], selectionGeneration: number, writeEpoch: number): Promise<boolean>;
  updateSelectedGlucoseForWriteEpochAsync(
    writeEpoch: number,
    selectionGeneration: number,
    snapshot: GlucoseDisplayPublicationSnapshot | null,
    readings: GlucoseDisplayHistoryPoint[],
    missingSourceLabel: string,
  ): Promise<boolean>;
  getWearStatusAsync(): Promise<WearCompanionStatus>;
  getWatchFaceStatusAsync(): Promise<WatchFaceDeviceStatus[]>;
  installBundledWatchFaceAsync(nodeId: string, faceId: WatchFaceId): Promise<WatchFaceResult>;
  openWatchFaceActivationAsync(nodeId: string): Promise<boolean>;
  setWidgetThemeAsync?(mode: string, palette: string): Promise<boolean>;
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
  getGlucoseAlarmConfigurationAsync?(): Promise<GlucoseAlarmConfiguration | null>;
  saveGlucoseAlarmConfigurationAsync?(configuration: GlucoseAlarmConfiguration): Promise<GlucoseAlarmStatus>;
  getGlucoseAlarmStatusAsync?(): Promise<GlucoseAlarmStatus>;
  reconcileGlucoseAlarmAsync?(): Promise<boolean>;
  snoozeGlucoseAlarmAsync?(episodeId: string, untilMs: number): Promise<GlucoseAlarmStatus>;
  cancelGlucoseAlarmSnoozeAsync?(episodeId: string): Promise<GlucoseAlarmStatus>;
  acknowledgeGlucoseAlarmAsync?(episodeId: string): Promise<GlucoseAlarmStatus>;
  importGlucoseAlarmSoundAsync?(uri: string, displayName: string): Promise<GlucoseAlarmCustomSound>;
  previewGlucoseAlarmSoundAsync?(soundId: string, volume: number): Promise<boolean>;
  stopGlucoseAlarmPreviewAsync?(): Promise<boolean>;
  openGlucoseAlarmExactAlarmSettingsAsync?(): Promise<boolean>;
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
