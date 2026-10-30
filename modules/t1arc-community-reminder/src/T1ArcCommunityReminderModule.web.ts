import { NativeModule, registerWebModule } from 'expo';
import type { CommunityReminderStatus } from './T1ArcCommunityReminderModule';

class CommunityReminderWeb extends NativeModule<Record<string, never>> {
  async getStatusAsync(): Promise<CommunityReminderStatus> { return { enabled: false, notificationsAllowed: false }; }
  async setEnabledAsync(_enabled: boolean): Promise<CommunityReminderStatus> { return this.getStatusAsync(); }
  async reconcileAsync(): Promise<CommunityReminderStatus> { return this.getStatusAsync(); }
  async eraseAsync(): Promise<void> {}
  async copySupportEmailAsync(): Promise<void> { await navigator.clipboard.writeText('support@t1arc.com'); }
  async shouldRequestPermissionAsync(): Promise<boolean> { return false; }
  async markPermissionRequestedAsync(): Promise<void> {}
}
export default registerWebModule(CommunityReminderWeb, 'T1ArcCommunityReminder');
