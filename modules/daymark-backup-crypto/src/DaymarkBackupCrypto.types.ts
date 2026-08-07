export interface BackupCryptoResult {
  uri: string;
  byteLength: number;
}

export type BackupSaveResult =
  | {
      status: 'saved';
      uri: string;
      byteLength: number;
    }
  | {
      status: 'cancelled';
    };
