import {
  BasalDelivery,
  BolusDelivery,
  HealthContextEvent,
  InsulinDailyTotal,
  PumpStateInterval,
  TimeRange,
} from '@/domain/models';
import { toDateKey } from '@/domain/time';

export interface StoredRecordBounds {
  earliest?: number;
  latest?: number;
  lastRecordedAt?: number;
  count: number;
}

export interface ImportBatch {
  id: string;
  sourceId: string;
  fileName: string;
  fileSha256: string;
  importedAt: number;
  dataStart?: number;
  dataThrough?: number;
  skippedCount: number;
  warnings: string[];
}

export interface StoredImportBatch extends ImportBatch {
  basalCount: number;
  bolusCount: number;
  contextCount: number;
  dailyTotalCount: number;
  duplicateCount: number;
}

export interface ImportSourceEntry {
  name: string;
  /** Present in archives retained by Daymark 1.3.5 and earlier. */
  originalBytes?: number;
  measuredBytes?: number;
  reportedOriginalBytes?: number;
  compressedBytes?: number;
  handling: 'loaded' | 'retained';
  reason?: 'not-normalised' | 'entry-limit' | 'archive-limit' | 'file-limit';
}

export interface ImportSourcePayload {
  format: 'zip' | 'csv';
  bytes: Uint8Array;
  entries: ImportSourceEntry[];
}

/**
 * Exact field/value evidence from a source row. The original archive remains
 * authoritative; this encrypted, deduplicated index makes every field usable
 * without reparsing a ZIP for each screen or analysis.
 */
export interface ImportRawRecord {
  id: string;
  sourceId: string;
  recordKind: string;
  timestamp?: number;
  sourceFile: string;
  sourceRow: number;
  payloadJson: string;
  importedAt: number;
}

export function pumpStateIntervalFromRawRecord(
  record: ImportRawRecord,
): PumpStateInterval | undefined {
  if (record.recordKind !== 'pump-state-interval') return undefined;
  try {
    const payload = JSON.parse(record.payloadJson) as {
      start?: unknown;
      end?: unknown;
      kind?: unknown;
      sourcePage?: unknown;
    };
    if (
      typeof payload.start !== 'number' ||
      typeof payload.end !== 'number' ||
      payload.end <= payload.start ||
      (payload.kind !== 'activity-mode' &&
        payload.kind !== 'automated-pause')
    ) {
      return undefined;
    }
    return {
      id: record.id,
      start: payload.start,
      end: payload.end,
      kind: payload.kind,
      sourceId: record.sourceId,
      importedAt: record.importedAt,
      sourceFile: record.sourceFile,
      sourcePage:
        typeof payload.sourcePage === 'number'
          ? payload.sourcePage
          : undefined,
    };
  } catch {
    return undefined;
  }
}

export interface StoredImportSourcePayload {
  batch: StoredImportBatch;
  payload: ImportSourcePayload;
}

export interface StoredImportSourceSummary {
  archiveCount: number;
  totalBytes: number;
  earliestStoredAt?: number;
  latestStoredAt?: number;
  dataStart?: number;
  dataThrough?: number;
  loadedEntryCount: number;
  retainedEntryCount: number;
  indexedRecordCount?: number;
}

export interface StoredImportSourceReference {
  batchId: string;
  storedAt: number;
}

export interface ImportWriteResult {
  alreadyImported: boolean;
  /** Historical CGM rows are written by the glucose store alongside this import. */
  insertedGlucose: number;
  insertedBasal: number;
  insertedBoluses: number;
  insertedContext: number;
  insertedDailyTotals: number;
  duplicateCount: number;
  sourcePayloadStored: boolean;
  batch: StoredImportBatch;
}

export interface ImportedSourceDeleteResult {
  glucose: number;
  basal: number;
  boluses: number;
  context: number;
  dailyTotals: number;
  batches: number;
}

export interface HealthRecordStore {
  initialize(): Promise<void>;
  getBasalDeliveries(range: TimeRange): Promise<BasalDelivery[]>;
  getBolusDeliveries(range: TimeRange): Promise<BolusDelivery[]>;
  getDailyInsulinTotals(range: TimeRange): Promise<InsulinDailyTotal[]>;
  getPumpStateIntervals(range: TimeRange): Promise<PumpStateInterval[]>;
  getContextEvents(range: TimeRange): Promise<HealthContextEvent[]>;
  getInsulinBounds(): Promise<StoredRecordBounds>;
  getContextBounds(): Promise<StoredRecordBounds>;
  getLatestImport(sourceId: string): Promise<StoredImportBatch | undefined>;
  getLatestImportSourcePayload(
    sourceId: string,
  ): Promise<StoredImportSourcePayload | undefined>;
  getImportSourcePayloadReferences(
    sourceId: string,
  ): Promise<StoredImportSourceReference[]>;
  getImportSourcePayload(
    batchId: string,
  ): Promise<StoredImportSourcePayload | undefined>;
  getImportSourceSummary(
    sourceId: string,
  ): Promise<StoredImportSourceSummary>;
  getRawSourceRecords(
    sourceId: string,
    range?: TimeRange,
    recordKinds?: string[],
  ): Promise<ImportRawRecord[]>;
  getRawSourceRecordsByIds(
    recordIds: readonly string[],
  ): Promise<ImportRawRecord[]>;
  hasImportSourcePayload(sourceId: string): Promise<boolean>;
  writeImport(
    batch: ImportBatch,
    basal: BasalDelivery[],
    boluses: BolusDelivery[],
    context: HealthContextEvent[],
    sourcePayload?: ImportSourcePayload,
    dailyTotals?: InsulinDailyTotal[],
    rawRecords?: ImportRawRecord[],
  ): Promise<ImportWriteResult>;
  saveManualContext(event: HealthContextEvent): Promise<void>;
  deleteManualContext(id: string): Promise<boolean>;
  clearImportedSource(sourceId: string): Promise<ImportedSourceDeleteResult>;
}

function eventEnd(event: HealthContextEvent) {
  return event.end ?? event.start;
}

function isCorrectedRetainedBasal(
  stored: BasalDelivery,
  incoming: BasalDelivery,
) {
  return (
    stored.id !== incoming.id &&
    stored.unitsEstimated === true &&
    incoming.unitsEstimated !== true &&
    incoming.sourceFile !== undefined &&
    incoming.sourceRow !== undefined &&
    stored.sourceId === incoming.sourceId &&
    stored.sourceFile === incoming.sourceFile &&
    stored.sourceRow === incoming.sourceRow &&
    (stored.sourceDeviceId ?? '') === (incoming.sourceDeviceId ?? '') &&
    stored.start === incoming.start &&
    stored.end === incoming.end
  );
}

export class MemoryHealthRecordStore implements HealthRecordStore {
  private readonly basal = new Map<string, BasalDelivery>();
  private readonly boluses = new Map<string, BolusDelivery>();
  private readonly context = new Map<string, HealthContextEvent>();
  private readonly dailyTotals = new Map<string, InsulinDailyTotal>();
  private readonly batches = new Map<string, StoredImportBatch>();
  private readonly sourcePayloads = new Map<string, ImportSourcePayload>();
  private readonly rawRecords = new Map<string, ImportRawRecord>();

  async initialize() {}

  async getBasalDeliveries(range: TimeRange) {
    return [...this.basal.values()]
      .filter((delivery) => delivery.start < range.end && delivery.end > range.start)
      .sort((a, b) => a.start - b.start);
  }

  async getBolusDeliveries(range: TimeRange) {
    return [...this.boluses.values()]
      .filter(
        (delivery) =>
          delivery.timestamp >= range.start && delivery.timestamp < range.end,
      )
      .sort((a, b) => a.timestamp - b.timestamp);
  }

  async getPumpStateIntervals(range: TimeRange) {
    return [...this.rawRecords.values()]
      .filter(
        (record) =>
          record.recordKind === 'pump-state-interval',
      )
      .flatMap((record) => {
        const interval = pumpStateIntervalFromRawRecord(record);
        return interval &&
          interval.start < range.end &&
          interval.end > range.start
          ? [interval]
          : [];
      })
      .sort((left, right) => left.start - right.start);
  }

  async getDailyInsulinTotals(range: TimeRange) {
    if (range.end <= range.start) return [];
    const startDate = toDateKey(range.start);
    const endDate = toDateKey(range.end - 1);
    return [...this.dailyTotals.values()]
      .filter(
        (total) =>
          total.dateKey >= startDate && total.dateKey <= endDate,
      )
      .sort((a, b) => a.timestamp - b.timestamp);
  }

  async getContextEvents(range: TimeRange) {
    return [...this.context.values()]
      .filter(
        (event) => event.start < range.end && eventEnd(event) >= range.start,
      )
      .sort((a, b) => a.start - b.start);
  }

  async getRawSourceRecords(
    sourceId: string,
    range?: TimeRange,
    recordKinds?: string[],
  ) {
    const kinds = recordKinds?.length ? new Set(recordKinds) : undefined;
    return [...this.rawRecords.values()]
      .filter(
        (record) =>
          record.sourceId === sourceId &&
          (!kinds || kinds.has(record.recordKind)) &&
          (!range ||
            record.timestamp === undefined ||
            (record.timestamp >= range.start &&
              record.timestamp < range.end)),
      )
      .sort(
        (left, right) =>
          (left.timestamp ?? left.importedAt) -
          (right.timestamp ?? right.importedAt),
      );
  }

  async getRawSourceRecordsByIds(recordIds: readonly string[]) {
    const requested = new Set(recordIds);
    return [...this.rawRecords.values()]
      .filter((record) => requested.has(record.id))
      .sort(
        (left, right) =>
          (left.timestamp ?? left.importedAt) -
          (right.timestamp ?? right.importedAt),
      );
  }

  async getInsulinBounds(): Promise<StoredRecordBounds> {
    const records = [
      ...[...this.basal.values()].map((item) => ({
        start: item.start,
        end: item.end,
        recordedAt: item.importedAt,
      })),
      ...[...this.boluses.values()].map((item) => ({
        start: item.timestamp,
        end: item.timestamp,
        recordedAt: item.importedAt,
      })),
      ...[...this.dailyTotals.values()].map((item) => ({
        start: item.timestamp,
        end: item.timestamp,
        recordedAt: item.importedAt,
      })),
    ];
    if (!records.length) return { count: 0 };
    return {
      earliest: Math.min(...records.map((record) => record.start)),
      latest: Math.max(...records.map((record) => record.end)),
      lastRecordedAt: Math.max(
        ...records.map((record) => record.recordedAt ?? 0),
      ),
      count: records.length,
    };
  }

  async getContextBounds(): Promise<StoredRecordBounds> {
    const records = [...this.context.values()];
    if (!records.length) return { count: 0 };
    return {
      earliest: Math.min(...records.map((record) => record.start)),
      latest: Math.max(...records.map(eventEnd)),
      lastRecordedAt: Math.max(
        ...records.map((record) => record.recordedAt ?? record.start),
      ),
      count: records.length,
    };
  }

  async getLatestImport(sourceId: string) {
    return [...this.batches.values()]
      .filter((batch) => batch.sourceId === sourceId)
      .sort((a, b) => b.importedAt - a.importedAt)[0];
  }

  async getLatestImportSourcePayload(sourceId: string) {
    const batch = [...this.batches.values()]
      .filter((item) => item.sourceId === sourceId)
      .filter((item) =>
        this.sourcePayloads.has(`${item.sourceId}:${item.fileSha256}`),
      )
      .sort((a, b) => b.importedAt - a.importedAt)[0];
    if (!batch) return undefined;
    const payload = this.sourcePayloads.get(
      `${batch.sourceId}:${batch.fileSha256}`,
    );
    if (!payload) return undefined;
    return {
      batch: { ...batch, warnings: [...batch.warnings] },
      payload: {
        format: payload.format,
        bytes: payload.bytes.slice(),
        entries: payload.entries.map((entry) => ({ ...entry })),
      },
    };
  }

  async getImportSourcePayloadReferences(sourceId: string) {
    return [...this.batches.entries()]
      .filter(
        ([key, batch]) =>
          batch.sourceId === sourceId && this.sourcePayloads.has(key),
      )
      .map(([, batch]) => ({
        batchId: batch.id,
        storedAt: batch.importedAt,
      }))
      .sort((a, b) => a.storedAt - b.storedAt);
  }

  async getImportSourcePayload(batchId: string) {
    const entry = [...this.batches.entries()].find(
      ([, batch]) => batch.id === batchId,
    );
    if (!entry) return undefined;
    const [key, batch] = entry;
    const payload = this.sourcePayloads.get(key);
    if (!payload) return undefined;
    return {
      batch: { ...batch, warnings: [...batch.warnings] },
      payload: {
        format: payload.format,
        bytes: payload.bytes.slice(),
        entries: payload.entries.map((item) => ({ ...item })),
      },
    };
  }

  async hasImportSourcePayload(sourceId: string) {
    return [...this.sourcePayloads.keys()].some((key) =>
      key.startsWith(`${sourceId}:`),
    );
  }

  async getImportSourceSummary(
    sourceId: string,
  ): Promise<StoredImportSourceSummary> {
    const summary: StoredImportSourceSummary = {
      archiveCount: 0,
      totalBytes: 0,
      loadedEntryCount: 0,
      retainedEntryCount: 0,
    };
    for (const [key, payload] of this.sourcePayloads) {
      if (!key.startsWith(`${sourceId}:`)) continue;
      const batch = this.batches.get(key);
      summary.archiveCount += 1;
      summary.totalBytes += payload.bytes.length;
      summary.loadedEntryCount += payload.entries.filter(
        (entry) => entry.handling === 'loaded',
      ).length;
      summary.retainedEntryCount += payload.entries.filter(
        (entry) => entry.handling === 'retained',
      ).length;
      if (!batch) continue;
      summary.earliestStoredAt =
        summary.earliestStoredAt === undefined
          ? batch.importedAt
          : Math.min(summary.earliestStoredAt, batch.importedAt);
      summary.latestStoredAt =
        summary.latestStoredAt === undefined
          ? batch.importedAt
          : Math.max(summary.latestStoredAt, batch.importedAt);
      if (batch.dataStart !== undefined) {
        summary.dataStart =
          summary.dataStart === undefined
            ? batch.dataStart
            : Math.min(summary.dataStart, batch.dataStart);
      }
      if (batch.dataThrough !== undefined) {
        summary.dataThrough =
          summary.dataThrough === undefined
            ? batch.dataThrough
            : Math.max(summary.dataThrough, batch.dataThrough);
      }
    }
    summary.indexedRecordCount = [...this.rawRecords.values()].filter(
      (record) => record.sourceId === sourceId,
    ).length;
    return summary;
  }

  async writeImport(
    batch: ImportBatch,
    basal: BasalDelivery[],
    boluses: BolusDelivery[],
    context: HealthContextEvent[],
    sourcePayload?: ImportSourcePayload,
    dailyTotals: InsulinDailyTotal[] = [],
    rawRecords: ImportRawRecord[] = [],
  ): Promise<ImportWriteResult> {
    const key = `${batch.sourceId}:${batch.fileSha256}`;
    if (sourcePayload && !this.sourcePayloads.has(key)) {
      this.sourcePayloads.set(key, {
        format: sourcePayload.format,
        bytes: sourcePayload.bytes.slice(),
        entries: sourcePayload.entries.map((entry) => ({ ...entry })),
      });
    }
    const existing = this.batches.get(key);

    let insertedBasal = 0;
    let replacedBasal = 0;
    let insertedBoluses = 0;
    let insertedContext = 0;
    let insertedDailyTotals = 0;
    const canReplaceRetainedBasal = Boolean(
      existing && this.sourcePayloads.has(key),
    );
    basal.forEach((delivery) => {
      if (
        canReplaceRetainedBasal &&
        delivery.sourceId === batch.sourceId &&
        delivery.unitsEstimated !== true
      ) {
        for (const [id, stored] of this.basal) {
          if (!isCorrectedRetainedBasal(stored, delivery)) continue;
          this.basal.delete(id);
          replacedBasal += 1;
        }
      }
      if (!this.basal.has(delivery.id)) {
        this.basal.set(delivery.id, { ...delivery });
        insertedBasal += 1;
      }
    });
    boluses.forEach((delivery) => {
      if (!this.boluses.has(delivery.id)) {
        this.boluses.set(delivery.id, { ...delivery });
        insertedBoluses += 1;
      }
    });
    context.forEach((event) => {
      if (!this.context.has(event.id)) {
        this.context.set(event.id, { ...event });
        insertedContext += 1;
      }
    });
    dailyTotals.forEach((total) => {
      if (!this.dailyTotals.has(total.id)) {
        this.dailyTotals.set(total.id, { ...total });
        insertedDailyTotals += 1;
      }
    });
    rawRecords.forEach((record) => {
      const existingRaw = this.rawRecords.get(record.id);
      if (!existingRaw) {
        this.rawRecords.set(record.id, { ...record });
      } else if (record.importedAt > existingRaw.importedAt) {
        this.rawRecords.set(record.id, {
          ...existingRaw,
          importedAt: record.importedAt,
        });
      }
    });

    const duplicateCount =
      basal.length +
      boluses.length +
      context.length +
      dailyTotals.length -
      insertedBasal -
      insertedBoluses -
      insertedContext -
      insertedDailyTotals;
    const stored: StoredImportBatch = existing
      ? {
          ...existing,
          dataStart:
            batch.dataStart === undefined
              ? existing.dataStart
              : existing.dataStart === undefined
                ? batch.dataStart
                : Math.min(existing.dataStart, batch.dataStart),
          dataThrough:
            batch.dataThrough === undefined
              ? existing.dataThrough
              : existing.dataThrough === undefined
                ? batch.dataThrough
                : Math.max(existing.dataThrough, batch.dataThrough),
          basalCount:
            existing.basalCount +
            Math.max(0, insertedBasal - replacedBasal),
          bolusCount: existing.bolusCount + insertedBoluses,
          contextCount: existing.contextCount + insertedContext,
          dailyTotalCount:
            existing.dailyTotalCount + insertedDailyTotals,
          duplicateCount: existing.duplicateCount + duplicateCount,
          skippedCount: batch.skippedCount,
          warnings: [...batch.warnings],
        }
      : {
          ...batch,
          basalCount: insertedBasal,
          bolusCount: insertedBoluses,
          contextCount: insertedContext,
          dailyTotalCount: insertedDailyTotals,
          duplicateCount,
          warnings: [...batch.warnings],
        };
    this.batches.set(key, stored);
    return {
      alreadyImported: Boolean(existing),
      insertedGlucose: 0,
      insertedBasal,
      insertedBoluses,
      insertedContext,
      insertedDailyTotals,
      duplicateCount,
      sourcePayloadStored: this.sourcePayloads.has(key),
      batch: stored,
    };
  }

  async saveManualContext(event: HealthContextEvent) {
    if (event.origin !== 'manual') {
      throw new Error('Only manual context can be saved through this method.');
    }
    this.context.set(event.id, { ...event });
  }

  async deleteManualContext(id: string) {
    const event = this.context.get(id);
    if (!event || event.origin !== 'manual') return false;
    return this.context.delete(id);
  }

  async clearImportedSource(
    sourceId: string,
  ): Promise<ImportedSourceDeleteResult> {
    let basal = 0;
    let boluses = 0;
    let context = 0;
    let dailyTotals = 0;
    let batches = 0;
    for (const [id, delivery] of this.basal) {
      if (delivery.sourceId === sourceId) {
        this.basal.delete(id);
        basal += 1;
      }
    }
    for (const [id, delivery] of this.boluses) {
      if (delivery.sourceId === sourceId) {
        this.boluses.delete(id);
        boluses += 1;
      }
    }
    for (const [id, event] of this.context) {
      if (event.sourceId === sourceId && event.origin === 'imported') {
        this.context.delete(id);
        context += 1;
      }
    }
    for (const [id, total] of this.dailyTotals) {
      if (total.sourceId === sourceId) {
        this.dailyTotals.delete(id);
        dailyTotals += 1;
      }
    }
    for (const [key, batch] of this.batches) {
      if (batch.sourceId === sourceId) {
        this.batches.delete(key);
        batches += 1;
      }
    }
    for (const [id, record] of this.rawRecords) {
      if (record.sourceId === sourceId) this.rawRecords.delete(id);
    }
    for (const key of this.sourcePayloads.keys()) {
      if (key.startsWith(`${sourceId}:`)) this.sourcePayloads.delete(key);
    }
    return {
      glucose: 0,
      basal,
      boluses,
      context,
      dailyTotals,
      batches,
    };
  }
}
