import {
  MedtrumConnection,
  MedtrumError,
  MedtrumGlucoseUnit,
  MedtrumPatient,
  MedtrumRegion,
} from './types';

const REGION_LABELS: Record<MedtrumRegion, string> = {
  eu: 'Europe / default',
  fr: 'France',
};

export function normalizeMedtrumConnection(
  username: string,
  password: string,
  region: MedtrumRegion,
  patientId?: string,
  patientName?: string,
  glucoseUnit: MedtrumGlucoseUnit = 'mmolL',
): MedtrumConnection {
  const normalizedUsername = username.trim();
  if (!normalizedUsername) {
    throw new MedtrumError(
      'invalid-connection',
      'Enter the username for the Medtrum EasyFollow follower account.',
    );
  }
  if (!password) {
    throw new MedtrumError(
      'invalid-connection',
      'Enter the password for the Medtrum EasyFollow follower account.',
    );
  }
  if (!Object.hasOwn(REGION_LABELS, region)) {
    throw new MedtrumError(
      'invalid-connection',
      'Choose the Medtrum server used by the follower account.',
    );
  }
  if (glucoseUnit !== 'mmolL' && glucoseUnit !== 'mgDl') {
    throw new MedtrumError(
      'invalid-connection',
      'Choose the glucose unit used by the Medtrum account.',
    );
  }
  return {
    username: normalizedUsername,
    password,
    region,
    glucoseUnit,
    patientId: patientId?.trim() || undefined,
    patientName: patientName?.trim() || undefined,
  };
}

export function isSameMedtrumIdentity(
  saved: MedtrumConnection | undefined,
  username: string,
  region: MedtrumRegion,
  glucoseUnit?: MedtrumGlucoseUnit,
) {
  return (
    saved !== undefined &&
    saved.username.trim() === username.trim() &&
    saved.region === region &&
    (glucoseUnit === undefined || (saved.glucoseUnit ?? 'mmolL') === glucoseUnit)
  );
}

export function resolveMedtrumDraftConnection(input: {
  saved?: MedtrumConnection;
  username: string;
  password: string;
  region: MedtrumRegion;
  glucoseUnit?: MedtrumGlucoseUnit;
  patient?: { id: string; name: string };
}) {
  const glucoseUnit =
    input.glucoseUnit ?? input.saved?.glucoseUnit ?? 'mmolL';
  const sameIdentity = isSameMedtrumIdentity(
    input.saved,
    input.username,
    input.region,
    glucoseUnit,
  );
  return normalizeMedtrumConnection(
    input.username,
    input.password || (sameIdentity ? input.saved?.password : '') || '',
    input.region,
    input.patient?.id ?? (sameIdentity ? input.saved?.patientId : undefined),
    input.patient?.name ??
      (sameIdentity ? input.saved?.patientName : undefined),
    glucoseUnit,
  );
}

export function medtrumDraftFromSaved(saved: MedtrumConnection) {
  return {
    username: saved.username,
    region: saved.region,
    glucoseUnit: saved.glucoseUnit ?? 'mmolL',
    password: '',
    patients: [] as MedtrumPatient[],
  } as const;
}

export function medtrumRegionLabel(region: MedtrumRegion) {
  return REGION_LABELS[region];
}
