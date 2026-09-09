import { NativeModule, requireNativeModule } from 'expo';

import {
  BackupCryptoResult,
  BackupSaveResult,
  FileDigestResult,
} from './T1ArcBackupCrypto.types';

declare class T1ArcBackupCryptoModule extends NativeModule<
  Record<string, never>
> {
  createWorkingFileAsync(extension: '.container' | '.html'): Promise<string>;
  encryptJsonFileAsync(
    plaintextUri: string,
    passphrase: string,
  ): Promise<BackupCryptoResult>;
  decryptJsonFileAsync(
    encryptedUri: string,
    passphrase: string,
  ): Promise<BackupCryptoResult>;
  encryptMigrationFileAsync(
    plaintextUri: string,
    passphrase: string,
  ): Promise<BackupCryptoResult>;
  decryptMigrationFileAsync(
    encryptedUri: string,
    passphrase: string,
  ): Promise<BackupCryptoResult>;
  sha256FileAsync(sourceUri: string): Promise<FileDigestResult>;
  saveTemporaryFileAsync(
    sourceUri: string,
    fileName: string,
    mimeType: string,
  ): Promise<BackupSaveResult>;
  removeTemporaryFileAsync(uri: string): Promise<boolean>;
}

export default requireNativeModule<T1ArcBackupCryptoModule>(
  'T1ArcBackupCrypto',
);
