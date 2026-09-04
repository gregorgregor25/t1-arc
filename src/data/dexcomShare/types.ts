export const DEXCOM_SHARE_SOURCE_ID = 'dexcom-share';

export type DexcomShareRegion = 'international' | 'us' | 'japan';

export interface DexcomShareConnection {
  username: string;
  password: string;
  region: DexcomShareRegion;
}

export interface DexcomShareEntry {
  WT?: string;
  ST?: string;
  DT?: string;
  Value?: number;
  Trend?: string | number;
}

export type DexcomShareErrorCode =
  | 'invalid-connection'
  | 'authentication'
  | 'network'
  | 'invalid-response';

export class DexcomShareError extends Error {
  constructor(
    readonly code: DexcomShareErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'DexcomShareError';
  }
}
