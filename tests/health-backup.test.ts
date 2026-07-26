import { describe, expect, it, vi } from 'vitest';

vi.mock('expo-file-system', () => ({
  File: class {},
  FileMode: { Truncate: 'wt' },
  Paths: { cache: 'file:///cache' },
}));
vi.mock('expo-crypto', () => ({}));
vi.mock('expo-secure-store', () => ({}));
vi.mock('expo-sqlite', () => ({}));

import {
  HEALTH_BACKUP_FORMAT,
  HEALTH_BACKUP_VERSION,
  validateHealthBackupDocument,
} from '@/data/backup/healthBackup';

const tableNames = [
  'glucose_readings',
  'source_sync_state',
  'insulin_basal',
  'insulin_bolus',
  'context_events',
  'health_connect_records',
  'health_connect_sources',
  'health_connect_preferences',
  'health_connect_sync_state',
  'food_catalog_cache',
  'food_logs',
  'food_log_items',
  'import_batches',
] as const;

function emptyBackup(): {
  manifest: Record<string, any> & {
    counts: Record<string, number>;
    totalRecords: number;
  };
  tables: Record<string, Array<Record<string, any>>>;
} {
  return {
    manifest: {
      format: HEALTH_BACKUP_FORMAT,
      version: HEALTH_BACKUP_VERSION,
      createdAt: Date.now() - 1_000,
      timeZone: 'Europe/London',
      counts: Object.fromEntries(tableNames.map((name) => [name, 0])),
      totalRecords: 0,
      excludes: ['credentials', 'session tokens', 'Glooko web cookies'],
    },
    tables: Object.fromEntries(tableNames.map((name) => [name, []])),
  };
}

describe('health backup validation', () => {
  it('accepts a complete empty backup', () => {
    const parsed = validateHealthBackupDocument(emptyBackup());
    expect(parsed.manifest.totalRecords).toBe(0);
    expect(parsed.manifest.timeZone).toBe('Europe/London');
  });

  it('accepts a normalised glucose row with provenance timestamps', () => {
    const backup = emptyBackup();
    backup.tables.glucose_readings!.push({
      id: 'libre:1720000000000',
      source_id: 'daymark-librelinkup',
      timestamp_ms: 1_720_000_000_000,
      received_at_ms: 1_720_000_010_000,
      mmol_l: 6.4,
      trend: 'steady',
      quality: 'measured',
      source_factory_timestamp: '2024-07-03T09:46:40Z',
      source_local_timestamp: null,
      timestamp_discrepancy_minutes: null,
    });
    backup.manifest.counts.glucose_readings = 1;
    backup.manifest.totalRecords = 1;

    const parsed = validateHealthBackupDocument(backup);
    expect(parsed.tables.glucose_readings[0]?.mmol_l).toBe(6.4);
  });

  it('rejects a manifest whose counts do not match its rows', () => {
    const backup = emptyBackup();
    backup.manifest.counts.insulin_bolus = 1;
    expect(() => validateHealthBackupDocument(backup)).toThrow(
      /record count does not match/i,
    );
  });

  it('rejects unknown row fields rather than passing them into SQL', () => {
    const backup = emptyBackup();
    backup.tables.insulin_bolus!.push({
      id: 'bolus:1',
      source_id: 'glooko-export',
      timestamp_ms: 1_720_000_000_000,
      units: 2.5,
      imported_at_ms: 1_720_000_100_000,
      source_file: 'Bolus.csv',
      source_row: 4,
      injected_column: 'DROP TABLE glucose_readings',
    });
    backup.manifest.counts.insulin_bolus = 1;
    backup.manifest.totalRecords = 1;

    expect(() => validateHealthBackupDocument(backup)).toThrow(
      /unsupported shape/i,
    );
  });

  it('rejects a different timezone contract', () => {
    const backup = emptyBackup();
    backup.manifest.timeZone = 'America/New_York';
    expect(() => validateHealthBackupDocument(backup)).toThrow(
      /Europe\/London/i,
    );
  });
});
