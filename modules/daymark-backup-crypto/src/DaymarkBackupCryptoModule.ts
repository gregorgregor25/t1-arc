import { NativeModule, requireNativeModule } from 'expo';

import { BackupCryptoResult } from './DaymarkBackupCrypto.types';

declare class DaymarkBackupCryptoModule extends NativeModule<
  Record<string, never>
> {
  encryptJsonFileAsync(
    plaintextUri: string,
    passphrase: string,
  ): Promise<BackupCryptoResult>;
  decryptJsonFileAsync(
    encryptedUri: string,
    passphrase: string,
  ): Promise<BackupCryptoResult>;
  removeTemporaryFileAsync(uri: string): Promise<boolean>;
}

export default requireNativeModule<DaymarkBackupCryptoModule>(
  'DaymarkBackupCrypto',
);
