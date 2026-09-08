import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

import {
  assertHealthBackupSchemaCoverage,
  BACKUP_TABLE_NAMES,
  backupBase64ToBytes,
  backupRestoreBinding,
  bytesToBackupBase64,
  decodeBackupFrameHeader,
  encodeBackupFrameHeader,
  encodeHealthBackupFingerprintRow,
  HEALTH_BACKUP_FORMAT,
  HEALTH_BACKUP_VERSION,
  isHealthBackupTableExported,
  validateCurrentContainerManifest,
  validateHealthBackupDocument,
} from '@/data/backup/healthBackup';
import { DEFAULT_GLUCOSE_APPEARANCE } from '@/domain/glucoseAppearance';
import { PORTABLE_PREFERENCES_VERSION } from '@/domain/portablePreferences';
import { DEFAULT_REGIONAL_PROFILE } from '@/domain/regionalProfile';
import { NOTEBOOK_STORAGE_KEY } from '@/domain/personalNotebook';
import { DISPLAY_PREFERENCES_STORAGE_KEY, DEFAULT_DISPLAY_PREFERENCES } from '@/domain/displayPreferences';

const MIGRATION_METADATA = {
  format: 't1arc-maintainer-migration' as const,
  version: 1 as const,
  createdAt: 1_750_000_000_000,
  sourceBackupVersion: 16,
  sourceContainerSha256: 'a'.repeat(64),
  recordFingerprintSha256: 'b'.repeat(64),
};

vi.mock('expo-file-system', () => ({
  File: class {},
  FileMode: { Truncate: 'wt' },
  Paths: { cache: 'file:///cache' },
}));
vi.mock('expo-crypto', () => ({}));
vi.mock('expo-secure-store', () => ({}));
vi.mock('expo-sqlite', () => ({}));

const tableNames = BACKUP_TABLE_NAMES;

function emptyBackup(): {
  manifest: Record<string, any> & {
    counts: Record<string, number>;
    totalRecords: number;
  };
  tables: Record<string, Record<string, any>[]>;
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

function genuineVersionOneBackupWithHealthConnectPreference() {
  const versionOneTableNames = [
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
  const tables: Record<
    (typeof versionOneTableNames)[number],
    Record<string, any>[]
  > = {
    glucose_readings: [],
    source_sync_state: [],
    insulin_basal: [],
    insulin_bolus: [],
    context_events: [],
    health_connect_records: [],
    health_connect_sources: [],
    health_connect_preferences: [],
    health_connect_sync_state: [],
    food_catalog_cache: [],
    food_logs: [],
    food_log_items: [],
    import_batches: [],
  };
  tables.health_connect_preferences.push({
    category: 'activity',
    enabled: 1,
    preferred_source_package: 'com.google.android.apps.fitness',
    updated_at_ms: 1_720_000_000_000,
  });
  return {
    manifest: {
      format: HEALTH_BACKUP_FORMAT,
      version: 1,
      createdAt: Date.now() - 1_000,
      timeZone: 'Europe/London',
      counts: Object.fromEntries(
        versionOneTableNames.map((name) => [
          name,
          name === 'health_connect_preferences' ? 1 : 0,
        ]),
      ),
      totalRecords: 1,
      excludes: ['credentials', 'session tokens', 'Glooko web cookies'],
    },
    tables,
  };
}

describe('health backup validation', () => {
  it('preserves explicit sensor changes and migrates old sensor notes without guessing a start', () => {
    const backup = emptyBackup();
    const row = {
      id: 'sensor-start', source_id: 't1arc-manual', origin: 'manual', start_ms: 1_720_000_000_000,
      end_ms: null, title: 'Started a new sensor', category: 'sensor', detail: null,
      recorded_at_ms: 1_720_000_000_000, source_file: null, source_row: null,
      glucose_mmol_l: null, sensor_started: 1, sensor_glucose_source_id: 'libre-link-up',
    };
    backup.tables.context_notes = [row];
    backup.manifest.counts.context_notes = 1;
    backup.manifest.totalRecords = 1;
    expect(validateHealthBackupDocument(backup).tables.context_notes[0]).toEqual(row);
    backup.manifest.version = 16;
    const { sensor_started: _started, sensor_glucose_source_id: _source, ...oldNote } = row;
    backup.tables.context_notes = [oldNote];
    expect(validateHealthBackupDocument(backup).tables.context_notes[0]).toMatchObject({
      title: 'Started a new sensor', sensor_started: null, sensor_glucose_source_id: null,
    });
    backup.manifest.version = HEALTH_BACKUP_VERSION;
    backup.tables.context_notes = [{ ...row, category: 'illness' }];
    expect(() => validateHealthBackupDocument(backup)).toThrow(/invalid sensor change/);
    backup.tables.context_notes = [{ ...row, sensor_glucose_source_id: '' }];
    expect(() => validateHealthBackupDocument(backup)).toThrow(/invalid sensor change/);
  });

  it('allowlists notebook and display settings without exporting unrelated private metadata', () => {
    const backup = emptyBackup();
    backup.tables.portable_app_state = [
      { key: NOTEBOOK_STORAGE_KEY, value: JSON.stringify({ version: 1, entries: [] }) },
      { key: DISPLAY_PREFERENCES_STORAGE_KEY, value: JSON.stringify(DEFAULT_DISPLAY_PREFERENCES) },
    ];
    backup.manifest.counts.portable_app_state = 2;
    backup.manifest.totalRecords = 2;
    expect(validateHealthBackupDocument(backup).tables.portable_app_state).toHaveLength(2);
    backup.tables.portable_app_state[1] = backup.tables.portable_app_state[0]!;
    expect(() => validateHealthBackupDocument(backup)).toThrow(/duplicate private application state/);
    backup.tables.portable_app_state[1] = { key: 'openai-api-key', value: 'not-a-real-key' };
    expect(() => validateHealthBackupDocument(backup)).toThrow(/unsupported private application state/);
  });
  it('freezes the private-converter record fingerprint framing fixture', () => {
    const rows = [
      [
        'glucose_readings',
        {
          id: 'glucose-1',
          source_id: 'source',
          timestamp_ms: 1_750_000_000_000,
          mmol_l: 5.6,
        },
      ],
      [
        'food_logs',
        { id: 'food-1', title: 'Lunch', carbohydrate_grams: 42 },
      ],
    ] as const;
    const digest = createHash('sha256');
    digest.update('T1ARCRF1', 'ascii');
    let byteLength = 8;
    for (const [table, row] of rows) {
      const chunks = encodeHealthBackupFingerprintRow(table, row);
      for (const chunk of chunks) {
        digest.update(chunk);
        byteLength += chunk.length;
      }
    }

    expect(byteLength).toBe(156);
    expect(digest.digest('hex')).toBe(
      'a8119e34944aa1ec8cd501306cbdfb84f2d4f352a04fd00bd8de263c5ad9618b',
    );
    const source = readFileSync(
      new URL('../src/data/backup/healthBackup.ts', import.meta.url),
      'utf8',
    );
    const fingerprintWriter = source.slice(
      source.indexOf('export async function computeHealthBackupRecordFingerprint'),
      source.indexOf('const CONTAINER_MAGIC_TEXT'),
    );
    expect(fingerprintWriter).toMatch(/writer\.flush\(\)/);
    expect(fingerprintWriter).not.toMatch(/writer\.finish\(\)/);
  });

  it('retains only valid migration metadata in JSON and stream manifests', () => {
    const backup = emptyBackup();
    backup.manifest.migration = MIGRATION_METADATA;

    expect(validateHealthBackupDocument(backup).manifest.migration).toEqual(
      MIGRATION_METADATA,
    );
    expect(
      validateCurrentContainerManifest(backup.manifest).migration,
    ).toEqual(MIGRATION_METADATA);

    backup.manifest.migration = {
      ...MIGRATION_METADATA,
      sourceContainerSha256: 'not-a-sha256',
    };
    expect(() => validateHealthBackupDocument(backup)).toThrow(
      /migration manifest/i,
    );
    expect(() => validateCurrentContainerManifest(backup.manifest)).toThrow(
      /migration manifest/i,
    );
  });

  it('backs up parsed health data but not replaceable raw source downloads', () => {
    expect(isHealthBackupTableExported('import_raw_records')).toBe(true);
    expect(isHealthBackupTableExported('import_source_payloads')).toBe(false);
    expect(isHealthBackupTableExported('glooko_report_payloads')).toBe(false);
  });

  function schemaDatabase(
    tables: string[],
    columns: Record<string, string[]> = {},
  ) {
    return {
      getAllAsync: vi.fn(async (query: string) => {
        if (query.includes('FROM sqlite_schema')) {
          return tables.map((name) => ({ name }));
        }
        const table = query.match(/PRAGMA table_info\("([^"]+)"\)/)?.[1];
        return (table ? (columns[table] ?? []) : []).map((name) => ({
          name,
        }));
      }),
    };
  }

  it('classifies every device-bound backup omission explicitly', async () => {
    const database = schemaDatabase(
      [
        'app_metadata',
        'automation_runs',
        'health_connect_sync_state',
        'import_source_payloads',
      ],
      {
        health_connect_sync_state: [
          'category',
          'changes_token',
          'changes_token_source_package',
        ],
        import_source_payloads: ['import_batch_id', 'payload_bytes'],
      },
    );

    await expect(
      assertHealthBackupSchemaCoverage(database),
    ).resolves.toBeUndefined();
  });

  it('refuses to export when a database table has no backup policy', async () => {
    const database = schemaDatabase(['new_health_table']);

    await expect(assertHealthBackupSchemaCoverage(database)).rejects.toThrow(
      /new_health_table/i,
    );
  });

  it('refuses to export when a portable table gains an unclassified column', async () => {
    const database = schemaDatabase(['glucose_readings'], {
      glucose_readings: ['id', 'future_clinical_field'],
    });

    await expect(assertHealthBackupSchemaCoverage(database)).rejects.toThrow(
      /future_clinical_field/i,
    );
  });

  it('accepts a complete empty backup', () => {
    const parsed = validateHealthBackupDocument(emptyBackup());
    expect(parsed.manifest.totalRecords).toBe(0);
    expect(parsed.manifest.timeZone).toBe('Europe/London');
  });

  it('preserves validated non-secret preferences in the manifest', () => {
    const backup = emptyBackup();
    backup.manifest.preferences = {
      version: PORTABLE_PREFERENCES_VERSION,
      glucoseAppearance: DEFAULT_GLUCOSE_APPEARANCE,
      glanceableDisplay: {
        lockScreenVisible: false,
        aodPosition: 'middleRight',
        aodSize: 'small',
      },
      insightReviews: {
        weeklyNotificationEnabled: true,
        reviewWeekday: 0,
        reviewHour: 8,
        reviewMinute: 30,
      },
      glucoseAlerts: {
        lowEnabled: true,
        lowThresholdMmolL: 3.8,
        highEnabled: true,
        highThresholdMmolL: 14,
        staleEnabled: false,
        repeatMinutes: 30,
      },
      themeMode: 'dark',
      healthGoals: { dailyStepGoal: 8_500 },
      treatmentProfile: null,
      regionalProfile: DEFAULT_REGIONAL_PROFILE,
    };

    const parsed = validateHealthBackupDocument(backup);

    expect(parsed.manifest.preferences?.glanceableDisplay).toEqual({
      lockScreenVisible: false,
      aodPosition: 'middleRight',
      aodSize: 'small',
    });
    expect(
      parsed.manifest.preferences?.insightReviews.weeklyNotificationEnabled,
    ).toBe(true);
    expect(parsed.manifest.preferences?.themeMode).toBe('dark');
    expect(parsed.manifest.preferences?.healthGoals?.dailyStepGoal).toBe(8_500);
  });

  it('rejects malformed portable preferences before restore', () => {
    const backup = emptyBackup();
    backup.manifest.preferences = {
      version: PORTABLE_PREFERENCES_VERSION,
      glucoseAppearance: DEFAULT_GLUCOSE_APPEARANCE,
      glanceableDisplay: {
        lockScreenVisible: true,
        aodPosition: 'outside-screen',
        aodSize: 'standard',
      },
      insightReviews: {
        weeklyNotificationEnabled: false,
        reviewWeekday: 1,
        reviewHour: 7,
        reviewMinute: 0,
      },
      glucoseAlerts: {
        lowEnabled: true,
        lowThresholdMmolL: 3.9,
        highEnabled: true,
        highThresholdMmolL: 13.9,
        staleEnabled: false,
        repeatMinutes: 30,
      },
      themeMode: 'system',
      healthGoals: { dailyStepGoal: null },
      treatmentProfile: null,
      regionalProfile: DEFAULT_REGIONAL_PROFILE,
    };

    expect(() => validateHealthBackupDocument(backup)).toThrow(
      /display settings/i,
    );
  });

  it('allows only a validated Tarv1s conversation into portable app state', () => {
    const backup = emptyBackup();
    backup.tables.portable_app_state!.push({
      key: 'tarvis-conversation-v1',
      value: JSON.stringify({
        schemaVersion: 3,
        updatedAt: 1_720_000_000_000,
        exchanges: [],
      }),
    });
    backup.manifest.counts.portable_app_state = 1;
    backup.manifest.totalRecords = 1;

    const parsed = validateHealthBackupDocument(backup);

    expect(parsed.tables.portable_app_state).toHaveLength(1);
    expect(parsed.tables.portable_app_state[0]?.key).toBe(
      'tarvis-conversation-v1',
    );
  });

  it('rejects non-allowlisted metadata and malformed conversations', () => {
    const backup = emptyBackup();
    backup.tables.portable_app_state!.push({
      key: 'hevy-sync-state-v1',
      value: '{"cursor":"device-bound"}',
    });
    backup.manifest.counts.portable_app_state = 1;
    backup.manifest.totalRecords = 1;

    expect(() => validateHealthBackupDocument(backup)).toThrow(
      /unsupported private application state/i,
    );

    backup.tables.portable_app_state![0] = {
      key: 'tarvis-conversation-v1',
      value: '{"schemaVersion":3,"updatedAt":1,"exchanges":"invalid"}',
    };
    expect(() => validateHealthBackupDocument(backup)).toThrow(
      /invalid Tarv1s conversation/i,
    );
  });

  it('round-trips streamed container frame headers', () => {
    const header = encodeBackupFrameHeader(2, 14, 50 * 1024 * 1024);
    expect([...header]).toHaveLength(6);
    expect(decodeBackupFrameHeader(header)).toEqual({
      type: 2,
      tableIndex: 14,
      byteLength: 50 * 1024 * 1024,
    });
    expect(() => encodeBackupFrameHeader(2, 14, 0x1_0000_0000)).toThrow(
      /supported range/i,
    );
  });

  it('accepts a normalised glucose row with provenance timestamps', () => {
    const backup = emptyBackup();
    backup.tables.glucose_readings!.push({
      id: 'libre:1720000000000',
      source_id: 't1arc-librelinkup',
      timestamp_ms: 1_720_000_000_000,
      received_at_ms: 1_720_000_010_000,
      mmol_l: 6.4,
      trend: 'steady',
      quality: 'measured',
      source_factory_timestamp: '2024-07-03T09:46:40Z',
      source_local_timestamp: null,
      timestamp_discrepancy_minutes: null,
      imported_at_ms: null,
      source_file: null,
      source_row: null,
      source_device_id: null,
    });
    backup.manifest.counts.glucose_readings = 1;
    backup.manifest.totalRecords = 1;

    const parsed = validateHealthBackupDocument(backup);
    expect(parsed.tables.glucose_readings[0]?.mmol_l).toBe(6.4);
    const binding = backupRestoreBinding(
      'glucose_readings',
      parsed.tables.glucose_readings[0]!,
    );
    expect(binding.values[binding.columns.indexOf('source_device_id')]).toBe(
      '',
    );
  });

  it('marks restored Health Connect rows as archival until seen on this phone', () => {
    const binding = backupRestoreBinding('health_connect_records', {
      id: 'health-connect:nutrition:source:record',
    } as any);

    expect(binding.columns.at(-1)).toBe('reconciliation_scope');
    expect(binding.values.at(-1)).toBe('restored');
  });

  it('marks restored notification evidence as restored provenance', () => {
    const binding = backupRestoreBinding('notification_source_events', {
      id: 'notification-observation:v2:native:123',
    } as any);

    expect(binding.columns.at(-1)).toBe('reconciliation_scope');
    expect(binding.values.at(-1)).toBe('restored');
  });

  it('upgrades version 1 glucose rows without import provenance', () => {
    const backup = emptyBackup();
    backup.manifest.version = 1;
    backup.tables.glucose_readings!.push({
      id: 'libre:1720000000000',
      source_id: 't1arc-librelinkup',
      timestamp_ms: 1_720_000_000_000,
      received_at_ms: 1_720_000_010_000,
      mmol_l: 6.4,
      trend: 'flat',
      quality: 'measured',
      source_factory_timestamp: null,
      source_local_timestamp: null,
      timestamp_discrepancy_minutes: null,
    });
    backup.manifest.counts.glucose_readings = 1;
    backup.manifest.totalRecords = 1;

    const parsed = validateHealthBackupDocument(backup);
    expect(parsed.manifest.version).toBe(HEALTH_BACKUP_VERSION);
    expect(parsed.tables.glucose_readings[0]?.source_file).toBeNull();
  });

  it('upgrades a genuine version 1 Health Connect preference row', () => {
    const parsed = validateHealthBackupDocument(
      genuineVersionOneBackupWithHealthConnectPreference(),
    );
    const preference = parsed.tables.health_connect_preferences[0]!;

    expect(preference).toEqual({
      category: 'activity',
      enabled: 1,
      preferred_source_package: 'com.google.android.apps.fitness',
      preferred_source_mode: null,
      updated_at_ms: 1_720_000_000_000,
    });
    const binding = backupRestoreBinding(
      'health_connect_preferences',
      preference,
    );
    expect(
      binding.values[binding.columns.indexOf('preferred_source_mode')],
    ).toBeNull();
  });

  it('does not overwrite an explicit source mode in a pre-v12 row', () => {
    const backup = genuineVersionOneBackupWithHealthConnectPreference();
    backup.tables.health_connect_preferences[0]!.preferred_source_mode =
      'manual';

    const parsed = validateHealthBackupDocument(backup);

    expect(
      parsed.tables.health_connect_preferences[0]?.preferred_source_mode,
    ).toBe('manual');
  });

  it.each([12, HEALTH_BACKUP_VERSION])(
    'preserves an explicit Health Connect source mode in backup version %s',
    (version) => {
      const backup = emptyBackup();
      backup.manifest.version = version;
      if (version < 13) {
        delete backup.manifest.counts.hevy_workouts;
        delete backup.tables.hevy_workouts;
      }
      if (version < 14) {
        delete backup.manifest.counts.portable_app_state;
        delete backup.tables.portable_app_state;
      }
      backup.tables.health_connect_preferences!.push({
        category: 'activity',
        enabled: 1,
        preferred_source_package: 'com.google.android.apps.fitness',
        preferred_source_mode: 'automatic',
        updated_at_ms: 1_720_000_000_000,
      });
      backup.manifest.counts.health_connect_preferences = 1;
      backup.manifest.totalRecords = 1;

      const parsed = validateHealthBackupDocument(backup);

      expect(
        parsed.tables.health_connect_preferences[0]?.preferred_source_mode,
      ).toBe('automatic');
    },
  );

  it('upgrades a version 2 backup with no retained-source section', () => {
    const backup = emptyBackup();
    backup.manifest.version = 2;
    delete backup.manifest.counts.import_source_payloads;
    delete backup.tables.import_source_payloads;
    delete backup.manifest.counts.notification_source_events;
    delete backup.tables.notification_source_events;
    delete backup.manifest.counts.insight_reports;
    delete backup.tables.insight_reports;

    const parsed = validateHealthBackupDocument(backup);

    expect(parsed.manifest.version).toBe(HEALTH_BACKUP_VERSION);
    expect(parsed.tables.import_source_payloads).toEqual([]);
    expect(parsed.tables.notification_source_events).toEqual([]);
    expect(parsed.tables.insight_reports).toEqual([]);
  });

  it('upgrades a version 3 backup with no notification evidence or reviews', () => {
    const backup = emptyBackup();
    backup.manifest.version = 3;
    delete backup.manifest.counts.notification_source_events;
    delete backup.tables.notification_source_events;
    delete backup.manifest.counts.insight_reports;
    delete backup.tables.insight_reports;

    const parsed = validateHealthBackupDocument(backup);

    expect(parsed.manifest.version).toBe(HEALTH_BACKUP_VERSION);
    expect(parsed.tables.notification_source_events).toEqual([]);
    expect(parsed.tables.insight_reports).toEqual([]);
  });

  it('upgrades a complete version 4 JSON backup to the streamed version', () => {
    const backup = emptyBackup();
    backup.manifest.version = 4;

    const parsed = validateHealthBackupDocument(backup);

    expect(parsed.manifest.version).toBe(HEALTH_BACKUP_VERSION);
    expect(parsed.manifest.totalRecords).toBe(0);
  });

  it('upgrades a version 11 backup with no retained pump-report section', () => {
    const backup = emptyBackup();
    backup.manifest.version = 11;
    delete backup.manifest.counts.glooko_report_payloads;
    delete backup.manifest.counts.hevy_workouts;
    delete backup.manifest.counts.portable_app_state;
    delete backup.tables.glooko_report_payloads;
    delete backup.tables.hevy_workouts;
    delete backup.tables.portable_app_state;

    const parsed = validateHealthBackupDocument(backup);

    expect(parsed.manifest.version).toBe(HEALTH_BACKUP_VERSION);
    expect(parsed.tables.glooko_report_payloads).toEqual([]);
  });

  it('upgrades version 14 meal context without inventing newer nutrients', () => {
    const backup = emptyBackup();
    backup.manifest.version = 14;
    backup.tables.context_events!.push({
      id: 'meal:legacy',
      source_id: 't1arc-food',
      origin: 'manual',
      kind: 'meal',
      start_ms: 1_720_000_000_000,
      end_ms: null,
      title: 'Lunch',
      meal_type: 'lunch',
      carbs_grams: 42,
      energy_kcal: 510,
      protein_grams: 28,
      fat_grams: 16,
      serving_quantity: null,
      serving_count: null,
      activity_type: null,
      duration_minutes: null,
      intensity: null,
      calories_burned: null,
      quality_percent: null,
      kilograms: null,
      amount: null,
      unit: null,
      medication_type: null,
      recorded_at_ms: 1_720_000_001_000,
      source_file: 'Food log',
      source_row: null,
    });
    backup.manifest.counts.context_events = 1;
    backup.manifest.totalRecords = 1;

    const parsed = validateHealthBackupDocument(backup);

    expect(parsed.tables.context_events[0]).toMatchObject({
      carbs_grams: 42,
      energy_kcal: 510,
      fibre_grams: null,
      sugars_grams: null,
      saturated_fat_grams: null,
    });
  });

  it('upgrades a version 5 backup with no context-note section', () => {
    const backup = emptyBackup();
    backup.manifest.version = 5;
    delete backup.manifest.counts.context_notes;
    delete backup.tables.context_notes;

    const parsed = validateHealthBackupDocument(backup);

    expect(parsed.manifest.version).toBe(HEALTH_BACKUP_VERSION);
    expect(parsed.tables.context_notes).toEqual([]);
  });

  it('upgrades cached foods from version 5 without losing their source data', () => {
    const backup = emptyBackup();
    backup.manifest.version = 5;
    delete backup.manifest.counts.context_notes;
    delete backup.tables.context_notes;
    backup.tables.food_catalog_cache!.push({
      id: 'open-food-facts:123',
      provider: 'open-food-facts',
      external_id: '123',
      barcode: '123',
      name: 'Test cereal bar',
      brand: 'Test brand',
      image_url: null,
      basis_amount: 100,
      basis_unit: 'g',
      carbohydrate_grams: 60,
      energy_kcal: 400,
      protein_grams: 5,
      fat_grams: 12,
      fibre_grams: 3,
      sugars_grams: 25,
      saturated_fat_grams: 4,
      nutrition_quality_json: '{}',
      source_label: 'Open Food Facts',
      source_url: 'https://world.openfoodfacts.org/product/123',
      raw_payload_json: '{"serving_quantity":"25","serving_quantity_unit":"g"}',
      cached_at_ms: 1_720_000_000_000,
      expires_at_ms: null,
      is_favorite: 1,
      use_count: 2,
      last_used_at_ms: 1_720_000_000_000,
    });
    backup.manifest.counts.food_catalog_cache = 1;
    backup.manifest.totalRecords = 1;

    const parsed = validateHealthBackupDocument(backup);

    expect(parsed.tables.food_catalog_cache[0]).toMatchObject({
      id: 'open-food-facts:123',
      default_serving_amount: null,
      default_serving_unit: null,
      last_portion_amount: null,
      last_portion_unit: null,
      raw_payload_json: '{"serving_quantity":"25","serving_quantity_unit":"g"}',
    });
  });

  it('accepts a version 6 backup before remembered food portions existed', () => {
    const backup = emptyBackup();
    backup.manifest.version = 6;

    const parsed = validateHealthBackupDocument(backup);

    expect(parsed.manifest.version).toBe(HEALTH_BACKUP_VERSION);
  });

  it('upgrades version 7 batches and preserves remembered food portions', () => {
    const backup = emptyBackup();
    backup.manifest.version = 7;
    delete backup.manifest.counts.insulin_daily_totals;
    delete backup.tables.insulin_daily_totals;
    backup.tables.import_batches!.push({
      id: 'batch:1',
      source_id: 'glooko-export',
      file_name: 'export.zip',
      file_sha256: 'sha256',
      imported_at_ms: 1_720_000_000_000,
      data_start_ms: 1_719_000_000_000,
      data_through_ms: 1_720_000_000_000,
      basal_count: 1,
      bolus_count: 1,
      context_count: 0,
      duplicate_count: 0,
      skipped_count: 0,
      warnings_json: '[]',
    });
    backup.tables.food_catalog_cache!.push({
      id: 'user:porridge',
      provider: 'user',
      external_id: 'porridge',
      barcode: null,
      name: 'Porridge',
      brand: null,
      image_url: null,
      basis_amount: 100,
      basis_unit: 'g',
      default_serving_amount: 40,
      default_serving_unit: 'g',
      last_portion_amount: 55,
      last_portion_unit: 'g',
      carbohydrate_grams: 60,
      energy_kcal: 370,
      protein_grams: 12,
      fat_grams: 7,
      fibre_grams: 9,
      sugars_grams: 1,
      saturated_fat_grams: 1,
      nutrition_quality_json: '{}',
      source_label: 'Personal food',
      source_url: null,
      raw_payload_json: null,
      cached_at_ms: 1_720_000_000_000,
      expires_at_ms: null,
      is_favorite: 1,
      use_count: 3,
      last_used_at_ms: 1_720_000_000_000,
    });
    backup.manifest.counts.import_batches = 1;
    backup.manifest.counts.food_catalog_cache = 1;
    backup.manifest.totalRecords = 2;

    const parsed = validateHealthBackupDocument(backup);

    expect(parsed.tables.import_batches[0]?.daily_total_count).toBe(0);
    expect(parsed.tables.food_catalog_cache[0]).toMatchObject({
      last_portion_amount: 55,
      last_portion_unit: 'g',
    });
    expect(parsed.tables.insulin_daily_totals).toEqual([]);
  });

  it('upgrades version 8 food logs before saved meals existed', () => {
    const backup = emptyBackup();
    backup.manifest.version = 8;
    backup.tables.food_logs!.push({
      id: 'food-log:1',
      context_event_id: 'context:meal:1',
      timestamp_ms: 1_720_000_000_000,
      meal_type: 'breakfast',
      title: 'Porridge',
      carbohydrate_grams: 32,
      energy_kcal: 240,
      protein_grams: 9,
      fat_grams: 6,
      fibre_grams: 5,
      sugars_grams: 4,
      saturated_fat_grams: 1,
      created_at_ms: 1_720_000_000_000,
      updated_at_ms: 1_720_000_000_000,
    });
    backup.manifest.counts.food_logs = 1;
    backup.manifest.totalRecords = 1;

    const parsed = validateHealthBackupDocument(backup);

    expect(parsed.tables.food_logs[0]?.is_favorite).toBe(0);
  });

  it('upgrades version 9 backups before recipes were portable', () => {
    const backup = emptyBackup();
    backup.manifest.version = 9;
    delete backup.manifest.counts.food_recipes;
    delete backup.manifest.counts.food_recipe_items;
    delete backup.manifest.counts.import_raw_records;
    delete backup.manifest.counts.glooko_report_payloads;
    delete backup.tables.food_recipes;
    delete backup.tables.food_recipe_items;
    delete backup.tables.import_raw_records;
    delete backup.tables.glooko_report_payloads;

    const parsed = validateHealthBackupDocument(backup);

    expect(parsed.tables.food_recipes).toEqual([]);
    expect(parsed.tables.food_recipe_items).toEqual([]);
  });

  it('accepts a streamed version 5 manifest after context notes are added', () => {
    const backup = emptyBackup();
    backup.manifest.version = 5;
    delete backup.manifest.counts.context_notes;
    delete backup.manifest.counts.insulin_daily_totals;
    delete backup.manifest.counts.food_recipes;
    delete backup.manifest.counts.food_recipe_items;
    delete backup.manifest.counts.import_raw_records;
    delete backup.manifest.counts.glooko_report_payloads;
    delete backup.manifest.counts.hevy_workouts;
    delete backup.manifest.counts.portable_app_state;

    const manifest = validateCurrentContainerManifest(backup.manifest);

    expect(manifest.version).toBe(HEALTH_BACKUP_VERSION);
    expect(manifest.counts.context_notes).toBe(0);
    expect(manifest.counts.insulin_daily_totals).toBe(0);
    expect(manifest.counts.food_recipes).toBe(0);
    expect(manifest.counts.food_recipe_items).toBe(0);
    expect(manifest.counts.portable_app_state).toBe(0);
    expect(manifest.totalRecords).toBe(0);
  });

  it('preserves raw notification evidence and saved deterministic reviews', () => {
    const backup = emptyBackup();
    backup.tables.notification_source_events!.push({
      id: 'notification:1',
      package_name: 'com.example.cgm',
      posted_at_ms: 1_720_000_000_000,
      notification_when_ms: 1_720_000_000_000,
      received_at_ms: 1_720_000_001_000,
      is_ongoing: 1,
      payload_json: '{"title":"6.4 mmol/L"}',
      parser_version: 1,
      parsed_glucose_id: 'notification-glucose:1',
      parsed_iob_units: null,
      parsed_pump_mode: null,
      imported_at_ms: 1_720_000_002_000,
    });
    backup.tables.insight_reports!.push({
      id: 'rolling-week:2024-07-07',
      kind: 'rolling-week',
      period_start_ms: 1_719_792_000_000,
      period_end_ms: 1_720_396_800_000,
      comparison_start_ms: 1_719_187_200_000,
      comparison_end_ms: 1_719_792_000_000,
      generated_at_ms: 1_720_396_800_000,
      updated_at_ms: 1_720_396_801_000,
      schema_version: 1,
      input_fingerprint: 'fingerprint',
      ready: 1,
      headline: 'A steady week',
      summary: 'Observed patterns are linked to exact records.',
      evidence_record_count: 1,
      report_json: '{"headline":"A steady week","findings":[]}',
      viewed_at_ms: null,
    });
    backup.manifest.counts.notification_source_events = 1;
    backup.manifest.counts.insight_reports = 1;
    backup.manifest.totalRecords = 2;

    const parsed = validateHealthBackupDocument(backup);

    expect(parsed.tables.notification_source_events[0]?.payload_json).toContain(
      '6.4 mmol/L',
    );
    expect(parsed.tables.insight_reports[0]?.headline).toBe('A steady week');
  });

  it('preserves factual context notes and their provenance', () => {
    const backup = emptyBackup();
    backup.tables.context_notes!.push({
      id: 't1arc-manual:note:1',
      source_id: 't1arc-manual',
      origin: 'manual',
      start_ms: 1_720_000_000_000,
      end_ms: null,
      title: 'Pod / site',
      category: 'pump',
      detail: 'Changed pod after suspected site issue',
      sensor_started: null,
      sensor_glucose_source_id: null,
      recorded_at_ms: 1_720_000_001_000,
      source_file: null,
      source_row: null,
      glucose_mmol_l: null,
    });
    backup.manifest.counts.context_notes = 1;
    backup.manifest.totalRecords = 1;

    const parsed = validateHealthBackupDocument(backup);

    expect(parsed.tables.context_notes[0]).toMatchObject({
      category: 'pump',
      detail: 'Changed pod after suspected site issue',
    });
  });

  it('round-trips canonical meter glucose in a current context note', () => {
    const backup = emptyBackup();
    backup.tables.context_notes!.push({
      id: 'glooko:meter:1',
      source_id: 'glooko-export',
      origin: 'imported',
      start_ms: 1_720_000_000_000,
      end_ms: null,
      title: 'Blood glucose check',
      category: 'other',
      detail: 'Manual reading: Yes',
      sensor_started: null,
      sensor_glucose_source_id: null,
      recorded_at_ms: 1_720_000_001_000,
      source_file: 'bg_data.csv',
      source_row: 2,
      glucose_mmol_l: 7,
    });
    backup.manifest.counts.context_notes = 1;
    backup.manifest.totalRecords = 1;

    const parsed = validateHealthBackupDocument(backup);

    expect(parsed.tables.context_notes[0]?.glucose_mmol_l).toBe(7);
  });

  it('upgrades a version 15 context note without inventing meter glucose', () => {
    const backup = emptyBackup();
    backup.manifest.version = 15;
    const legacyNote = {
      id: 'legacy-note',
      source_id: 't1arc-manual',
      origin: 'manual',
      start_ms: 1_720_000_000_000,
      end_ms: null,
      title: 'Travel',
      category: 'travel',
      detail: null,
      recorded_at_ms: 1_720_000_001_000,
      source_file: null,
      source_row: null,
    };
    backup.tables.context_notes!.push(legacyNote);
    backup.manifest.counts.context_notes = 1;
    backup.manifest.totalRecords = 1;

    const parsed = validateHealthBackupDocument(backup);

    expect(parsed.tables.context_notes[0]).toMatchObject({
      id: 'legacy-note',
      glucose_mmol_l: null,
    });
  });

  it('rejects a context note category outside the supported schema', () => {
    const backup = emptyBackup();
    backup.tables.context_notes!.push({
      id: 'note:bad',
      source_id: 't1arc-manual',
      origin: 'manual',
      start_ms: 1_720_000_000_000,
      end_ms: null,
      title: 'Unknown',
      category: 'unbounded-value',
      sensor_started: null,
      sensor_glucose_source_id: null,
      detail: null,
      recorded_at_ms: 1_720_000_001_000,
      source_file: null,
      source_row: null,
      glucose_mmol_l: null,
    });
    backup.manifest.counts.context_notes = 1;
    backup.manifest.totalRecords = 1;

    expect(() => validateHealthBackupDocument(backup)).toThrow(
      /invalid note category or origin/i,
    );
  });

  it('round-trips retained source bytes and validates their reported size', () => {
    const bytes = new Uint8Array([0, 1, 2, 253, 254, 255]);
    const encoded = bytesToBackupBase64(bytes);
    expect([...backupBase64ToBytes(encoded)]).toEqual([...bytes]);

    const backup = emptyBackup();
    backup.tables.import_source_payloads!.push({
      import_batch_id: 'batch-1',
      source_id: 'glooko-export',
      file_name: 'glooko.zip',
      file_sha256: 'abc123',
      format: 'zip',
      byte_length: bytes.length,
      manifest_json: '{}',
      payload_base64: encoded,
      stored_at_ms: 1_720_000_000_000,
    });
    backup.manifest.counts.import_source_payloads = 1;
    backup.manifest.totalRecords = 1;

    expect(
      validateHealthBackupDocument(backup).tables.import_source_payloads[0]
        ?.payload_base64,
    ).toBe(encoded);
    const binding = backupRestoreBinding(
      'import_source_payloads',
      backup.tables.import_source_payloads![0]!,
    );
    expect(binding.columns).toContain('payload_bytes');
    expect(binding.columns).not.toContain('payload_base64');
    expect(binding.values[binding.columns.indexOf('payload_bytes')]).toEqual(
      bytes,
    );

    backup.tables.import_source_payloads![0]!.byte_length += 1;
    expect(() => validateHealthBackupDocument(backup)).toThrow(
      /invalid retained export/i,
    );
  });

  it('still accepts an exact Glooko PDF from an older portable backup', () => {
    const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]);
    const encoded = bytesToBackupBase64(bytes);
    const backup = emptyBackup();
    backup.tables.glooko_report_payloads!.push({
      id: 'glooko-export:report:abc123',
      source_id: 'glooko-export',
      file_name: 'pump-report.pdf',
      file_sha256: 'abc123',
      byte_length: bytes.length,
      payload_base64: encoded,
      extracted_text: 'Anonymised report text',
      preview_json: '{"warnings":[]}',
      report_start_ms: 1_720_000_000_000,
      report_end_ms: 1_720_604_800_000,
      imported_at_ms: 1_720_604_900_000,
    });
    backup.manifest.counts.glooko_report_payloads = 1;
    backup.manifest.totalRecords = 1;

    const parsed = validateHealthBackupDocument(backup);
    expect(parsed.tables.glooko_report_payloads[0]?.payload_base64).toBe(
      encoded,
    );
    const binding = backupRestoreBinding(
      'glooko_report_payloads',
      parsed.tables.glooko_report_payloads[0]!,
    );
    expect(binding.values[binding.columns.indexOf('payload_bytes')]).toEqual(
      bytes,
    );
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

  it('accepts a valid regional timezone contract', () => {
    const backup = emptyBackup();
    backup.manifest.timeZone = 'America/New_York';
    expect(validateHealthBackupDocument(backup).manifest.timeZone).toBe(
      'America/New_York',
    );
  });

  it('rejects an invalid timezone contract', () => {
    const backup = emptyBackup();
    backup.manifest.timeZone = 'not/a-zone';
    expect(() => validateHealthBackupDocument(backup)).toThrow(/IANA time zone/i);
  });
});
