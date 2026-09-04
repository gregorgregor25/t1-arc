import { normalizeXdripReading } from '@/data/adapters/xdrip';
import { GlucoseSource } from '@/data/contracts';
import {
  GlucoseHistoryStore,
  SourceSyncState,
} from '@/data/persistence/GlucoseHistoryStore';
import { glucoseFreshness } from '@/domain/freshness';
import {
  DataSourceStatus,
  GlucoseReading,
  TimeRange,
} from '@/domain/models';

import { dexcomShareRegionLabel } from './connection';
import {
  DEXCOM_SHARE_SOURCE_ID,
  DexcomShareConnection,
  DexcomShareEntry,
  DexcomShareError,
  DexcomShareErrorCode,
  DexcomShareRegion,
} from './types';

const REQUEST_TIMEOUT_MS = 15_000;
const INVALID_ID = '00000000-0000-0000-0000-000000000000';
const APPLICATION_ID = 'd8665ade-9673-4e27-9ff6-92db4ce13d13';
const USER_AGENT = 'Dexcom Share/3.0.2.11 CFNetwork/711.2.23 Darwin/14.0.0';
const AUTHENTICATE_PATH =
  '/ShareWebServices/Services/General/AuthenticatePublisherAccount';
const LOGIN_PATH =
  '/ShareWebServices/Services/General/LoginPublisherAccountById';
const READ_PATH =
  '/ShareWebServices/Services/Publisher/ReadPublisherLatestGlucoseValues';

const SERVERS: Record<DexcomShareRegion, string> = {
  international: 'https://shareous1.dexcom.com',
  us: 'https://share2.dexcom.com',
  japan: 'https://share.dexcom.jp',
};

type FetchLike = typeof fetch;

function errorCode(error: unknown): DexcomShareErrorCode {
  return error instanceof DexcomShareError ? error.code : 'network';
}
function errorMessage(error: unknown) {
  return error instanceof Error
    ? error.message
    : 'Dexcom Share could not be reached.';
}

function shareId(payload: unknown) {
  const value =
    typeof payload === 'string'
      ? payload
      : payload && typeof payload === 'object' && 'SessionID' in payload
        ? (payload as { SessionID?: unknown }).SessionID
        : undefined;
  return typeof value === 'string' ? value.replaceAll('"', '').trim() : '';
}

function timestampFromEntry(entry: DexcomShareEntry) {
  for (const value of [entry.WT, entry.ST, entry.DT]) {
    const match = typeof value === 'string' ? /Date\((\d{10,})/.exec(value) : null;
    if (match) return Number(match[1]);
  }
  return Number.NaN;
}

function trendLabel(trend: DexcomShareEntry['Trend']) {
  if (typeof trend === 'string') return trend;
  return (
    {
      1: 'DoubleUp',
      2: 'SingleUp',
      3: 'FortyFiveUp',
      4: 'Flat',
      5: 'FortyFiveDown',
      6: 'SingleDown',
      7: 'DoubleDown',
    } as Record<number, string>
  )[Number(trend)];
}

export class DexcomShareGlucoseSource implements GlucoseSource {
  readonly sourceId = DEXCOM_SHARE_SOURCE_ID;
  private refreshInFlight?: Promise<void>;
  private sessionId?: string;

  constructor(
    private readonly connection: DexcomShareConnection,
    private readonly store: GlucoseHistoryStore,
    private readonly fetcher: FetchLike = fetch,
    private readonly clock: () => number = Date.now,
  ) {}

  async refresh() {
    if (this.refreshInFlight) return this.refreshInFlight;
    this.refreshInFlight = this.importReadings(1_440, 288).finally(() => {
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
      label: 'Dexcom Share',
      detail: `${dexcomShareRegionLabel(this.connection.region)} · publisher account`,
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

  private async post(path: string, payload?: object, query = '') {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      let response: Response;
      try {
        response = await this.fetcher(`${SERVERS[this.connection.region]}${path}${query}`, {
          method: 'POST',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            'User-Agent': USER_AGENT,
          },
          body: payload ? JSON.stringify(payload) : '',
          signal: controller.signal,
        });
      } catch {
        throw new DexcomShareError(
          'network',
          'Dexcom Share could not be reached. Check the connection and region.',
        );
      }
      let body: unknown;
      try {
        body = await response.json();
      } catch {
        throw new DexcomShareError(
          'invalid-response',
          'Dexcom Share returned an unreadable response.',
        );
      }
      if (!response.ok) {
        const serverMessage =
          body && typeof body === 'object' && 'Message' in body
            ? String((body as { Message?: unknown }).Message ?? '')
            : '';
        throw new DexcomShareError(
          response.status === 401 || response.status === 403 || response.status === 500
            ? 'authentication'
            : 'network',
          serverMessage ||
            (response.status === 401 || response.status === 403 || response.status === 500
              ? 'Dexcom rejected the account details. Check the publisher account, password and region.'
              : `Dexcom Share returned HTTP ${response.status}.`),
        );
      }
      return body;
    } finally {
      clearTimeout(timeout);
    }
  }

  private async authenticate() {
    if (this.sessionId) return this.sessionId;
    const common = {
      password: this.connection.password,
      applicationId: APPLICATION_ID,
    };
    const account = shareId(
      await this.post(AUTHENTICATE_PATH, {
        ...common,
        accountName: this.connection.username,
      }),
    );
    if (!account || account === INVALID_ID) {
      throw new DexcomShareError(
        'authentication',
        'Dexcom did not recognise that publisher account. A follower-only account cannot be used.',
      );
    }
    const session = shareId(
      await this.post(LOGIN_PATH, { ...common, accountId: account }),
    );
    if (!session || session === INVALID_ID) {
      throw new DexcomShareError(
        'authentication',
        'Dexcom accepted the account but did not open a Share session. Make sure Share is on in the Dexcom app.',
      );
    }
    this.sessionId = session;
    return session;
  }

  private async importReadings(minutes: number, maxCount: number) {
    await this.store.initialize();
    const attemptedAt = this.clock();
    try {
      const sessionId = await this.authenticate();
      const query = `?sessionId=${encodeURIComponent(sessionId)}&minutes=${minutes}&maxCount=${maxCount}`;
      const payload = await this.post(READ_PATH, undefined, query);
      if (!Array.isArray(payload)) {
        throw new DexcomShareError(
          'invalid-response',
          'Dexcom Share returned an unexpected glucose response.',
        );
      }
      const receivedAt = this.clock();
      const readings = (payload as DexcomShareEntry[]).flatMap(
        (entry): GlucoseReading[] => {
          try {
            const date = timestampFromEntry(entry);
            const normalized = normalizeXdripReading(
              {
                sgv: Number(entry.Value),
                date,
                direction: trendLabel(entry.Trend),
              },
              this.sourceId,
              receivedAt,
            );
            return [
              {
                ...normalized,
                id: `${this.sourceId}:${date}:${Number(entry.Value)}`,
                sourceFactoryTimestamp: entry.WT,
                sourceLocalTimestamp: entry.DT,
              },
            ];
          } catch {
            return [];
          }
        },
      );
      if (payload.length > 0 && readings.length === 0) {
        throw new DexcomShareError(
          'invalid-response',
          'Dexcom returned readings, but none contained a usable value and timestamp.',
        );
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
      if (error instanceof DexcomShareError && error.code === 'authentication') {
        this.sessionId = undefined;
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
