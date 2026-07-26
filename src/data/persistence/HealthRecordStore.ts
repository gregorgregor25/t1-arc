import {
  BasalDelivery,
  BolusDelivery,
  HealthContextEvent,
  TimeRange,
} from '@/domain/models';

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

export interface StoredImportSourcePayload {
  batch: StoredImportBatch;
  payload: ImportSourcePayload;
}

export interface ImportWriteResult {
  alreadyImported: boolean;
  insertedBasal: number;
  insertedBoluses: number;
  insertedContext: number;
  duplicateCount: number;
  sourcePayloadStored: boolean;
  batch: StoredImportBatch;
}

export interface ImportedSourceDeleteResult {
  basal: number;
  boluses: number;
  context: number;
  batches: number;
}

export interface HealthRecordStore {
  initialize(): Promise<void>;
  getBasalDeliveries(range: TimeRange): Promise<BasalDelivery[]>;
  getBolusDeliveries(range: TimeRange): Promise<BolusDelivery[]>;
  getContextEvents(range: TimeRange): Promise<HealthContextEvent[]>;
  getInsulinBounds(): Promise<StoredRecordBounds>;
  getContextBounds(): Promise<StoredRecordBounds>;
  getLatestImport(sourceId: string): Promise<StoredImportBatch | undefined>;
  getLatestImportSourcePayload(
    sourceId: string,
  ): Promise<StoredImportSourcePayload | undefined>;
  hasImportSourcePayload(sourceId: string): Promise<boolean>;
  writeImport(
    batch: ImportBatch,
    basal: BasalDelivery[],
    boluses: BolusDelivery[],
    context: HealthContextEvent[],
    sourcePayload?: ImportSourcePayload,
  ): Promise<ImportWriteResult>;
  saveManualContext(event: HealthContextEvent): Promise<void>;
  deleteManualContext(id: string): Promise<boolean>;
  clearImportedSource(sourceId: string): Promise<ImportedSourceDeleteResult>;
}

function eventEnd(event: HealthContextEvent) {
  return event.end ?? event.start;
}

export class MemoryHealthRecordStore implements HealthRecordStore {
  private readonly basal = new Map<string, BasalDelivery>();
  private readonly boluses = new Map<string, BolusDelivery>();
  private readonly context = new Map<string, HealthContextEvent>();
  private readonly batches = new Map<string, StoredImportBatch>();
  private readonly sourcePayloads = new Map<string, ImportSourcePayload>();

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

  async getContextEvents(range: TimeRange) {
    return [...this.context.values()]
      .filter(
        (event) => event.start < range.end && eventEnd(event) >= range.start,
      )
      .sort((a, b) => a.start - b.start);
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

  async hasImportSourcePayload(sourceId: string) {
    return [...this.sourcePayloads.keys()].some((key) =>
      key.startsWith(`${sourceId}:`),
    );
  }

  async writeImport(
    batch: ImportBatch,
    basal: BasalDelivery[],
    boluses: BolusDelivery[],
    context: HealthContextEvent[],
    sourcePayload?: ImportSourcePayload,
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
    let insertedBoluses = 0;
    let insertedContext = 0;
    basal.forEach((delivery) => {
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

    const duplicateCount =
      basal.length +
      boluses.length +
      context.length -
      insertedBasal -
      insertedBoluses -
      insertedContext;
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
          basalCount: existing.basalCount + insertedBasal,
          bolusCount: existing.bolusCount + insertedBoluses,
          contextCount: existing.contextCount + insertedContext,
          duplicateCount: existing.duplicateCount + duplicateCount,
          skippedCount: batch.skippedCount,
          warnings: [...batch.warnings],
        }
      : {
          ...batch,
          basalCount: insertedBasal,
          bolusCount: insertedBoluses,
          contextCount: insertedContext,
          duplicateCount,
          warnings: [...batch.warnings],
        };
    this.batches.set(key, stored);
    return {
      alreadyImported: Boolean(existing),
      insertedBasal,
      insertedBoluses,
      insertedContext,
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
    for (const [key, batch] of this.batches) {
      if (batch.sourceId === sourceId) {
        this.batches.delete(key);
        batches += 1;
      }
    }
    for (const key of this.sourcePayloads.keys()) {
      if (key.startsWith(`${sourceId}:`)) this.sourcePayloads.delete(key);
    }
    return { basal, boluses, context, batches };
  }
}
