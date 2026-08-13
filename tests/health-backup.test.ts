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
  assertHealthBackupSchemaCoverage,
  BACKUP_TABLE_NAMES,
  backupBase64ToBytes,
  backupRestoreBinding,
  bytesToBackupBase64,
  decodeBackupFrameHeader,
  encodeBackupFrameHeader,
  HEALTH_BACKUP_FORMAT,
  HEALTH_BACKUP_VERSION,
  validateCurrentContainerManifest,
  validateHealthBackupDocument,
} from '@/data/backup/healthBackup';
import { DEFAULT_GLUCOSE_APPEARANCE } from '@/domain/glucoseAppearance';
import { PORTABLE_PREFERENCES_VERSION } from '@/domain/portablePreferences';

const tableNames = BACKUP_TABLE_NAMES;

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
  function schemaDatabase(
    tables: string[],
    columns: Record<string, string[]> = {},
  ) {
    return {
      getAllAsync: vi.fn(async (query: string) => {
        if (query.includes('FROM sqlite_schema')) {
          return tables.map((name) => ({ name }));
        }
        const table = query.match(
          /PRAGMA table_info\("([^"]+)"\)/,
        )?.[1];
        return (table ? columns[table] ?? [] : []).map((name) => ({
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
        import_source_payloads: [
          'import_batch_id',
          'payload_bytes',
        ],
      },
    );

    await expect(
      assertHealthBackupSchemaCoverage(database),
    ).resolves.toBeUndefined();
  });

  it('refuses to export when a database table has no backup policy', async () => {
    const database = schemaDatabase(['new_health_table']);

    await expect(
      assertHealthBackupSchemaCoverage(database),
    ).rejects.toThrow(/new_health_table/i);
  });

  it('refuses to export when a portable table gains an unclassified column', async () => {
    const database = schemaDatabase(['glucose_readings'], {
      glucose_readings: ['id', 'future_clinical_field'],
    });

    await expect(
      assertHealthBackupSchemaCoverage(database),
    ).rejects.toThrow(/future_clinical_field/i);
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
      insightReviews: { weeklyNotificationEnabled: true },
      glucoseAlerts: {
        lowEnabled: true,
        lowThresholdMmolL: 3.8,
        highEnabled: true,
        highThresholdMmolL: 14,
        staleEnabled: false,
        repeatMinutes: 30,
      },
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
      insightReviews: { weeklyNotificationEnabled: false },
      glucoseAlerts: {
        lowEnabled: true,
        lowThresholdMmolL: 3.9,
        highEnabled: true,
        highThresholdMmolL: 13.9,
        staleEnabled: false,
        repeatMinutes: 30,
      },
    };

    expect(() => validateHealthBackupDocument(backup)).toThrow(
      /display settings/i,
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
      source_id: 'daymark-librelinkup',
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
    expect(
      binding.values[binding.columns.indexOf('source_device_id')],
    ).toBe('');
  });

  it('upgrades version 1 glucose rows without import provenance', () => {
    const backup = emptyBackup();
    backup.manifest.version = 1;
    backup.tables.glucose_readings!.push({
      id: 'libre:1720000000000',
      source_id: 'daymark-librelinkup',
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
    delete backup.tables.glooko_report_payloads;

    const parsed = validateHealthBackupDocument(backup);

    expect(parsed.manifest.version).toBe(HEALTH_BACKUP_VERSION);
    expect(parsed.tables.glooko_report_payloads).toEqual([]);
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
      raw_payload_json:
        '{"serving_quantity":"25","serving_quantity_unit":"g"}',
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
      raw_payload_json:
        '{"serving_quantity":"25","serving_quantity_unit":"g"}',
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

    const manifest = validateCurrentContainerManifest(backup.manifest);

    expect(manifest.version).toBe(HEALTH_BACKUP_VERSION);
    expect(manifest.counts.context_notes).toBe(0);
    expect(manifest.counts.insulin_daily_totals).toBe(0);
    expect(manifest.counts.food_recipes).toBe(0);
    expect(manifest.counts.food_recipe_items).toBe(0);
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
      id: 'daymark-manual:note:1',
      source_id: 'daymark-manual',
      origin: 'manual',
      start_ms: 1_720_000_000_000,
      end_ms: null,
      title: 'Pod / site',
      category: 'pump',
      detail: 'Changed pod after suspected site issue',
      recorded_at_ms: 1_720_000_001_000,
      source_file: null,
      source_row: null,
    });
    backup.manifest.counts.context_notes = 1;
    backup.manifest.totalRecords = 1;

    const parsed = validateHealthBackupDocument(backup);

    expect(parsed.tables.context_notes[0]).toMatchObject({
      category: 'pump',
      detail: 'Changed pod after suspected site issue',
    });
  });

  it('rejects a context note category outside the supported schema', () => {
    const backup = emptyBackup();
    backup.tables.context_notes!.push({
      id: 'note:bad',
      source_id: 'daymark-manual',
      origin: 'manual',
      start_ms: 1_720_000_000_000,
      end_ms: null,
      title: 'Unknown',
      category: 'unbounded-value',
      detail: null,
      recorded_at_ms: 1_720_000_001_000,
      source_file: null,
      source_row: null,
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
    expect(
      binding.values[binding.columns.indexOf('payload_bytes')],
    ).toEqual(bytes);

    backup.tables.import_source_payloads![0]!.byte_length += 1;
    expect(() => validateHealthBackupDocument(backup)).toThrow(
      /invalid retained export/i,
    );
  });

  it('keeps the exact Glooko PDF inside the portable encrypted backup', () => {
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
    expect(
      parsed.tables.glooko_report_payloads[0]?.payload_base64,
    ).toBe(encoded);
    const binding = backupRestoreBinding(
      'glooko_report_payloads',
      parsed.tables.glooko_report_payloads[0]!,
    );
    expect(
      binding.values[binding.columns.indexOf('payload_bytes')],
    ).toEqual(bytes);
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
