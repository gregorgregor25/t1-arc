import * as Crypto from 'expo-crypto';

import {
  DEFAULT_DEXCOM_CLARITY_IMPORT_REGIONAL_SETTINGS,
  DEXCOM_CLARITY_SOURCE_ID,
  type DexcomClarityImportRegionalSettings,
  DexcomClarityImportPreview,
  parseDexcomClarityCsv,
} from './dexcomClarityCsv';
import {
  ImportBatch,
  ImportSourcePayload,
} from '@/data/persistence/HealthRecordStore';
import type { T1ArcRegionalDefaults } from '@/domain/regionalProfile';
import { getRuntimeRegionalDefaults } from '@/domain/regionalProfileRuntime';

const MAX_DEXCOM_EXPORT_BYTES = 96 * 1024 * 1024;

export interface PreparedDexcomClarityImport {
  preview: DexcomClarityImportPreview;
  batch: ImportBatch;
  sourcePayload: ImportSourcePayload;
}

function safeFileName(value: string) {
  return value.split(/[\\/]/).pop()?.trim() || 'dexcom-clarity.csv';
}

function toHex(buffer: ArrayBuffer) {
  return [...new Uint8Array(buffer)]
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('');
}

export function dexcomClarityImportSettingsFromRegionalDefaults(
  regional: Pick<T1ArcRegionalDefaults, 'dexcomRegion' | 'timeZone'>,
): DexcomClarityImportRegionalSettings {
  return {
    timeZone: regional.timeZone,
    dateOrder: regional.dexcomRegion === 'us' ? 'month-first' : 'day-first',
  };
}

function runtimeDexcomClarityImportSettings() {
  try {
    return dexcomClarityImportSettingsFromRegionalDefaults(
      getRuntimeRegionalDefaults(),
    );
  } catch {
    return DEFAULT_DEXCOM_CLARITY_IMPORT_REGIONAL_SETTINGS;
  }
}

export async function prepareDexcomClarityImport(
  fileName: string,
  bytes: Uint8Array,
  importedAt = Date.now(),
  regionalSettings: DexcomClarityImportRegionalSettings =
    runtimeDexcomClarityImportSettings(),
): Promise<PreparedDexcomClarityImport> {
  if (!bytes.byteLength) {
    throw new Error('The selected Dexcom Clarity CSV is empty.');
  }
  if (bytes.byteLength > MAX_DEXCOM_EXPORT_BYTES) {
    throw new Error(
      'This Dexcom export is larger than the 96 MB on-device safety limit. Export it in two date ranges and import both files.',
    );
  }
  const name = safeFileName(fileName);
  if (!name.toLowerCase().endsWith('.csv')) {
    throw new Error('Choose the raw .csv file exported by Dexcom Clarity.');
  }
  const digestInput = bytes.slice();
  const digest = await Crypto.digest(
    Crypto.CryptoDigestAlgorithm.SHA256,
    digestInput,
  ).finally(() => digestInput.fill(0));
  const fileSha256 = toHex(digest);
  const preview = parseDexcomClarityCsv(
    bytes,
    name,
    importedAt,
    regionalSettings,
  );
  return {
    preview,
    batch: {
      id: `${DEXCOM_CLARITY_SOURCE_ID}:${fileSha256.slice(0, 32)}`,
      sourceId: DEXCOM_CLARITY_SOURCE_ID,
      fileName: name,
      fileSha256,
      importedAt,
      dataStart: preview.dataStart,
      dataThrough: preview.dataThrough,
      skippedCount: preview.skippedRows + preview.duplicateRows,
      warnings: preview.warnings,
    },
    sourcePayload: {
      format: 'csv',
      bytes,
      entries: [
        {
          name,
          measuredBytes: bytes.byteLength,
          handling: 'loaded',
        },
      ],
    },
  };
}
