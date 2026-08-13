import { describe, expect, it } from 'vitest';
import { strToU8, zipSync } from 'fflate';

import {
  glookoEntryLimitForName,
  unpackGlookoExport,
  unpackGlookoFiles,
} from '@/data/import/glookoArchive';
import {
  GLOOKO_CGM_SOURCE_ID,
  parseDelimitedText,
  parseGlookoTextFiles,
  parseGlookoTimestamp,
} from '@/data/import/glookoCsv';
import {
  GlookoImportSourceCommitGuard,
  releasePreparedGlookoImportSource,
} from '@/data/import/glookoImportLifecycle';
import {
  ImportBatch,
  MemoryHealthRecordStore,
} from '@/data/persistence/HealthRecordStore';
import { calculateInsulinStats } from '@/domain/stats';

const IMPORTED_AT = Date.parse('2026-07-26T08:00:00+01:00');

const BOLUS_TSV = `Name:Example\tDate Range:2026-03-29 - 2026-03-30
Timestamp\tBolus Type\tDose (units)\tCarbs (g)\tNotes
2026-03-29 09:17:50\tNormal\t4.8\t45\tBreakfast
2026-03-29 12:37:50\tCorrection\t1.2\t0\tCorrection`;

const BASAL_TSV = `Name:Example\tDate Range:2026-03-29 - 2026-03-30
Timestamp\tBasal Rate (units/hr)\tDuration (min)\tType
2026-03-29 00:00:00\t0.60\t30\tScheduled
2026-03-29 00:30:00\t0.80\t30\tScheduled`;

const CGM_TSV = `Name:Example\tDate Range:2026-03-29 - 2026-03-30
Timestamp\tGlucose Value (mmol/L)\tTrend\tSerial Number
2026-03-29 09:00:00\t6.2\tFlat\tLIBRE-ANONYMISED
2026-03-29 09:05:00\t6.7\tFortyFiveUp\tLIBRE-ANONYMISED`;

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
  it('zeroes and detaches a selected source archive when it is released', () => {
    const bytes = new Uint8Array([9, 8, 7, 6]);
    const released = releasePreparedGlookoImportSource({
      preview: {},
      batch: {},
      sourcePayload: { format: 'zip', bytes, entries: [] },
    } as never);

    expect([...bytes]).toEqual([0, 0, 0, 0]);
    expect(released.sourcePayload).toBeUndefined();
  });

  it('does not zero a source archive when its preview unmounts mid-commit', () => {
    const guard = new GlookoImportSourceCommitGuard();
    const bytes = new Uint8Array([9, 8, 7, 6]);
    const prepared = {
      preview: {},
      batch: {},
      sourcePayload: { format: 'zip', bytes, entries: [] },
    } as never;

    guard.begin(prepared);
    guard.disposePreview(prepared);
    expect([...bytes]).toEqual([9, 8, 7, 6]);

    guard.finish(prepared);
    expect([...bytes]).toEqual([0, 0, 0, 0]);
  });

  it('still zeroes a replaced preview that has no active commit', () => {
    const guard = new GlookoImportSourceCommitGuard();
    const bytes = new Uint8Array([4, 3, 2, 1]);
    const prepared = {
      preview: {},
      batch: {},
      sourcePayload: { format: 'zip', bytes, entries: [] },
    } as never;

    guard.disposePreview(prepared);

    expect([...bytes]).toEqual([0, 0, 0, 0]);
  });

  it('uses pump identity to preserve otherwise identical insulin records', () => {
    const preview = parseGlookoTextFiles(
      [
        {
          name: 'bolus_data_1.csv',
          text: `Name:Example\nTimestamp,Insulin delivered (U),Serial number\n29/03/2026 09:17,4.8,PDM-A\n29/03/2026 09:17,4.8,PDM-B`,
        },
        {
          name: 'basal_data_1.csv',
          text: `Name:Example\nTimestamp,Insulin delivered (U),Duration (min),Serial number\n29/03/2026 09:00,0.4,30,PDM-A\n29/03/2026 09:00,0.4,30,PDM-B`,
        },
        {
          name: 'insulin_data_1.csv',
          text: `Name:Example\nTimestamp,Total basal (U),Total bolus (U),Total insulin (U),Serial number\n29/03/2026 23:58,10,12,22,PDM-A\n29/03/2026 23:58,10,12,22,PDM-B`,
        },
      ],
      IMPORTED_AT,
    );

    expect(preview.boluses).toHaveLength(2);
    expect(preview.basal).toHaveLength(2);
    expect(preview.dailyInsulinTotals).toHaveLength(2);
    for (const records of [
      preview.boluses,
      preview.basal,
      preview.dailyInsulinTotals,
    ]) {
      expect(new Set(records.map((record) => record.id)).size).toBe(2);
      expect(records.every((record) => Boolean(record.legacyId))).toBe(true);
      expect(new Set(records.map((record) => record.legacyId)).size).toBe(1);
    }
  });

  it('migrates pre-device insulin IDs without counting or retaining duplicates', async () => {
    const parsed = parseGlookoTextFiles(
      [
        {
          name: 'bolus_data_1.csv',
          text: `Name:Example\nTimestamp,Insulin delivered (U),Serial number\n29/03/2026 09:17,4.8,PDM-A`,
        },
      ],
      IMPORTED_AT,
    );
    const current = parsed.boluses[0]!;
    const legacy = {
      ...current,
      id: current.legacyId!,
      legacyId: undefined,
    };
    const store = new MemoryHealthRecordStore();
    const batch = (id: string): ImportBatch => ({
      id,
      sourceId: 'glooko-export',
      fileName: `${id}.zip`,
      fileSha256: id,
      importedAt: IMPORTED_AT,
      skippedCount: 0,
      warnings: [],
    });

    await store.writeImport(batch('legacy'), [], [legacy], []);
    const result = await store.writeImport(
      batch('device-aware'),
      [],
      [current],
      [],
    );
    const stored = await store.getBolusDeliveries({
      start: current.timestamp - 1,
      end: current.timestamp + 1,
    });

    expect(result.insertedBoluses).toBe(0);
    expect(stored).toHaveLength(1);
    expect(stored[0]?.id).toBe(current.id);
  });

  it('reports rejected bolus doses separately from accepted carbohydrate context', () => {
    const preview = parseGlookoTextFiles(
      [
        {
          name: 'bolus_data_1.csv',
          text: `Name:Example\nTimestamp,Insulin delivered (U),Carbs input (g)\n29/03/2026 09:17,not-a-dose,45`,
        },
      ],
      IMPORTED_AT,
    );

    expect(preview.boluses).toHaveLength(0);
    expect(preview.context).toHaveLength(1);
    expect(preview.recognisedFiles[0]).toMatchObject({
      kind: 'bolus',
      records: 1,
      skippedRows: 0,
      insulinRecords: 0,
      rejectedInsulinRows: 1,
    });
  });

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

  it('loads CGM files beyond the normal entry limit while importing pump files', async () => {
    const archive = zipSync({
      'private/export/cgm_data_1.csv': strToU8(CGM_TSV),
      'private/export/bolus_data_1.csv': strToU8(BOLUS_TSV),
    });

    const files = await unpackGlookoFiles('glooko.zip', archive);
    const cgm = files.find((file) => file.name === 'cgm_data_1.csv');
    const bolus = files.find((file) => file.name === 'bolus_data_1.csv');

    expect(glookoEntryLimitForName('cgm_data_1.csv')).toBeGreaterThan(
      glookoEntryLimitForName('bolus_data_1.csv'),
    );
    expect(cgm?.bytes).toBeInstanceOf(Uint8Array);
    expect(cgm?.retainedOnly).toBeUndefined();
    expect(bolus?.text).toContain('Bolus Type');
    const preview = parseGlookoTextFiles(files, IMPORTED_AT);
    expect(preview.glucose).toHaveLength(2);
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

  it('retains oversized food while normalising available CGM and insulin', async () => {
    const oversizedFood = new Uint8Array(25 * 1024 * 1024 + 7);
    const archive = zipSync({
      'private/export/food_data_1.csv': oversizedFood,
      'private/export/cgm_data_1.csv': strToU8(CGM_TSV),
      'private/export/bolus_data_1.csv': strToU8(BOLUS_TSV),
    });

    const preview = parseGlookoTextFiles(
      await unpackGlookoFiles('glooko.zip', archive),
      IMPORTED_AT,
    );

    expect(preview.boluses).toHaveLength(2);
    expect(preview.glucose).toHaveLength(2);
    expect(preview.retainedFiles).toEqual([
      {
        name: 'food_data_1.csv',
        // Extraction stops immediately after proving the entry is too large;
        // this is a measured lower bound, not trusted ZIP metadata.
        originalBytes: glookoEntryLimitForName('food_data_1.csv') + 1,
      },
    ]);
    expect(preview.warnings).toContain(
      '1 source file was retained exactly in the encrypted source archive for future processing.',
    );
  });

  it('bounds work after the first forty CSV entries even when files are retained', async () => {
    const entries = Object.fromEntries(
      Array.from({ length: 41 }, (_, index) => [
        `private/export/food_data_${index + 1}.csv`,
        strToU8('Timestamp,Food name\n29/03/2026 09:00,Example'),
      ]),
    );
    const unpacked = await unpackGlookoExport('glooko.zip', zipSync(entries));

    expect(unpacked.entries).toHaveLength(41);
    expect(
      unpacked.entries.filter((entry) => entry.handling === 'loaded'),
    ).toHaveLength(40);
    expect(unpacked.entries[40]).toMatchObject({
      handling: 'retained',
      reason: 'file-limit',
    });
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
    expect(preview.glucose).toHaveLength(1);
    expect(preview.glucose[0]).toMatchObject({
      mmolL: 6.2,
      sourceId: GLOOKO_CGM_SOURCE_ID,
      sourceFile: 'cgm_data_1.csv',
      sourceRow: 2,
    });
    expect(preview.recognisedFiles).toHaveLength(3);
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

  it('keeps exact Omnipod bolus inputs and scheduled-basal provenance', () => {
    const preview = parseGlookoTextFiles(
      [
        {
          name: 'bolus_data_1.csv',
          text: `Timestamp,Insulin type,Blood glucose input (mmol/L),Carbs input (g),Carbs ratio,Insulin delivered (U),Initial delivery (U),Extended delivery (U),Serial number
2026-07-01 18:45:00,Normal,7.2,62,10,5.4,5.4,0,PDM-ANONYMISED`,
        },
        {
          name: 'basal_data_1.csv',
          text: `Timestamp,Insulin type,Duration (minutes),Percentage (%),Rate,Insulin delivered (U),Serial number
2026-07-01 00:00:00,Scheduled,30,,0.6,,PDM-ANONYMISED`,
        },
      ],
      IMPORTED_AT,
    );

    expect(preview.boluses[0]).toMatchObject({
      deliveryType: 'Normal',
      bloodGlucoseInputMmolL: 7.2,
      carbsInputGrams: 62,
      carbRatioGramsPerUnit: 10,
      initialUnits: 5.4,
      extendedUnits: 0,
      sourceDeviceId: 'PDM-ANONYMISED',
    });
    expect(preview.basal[0]).toMatchObject({
      deliveryType: 'Scheduled',
      rateUnitsPerHour: 0.6,
      unitsEstimated: true,
      sourceDeviceId: 'PDM-ANONYMISED',
    });
    expect(preview.rawRecords).toHaveLength(2);
    expect(JSON.parse(preview.rawRecords[0]!.payloadJson)).toHaveProperty(
      'headers',
    );
  });

  it('keeps exact automated basal units when Glooko leaves rate blank', () => {
    const preview = parseGlookoTextFiles(
      [
        {
          name: 'basal_data_automated.csv',
          text: `Timestamp,Insulin type,Duration (minutes),Rate,Insulin delivered (U),Serial number
2026-07-01 00:00:00,Automated,5,,0.075,PDM-ANONYMISED
2026-07-01 00:05:00,Automated pause,5,,0,PDM-ANONYMISED`,
        },
      ],
      IMPORTED_AT,
    );

    expect(preview.basal).toHaveLength(2);
    expect(preview.basal[0]).toMatchObject({
      deliveryType: 'Automated',
      units: 0.075,
      unitsEstimated: false,
      sourceRow: 2,
    });
    expect(preview.basal[0]?.rateUnitsPerHour).toBeCloseTo(0.9);
    expect(preview.basal[1]).toMatchObject({
      deliveryType: 'Automated pause',
      units: 0,
      rateUnitsPerHour: 0,
      unitsEstimated: false,
      sourceRow: 3,
    });
    expect(preview.recognisedFiles[0]?.skippedRows).toBe(0);
  });

  it('normalises Glooko pump alarms while retaining every exact field', async () => {
    const alarmCsv = `Timestamp,Alarm/Event,Serial number
2026-07-01 10:00:00,Insulin Delivery Suspended,PDM-ANONYMISED
2026-07-01 10:15:00,Insulin Delivery Suspension Ended,PDM-ANONYMISED`;
    const files = await unpackGlookoFiles(
      'glooko.zip',
      zipSync({ 'private/export/alarms_data_1.csv': strToU8(alarmCsv) }),
    );
    const preview = parseGlookoTextFiles(files, IMPORTED_AT);

    expect(files[0]?.retainedOnly).toBeUndefined();
    expect(preview.context).toHaveLength(2);
    expect(preview.context[0]).toMatchObject({
      kind: 'note',
      category: 'pump',
      title: 'Insulin Delivery Suspended',
    });
    expect(preview.rawRecords).toHaveLength(2);
    expect(preview.recognisedFiles[0]).toMatchObject({
      kind: 'alarm',
      records: 2,
    });
  });

  it('normalises exported Glooko notes as encrypted factual context', () => {
    const preview = parseGlookoTextFiles(
      [
        {
          name: 'notes_data_1.csv',
          text: `Name:Example,Date Range:2026-07-01 - 2026-07-02
Timestamp,Notes
2026-07-01 21:15:00,"Changed pod site, absorption seemed unusual"`,
        },
      ],
      IMPORTED_AT,
    );

    expect(preview.context).toHaveLength(1);
    expect(preview.context[0]).toMatchObject({
      kind: 'note',
      category: 'other',
      title: 'Changed pod site, absorption seemed unusual',
      detail: 'Changed pod site, absorption seemed unusual',
      origin: 'imported',
      sourceFile: 'notes_data_1.csv',
      sourceRow: 3,
    });
    expect(preview.recognisedFiles).toEqual([
      {
        name: 'notes_data_1.csv',
        kind: 'note',
        records: 1,
        skippedRows: 0,
      },
    ]);
  });

  it('keeps manual blood-glucose checks distinct from the CGM trace', () => {
    const preview = parseGlookoTextFiles(
      [
        {
          name: 'bg_data_1.csv',
          text: `Timestamp,Glucose Value (mmol/L),Manual reading,Serial number
2026-07-01 21:15:00,5.8,Yes,METER-ANONYMISED`,
        },
      ],
      IMPORTED_AT,
    );

    expect(preview.glucose).toHaveLength(0);
    expect(preview.context).toEqual([
      expect.objectContaining({
        kind: 'note',
        title: 'Blood glucose check · 5.8 mmol/L',
        detail: 'Manual reading: Yes · Source device recorded by Glooko',
      }),
    ]);
    expect(preview.rawRecords[0]?.recordKind).toBe('blood-glucose');
  });

  it('represents manually logged insulin as medication context, not pump delivery', () => {
    const preview = parseGlookoTextFiles(
      [
        {
          name: 'manual_insulin_data_1.csv',
          text: `Timestamp,Name,Value,Insulin type
2026-07-01 21:15:00,Injected insulin,4.5,Rapid acting`,
        },
      ],
      IMPORTED_AT,
    );

    expect(preview.boluses).toHaveLength(0);
    expect(preview.context).toEqual([
      expect.objectContaining({
        kind: 'medication',
        title: 'Injected insulin',
        amount: 4.5,
        unit: 'U',
        medicationType: 'Rapid acting',
      }),
    ]);
    expect(preview.rawRecords[0]?.recordKind).toBe('manual-insulin');
  });

  it('keeps Glooko food nutrition and serving fields available for analysis', () => {
    const preview = parseGlookoTextFiles(
      [
        {
          name: 'food_data_1.csv',
          text: `Timestamp,Name,Carbs (g),Fat,Protein,Calories,Serving quantity,Number of servings
2026-07-01 12:30:00,Pasta bowl,64,18,24,620,350,1`,
        },
      ],
      IMPORTED_AT,
    );

    expect(preview.context[0]).toMatchObject({
      kind: 'meal',
      title: 'Pasta bowl',
      carbsGrams: 64,
      fatGrams: 18,
      proteinGrams: 24,
      energyKcal: 620,
      servingQuantity: 350,
      servingCount: 1,
    });
    expect(preview.rawRecords).toHaveLength(1);
  });

  it('converts mg/dL CGM rows and retains exact row provenance', () => {
    const preview = parseGlookoTextFiles(
      [
        {
          name: 'cgm_data_1.csv',
          text: `Name:Example,Date Range:2026-07-01 - 2026-07-02
Timestamp,Glucose Value (mg/dL),Direction,Device Serial Number
2026-07-01 18:45:00,126,SingleUp,ANONYMISED
2026-07-01 18:50:00,not-a-reading,Flat,ANONYMISED`,
        },
      ],
      IMPORTED_AT,
    );

    expect(preview.glucose).toHaveLength(1);
    expect(preview.glucose[0]).toMatchObject({
      mmolL: 6.99,
      trend: 'up',
      sourceId: GLOOKO_CGM_SOURCE_ID,
      sourceFile: 'cgm_data_1.csv',
      sourceRow: 3,
      sourceDeviceId: 'ANONYMISED',
      importedAt: IMPORTED_AT,
    });
    expect(preview.skippedRows).toBe(1);
  });

  it('deduplicates overlapping CGM exports by source timestamp', () => {
    const preview = parseGlookoTextFiles(
      [
        { name: 'cgm_data_1.csv', text: CGM_TSV },
        { name: 'cgm_data_2.csv', text: CGM_TSV },
      ],
      IMPORTED_AT,
    );

    expect(preview.glucose).toHaveLength(2);
    expect(preview.duplicateRows).toBe(2);
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
    expect(preview.dailyInsulinTotals).toEqual([
      expect.objectContaining({
        dateKey: '2026-07-01',
        basalUnits: 22.4,
        bolusUnits: 18.2,
        totalUnits: 40.6,
        sourceFile: 'insulin_data_1.csv',
        sourceRow: 2,
      }),
    ]);
    expect(preview.recognisedFiles[0]).toMatchObject({
      name: 'insulin_data_1.csv',
      kind: 'daily-insulin',
      records: 1,
    });
  });

  it('prioritises aggregate headers over bolus-like columns for renamed files', () => {
    const preview = parseGlookoTextFiles(
      [
        {
          name: 'renamed_export.csv',
          text: `Timestamp,Total Bolus (U),Total Basal (U),Total Insulin (U)
2026-07-01 23:59:00,18.2,22.4,40.6`,
        },
      ],
      IMPORTED_AT,
    );

    expect(preview.boluses).toHaveLength(0);
    expect(preview.dailyInsulinTotals).toHaveLength(1);
    expect(preview.recognisedFiles[0]?.kind).toBe('daily-insulin');
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
    expect(parseGlookoTimestamp('29/03/2026 01:30:00')).toBeUndefined();
    expect(parseGlookoTimestamp('25/10/2026 01:30:00')).toBeUndefined();
    expect(parseGlookoTimestamp('2026-10-25T01:30:00+01:00')).toBe(
      Date.parse('2026-10-25T00:30:00Z'),
    );
    expect(parseGlookoTimestamp('2026-10-25T01:30:00+00:00')).toBe(
      Date.parse('2026-10-25T01:30:00Z'),
    );
  });

  it('fails closed on a nonexistent spring Europe/London local time', () => {
    const preview = parseGlookoTextFiles(
      [
        {
          name: 'bolus_data_1.csv',
          text: `Timestamp,Insulin delivered (U)
29/03/2026 00:55:00,1.0
29/03/2026 01:30:00,1.1
29/03/2026 02:05:00,1.2`,
        },
      ],
      IMPORTED_AT,
    );

    expect(preview.unsafeTimestampLocale).toBe(true);
    expect(preview.boluses).toHaveLength(0);
    expect(preview.rawRecords).toHaveLength(0);
    expect(preview.recognisedFiles[0]).toMatchObject({
      kind: 'bolus',
      records: 0,
      skippedRows: 3,
      rejectedInsulinRows: 3,
    });
    expect(preview.warnings).toContain(
      'bolus_data_1.csv: a Europe/London local time was skipped by the spring clock change; the file was not normalised.',
    );
  });

  it('fails closed on a nonexistent spring time in streaming CGM data', () => {
    const preview = parseGlookoTextFiles(
      [
        {
          name: 'cgm_data_1.csv',
          text: `Timestamp,Glucose Value (mmol/L),Serial number
29/03/2026 00:55:00,6.0,SN-1
29/03/2026 01:30:00,6.1,SN-1
29/03/2026 02:05:00,6.2,SN-1`,
        },
      ],
      IMPORTED_AT,
    );

    expect(preview.unsafeTimestampLocale).toBe(true);
    expect(preview.glucose).toHaveLength(0);
    expect(preview.rawRecords).toHaveLength(0);
    expect(preview.recognisedFiles[0]).toMatchObject({
      kind: 'cgm',
      records: 0,
      skippedRows: 3,
    });
  });

  it('retains both autumn folds when ordered rows uniquely show the rollback', () => {
    const preview = parseGlookoTextFiles(
      [
        {
          name: 'bolus_data_1.csv',
          text: `Timestamp,Insulin delivered (U),Serial number
25/10/2026 00:55:00,0.9,SN-1
25/10/2026 01:00:00,1.0,SN-1
25/10/2026 01:05:00,1.1,SN-1
25/10/2026 01:55:00,1.2,SN-1
25/10/2026 01:00:00,1.0,SN-1
25/10/2026 01:05:00,1.1,SN-1
25/10/2026 02:05:00,1.3,SN-1`,
        },
      ],
      IMPORTED_AT,
    );

    expect(preview.unsafeTimestampLocale).toBe(false);
    expect(preview.boluses).toHaveLength(7);
    expect(preview.boluses.map((record) => record.timestamp)).toEqual([
      Date.parse('2026-10-24T23:55:00Z'),
      Date.parse('2026-10-25T00:00:00Z'),
      Date.parse('2026-10-25T00:05:00Z'),
      Date.parse('2026-10-25T00:55:00Z'),
      Date.parse('2026-10-25T01:00:00Z'),
      Date.parse('2026-10-25T01:05:00Z'),
      Date.parse('2026-10-25T02:05:00Z'),
    ]);
    expect(new Set(preview.boluses.map((record) => record.id)).size).toBe(7);
    expect(preview.rawRecords).toHaveLength(7);
    expect(new Set(preview.rawRecords.map((record) => record.id)).size).toBe(7);
    expect(preview.duplicateRows).toBe(0);
  });

  it('retains both autumn folds in ordered streaming CGM rows', () => {
    const preview = parseGlookoTextFiles(
      [
        {
          name: 'cgm_data_1.csv',
          text: `Timestamp,Glucose Value (mmol/L),Serial number
25/10/2026 00:55:00,6.0,SN-1
25/10/2026 01:00:00,6.1,SN-1
25/10/2026 01:05:00,6.2,SN-1
25/10/2026 01:55:00,6.3,SN-1
25/10/2026 01:00:00,6.1,SN-1
25/10/2026 01:05:00,6.2,SN-1
25/10/2026 02:05:00,6.6,SN-1`,
        },
      ],
      IMPORTED_AT,
    );

    expect(preview.unsafeTimestampLocale).toBe(false);
    expect(preview.glucose).toHaveLength(7);
    expect(preview.glucose[1]?.timestamp).toBe(
      Date.parse('2026-10-25T00:00:00Z'),
    );
    expect(preview.glucose[4]?.timestamp).toBe(
      Date.parse('2026-10-25T01:00:00Z'),
    );
    expect(new Set(preview.glucose.map((record) => record.id)).size).toBe(7);
    expect(preview.rawRecords).toHaveLength(7);
    expect(new Set(preview.rawRecords.map((record) => record.id)).size).toBe(7);
    expect(preview.rawRecords.map((record) => record.timestamp)).toEqual(
      preview.glucose.map((record) => record.timestamp),
    );
  });

  it('fails closed when autumn row order cannot identify the fold', () => {
    const preview = parseGlookoTextFiles(
      [
        {
          name: 'bolus_data_1.csv',
          text: `Timestamp,Insulin delivered (U)
25/10/2026 00:55:00,1.0
25/10/2026 01:30:00,1.1
25/10/2026 02:05:00,1.2`,
        },
      ],
      IMPORTED_AT,
    );

    expect(preview.unsafeTimestampLocale).toBe(true);
    expect(preview.boluses).toHaveLength(0);
    expect(preview.rawRecords).toHaveLength(0);
    expect(preview.warnings).toContain(
      'bolus_data_1.csv: a repeated autumn Europe/London hour could not be uniquely disambiguated from source row order; the file was not normalised.',
    );
  });

  it('rejects impossible and detectably month-first calendar dates', () => {
    expect(parseGlookoTimestamp('31/02/2026 12:00:00')).toBeUndefined();
    expect(parseGlookoTimestamp('08/13/2026 12:00:00')).toBeUndefined();
  });

  it('rejects an entire file when any row proves it is month-first', () => {
    const preview = parseGlookoTextFiles(
      [
        {
          name: 'bolus_data_1.csv',
          text: `Timestamp,Insulin delivered (U)
08/10/2026 12:00:00,1.5
08/13/2026 12:00:00,2.0`,
        },
      ],
      IMPORTED_AT,
    );

    expect(preview.boluses).toHaveLength(0);
    expect(preview.rawRecords).toHaveLength(0);
    expect(preview.recognisedFiles[0]).toMatchObject({
      records: 0,
      skippedRows: 2,
    });
    expect(preview.warnings).toContain(
      'bolus_data_1.csv: month/day/year timestamps are not supported; the file was not normalised.',
    );
  });

  it('marks a mixed archive unsafe even when a UK-format sibling parses', () => {
    const preview = parseGlookoTextFiles(
      [
        {
          name: 'bolus_data_uk.csv',
          text: `Timestamp,Insulin delivered (U)
13/08/2026 12:00:00,1.5`,
        },
        {
          name: 'cgm_data_month_first.csv',
          text: `Timestamp,Glucose Value (mmol/L)
08/13/2026 13:00:00,6.2`,
        },
      ],
      IMPORTED_AT,
    );

    expect(preview.boluses).toHaveLength(1);
    expect(preview.unsafeTimestampLocale).toBe(true);
    expect(preview.recognisedFiles).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'bolus_data_uk.csv', records: 1 }),
        expect.objectContaining({
          name: 'cgm_data_month_first.csv',
          kind: 'cgm',
          records: 0,
          skippedRows: 1,
        }),
      ]),
    );
  });

  it('parses quoted delimiters without splitting note text', () => {
    expect(
      parseDelimitedText(
        'Timestamp,Dose (units),Notes\n2026-07-01 12:00:00,2.4,"Lunch, away from home"',
      )[1],
    ).toEqual(['2026-07-01 12:00:00', '2.4', 'Lunch, away from home']);
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
      undefined,
      preview.rawRecords,
    );
    const second = await store.writeImport(
      batch,
      preview.basal,
      preview.boluses,
      preview.context,
      sourcePayload,
      undefined,
      preview.rawRecords,
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
    expect(await store.getRawSourceRecords('glooko-export')).toHaveLength(4);
    const raw = await store.getRawSourceRecords('glooko-export');
    expect(await store.getRawSourceRecordsByIds([raw[0]!.id])).toEqual([
      raw[0],
    ]);
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

  it('summarises retained source snapshots without reading their health bytes', async () => {
    const store = new MemoryHealthRecordStore();
    await store.writeImport(
      {
        id: 'glooko-export:summary-1',
        sourceId: 'glooko-export',
        fileName: 'first.zip',
        fileSha256: 'summary-1',
        importedAt: IMPORTED_AT,
        dataStart: IMPORTED_AT - 30 * 24 * 60 * 60 * 1000,
        dataThrough: IMPORTED_AT - 60_000,
        skippedCount: 0,
        warnings: [],
      },
      [],
      [],
      [],
      {
        format: 'zip',
        bytes: new Uint8Array(4),
        entries: [
          { name: 'bolus.csv', handling: 'loaded' },
          { name: 'food.csv', handling: 'retained' },
        ],
      },
    );
    await store.writeImport(
      {
        id: 'glooko-export:summary-2',
        sourceId: 'glooko-export',
        fileName: 'second.zip',
        fileSha256: 'summary-2',
        importedAt: IMPORTED_AT + 24 * 60 * 60 * 1000,
        dataStart: IMPORTED_AT - 29 * 24 * 60 * 60 * 1000,
        dataThrough: IMPORTED_AT + 23 * 60 * 60 * 1000,
        skippedCount: 0,
        warnings: [],
      },
      [],
      [],
      [],
      {
        format: 'zip',
        bytes: new Uint8Array(6),
        entries: [{ name: 'basal.csv', handling: 'loaded' }],
      },
    );

    expect(await store.getImportSourceSummary('glooko-export')).toEqual({
      archiveCount: 2,
      totalBytes: 10,
      earliestStoredAt: IMPORTED_AT,
      latestStoredAt: IMPORTED_AT + 24 * 60 * 60 * 1000,
      dataStart: IMPORTED_AT - 30 * 24 * 60 * 60 * 1000,
      dataThrough: IMPORTED_AT + 23 * 60 * 60 * 1000,
      loadedEntryCount: 2,
      retainedEntryCount: 1,
      indexedRecordCount: 0,
    });
    expect(
      await store.getImportSourcePayloadReferences('glooko-export'),
    ).toEqual([
      {
        batchId: 'glooko-export:summary-1',
        storedAt: IMPORTED_AT,
      },
      {
        batchId: 'glooko-export:summary-2',
        storedAt: IMPORTED_AT + 24 * 60 * 60 * 1000,
      },
    ]);
    const firstPayload = await store.getImportSourcePayload(
      'glooko-export:summary-1',
    );
    expect(firstPayload?.batch.fileName).toBe('first.zip');
    expect(firstPayload?.payload.bytes).toEqual(new Uint8Array(4));
    firstPayload?.payload.bytes.fill(9);
    expect(
      (await store.getImportSourcePayload('glooko-export:summary-1'))?.payload
        .bytes,
    ).toEqual(new Uint8Array(4));
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
      (await store.getLatestImportSourcePayload('glooko-export'))?.payload
        .bytes,
    ).toEqual(sourceBytes);
  });

  it('replaces an estimated basal with the corrected row from the same retained archive', async () => {
    const store = new MemoryHealthRecordStore();
    const start = Date.parse('2026-08-06T00:00:00+01:00');
    const end = start + 60 * 60 * 1000;
    const batch: ImportBatch = {
      id: 'glooko-export:corrected-basal',
      sourceId: 'glooko-export',
      fileName: 'export.zip',
      fileSha256: 'corrected-basal',
      importedAt: IMPORTED_AT,
      skippedCount: 0,
      warnings: [],
    };
    const provenance = {
      sourceId: 'glooko-export',
      sourceFile: 'basal_data_1.csv',
      sourceRow: 2,
      sourceDeviceId: 'PDM-ANONYMISED',
      start,
      end,
      rateUnitsPerHour: 1,
    };
    await store.writeImport(
      batch,
      [
        {
          ...provenance,
          id: 'estimated-old-id',
          units: 1,
          unitsEstimated: true,
        },
        {
          ...provenance,
          id: 'unrelated-row',
          sourceRow: 3,
          units: 0.2,
          unitsEstimated: true,
        },
      ],
      [],
      [],
      {
        format: 'zip',
        bytes: new Uint8Array([0x50, 0x4b, 0x03, 0x04]),
        entries: [{ name: 'basal_data_1.csv', handling: 'loaded' }],
      },
    );

    const reprocessed = await store.writeImport(
      batch,
      [
        {
          ...provenance,
          id: 'exact-corrected-id',
          units: 0.8,
          unitsEstimated: false,
        },
      ],
      [],
      [],
    );
    const basal = await store.getBasalDeliveries({ start, end });

    expect(basal.map((delivery) => delivery.id).sort()).toEqual([
      'exact-corrected-id',
      'unrelated-row',
    ]);
    expect(reprocessed.batch.basalCount).toBe(2);
    expect(calculateInsulinStats(basal, [], { start, end })).toMatchObject({
      basalUnits: 1,
      totalUnits: 1,
    });
  });

  it('loads a source daily total by its date during a partial-day query', async () => {
    const store = new MemoryHealthRecordStore();
    const timestamp = Date.parse('2026-08-06T23:59:00+01:00');
    await store.writeImport(
      {
        id: 'glooko-export:daily-total-date-query',
        sourceId: 'glooko-export',
        fileName: 'export.zip',
        fileSha256: 'daily-total-date-query',
        importedAt: Date.parse('2026-08-07T08:00:00+01:00'),
        skippedCount: 0,
        warnings: [],
      },
      [],
      [],
      [],
      undefined,
      [
        {
          id: 'daily-total:2026-08-06',
          sourceId: 'glooko-export',
          timestamp,
          dateKey: '2026-08-06',
          basalUnits: 16.8,
          bolusUnits: 23.2,
          totalUnits: 40,
        },
      ],
    );

    const totals = await store.getDailyInsulinTotals({
      start: Date.parse('2026-08-06T00:00:00+01:00'),
      end: Date.parse('2026-08-06T12:00:00+01:00'),
    });

    expect(totals.map((total) => total.id)).toEqual(['daily-total:2026-08-06']);
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
    expect(await store.deleteManualContext('daymark-manual:meal:1')).toBe(
      false,
    );
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
      glucose: 0,
      basal: 2,
      boluses: 2,
      context: 1,
      dailyTotals: 0,
      batches: 1,
    });
    expect((await store.getInsulinBounds()).count).toBe(0);
    expect((await store.getContextBounds()).count).toBe(1);
  });
});
