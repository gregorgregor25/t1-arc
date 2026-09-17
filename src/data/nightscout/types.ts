export const NIGHTSCOUT_SOURCE_ID = 'nightscout';

export interface NightscoutConnection {
  baseUrl: string;
  accessToken?: string;
  apiSecret?: string;
  includeIobCob?: boolean;
}

export interface NightscoutIobCobSnapshot {
  iobUnits?: number;
  cobGrams?: number;
  timestamp: number;
}

export interface NightscoutEntry {
  _id?: string;
  identifier?: string;
  sgv?: number;
  direction?: string;
  date?: number;
  dateString?: string;
  device?: string;
  type?: string;
}

export interface NightscoutTreatment {
  _id?: string;
  identifier?: string;
  eventType?: string;
  created_at?: string;
  date?: number | string;
  mills?: number | string;
  insulin?: number | string;
  carbs?: number | string;
  duration?: number | string;
  rate?: number | string;
  absolute?: number | string;
  percent?: number | string;
  enteredBy?: string;
  notes?: string;
  profile?: string;
  reason?: string;
  [key: string]: unknown;
}

export type NightscoutErrorCode =
  | 'invalid-connection'
  | 'authentication'
  | 'network'
  | 'invalid-response';

export class NightscoutError extends Error {
  constructor(
    readonly code: NightscoutErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'NightscoutError';
  }
}
