import * as Crypto from 'expo-crypto';

import {
  GLOOKO_SOURCE_ID,
  GlookoImportPreview,
  parseGlookoTextFiles,
} from './glookoCsv';
import {
  safeGlookoFileName,
  unpackGlookoExport,
} from './glookoArchive';
import {
  ImportBatch,
  ImportSourcePayload,
} from '@/data/persistence/HealthRecordStore';

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
): Promise<PreparedGlookoImport> {
  const name = safeGlookoFileName(fileName);
  const digestInput = new Uint8Array(bytes.byteLength);
  digestInput.set(bytes);
  const digest = await Crypto.digest(
    Crypto.CryptoDigestAlgorithm.SHA256,
    digestInput,
  );
  const fileSha256 = toHex(digest);
  const unpacked = await unpackGlookoExport(name, bytes);
  const preview = parseGlookoTextFiles(unpacked.files, importedAt);
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
