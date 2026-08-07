import { describe, expect, it } from 'vitest';

import {
  DEXCOM_CGM_SOURCE_ID,
  parseDexcomClarityCsv,
} from '@/data/import/dexcomClarityCsv';
import {
  clearDexcomGlucoseHistory,
  writeDexcomGlucoseHistory,
} from '@/data/import/dexcomGlucoseImport';
import { MemoryGlucoseHistoryStore } from '@/data/persistence/GlucoseHistoryStore';

describe('Dexcom Clarity CSV import', () => {
  it('normalises Clarity EGV rows while retaining row provenance', () => {
    const preview = parseDexcomClarityCsv(
      [
        'Index,Timestamp (YYYY-MM-DDThh:mm:ss),Event Type,Event Subtype,Patient Info,Device Info,Source Device ID,Glucose Value (mg/dL),Insulin Value (u),Carb Value (grams),Duration (hh:mm:ss),Glucose Rate of Change (mg/dL/min),Transmitter Time (Long Integer),Transmitter ID',
        '1,2026-07-27T09:00:00,EGV,,,,watch-1,108,,,,0.5,,',
        '2,2026-07-27T09:05:00,Calibration,,,,watch-1,110,,,,,,',
        '3,2026-07-27T09:05:00,EGV,,,,watch-1,126,,,,2.4,,',
      ].join('\n'),
      'clarity-export.csv',
      1_800_000_000_000,
    );

    expect(preview.glucose).toHaveLength(2);
    expect(preview.glucose[0]).toMatchObject({
      mmolL: 5.99,
      trend: 'flat',
      sourceId: DEXCOM_CGM_SOURCE_ID,
      sourceFile: 'clarity-export.csv',
      sourceRow: 2,
      sourceDeviceId: 'watch-1',
      importedAt: 1_800_000_000_000,
    });
    expect(preview.glucose[1]).toMatchObject({
      mmolL: 6.99,
      trend: 'up',
      sourceRow: 4,
    });
    expect(preview.skippedRows).toBe(0);
  });

  it('finds a later header and reads mmol/L exports with semicolon delimiters', () => {
    const preview = parseDexcomClarityCsv(
      [
        'Dexcom Clarity raw data export',
        'Created;2026-07-28',
        'Index;Timestamp (YYYY-MM-DDThh:mm:ss);Event Type;Glucose Value (mmol/L);Glucose Rate of Change (mmol/L/min);Trend',
        '1;2026-07-27T10:00:00;EGV;6,4;0,08;FortyFiveUp',
      ].join('\n'),
    );

    expect(preview.glucose).toHaveLength(1);
    expect(preview.glucose[0]).toMatchObject({
      mmolL: 6.4,
      trend: 'slightUp',
      sourceRow: 4,
    });
  });

  it('deduplicates repeated timestamps and reports unreadable glucose rows', () => {
    const preview = parseDexcomClarityCsv(
      [
        'Timestamp,Event Type,Glucose Value (mg/dL)',
        '2026-07-27T09:00:00,EGV,100',
        '2026-07-27T09:00:00,EGV,110',
        '2026-07-27T09:05:00,EGV,not available',
      ].join('\n'),
    );

    expect(preview.glucose).toHaveLength(1);
    expect(preview.glucose[0]?.mmolL).toBe(6.11);
    expect(preview.duplicateRows).toBe(1);
    expect(preview.skippedRows).toBe(1);
    expect(preview.warnings).toHaveLength(2);
  });

  it('writes idempotent history and clears only the Dexcom source', async () => {
    const store = new MemoryGlucoseHistoryStore();
    const preview = parseDexcomClarityCsv(
      [
        'Timestamp,Event Type,Glucose Value (mg/dL)',
        '2026-07-27T09:00:00,EGV,108',
        '2026-07-27T09:05:00,EGV,126',
      ].join('\n'),
    );

    expect(await writeDexcomGlucoseHistory(store, preview.glucose)).toBe(2);
    expect(await writeDexcomGlucoseHistory(store, preview.glucose)).toBe(0);
    expect(await clearDexcomGlucoseHistory(store)).toBe(2);
    expect(await store.getBounds(DEXCOM_CGM_SOURCE_ID)).toEqual({ count: 0 });
  });

  it('rejects unrelated CSV files', () => {
    expect(() =>
      parseDexcomClarityCsv('name,carbs\nApple,20'),
    ).toThrow(/does not look like a Dexcom Clarity CSV/);
  });
});
