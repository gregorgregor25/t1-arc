import { NativeModule, requireNativeModule } from 'expo';

import {
  GlucoseAppearanceSettings,
  GlucoseDisplayStatus,
} from './DaymarkGlucoseDisplay.types';

declare class DaymarkGlucoseDisplayModule extends NativeModule<Record<string, never>> {
  getStatusAsync(): Promise<GlucoseDisplayStatus>;
  enableAsync(showOnLockScreen: boolean): Promise<GlucoseDisplayStatus>;
  disableAsync(): Promise<GlucoseDisplayStatus>;
  setLockScreenVisibleAsync(
    visible: boolean,
  ): Promise<GlucoseDisplayStatus>;
  setAodDesiredAsync(desired: boolean): Promise<GlucoseDisplayStatus>;
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
  ): Promise<GlucoseDisplayStatus>;
  updateMissingAsync(sourceLabel: string): Promise<GlucoseDisplayStatus>;
  openNotificationSettingsAsync(): Promise<boolean>;
  openAppDetailsSettingsAsync(): Promise<boolean>;
  openAccessibilitySettingsAsync(): Promise<boolean>;
}

export default requireNativeModule<DaymarkGlucoseDisplayModule>(
  'DaymarkGlucoseDisplay',
);
