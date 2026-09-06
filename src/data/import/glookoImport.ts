import * as Crypto from 'expo-crypto';

import {
  DEFAULT_GLOOKO_IMPORT_REGIONAL_SETTINGS,
  GLOOKO_SOURCE_ID,
  GlookoImportPreview,
  type GlookoImportRegionalSettings,
  parseGlookoTextFiles,
} from './glookoCsv';
import { safeGlookoFileName, unpackGlookoExport } from './glookoArchive';
import { snapshotGlookoImportRegionalSettings } from './glookoManualFileSettings';
import {
  ImportBatch,
  ImportSourcePayload,
} from '@/data/persistence/HealthRecordStore';
import { getRuntimeRegionalDefaults } from '@/domain/regionalProfileRuntime';

export interface PreparedGlookoImport {
  preview: GlookoImportPreview;
  batch: ImportBatch;
  sourcePayload?: ImportSourcePayload;
}

function toHex(buffer: ArrayBuffer) {
  return [...new Uint8Array(buffer)]
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('');
}

export async function prepareGlookoImport(
  fileName: string,
  bytes: Uint8Array,
  importedAt = Date.now(),
  regionalSettings: GlookoImportRegionalSettings = (() => {
    try {
      const regional = getRuntimeRegionalDefaults();
      return {
        timeZone: regional.timeZone,
        dateOrder: regional.glookoRegion === 'us' ? 'month-first' : 'day-first',
      };
    } catch {
      return DEFAULT_GLOOKO_IMPORT_REGIONAL_SETTINGS;
    }
  })(),
): Promise<PreparedGlookoImport> {
  const importSettings = snapshotGlookoImportRegionalSettings(regionalSettings);
  const name = safeGlookoFileName(fileName);
  const digestInput = new Uint8Array(bytes.byteLength);
  digestInput.set(bytes);
  const digest = await Crypto.digest(
    Crypto.CryptoDigestAlgorithm.SHA256,
    digestInput,
  ).finally(() => digestInput.fill(0));
  const fileSha256 = toHex(digest);
  const unpacked = await unpackGlookoExport(name, bytes);
  // Let the caller publish the local-read stage before CPU-bound normalisation.
  await new Promise<void>((resolve) => { setTimeout(resolve, 0); });
  const preview = (() => {
    try {
      return parseGlookoTextFiles(unpacked.files, importedAt, importSettings);
    } finally {
      // Decompressed CGM buffers are working copies. The exact selected ZIP
      // or CSV remains in sourcePayload and has its own explicit lifecycle.
      unpacked.files.forEach((file) => file.bytes?.fill(0));
    }
  })();
  return {
    preview,
    batch: {
      id: `${GLOOKO_SOURCE_ID}:${fileSha256.slice(0, 32)}`,
      sourceId: GLOOKO_SOURCE_ID,
      fileName: name,
      fileSha256,
      importedAt,
      dataStart: preview.dataStart,
      dataThrough: preview.dataThrough,
      skippedCount: preview.skippedRows + preview.duplicateRows,
      warnings: preview.warnings,
    },
    sourcePayload: {
      format: unpacked.format,
      bytes,
      entries: unpacked.entries,
    },
  };
}
