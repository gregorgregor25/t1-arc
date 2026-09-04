import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it, vi } from 'vitest';

import {
  DEXCOM_CGM_SOURCE_ID,
  parseDexcomClarityCsv,
} from '@/data/import/dexcomClarityCsv';
import {
  dexcomClarityImportSettingsFromRegionalDefaults,
  prepareDexcomClarityImport,
} from '@/data/import/dexcomClarityImport';
import {
  clearDexcomGlucoseHistory,
  writeDexcomGlucoseHistory,
} from '@/data/import/dexcomGlucoseImport';
import { MemoryGlucoseHistoryStore } from '@/data/persistence/GlucoseHistoryStore';
import { DEFAULT_REGIONAL_PROFILE } from '@/domain/regionalProfile';
import {
  getRuntimeRegionalProfile,
  setRuntimeRegionalProfile,
} from '@/domain/regionalProfileRuntime';

vi.mock('expo-crypto', () => ({
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  digest: async () => new Uint8Array(32).buffer,
}));

const dexcomClarityCardSource = readFileSync(
  fileURLToPath(
    new URL('../src/components/DexcomClarityImportCard.tsx', import.meta.url),
  ),
  'utf8',
);

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

  it.each([
    'Timestamp,Event Type,Glucose Value',
    'Timestamp,Event Type,Valeur de glucose',
    'Timestamp,Event Type,Glukosewert',
  ])('rejects an ambiguous unitless glucose header: %s', (header) => {
    expect(() =>
      parseDexcomClarityCsv(
        [header, '2026-07-27T09:00:00,EGV,20'].join('\n'),
      ),
    ).toThrow(/does not declare mg\/dL or mmol\/L/);
  });

  it('does not guess the unit of an unlabelled rate column', () => {
    const preview = parseDexcomClarityCsv(
      [
        'Timestamp,Event Type,Glucose Value (mg/dL),Glucose Rate of Change',
        '2026-07-27T09:00:00,EGV,108,3',
      ].join('\n'),
    );

    expect(preview.glucose[0]?.trend).toBe('unknown');
    expect(preview.warnings).toContain(
      'The glucose rate column did not declare mg/dL/min or mmol/L/min, so rate-derived trend arrows were not used.',
    );
  });

  it('parses a localized US export with an explicit account date order and zone', () => {
    const preview = parseDexcomClarityCsv(
      [
        'Horodatage;Type d’événement;Valeur de glucose (mg/dL)',
        '07/27/2026 09:00:00;Glucose estimé;108',
        '07/27/2026 09:05:00;Étalonnage;120',
      ].join('\n'),
      'clarity-fr-us.csv',
      1_800_000_000_000,
      { timeZone: 'America/New_York', dateOrder: 'month-first' },
    );

    expect(preview.glucose).toHaveLength(1);
    expect(preview.glucose[0]).toMatchObject({
      timestamp: Date.UTC(2026, 6, 27, 13),
      mmolL: 5.99,
    });
    expect(preview.regionalSettings).toEqual({
      timeZone: 'America/New_York',
      dateOrder: 'month-first',
    });
  });

  it('prepares with explicit export settings independently of the current profile', async () => {
    const originalProfile = getRuntimeRegionalProfile();
    setRuntimeRegionalProfile({
      ...DEFAULT_REGIONAL_PROFILE,
      region: 'us',
      countryCode: 'US',
      languageTag: 'en-US',
      analysisTimeZone: 'America/Los_Angeles',
      followDeviceTimeZone: false,
    });

    try {
      expect(
        dexcomClarityImportSettingsFromRegionalDefaults({
          dexcomRegion: 'us',
          timeZone: 'America/Los_Angeles',
        }),
      ).toEqual({
        dateOrder: 'month-first',
        timeZone: 'America/Los_Angeles',
      });

      const bytes = new TextEncoder().encode(
        [
          'Timestamp,Event Type,Glucose Value (mg/dL)',
          '07/08/2026 09:00:00,EGV,108',
        ].join('\n'),
      );
      const prepared = await prepareDexcomClarityImport(
        'clarity-explicit.csv',
        bytes,
        1_800_000_000_000,
        { dateOrder: 'day-first', timeZone: 'Asia/Tokyo' },
      );

      expect(prepared.preview.regionalSettings).toEqual({
        dateOrder: 'day-first',
        timeZone: 'Asia/Tokyo',
      });
      expect(prepared.preview.glucose[0]?.timestamp).toBe(
        Date.UTC(2026, 7, 7, 0),
      );
    } finally {
      setRuntimeRegionalProfile(originalProfile);
    }
  });

  it('passes the card selections into preparation and exposes accessible controls', () => {
    expect(dexcomClarityCardSource).toContain(
      'accessibilityLabel="Dexcom Clarity export date order"',
    );
    expect(dexcomClarityCardSource).toContain(
      'accessibilityLabel="Dexcom Clarity export time zone"',
    );
    expect(dexcomClarityCardSource).toMatch(
      /prepareDexcomClarityImport\(\s*asset\.name,\s*bytes,\s*undefined,\s*selectedImportSettings,?\s*\)/,
    );
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
