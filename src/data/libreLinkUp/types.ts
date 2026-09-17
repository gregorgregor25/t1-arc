import { GlucoseReading } from '@/domain/models';

export interface LibreLinkUpCredentials {
  email: string;
  password: string;
  topLevelDomain: 'io' | 'us';
}

export interface LibreLinkUpSession {
  token: string;
  expiresAt: number;
  userId: string;
  region: string;
  version: string;
  accountEmail: string;
  patientId?: string;
}

export interface LibreLinkUpPatient {
  id: string;
  name: string;
}

export interface LibreLinkUpSnapshot {
  readings: GlucoseReading[];
  patients: LibreLinkUpPatient[];
  selectedPatientId: string;
  session: LibreLinkUpSession;
}

export type LibreLinkUpErrorCode =
  | 'invalid-credentials'
  | 'action-required'
  | 'rate-limited'
  | 'patient-selection-required'
  | 'unsupported-api'
  | 'network'
  | 'invalid-response';

export class LibreLinkUpError extends Error {
  constructor(
    public readonly code: LibreLinkUpErrorCode,
    message: string,
    public readonly apiStatus?: number,
  ) {
    super(message);
    this.name = 'LibreLinkUpError';
  }
}
