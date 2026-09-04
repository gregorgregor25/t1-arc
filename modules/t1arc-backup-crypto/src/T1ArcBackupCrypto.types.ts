export interface BackupCryptoResult {
  uri: string;
  byteLength: number;
  plaintextSha256: string;
}

export interface FileDigestResult {
  byteLength: number;
  sha256: string;
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
