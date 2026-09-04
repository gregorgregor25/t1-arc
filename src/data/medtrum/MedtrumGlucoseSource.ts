import { GlucoseSource } from '@/data/contracts';
import {
  GlucoseHistoryStore,
  SourceSyncState,
} from '@/data/persistence/GlucoseHistoryStore';
import { glucoseFreshness } from '@/domain/freshness';
import {
  DataSourceStatus,
  GlucoseReading,
  MG_DL_PER_MMOL_L,
  TimeRange,
  TrendDirection,
} from '@/domain/models';

import { medtrumRegionLabel } from './connection';
import {
  MEDTRUM_SOURCE_ID,
  MedtrumConnectResult,
  MedtrumConnection,
  MedtrumError,
  MedtrumErrorCode,
  MedtrumPatient,
} from './types';

const REQUEST_TIMEOUT_MS = 15_000;
const APP_TAG = 'v=1.2.70(112);n=eyfo;p=android';
const SERVERS = {
  eu: 'https://easyview.medtrum.eu',
  fr: 'https://easyview.medtrum.fr',
} as const;

type FetchLike = typeof fetch;

interface MedtrumSensorStatus {
  glucose?: number;
  glucoseRate?: number;
  updateTime?: number;
  sequence?: number;
  nextSequenceNeedCalibrate?: number;
  serial?: number;
  sensorId?: number;
}

interface MedtrumMonitor {
  username?: string;
  real_name?: string;
  sensor_status?: MedtrumSensorStatus;
}

function errorCode(error: unknown): MedtrumErrorCode {
  return error instanceof MedtrumError ? error.code : 'network';
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Medtrum could not be reached.';
}

export function medtrumGlucoseMmolL(
  value: number,
  unit: MedtrumConnection['glucoseUnit'],
) {
  return unit === 'mgDl' ? value / MG_DL_PER_MMOL_L : value;
}

function trendFromRate(rate?: number): TrendDirection {
  return (
    {
      0: 'flat',
      1: 'slightUp',
      2: 'up',
      3: 'doubleUp',
      4: 'slightDown',
      5: 'down',
      6: 'doubleDown',
      8: 'flat',
    } as Record<number, TrendDirection>
  )[Number(rate)] ?? 'unknown';
}

function responseObject(payload: unknown) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new MedtrumError(
      'invalid-response',
      'Medtrum returned an unexpected response.',
    );
  }
  const object = payload as Record<string, unknown>;
  if (typeof object.res === 'string' && object.res !== 'OK') {
    throw new MedtrumError(
      'authentication',
      typeof object.msg === 'string' && object.msg
        ? object.msg
        : 'Medtrum rejected the follower account details.',
    );
  }
  return object;
}

function monitorsFrom(payload: unknown) {
  const object = responseObject(payload);
  return Array.isArray(object.monitorlist)
    ? (object.monitorlist as MedtrumMonitor[])
    : [];
}

export class MedtrumGlucoseSource implements GlucoseSource {
  readonly sourceId = MEDTRUM_SOURCE_ID;
  private refreshInFlight?: Promise<void>;
  private cookie?: string;

  constructor(
    private readonly connection: MedtrumConnection,
    private readonly store: GlucoseHistoryStore,
    private readonly fetcher: FetchLike = fetch,
    private readonly clock: () => number = Date.now,
  ) {}

  async verifyConnection(): Promise<MedtrumConnectResult> {
    await this.authenticate();
    const patients = await this.getPatients();
    const selected =
      (this.connection.patientId
        ? patients.find((patient) => patient.id === this.connection.patientId)
        : undefined) ?? (patients.length === 1 ? patients[0] : undefined);
    if (!selected) return { patients };
    const connection = {
      ...this.connection,
      patientId: selected.id,
      patientName: selected.name,
    };
    const source = new MedtrumGlucoseSource(
      connection,
      this.store,
      this.fetcher,
      this.clock,
    );
    source.cookie = this.cookie;
    await source.importPatientReadings(true);
    const latest = await source.getLatestReading();
    if (!latest) {
      throw new MedtrumError(
        'sensor-state',
        'The Medtrum connection worked, but the selected person has no usable glucose reading yet.',
      );
    }
    return { patients, connection, latest };
  }

  async refresh() {
    if (this.refreshInFlight) return this.refreshInFlight;
    this.refreshInFlight = (async () => {
      await this.authenticate();
      await this.importPatientReadings(false);
    })().finally(() => {
      this.refreshInFlight = undefined;
    });
    return this.refreshInFlight;
  }

  async getReadings(range: TimeRange) {
    return this.store.getReadings(range, this.sourceId);
  }

  async getLatestReading() {
    return this.store.getLatestReading(this.sourceId);
  }

  async getStatus(now = this.clock()): Promise<DataSourceStatus> {
    await this.store.initialize();
    const [latest, state, bounds] = await Promise.all([
      this.store.getLatestReading(this.sourceId),
      this.store.getSyncState(this.sourceId),
      this.store.getBounds(this.sourceId),
    ]);
    return {
      id: this.sourceId,
      label: 'Medtrum',
      detail: `${this.connection.patientName ?? 'EasyFollow patient'} · ${medtrumRegionLabel(this.connection.region)}`,
      freshness: glucoseFreshness(latest?.timestamp, now),
      origin: 'live',
      lastAttemptAt: state?.lastAttemptAt,
      lastUpdatedAt: state?.lastSuccessAt,
      dataThrough: latest?.timestamp,
      recordCount: bounds.count,
      errorCode: state?.lastErrorCode,
      capabilities: [{ kind: 'glucose', fidelity: 'source-event' }],
      isLive: true,
    };
  }

  private headers(contentType?: string) {
    return {
      Accept: 'application/json',
      AppTag: APP_TAG,
      DevInfo: 'Android;T1 Arc;Android',
      'User-Agent': 'okhttp/3.5.0',
      ...(contentType ? { 'Content-Type': contentType } : {}),
      ...(this.cookie ? { Cookie: this.cookie } : {}),
    };
  }

  private async request(path: string, init: RequestInit = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      let response: Response;
      try {
        response = await this.fetcher(`${SERVERS[this.connection.region]}${path}`, {
          ...init,
          headers: { ...this.headers(), ...(init.headers ?? {}) },
          signal: controller.signal,
        });
      } catch {
        throw new MedtrumError(
          'network',
          'Medtrum EasyView could not be reached. Check the connection and server.',
        );
      }
      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        throw new MedtrumError(
          'invalid-response',
          'Medtrum returned an unreadable response.',
        );
      }
      if (!response.ok) {
        throw new MedtrumError(
          response.status === 401 || response.status === 403
            ? 'authentication'
            : 'network',
          response.status === 401 || response.status === 403
            ? 'Medtrum rejected the follower account details.'
            : `Medtrum returned HTTP ${response.status}.`,
        );
      }
      return { payload, response };
    } finally {
      clearTimeout(timeout);
    }
  }

  private async authenticate() {
    if (this.cookie) return;
    const body = ([
      ['apptype', 'Follow'],
      ['user_type', 'M'],
      ['platform', 'google'],
      ['user_name', this.connection.username],
      ['password', this.connection.password],
    ] satisfies [string, string][])
      .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
      .join('&');
    const { payload, response } = await this.request('/mobile/ajax/login', {
      method: 'POST',
      headers: this.headers('application/x-www-form-urlencoded'),
      body,
    });
    responseObject(payload);
    const cookie = response.headers.get('set-cookie')?.split(';')[0]?.trim();
    if (!cookie) {
      throw new MedtrumError(
        'authentication',
        'Medtrum accepted the login but did not return a follower session.',
      );
    }
    this.cookie = cookie;
  }

  private async getPatients(): Promise<MedtrumPatient[]> {
    const { payload } = await this.request('/mobile/ajax/logindata');
    const patients = monitorsFrom(payload).flatMap((monitor): MedtrumPatient[] => {
      const id = monitor.username?.trim();
      if (!id) return [];
      return [{ id, name: monitor.real_name?.trim() || id }];
    });
    if (!patients.length) {
      throw new MedtrumError(
        'no-patient',
        'This EasyFollow account is not following anyone yet.',
      );
    }
    return patients;
  }

  private readingFromMonitor(monitor: MedtrumMonitor, receivedAt: number) {
    const sensor = monitor.sensor_status;
    const value = Number(sensor?.glucose);
    const timestamp = Number(sensor?.updateTime) * 1000;
    if (!Number.isFinite(value) || value <= 0) {
      const sequence = Number(sensor?.sequence);
      const nextCalibration = Number(sensor?.nextSequenceNeedCalibrate);
      if (Number.isFinite(sequence) && sequence <= 15) {
        throw new MedtrumError('sensor-state', 'The Medtrum sensor is still starting.');
      }
      if (
        Number.isFinite(sequence) &&
        Number.isFinite(nextCalibration) &&
        sequence >= nextCalibration
      ) {
        throw new MedtrumError('sensor-state', 'The Medtrum sensor needs calibration.');
      }
      throw new MedtrumError('sensor-state', 'Medtrum has no current glucose value.');
    }
    if (!Number.isFinite(timestamp) || timestamp <= 0) {
      throw new MedtrumError('invalid-response', 'Medtrum did not supply a glucose timestamp.');
    }
    const serial = Number(sensor?.serial);
    const sensorId = Number(sensor?.sensorId);
    return {
      id: `${this.sourceId}:${timestamp}:${value}`,
      timestamp,
      receivedAt,
      mmolL:
        Math.round(
          medtrumGlucoseMmolL(value, this.connection.glucoseUnit ?? 'mmolL') * 10,
        ) / 10,
      trend: trendFromRate(sensor?.glucoseRate),
      quality: 'measured' as const,
      sourceId: this.sourceId,
      sourceDeviceId:
        Number.isFinite(serial) && Number.isFinite(sensorId)
          ? `${serial.toString(16).padStart(8, '0').toUpperCase()}-${sensorId}`
          : undefined,
    } satisfies GlucoseReading;
  }

  private async importPatientReadings(includeHistory: boolean) {
    const attemptedAt = this.clock();
    await this.store.initialize();
    try {
      const patientId = this.connection.patientId;
      if (!patientId) {
        throw new MedtrumError(
          'no-patient',
          'Choose the person whose Medtrum glucose should be shown.',
        );
      }
      const { payload } = await this.request(
        '/mobile/ajax/monitor?flag=monitor_list',
      );
      const monitor = monitorsFrom(payload).find(
        (candidate) => candidate.username === patientId,
      );
      if (!monitor) {
        throw new MedtrumError(
          'no-patient',
          'The selected person is no longer available in this EasyFollow account.',
        );
      }
      const receivedAt = this.clock();
      const readings: GlucoseReading[] = [
        this.readingFromMonitor(monitor, receivedAt),
      ];
      if (includeHistory) {
        const end = new Date(receivedAt).toISOString().slice(0, 19).replace('T', ' ');
        const start = new Date(receivedAt - 24 * 60 * 60_000)
          .toISOString()
          .slice(0, 19)
          .replace('T', ' ');
        const graphPath =
          `/mobile/ajax/download?flag=sg&st=${encodeURIComponent(start)}` +
          `&et=${encodeURIComponent(end)}&user_name=${encodeURIComponent(patientId)}`;
        const graph = responseObject((await this.request(graphPath)).payload);
        if (Array.isArray(graph.data)) {
          for (const row of graph.data) {
            if (!Array.isArray(row)) continue;
            const timestamp = Number(row[1]) * 1000;
            const value = Number(row[3]);
            if (!Number.isFinite(timestamp) || !Number.isFinite(value) || value <= 0) continue;
            readings.push({
              id: `${this.sourceId}:${timestamp}:${value}`,
              timestamp,
              receivedAt,
              mmolL:
                Math.round(
                  medtrumGlucoseMmolL(
                    value,
                    this.connection.glucoseUnit ?? 'mmolL',
                  ) * 10,
                ) / 10,
              trend: 'unknown',
              quality: 'measured',
              sourceId: this.sourceId,
            });
          }
        }
      }
      await this.store.upsertReadings(readings);
      const bounds = await this.store.getBounds(this.sourceId);
      await this.store.saveSyncState({
        sourceId: this.sourceId,
        lastAttemptAt: attemptedAt,
        lastSuccessAt: receivedAt,
        recordCount: bounds.count,
      });
    } catch (error) {
      if (error instanceof MedtrumError && error.code === 'authentication') {
        this.cookie = undefined;
      }
      const current =
        (await this.store.getSyncState(this.sourceId)) ??
        ({ sourceId: this.sourceId, recordCount: 0 } satisfies SourceSyncState);
      await this.store.saveSyncState({
        ...current,
        lastAttemptAt: attemptedAt,
        lastErrorCode: errorCode(error),
        lastErrorMessage: errorMessage(error),
      });
      throw error;
    }
  }
}
