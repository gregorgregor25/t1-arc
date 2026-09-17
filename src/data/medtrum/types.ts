export const MEDTRUM_SOURCE_ID = 'medtrum-easyfollow';

export type MedtrumRegion = 'eu' | 'fr';
export type MedtrumGlucoseUnit = 'mmolL' | 'mgDl';

export interface MedtrumConnection {
  username: string;
  password: string;
  region: MedtrumRegion;
  /** Explicit account payload unit; optional only while parsing a previous save. */
  glucoseUnit?: MedtrumGlucoseUnit;
  patientId?: string;
  patientName?: string;
}

export interface MedtrumPatient {
  id: string;
  name: string;
}

export interface MedtrumConnectResult {
  patients: MedtrumPatient[];
  connection?: MedtrumConnection;
  latest?: import('@/domain/models').GlucoseReading;
}

export type MedtrumErrorCode =
  | 'invalid-connection'
  | 'authentication'
  | 'no-patient'
  | 'sensor-state'
  | 'network'
  | 'invalid-response';

export class MedtrumError extends Error {
  constructor(
    readonly code: MedtrumErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'MedtrumError';
  }
}
