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
  /** AAPS and Nightscout v3 mark withdrawn or edited records as false. */
  isValid?: boolean;
  /** AAPS uploads exact durations alongside whole minutes. */
  durationInMilliseconds?: number | string;
  /** Combo/extended bolus total; `insulin` is the immediate part. */
  enteredinsulin?: number | string;
  splitNow?: number | string;
  splitExt?: number | string;
  relative?: number | string;
  isEmulatingTempBasal?: boolean;
  /** AAPS bolus type, for example NORMAL, SMB or PRIMING. */
  type?: string;
  isSMB?: boolean;
  targetTop?: number | string;
  targetBottom?: number | string;
  units?: string;
  percentage?: number | string;
  /** AAPS profile switch: hours the profile is shifted. */
  timeshift?: number | string;
  /** AAPS profile switch: profile name without percentage or shift. */
  originalProfileName?: string;
  /** AAPS profile switch and running mode: exact milliseconds; 0 means until changed. */
  originalDuration?: number | string;
  /** AAPS 3.3+ running mode on "OpenAPS Offline", for example SUSPENDED_BY_USER. */
  mode?: string;
  autoForced?: boolean;
  device?: string;
  app?: string;
  pumpId?: number | string;
  pumpType?: string;
  pumpSerial?: string;
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
