import {
  GlucoseReading,
  MG_DL_PER_MMOL_L,
  TrendDirection,
} from '@/domain/models';
import { DateKey, zonedDateTimeToTimestamp } from '@/domain/time';

import {
  LibreLinkUpCredentials,
  LibreLinkUpError,
  LibreLinkUpPatient,
  LibreLinkUpSession,
  LibreLinkUpSnapshot,
} from './types';

type HashFunction = (value: string) => Promise<string>;
type SessionListener = (session: LibreLinkUpSession) => Promise<void> | void;

interface ApiEnvelope {
  status?: number;
  data?: unknown;
  error?: { message?: string };
}

interface LibreMeasurement {
  FactoryTimestamp?: string;
  Timestamp?: string;
  ValueInMgPerDl?: number;
  Value?: number;
  TrendArrow?: number;
}

interface LibreConnection {
  patientId?: string;
  firstName?: string;
  lastName?: string;
  glucoseMeasurement?: LibreMeasurement;
}

const LOGIN_ENDPOINT = '/llu/auth/login';
const CONNECTIONS_ENDPOINT = '/llu/connections';
const GRAPH_ENDPOINT = (patientId: string) =>
  `/llu/connections/${encodeURIComponent(patientId)}/graph`;
const DEFAULT_VERSION = '4.17.0';
const REGION_PATTERN = /^[a-z0-9-]{1,24}$/i;
const VERSION_PATTERN = /^\d+(?:\.\d+){1,3}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function messageFromEnvelope(envelope: ApiEnvelope) {
  if (envelope.error?.message) return envelope.error.message;
  if (isRecord(envelope.data) && typeof envelope.data.message === 'string') {
    return envelope.data.message;
  }
  return 'LibreLinkUp returned an error.';
}

function trendFromArrow(value: number | undefined): TrendDirection {
  switch (value) {
    case 1:
      return 'down';
    case 2:
      return 'slightDown';
    case 3:
      return 'flat';
    case 4:
      return 'slightUp';
    case 5:
      return 'up';
    default:
      return 'unknown';
  }
}

function twelveHourTo24Hour(hour: number, suffix: string) {
  const normalised = hour % 12;
  return suffix.toUpperCase() === 'PM' ? normalised + 12 : normalised;
}

export function parseLibreTimestamp(
  value: string | undefined,
  assumeUtc: boolean,
): number | undefined {
  if (!value) return undefined;
  const match = value.trim().match(
    /^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{1,2}):(\d{1,2})\s+([AP]M)$/i,
  );
  if (!match) return undefined;
  const [, month, day, year, hour, minute, second, suffix] = match;
  const hour24 = twelveHourTo24Hour(Number(hour), suffix!);
  if (assumeUtc) {
    return Date.UTC(
      Number(year),
      Number(month) - 1,
      Number(day),
      hour24,
      Number(minute),
      Number(second),
    );
  }
  const dateKey = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}` as DateKey;
  return zonedDateTimeToTimestamp(dateKey, hour24, Number(minute), Number(second));
}

export function normaliseLibreMeasurement(
  measurement: LibreMeasurement,
  sourceId = 'daymark-librelinkup',
): GlucoseReading | undefined {
  const factoryTimestamp = parseLibreTimestamp(
    measurement.FactoryTimestamp,
    true,
  );
  const localTimestamp = parseLibreTimestamp(measurement.Timestamp, false);
  const timestamp = factoryTimestamp ?? localTimestamp;
  const timestampDiscrepancyMinutes =
    factoryTimestamp !== undefined && localTimestamp !== undefined
      ? Math.round(
          (Math.abs(factoryTimestamp - localTimestamp) / 60_000) * 10,
        ) / 10
      : undefined;
  const mgDl = measurement.ValueInMgPerDl;
  if (
    timestamp === undefined ||
    typeof mgDl !== 'number' ||
    !Number.isFinite(mgDl) ||
    mgDl <= 0
  ) {
    return undefined;
  }
  return {
    id: `${sourceId}:${timestamp}:${mgDl}`,
    timestamp,
    receivedAt: Date.now(),
    mmolL: Math.round((mgDl / MG_DL_PER_MMOL_L) * 10) / 10,
    trend: trendFromArrow(measurement.TrendArrow),
    quality: 'measured',
    sourceId,
    sourceFactoryTimestamp: measurement.FactoryTimestamp,
    sourceLocalTimestamp: measurement.Timestamp,
    timestampDiscrepancyMinutes,
  };
}

export class LibreLinkUpClient {
  private session: LibreLinkUpSession;

  constructor(
    private readonly credentials: LibreLinkUpCredentials,
    private readonly hashAccountId: HashFunction,
    private readonly fetchImplementation: typeof globalThis.fetch = globalThis.fetch,
    session?: Partial<LibreLinkUpSession>,
    private readonly onSession?: SessionListener,
    private readonly requestTimeoutMs = 20_000,
  ) {
    const accountEmail = credentials.email.trim().toLowerCase();
    const hasReusableRegion =
      !session?.region || REGION_PATTERN.test(session.region);
    const canReuseSession =
      session?.accountEmail === accountEmail && hasReusableRegion;
    this.session = {
      token: canReuseSession ? session?.token ?? '' : '',
      expiresAt: canReuseSession ? session?.expiresAt ?? 0 : 0,
      userId: canReuseSession ? session?.userId ?? '' : '',
      region:
        canReuseSession &&
        session?.region &&
        REGION_PATTERN.test(session.region)
          ? session.region
          : '',
      version:
        session?.version && VERSION_PATTERN.test(session.version)
          ? session.version
          : DEFAULT_VERSION,
      accountEmail,
      patientId: canReuseSession ? session?.patientId : undefined,
    };
  }

  getSession() {
    return { ...this.session };
  }

  private baseUrl() {
    const domain = this.credentials.topLevelDomain;
    return this.session.region
      ? `https://api-${this.session.region}.libreview.${domain}`
      : `https://api.libreview.${domain}`;
  }

  private async headers() {
    const accountId = await this.hashAccountId(this.session.userId);
    const headers: Record<string, string> = {
      product: 'llu.android',
      version: this.session.version,
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'cache-control': 'no-cache',
      'Account-Id': accountId,
    };
    if (this.session.token) headers.Authorization = `Bearer ${this.session.token}`;
    return headers;
  }

  private async persistSession() {
    await this.onSession?.({ ...this.session });
  }

  private errorForEnvelope(envelope: ApiEnvelope): LibreLinkUpError | undefined {
    const status = envelope.status;
    if (status === undefined || status === 0) return undefined;
    if (status === 2) {
      return new LibreLinkUpError(
        'invalid-credentials',
        'LibreLinkUp rejected the email or password.',
        status,
      );
    }
    if (status === 4) {
      const step =
        isRecord(envelope.data) && isRecord(envelope.data.step)
          ? envelope.data.step
          : undefined;
      const type = step && typeof step.type === 'string' ? step.type : 'account';
      return new LibreLinkUpError(
        'action-required',
        `LibreLinkUp requires a ${type} step in the official account flow. T1 Arc will not accept legal terms automatically.`,
        status,
      );
    }
    return new LibreLinkUpError(
      'invalid-response',
      messageFromEnvelope(envelope),
      status,
    );
  }

  private async request(
    endpoint: string,
    method: 'GET' | 'POST',
    body?: Record<string, unknown>,
    allowVersionRetry = true,
    allowAuthRetry = true,
  ): Promise<ApiEnvelope> {
    let response: Response;
    let responseText: string;
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      this.requestTimeoutMs,
    );
    try {
      response = await this.fetchImplementation(`${this.baseUrl()}${endpoint}`, {
        method,
        headers: await this.headers(),
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
      responseText = await response.text();
    } catch (error) {
      throw new LibreLinkUpError(
        'network',
        error instanceof Error && error.name === 'AbortError'
          ? 'LibreLinkUp request timed out.'
          : error instanceof Error
            ? error.message
            : 'Unable to reach LibreLinkUp.',
      );
    } finally {
      clearTimeout(timeout);
    }

    if (response.status === 429) {
      throw new LibreLinkUpError(
        'rate-limited',
        'LibreLinkUp has rate-limited this account. Stop other follower clients and wait before retrying.',
      );
    }
    if (
      response.status === 401 &&
      allowAuthRetry &&
      endpoint !== LOGIN_ENDPOINT &&
      this.session.token
    ) {
      this.session.token = '';
      this.session.expiresAt = 0;
      await this.persistSession();
      await this.authenticate(true);
      return this.request(endpoint, method, body, allowVersionRetry, false);
    }

    let envelope: ApiEnvelope;
    try {
      const parsed: unknown = JSON.parse(responseText);
      if (!isRecord(parsed)) throw new Error('Response is not an object.');
      envelope = parsed as ApiEnvelope;
    } catch {
      if (!response.ok) {
        throw new LibreLinkUpError(
          'network',
          `LibreLinkUp request failed with HTTP ${response.status}.`,
        );
      }
      throw new LibreLinkUpError(
        'unsupported-api',
        'LibreLinkUp returned an unreadable or encrypted response. The legacy direct interface may no longer be available.',
      );
    }

    if (
      response.status === 403 &&
      allowVersionRetry &&
      isRecord(envelope.data) &&
      typeof envelope.data.minimumVersion === 'string'
    ) {
      this.session.version = envelope.data.minimumVersion;
      await this.persistSession();
      return this.request(endpoint, method, body, false, allowAuthRetry);
    }
    const apiError = this.errorForEnvelope(envelope);
    if (apiError) throw apiError;
    if (!response.ok) {
      throw new LibreLinkUpError(
        'network',
        `LibreLinkUp request failed with HTTP ${response.status}.`,
      );
    }
    return envelope;
  }

  private async authenticate(force = false, redirectCount = 0) {
    if (
      !force &&
      this.session.token &&
      this.session.expiresAt > Date.now() + 60_000
    ) {
      return;
    }
    this.session.token = '';
    this.session.expiresAt = 0;
    const envelope = await this.request(LOGIN_ENDPOINT, 'POST', {
      email: this.credentials.email.trim(),
      password: this.credentials.password,
    });
    if (!isRecord(envelope.data)) {
      throw new LibreLinkUpError(
        'invalid-response',
        'LibreLinkUp login did not return account data.',
      );
    }
    if (envelope.data.redirect === true) {
      if (
        typeof envelope.data.region !== 'string' ||
        !REGION_PATTERN.test(envelope.data.region)
      ) {
        throw new LibreLinkUpError(
          'invalid-response',
          'LibreLinkUp returned an invalid account region.',
        );
      }
      if (redirectCount >= 2) {
        throw new LibreLinkUpError(
          'invalid-response',
          'LibreLinkUp returned too many account region redirects.',
        );
      }
      this.session.region = envelope.data.region;
      await this.persistSession();
      await this.authenticate(true, redirectCount + 1);
      return;
    }

    const user = isRecord(envelope.data.user) ? envelope.data.user : undefined;
    const ticket = isRecord(envelope.data.authTicket)
      ? envelope.data.authTicket
      : undefined;
    if (
      !user ||
      typeof user.id !== 'string' ||
      !ticket ||
      typeof ticket.token !== 'string' ||
      typeof ticket.expires !== 'number'
    ) {
      throw new LibreLinkUpError(
        'unsupported-api',
        'LibreLinkUp did not return the legacy authentication ticket. Its v5 interface may be active for this account.',
      );
    }
    this.session.userId = user.id;
    this.session.token = ticket.token;
    this.session.expiresAt = ticket.expires * 1000;
    await this.persistSession();
  }

  private async connections(): Promise<{
    patients: LibreLinkUpPatient[];
    raw: LibreConnection[];
  }> {
    await this.authenticate();
    const envelope = await this.request(CONNECTIONS_ENDPOINT, 'GET');
    if (!Array.isArray(envelope.data)) {
      throw new LibreLinkUpError(
        'invalid-response',
        'LibreLinkUp did not return a patient connection list.',
      );
    }
    const raw = envelope.data.filter(isRecord) as LibreConnection[];
    const patients = raw
      .filter((connection) => typeof connection.patientId === 'string')
      .map((connection) => ({
        id: connection.patientId!,
        name:
          [connection.firstName, connection.lastName].filter(Boolean).join(' ').trim() ||
          'LibreLinkUp connection',
      }));
    return { patients, raw };
  }

  private choosePatient(patients: LibreLinkUpPatient[]) {
    if (
      this.session.patientId &&
      patients.some((patient) => patient.id === this.session.patientId)
    ) {
      return this.session.patientId;
    }
    if (patients.length === 1) return patients[0]!.id;
    if (patients.length > 1) {
      throw new LibreLinkUpError(
        'patient-selection-required',
        'More than one LibreLinkUp connection is available; a patient must be selected.',
      );
    }
    throw new LibreLinkUpError(
      'invalid-response',
      'No accepted LibreLinkUp connection was found.',
    );
  }

  async getSnapshot(): Promise<LibreLinkUpSnapshot> {
    const { patients, raw } = await this.connections();
    const patientId = this.choosePatient(patients);
    this.session.patientId = patientId;
    await this.persistSession();

    const graphEnvelope = await this.request(GRAPH_ENDPOINT(patientId), 'GET');
    if (!isRecord(graphEnvelope.data)) {
      throw new LibreLinkUpError(
        'invalid-response',
        'LibreLinkUp graph data is missing.',
      );
    }
    const readings: GlucoseReading[] = [];
    const graphData = Array.isArray(graphEnvelope.data.graphData)
      ? graphEnvelope.data.graphData
      : [];
    graphData.filter(isRecord).forEach((measurement) => {
      const reading = normaliseLibreMeasurement(measurement);
      if (reading) readings.push(reading);
    });

    const graphConnection = isRecord(graphEnvelope.data.connection)
      ? (graphEnvelope.data.connection as LibreConnection)
      : raw.find((connection) => connection.patientId === patientId);
    if (graphConnection && isRecord(graphConnection.glucoseMeasurement)) {
      const current = normaliseLibreMeasurement(graphConnection.glucoseMeasurement);
      if (current) readings.push(current);
    }

    const deduplicated = [...new Map(readings.map((reading) => [reading.id, reading])).values()]
      .sort((a, b) => a.timestamp - b.timestamp);
    if (deduplicated.length === 0) {
      throw new LibreLinkUpError(
        'invalid-response',
        'LibreLinkUp returned no usable glucose readings.',
      );
    }
    return {
      readings: deduplicated,
      patients,
      selectedPatientId: patientId,
      session: this.getSession(),
    };
  }
}
