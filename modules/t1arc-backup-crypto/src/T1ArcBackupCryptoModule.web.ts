import { NativeModule, registerWebModule } from 'expo';

import {
  BackupCryptoResult,
  BackupSaveResult,
  FileDigestResult,
} from './T1ArcBackupCrypto.types';

class T1ArcBackupCryptoModule extends NativeModule<Record<string, never>> {
  async encryptJsonFileAsync(
    _plaintextUri: string,
    _passphrase: string,
  ): Promise<BackupCryptoResult> {
    throw new Error('Encrypted health backups require Android.');
  }

  async decryptJsonFileAsync(
    _encryptedUri: string,
    _passphrase: string,
  ): Promise<BackupCryptoResult> {
    throw new Error('Encrypted health backups require Android.');
  }

  async encryptMigrationFileAsync(
    _plaintextUri: string,
    _passphrase: string,
  ): Promise<BackupCryptoResult> {
    throw new Error('Encrypted migration bundles require Android.');
  }

  async decryptMigrationFileAsync(
    _encryptedUri: string,
    _passphrase: string,
  ): Promise<BackupCryptoResult> {
    throw new Error('Encrypted migration bundles require Android.');
  }

  async sha256FileAsync(_sourceUri: string): Promise<FileDigestResult> {
    throw new Error('Migration and backup file hashing requires Android.');
  }

  async saveTemporaryFileAsync(
    _sourceUri: string,
    _fileName: string,
    _mimeType: string,
  ): Promise<BackupSaveResult> {
    throw new Error('Encrypted health backups require Android.');
  }

  async removeTemporaryFileAsync(_uri: string) {
    return false;
  }
}

export default registerWebModule(
  T1ArcBackupCryptoModule,
  'T1ArcBackupCrypto',
);
