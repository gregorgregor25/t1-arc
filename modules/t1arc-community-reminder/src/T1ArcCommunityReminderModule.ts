import { NativeModule, requireNativeModule } from 'expo';

export interface CommunityReminderStatus {
  enabled: boolean;
  notificationsAllowed: boolean;
}

declare class NativeCommunityReminder extends NativeModule<Record<string, never>> {
  getStatusAsync(): Promise<CommunityReminderStatus>;
  setEnabledAsync(enabled: boolean): Promise<CommunityReminderStatus>;
  reconcileAsync(): Promise<CommunityReminderStatus>;
  eraseAsync(): Promise<void>;
  copySupportEmailAsync(): Promise<void>;
  shouldRequestPermissionAsync(): Promise<boolean>;
  markPermissionRequestedAsync(): Promise<void>;
}

const native = requireNativeModule<NativeCommunityReminder>('T1ArcCommunityReminder');
export default native;
