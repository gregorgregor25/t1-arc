import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import {
  CURRENT_T1ARC_SCHEMA_VERSION,
  runVersionedStartupMaintenance,
  shouldRunVersionedStartupMaintenance,
} from '@/data/persistence/databaseStartupPolicy';

describe('database startup policy', () => {
  it('skips heavy maintenance for a routine current-schema open', async () => {
    const maintenance = vi.fn(async () => undefined);

    await expect(
      runVersionedStartupMaintenance(
        CURRENT_T1ARC_SCHEMA_VERSION,
        CURRENT_T1ARC_SCHEMA_VERSION,
        maintenance,
      ),
    ).resolves.toBe(false);
    expect(maintenance).not.toHaveBeenCalled();
  });

  it('runs heavy maintenance once while upgrading an older schema', async () => {
    const maintenance = vi.fn(async () => undefined);

    await expect(
      runVersionedStartupMaintenance(
        CURRENT_T1ARC_SCHEMA_VERSION - 1,
        undefined,
        maintenance,
      ),
    ).resolves.toBe(true);
    expect(maintenance).toHaveBeenCalledOnce();
    expect(
      shouldRunVersionedStartupMaintenance(
        CURRENT_T1ARC_SCHEMA_VERSION,
        CURRENT_T1ARC_SCHEMA_VERSION,
      ),
    ).toBe(false);
  });

  it('recovers a current-schema database whose maintenance marker is missing', async () => {
    const maintenance = vi.fn(async () => undefined);

    await expect(
      runVersionedStartupMaintenance(
        CURRENT_T1ARC_SCHEMA_VERSION,
        undefined,
        maintenance,
      ),
    ).resolves.toBe(true);
    expect(maintenance).toHaveBeenCalledOnce();
  });

  it('does not claim completion when an interrupted repair fails', async () => {
    const failure = new Error('interrupted');

    await expect(
      runVersionedStartupMaintenance(
        CURRENT_T1ARC_SCHEMA_VERSION,
        undefined,
        async () => {
          throw failure;
        },
      ),
    ).rejects.toBe(failure);
    expect(
      shouldRunVersionedStartupMaintenance(
        CURRENT_T1ARC_SCHEMA_VERSION,
        undefined,
      ),
    ).toBe(true);
  });

  it('keeps vacuum off startup and gates truncation behind the erase marker', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'src/data/persistence/t1arcDatabase.ts'),
      'utf8',
    );
    const sanitizationSource = readFileSync(
      resolve(
        process.cwd(),
        'src/data/persistence/eraseSanitization.ts',
      ),
      'utf8',
    );

    expect(source).not.toMatch(/incremental_vacuum/i);
    expect(source).not.toMatch(/wal_checkpoint\s*\(\s*truncate\s*\)/i);
    expect(sanitizationSource).toMatch(
      /if \(!\(await hasPendingEraseSanitization\(database\)\)\) return false;[\s\S]*PRAGMA wal_checkpoint\(TRUNCATE\)/,
    );
    expect(sanitizationSource).not.toMatch(/\bVACUUM\b|PRAGMA\s+rekey/i);
  });

  it('resumes a committed erase marker through the non-recursive keyed path', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'src/data/persistence/t1arcDatabase.ts'),
      'utf8',
    );
    const openStart = source.indexOf('async function openAndMigrate');
    const openEnd = source.indexOf('export function openT1ArcDatabase');
    const openPath = source.slice(openStart, openEnd);

    expect(openPath).toContain('resumePendingEraseSanitizationAtStartup');
    expect(openPath).toContain('completePendingEraseSanitizationWithKey(key)');
    expect(openPath).not.toContain('openT1ArcDatabase()');
  });

  it('keeps large data repairs out of the boot-critical database open', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'src/data/persistence/t1arcDatabase.ts'),
      'utf8',
    );
    const openStart = source.indexOf('async function openAndMigrate');
    const openEnd = source.indexOf('export function openT1ArcDatabase');
    const openPath = source.slice(openStart, openEnd);

    expect(openStart).toBeGreaterThanOrEqual(0);
    expect(openEnd).toBeGreaterThan(openStart);
    expect(openPath).not.toContain('backfillNativeFoodLogContextNutrition');
    expect(openPath).not.toContain('repairHevyWorkoutContextOwnership');
    expect(openPath).not.toContain('pruneRetainedGlookoSources');
    expect(source).toContain('export async function runT1ArcStartupMaintenance');
  });

  it('keeps foreground maintenance out of the latency-sensitive writer lane', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'src/data/persistence/t1arcDatabase.ts'),
      'utf8',
    );
    const maintenanceStart = source.indexOf(
      'export async function runT1ArcStartupMaintenance',
    );
    const maintenanceEnd = source.indexOf(
      'export function withT1ArcTransaction',
    );
    const maintenancePath = source.slice(maintenanceStart, maintenanceEnd);

    expect(maintenancePath).not.toContain('withT1ArcTransaction');
    expect(maintenancePath).toContain('const database = await openT1ArcDatabase()');
    expect(maintenancePath).toContain('throwIfAborted');
    expect(maintenancePath).toContain('STARTUP_MAINTENANCE_METADATA_KEY');
  });

  it('gives an atomic verified glucose commit the priority writer lane', () => {
    const databaseSource = readFileSync(
      resolve(process.cwd(), 'src/data/persistence/t1arcDatabase.ts'),
      'utf8',
    );
    const glucoseStoreSource = readFileSync(
      resolve(
        process.cwd(),
        'src/data/persistence/SqliteGlucoseHistoryStore.ts',
      ),
      'utf8',
    );
    const criticalStart = databaseSource.indexOf(
      'export function withT1ArcCriticalTransaction',
    );
    const criticalPath = databaseSource.slice(criticalStart);
    const commitStart = glucoseStoreSource.indexOf(
      'async commitVerifiedSnapshot',
    );
    const commitEnd = glucoseStoreSource.indexOf(
      'async getReadings',
      commitStart,
    );
    const commitPath = glucoseStoreSource.slice(commitStart, commitEnd);
    const transactionHelperStart = glucoseStoreSource.indexOf(
      'export async function commitVerifiedSnapshotInTransaction',
    );
    const transactionHelperEnd = glucoseStoreSource.indexOf(
      'export async function glucoseHistoryBoundsInTransaction',
      transactionHelperStart,
    );
    const transactionHelperPath = glucoseStoreSource.slice(
      transactionHelperStart,
      transactionHelperEnd,
    );

    expect(criticalStart).toBeGreaterThanOrEqual(0);
    expect(criticalPath).toContain("transactionScheduler.schedule('critical'");
    expect(criticalPath).toContain('runT1ArcTransaction(task)');
    expect(commitStart).toBeGreaterThanOrEqual(0);
    expect(commitEnd).toBeGreaterThan(commitStart);
    expect(transactionHelperStart).toBeGreaterThanOrEqual(0);
    expect(transactionHelperEnd).toBeGreaterThan(transactionHelperStart);
    expect(commitPath).toContain('withT1ArcCriticalTransaction');
    expect(commitPath).toContain('commitVerifiedSnapshotInTransaction');
    expect(transactionHelperPath).toContain(
      'upsertGlucoseReadingsInTransaction',
    );
    expect(transactionHelperPath).toContain('source_sync_state');
  });

  it('does not enable SQLCipher whole-allocation memory locking on Android', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'src/data/persistence/t1arcDatabase.ts'),
      'utf8',
    );

    expect(source).not.toMatch(/cipher_memory_security/i);
    expect(source.match(/PRAGMA key/gi)?.length).toBeGreaterThanOrEqual(3);
  });

  it('builds Android SQLCipher without unavailable page pinning', () => {
    const appConfig = JSON.parse(
      readFileSync(resolve(process.cwd(), 'app.json'), 'utf8'),
    ) as {
      expo?: { plugins?: (string | [string, Record<string, unknown>])[] };
    };
    const sqlitePlugin = appConfig.expo?.plugins?.find(
      plugin => Array.isArray(plugin) && plugin[0] === 'expo-sqlite',
    );

    expect(sqlitePlugin).toEqual([
      'expo-sqlite',
      {
        useSQLCipher: true,
        android: { customBuildFlags: '-DOMIT_MEMLOCK' },
      },
    ]);

    const gradlePropertiesPath = resolve(
      process.cwd(),
      'android',
      'gradle.properties',
    );
    if (existsSync(gradlePropertiesPath)) {
      expect(readFileSync(gradlePropertiesPath, 'utf8')).toMatch(
        /^expo\.sqlite\.customBuildFlags=-DOMIT_MEMLOCK$/m,
      );
    }
  });
});
