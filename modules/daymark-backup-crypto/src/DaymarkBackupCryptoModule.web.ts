import { NativeModule, registerWebModule } from 'expo';

import { BackupCryptoResult } from './DaymarkBackupCrypto.types';

class DaymarkBackupCryptoModule extends NativeModule<Record<string, never>> {
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

  async removeTemporaryFileAsync(_uri: string) {
    return false;
  }
}

export default registerWebModule(
  DaymarkBackupCryptoModule,
  'DaymarkBackupCrypto',
);
