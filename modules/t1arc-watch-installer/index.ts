import { NativeModule, requireOptionalNativeModule } from 'expo';

export interface WatchEndpoint {
  id: string;
  name: string;
  host: string;
  pairingPort?: number;
  connectionPort?: number;
  legacy: boolean;
}
export interface InstallerProgress { phase: 'checking' | 'transferring' | 'installing' | 'verifying'; percent: number }
export interface CompanionInstallation { version: string; alreadyInstalled: boolean; model: string }

declare class WatchInstaller extends NativeModule<{ progress: (event: InstallerProgress) => void }> {
  readonly available: boolean;
  discoverAsync(): Promise<WatchEndpoint[]>;
  pairAsync(host: string, port: number, code: string): Promise<void>;
  connectAsync(host: string, port: number): Promise<{ model: string }>;
  installAsync(): Promise<CompanionInstallation>;
  cancelAsync(): Promise<void>;
  disconnectAsync(): Promise<void>;
}

export default requireOptionalNativeModule<WatchInstaller>('T1ArcWatchInstaller');
