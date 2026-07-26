import { describe, expect, it } from 'vitest';
import { strToU8, zipSync } from 'fflate';

import { unpackGlookoFiles } from '@/data/import/glookoArchive';
import {
  parseDelimitedText,
  parseGlookoTextFiles,
  parseGlookoTimestamp,
} from '@/data/import/glookoCsv';
import {
  ImportBatch,
  MemoryHealthRecordStore,
} from '@/data/persistence/HealthRecordStore';

const IMPORTED_AT = Date.parse('2026-07-26T08:00:00+01:00');

const BOLUS_TSV = `Name:Example\tDate Range:2026-03-29 - 2026-03-30
Timestamp\tBolus Type\tDose (units)\tCarbs (g)\tNotes
2026-03-29 09:17:50\tNormal\t4.8\t45\tBreakfast
2026-03-29 12:37:50\tCorrection\t1.2\t0\tCorrection`;

const BASAL_TSV = `Name:Example\tDate Range:2026-03-29 - 2026-03-30
Timestamp\tBasal Rate (units/hr)\tDuration (min)\tType
2026-03-29 00:00:00\t0.60\t30\tScheduled
2026-03-29 00:30:00\t0.80\t30\tScheduled`;

function overwriteFirstCentralUncompressedSize(
  archive: Uint8Array,
  size: number,
) {
  const copy = archive.slice();
  let central = -1;
  for (let index = 0; index <= copy.length - 4; index += 1) {
    if (
      copy[index] === 0x50 &&
      copy[index + 1] === 0x4b &&
      copy[index + 2] === 0x01 &&
      copy[index + 3] === 0x02
    ) {
      central = index;
      break;
    }
  }
  if (central < 0) throw new Error('Test ZIP has no central directory.');
  copy[central + 24] = size & 0xff;
  copy[central + 25] = (size >>> 8) & 0xff;
  copy[central + 26] = (size >>> 16) & 0xff;
  copy[central + 27] = (size >>> 24) & 0xff;
  return copy;
}

describe('Glooko ZIP/CSV normalisation', () => {
  it('extracts only CSV data and removes archive paths from provenance', async () => {
    const archive = zipSync({
      'private/export/bolus_data.csv': strToU8(BOLUS_TSV),
      'private/export/readme.txt': strToU8('not imported'),
    });

    const files = await unpackGlookoFiles('glooko.zip', archive);

    expect(files).toHaveLength(1);
    expect(files[0]?.name).toBe('bolus_data.csv');
    expect(files[0]?.text).toContain('Bolus Type');
  });

  it('measures extracted bytes instead of trusting misleading ZIP sizes', async () => {
    const archive = zipSync({
      'private/export/bolus_data_1.csv': strToU8(BOLUS_TSV),
    });
    const misleading = overwriteFirstCentralUncompressedSize(
      archive,
      30 * 1024 * 1024,
    );

    const files = await unpackGlookoFiles('glooko.zip', misleading);

    expect(files[0]?.text).toContain('Bolus Type');
    expect(parseGlookoTextFiles(files, IMPORTED_AT).boluses).toHaveLength(2);
  });

  it('retains oversized CGM data without decompressing it while importing pump files', async () => {
    const oversizedCgm = new Uint8Array(25 * 1024 * 1024 + 1);
    const archive = zipSync({
      'private/export/cgm_data_1.csv': oversizedCgm,
      'private/export/bolus_data_1.csv': strToU8(BOLUS_TSV),
    });

    const files = await unpackGlookoFiles('glooko.zip', archive);
    const cgm = files.find((file) => file.name === 'cgm_data_1.csv');
    const bolus = files.find((file) => file.name === 'bolus_data_1.csv');

    expect(cgm?.text).toBe('');
    expect(cgm?.retainedOnly).toBe(true);
    expect(cgm?.originalBytes).toBe(oversizedCgm.length);
    expect(bolus?.text).toContain('Bolus Type');
    const preview = parseGlookoTextFiles(files, IMPORTED_AT);
    expect(preview.retainedFiles).toContainEqual({
      name: 'cgm_data_1.csv',
      originalBytes: oversizedCgm.length,
    });
    expect(preview.boluses).toHaveLength(2);
  });

  it('retains oversized insulin data instead of rejecting the whole export', async () => {
    const oversizedBasal = new Uint8Array(25 * 1024 * 1024 + 1);
    const archive = zipSync({
      'private/export/basal_data_1.csv': oversizedBasal,
    });

    const files = await unpackGlookoFiles('glooko.zip', archive);

    expect(files).toEqual([
      {
        name: 'basal_data_1.csv',
        text: '',
        retainedOnly: true,
        originalBytes: oversizedBasal.length,
      },
    ]);
    expect(parseGlookoTextFiles(files, IMPORTED_AT).retainedFiles).toEqual([
      {
        name: 'basal_data_1.csv',
        originalBytes: oversizedBasal.length,
      },
    ]);
  });

  it('retains oversized food and CGM files while normalising available insulin', async () => {
    const oversizedFood = new Uint8Array(25 * 1024 * 1024 + 7);
    const oversizedCgm = new Uint8Array(25 * 1024 * 1024 + 9);
    const archive = zipSync({
      'private/export/food_data_1.csv': oversizedFood,
      'private/export/cgm_data_1.csv': oversizedCgm,
      'private/export/bolus_data_1.csv': strToU8(BOLUS_TSV),
    });

    const preview = parseGlookoTextFiles(
      await unpackGlookoFiles('glooko.zip', archive),
      IMPORTED_AT,
    );

    expect(preview.boluses).toHaveLength(2);
    expect(preview.retainedFiles).toEqual([
      {
        name: 'food_data_1.csv',
        originalBytes: oversizedFood.length,
      },
      {
        name: 'cgm_data_1.csv',
        originalBytes: oversizedCgm.length,
      },
    ]);
    expect(preview.warnings).toContain(
      '2 source files were retained exactly in the encrypted source archive for future processing.',
    );
  });

  it('rejects empty or unrelated selections before parsing', async () => {
    await expect(
      unpackGlookoFiles('empty.csv', new Uint8Array()),
    ).rejects.toThrow(/empty/);
    await expect(
      unpackGlookoFiles('notes.txt', strToU8('private notes')),
    ).rejects.toThrow(/Glooko/);
    await expect(
      unpackGlookoFiles(
        'empty.zip',
        zipSync({ 'readme.txt': strToU8('no csv') }),
      ),
    ).rejects.toThrow(/does not contain any CSV/);
  });

  it('parses representative Glooko basal, bolus and pump carbohydrate rows', () => {
    const preview = parseGlookoTextFiles(
      [
        { name: 'bolus_data_1.csv', text: BOLUS_TSV },
        { name: 'basal_data_1.csv', text: BASAL_TSV },
        {
          name: 'cgm_data_1.csv',
          text: 'Timestamp\tGlucose Value (mmol/L)\n2026-03-29 09:00:00\t6.2',
        },
      ],
      IMPORTED_AT,
    );

    expect(preview.boluses).toHaveLength(2);
    expect(preview.boluses[0]?.units).toBe(4.8);
    expect(preview.basal).toHaveLength(2);
    expect(preview.basal[0]?.units).toBeCloseTo(0.3);
    expect(preview.context).toHaveLength(1);
    expect(preview.context[0]).toMatchObject({
      kind: 'meal',
      title: 'Breakfast',
      carbsGrams: 45,
      origin: 'imported',
    });
    expect(preview.ignoredFiles).toContain('cgm_data_1.csv');
    expect(preview.recognisedFiles).toHaveLength(2);
  });

  it('supports official-style delivered-insulin and carbohydrate headers', () => {
    const preview = parseGlookoTextFiles(
      [
        {
          name: 'Bolus.csv',
          text: `Name:Example,Date Range:2026-07-01 - 2026-07-02
Timestamp,Insulin Type,Blood Glucose Input (mmol/L),Carbohydrate Intake (g),Delivered Insulin (units)
2026-07-01 18:45:00,Normal,7.2,62,5.4`,
        },
      ],
      IMPORTED_AT,
    );

    expect(preview.boluses[0]?.units).toBe(5.4);
    expect(preview.context[0]).toMatchObject({
      kind: 'meal',
      carbsGrams: 62,
    });
  });

  it('does not mislabel aggregate insulin totals as delivered boluses', () => {
    const preview = parseGlookoTextFiles(
      [
        {
          name: 'insulin_data_1.csv',
          text: `Timestamp,Total Bolus (U),Total Basal (U),Total Insulin (U)
2026-07-01 23:59:00,18.2,22.4,40.6`,
        },
      ],
      IMPORTED_AT,
    );

    expect(preview.boluses).toHaveLength(0);
    expect(preview.ignoredFiles).toContain('insulin_data_1.csv');
    expect(preview.unrecognisedFiles[0]).toMatchObject({
      name: 'insulin_data_1.csv',
      headers: [
        'Timestamp',
        'Total Bolus (U)',
        'Total Basal (U)',
        'Total Insulin (U)',
      ],
    });
  });

  it('collapses repeated records across overlapping export files', () => {
    const preview = parseGlookoTextFiles(
      [
        { name: 'bolus_data_1.csv', text: BOLUS_TSV },
        { name: 'bolus_data_2.csv', text: BOLUS_TSV },
      ],
      IMPORTED_AT,
    );

    expect(preview.boluses).toHaveLength(2);
    expect(preview.context).toHaveLength(1);
    expect(preview.duplicateRows).toBe(3);
  });

  it('interprets naive timestamps in Europe/London across BST', () => {
    expect(parseGlookoTimestamp('2026-01-15 12:00:00')).toBe(
      Date.parse('2026-01-15T12:00:00Z'),
    );
    expect(parseGlookoTimestamp('2026-07-15 12:00:00')).toBe(
      Date.parse('2026-07-15T11:00:00Z'),
    );
    expect(parseGlookoTimestamp('15/07/2026 12:00:00')).toBe(
      Date.parse('2026-07-15T11:00:00Z'),
    );
  });

  it('parses quoted delimiters without splitting note text', () => {
    expect(
      parseDelimitedText(
        'Timestamp,Dose (units),Notes\n2026-07-01 12:00:00,2.4,"Lunch, away from home"',
      )[1],
    ).toEqual([
      '2026-07-01 12:00:00',
      '2.4',
      'Lunch, away from home',
    ]);
  });
});

describe('encrypted health-record store contract', () => {
  it('deduplicates repeat and overlapping imports atomically', async () => {
    const store = new MemoryHealthRecordStore();
    const preview = parseGlookoTextFiles(
      [
        { name: 'bolus_data_1.csv', text: BOLUS_TSV },
        { name: 'basal_data_1.csv', text: BASAL_TSV },
      ],
      IMPORTED_AT,
    );
    const batch: ImportBatch = {
      id: 'glooko-export:batch-1',
      sourceId: 'glooko-export',
      fileName: 'export.zip',
      fileSha256: 'abc123',
      importedAt: IMPORTED_AT,
      dataStart: preview.dataStart,
      dataThrough: preview.dataThrough,
      skippedCount: preview.skippedRows,
      warnings: preview.warnings,
    };
    const sourcePayload = {
      format: 'zip' as const,
      bytes: new Uint8Array([0x50, 0x4b, 0x03, 0x04]),
      entries: [
        {
          name: 'bolus_data_1.csv',
          originalBytes: BOLUS_TSV.length,
          handling: 'loaded' as const,
        },
      ],
    };

    const first = await store.writeImport(
      batch,
      preview.basal,
      preview.boluses,
      preview.context,
      sourcePayload,
    );
    const second = await store.writeImport(
      batch,
      preview.basal,
      preview.boluses,
      preview.context,
      sourcePayload,
    );

    expect(first).toMatchObject({
      alreadyImported: false,
      insertedBasal: 2,
      insertedBoluses: 2,
      insertedContext: 1,
      duplicateCount: 0,
      sourcePayloadStored: true,
    });
    expect(second.alreadyImported).toBe(true);
    expect(second.sourcePayloadStored).toBe(true);
    expect((await store.getInsulinBounds()).count).toBe(4);
    expect((await store.getContextBounds()).count).toBe(1);
  });

  it('stores an exact source archive even when no rows are normalised yet', async () => {
    const store = new MemoryHealthRecordStore();
    const result = await store.writeImport(
      {
        id: 'glooko-export:retained-only',
        sourceId: 'glooko-export',
        fileName: 'large-export.zip',
        fileSha256: 'retained-only',
        importedAt: IMPORTED_AT,
        skippedCount: 0,
        warnings: [],
      },
      [],
      [],
      [],
      {
        format: 'zip',
        bytes: new Uint8Array([0x50, 0x4b, 0x03, 0x04]),
        entries: [
          {
            name: 'food_data_1.csv',
            originalBytes: 30 * 1024 * 1024,
            handling: 'retained',
          },
        ],
      },
    );

    expect(result).toMatchObject({
      insertedBasal: 0,
      insertedBoluses: 0,
      insertedContext: 0,
      sourcePayloadStored: true,
    });
  });

  it('can reprocess a retained archive into an existing zero-row batch', async () => {
    const store = new MemoryHealthRecordStore();
    const batch: ImportBatch = {
      id: 'glooko-export:reprocess',
      sourceId: 'glooko-export',
      fileName: 'export.zip',
      fileSha256: 'reprocess',
      importedAt: IMPORTED_AT,
      skippedCount: 0,
      warnings: ['No supported tables found.'],
    };
    const sourceBytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04]);
    await store.writeImport(batch, [], [], [], {
      format: 'zip',
      bytes: sourceBytes,
      entries: [],
    });
    const preview = parseGlookoTextFiles(
      [
        { name: 'bolus_data_1.csv', text: BOLUS_TSV },
        { name: 'basal_data_1.csv', text: BASAL_TSV },
      ],
      IMPORTED_AT,
    );

    const reprocessed = await store.writeImport(
      {
        ...batch,
        dataStart: preview.dataStart,
        dataThrough: preview.dataThrough,
        warnings: preview.warnings,
      },
      preview.basal,
      preview.boluses,
      preview.context,
    );

    expect(reprocessed).toMatchObject({
      alreadyImported: true,
      insertedBasal: 2,
      insertedBoluses: 2,
      insertedContext: 1,
      sourcePayloadStored: true,
    });
    expect(await store.hasImportSourcePayload('glooko-export')).toBe(true);
    expect(
      (await store.getLatestImportSourcePayload('glooko-export'))?.payload.bytes,
    ).toEqual(sourceBytes);
  });

  it('only permits deleting user-created context', async () => {
    const store = new MemoryHealthRecordStore();
    await store.saveManualContext({
      id: 'daymark-manual:meal:1',
      kind: 'meal',
      start: IMPORTED_AT,
      title: 'Lunch',
      mealType: 'lunch',
      carbsGrams: 40,
      sourceId: 'daymark-manual',
      origin: 'manual',
      recordedAt: IMPORTED_AT,
    });

    expect(await store.deleteManualContext('daymark-manual:meal:1')).toBe(true);
    expect(await store.deleteManualContext('daymark-manual:meal:1')).toBe(false);
  });

  it('removes an imported source without deleting manual context', async () => {
    const store = new MemoryHealthRecordStore();
    const preview = parseGlookoTextFiles(
      [
        { name: 'bolus_data.csv', text: BOLUS_TSV },
        { name: 'basal_data.csv', text: BASAL_TSV },
      ],
      IMPORTED_AT,
    );
    await store.writeImport(
      {
        id: 'glooko-export:clear-test',
        sourceId: 'glooko-export',
        fileName: 'export.zip',
        fileSha256: 'clear-test',
        importedAt: IMPORTED_AT,
        skippedCount: 0,
        warnings: [],
      },
      preview.basal,
      preview.boluses,
      preview.context,
    );
    await store.saveManualContext({
      id: 'daymark-manual:meal:kept',
      kind: 'meal',
      start: IMPORTED_AT,
      title: 'Kept meal',
      mealType: 'lunch',
      carbsGrams: 42,
      sourceId: 'daymark-manual',
      origin: 'manual',
      recordedAt: IMPORTED_AT,
    });

    expect(await store.clearImportedSource('glooko-export')).toEqual({
      basal: 2,
      boluses: 2,
      context: 1,
      batches: 1,
    });
    expect((await store.getInsulinBounds()).count).toBe(0);
    expect((await store.getContextBounds()).count).toBe(1);
  });
});
