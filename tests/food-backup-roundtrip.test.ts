import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BACKUP_TABLE_NAMES, backupRestoreBinding, createHealthBackupFile,
  mergeHealthBackup, mergePreparedHealthBackup, readHealthBackupFile,
  validateHealthBackupDocument, HEALTH_BACKUP_FORMAT, HEALTH_BACKUP_VERSION,
} from '@/data/backup/healthBackup';
import { cacheFoodBarcodeLookup, getFoodBarcodeCacheEntry, getFoodRecipePage,
  saveFoodPersonalServing, saveFoodRecipe,
} from '@/data/food/foodLogRepository';
import { createMyFood, listMyFoods } from '@/data/food/myFoodsRepository';
import { parseFoodDataCentralFood } from '@/data/food/usdaFoodDataCentral';

const harness = vi.hoisted(() => ({ database: undefined as unknown,
  files: new Map<string, Uint8Array>(),
}));

vi.mock('@/data/persistence/t1arcDatabase', () => ({
  openT1ArcDatabase: async () => harness.database,
  withT1ArcReadSnapshot: async (task: (database: unknown) => Promise<unknown>) => task(harness.database),
  withT1ArcTransaction: async (task: (database: unknown) => Promise<unknown>) => {
    const database = harness.database as TestDatabase;
    database.sqlite.exec('BEGIN');
    try { const result = await task(database); database.sqlite.exec('COMMIT'); return result; }
    catch (error) { database.sqlite.exec('ROLLBACK'); throw error; }
  },
  backfillLegacyGlookoMeterContextNotes: async () => 0,
}));
vi.mock('@/data/privacy/localDataWriteEpoch', () => ({
  acquireLocalDataWriteLease: async () => ({ epoch: 4 }),
  readLocalDataWriteEpochFromDatabase: async () => 4,
  assertLocalDataWriteLeaseInTransaction: async () => undefined,
}));
vi.mock('@/data/backup/portablePreferences', () => ({ capturePortablePreferences: async () => undefined }));
vi.mock('@/data/hevy/contextOwnership', () => ({ repairHevyWorkoutContextOwnership: async () => 0 }));
vi.mock('expo-crypto', () => ({}));
vi.mock('expo-secure-store', () => ({}));
vi.mock('expo-sqlite', () => ({}));
vi.mock('expo-file-system', () => ({
  File: class {
    readonly uri: string;
    constructor(...parts: string[]) { this.uri = parts.join('/'); }
    get exists() { return harness.files.has(this.uri); }
    get size() { return harness.files.get(this.uri)?.length ?? 0; }
    create() { harness.files.set(this.uri, new Uint8Array()); }
    delete() { harness.files.delete(this.uri); }
    open() {
      const uri = this.uri;
      let offset = 0;
      return {
        close() {},
        get size() { return harness.files.get(uri)?.length ?? 0; },
        get offset() { return offset; },
        set offset(value: number) { offset = value; },
        readBytes(length: number) {
          const bytes = harness.files.get(uri)!.slice(offset, offset + length);
          offset += bytes.length;
          return bytes;
        },
        writeBytes(bytes: Uint8Array) {
          const previous = harness.files.get(uri)!;
          const next = new Uint8Array(Math.max(previous.length, offset + bytes.length));
          next.set(previous); next.set(bytes, offset); offset += bytes.length;
          harness.files.set(uri, next);
        },
      };
    }
  },
  Paths: { cache: 'file:///cache' }, FileMode: { ReadOnly: 'r', Truncate: 'wt' },
}));

class TestDatabase {
  constructor(readonly sqlite: DatabaseSync) {}
  async getFirstAsync<T>(sql: string, ...params: SQLInputValue[]) {
    return (this.sqlite.prepare(sql).get(...params) ?? null) as T | null;
  }
  async getAllAsync<T>(sql: string, ...params: SQLInputValue[]) {
    return this.sqlite.prepare(sql).all(...params) as T[];
  }
  async *getEachAsync<T>(sql: string, ...params: SQLInputValue[]) {
    for (const row of this.sqlite.prepare(sql).iterate(...params)) yield row as T;
  }
  async runAsync(sql: string, ...params: SQLInputValue[]) {
    const result = this.sqlite.prepare(sql).run(...params);
    return { changes: Number(result.changes), lastInsertRowId: result.lastInsertRowid };
  }
}

// This fixture follows the real backup column contract. Production schema/FK
// constraints have separate migration tests; this targets the actual serializer,
// streaming validator, restore bindings and subsequent repository reads.
function database() {
  const sqlite = new DatabaseSync(':memory:');
  for (const table of BACKUP_TABLE_NAMES) {
    if (table === 'portable_app_state') continue;
    const columns = backupRestoreBinding(table, {}).columns;
    sqlite.exec(`CREATE TABLE "${table}" (${columns.map((column) =>
      `"${column}"${column === 'id' ? ' PRIMARY KEY' : ''}`).join(', ')})`);
  }
  sqlite.exec('CREATE TABLE app_metadata (key TEXT PRIMARY KEY, value TEXT)');
  return new TestDatabase(sqlite);
}

const opened: TestDatabase[] = [];
function useEmptyDatabase() {
  const next = database(); opened.push(next); harness.database = next; return next;
}
beforeEach(() => { harness.files.clear(); useEmptyDatabase(); });
afterEach(() => { opened.splice(0).forEach((entry) => entry.sqlite.close()); });

async function seedFoods() {
  const personal = await createMyFood({ name: 'Backup oats', servingAmount: 40,
    servingUnit: 'g', nutritionPerServing: { carbohydrateGrams: 24, fatGrams: 0 },
  }, { lease: { epoch: 4 }, now: 1_780_000_000_000, entropy: 'backup' });
  const privateMetadata = { ...personal, nutrientDefinitions: {
    carbohydrate: 'available' as const, energy: 'reported' as const, note: 'Personal label definition',
  } };
  // Normal food persistence, not hand-authored raw_payload_json.
  await saveFoodRecipe({ name: 'Private recipe', mealType: 'breakfast', servings: 2,
    ingredients: [{ food: privateMetadata, amount: 80, unit: 'g' }],
  }, { epoch: 4 });
  await saveFoodPersonalServing(privateMetadata, { amount: 55, unit: 'g', label: 'My bowl' }, { epoch: 4 });
  const remote = { ...parseFoodDataCentralFood({ fdcId: 9081, description: 'Backup drink',
    dataType: 'Branded', gtinUpc: '00012345678905', servingSize: 240, servingSizeUnit: 'MLT',
    foodNutrients: [{ nutrientId: 1005, value: 12 }, { nutrientId: 2047, value: 48 }],
  }), catalogueObservedAt: Date.parse('2026-04-30T00:00:00Z') };
  await cacheFoodBarcodeLookup(remote, { epoch: 4 });
  await saveFoodPersonalServing(remote, { amount: 180, unit: 'ml', label: 'My glass' }, { epoch: 4 });
  await saveFoodRecipe({ name: 'Cached recipe', mealType: 'snack', servings: 2,
    ingredients: [{ food: remote, amount: 480, unit: 'ml' }],
  }, { epoch: 4 });
  return { personal, remote };
}

function foodRows(database: TestDatabase) {
  return Object.fromEntries(['food_catalog_cache', 'food_recipes', 'food_recipe_items'].map((table) =>
    [table, database.sqlite.prepare(`SELECT * FROM ${table} ORDER BY id`).all()]));
}

describe('food metadata through backup serialization and restore', () => {
  it.each(['stream', 'legacy-json'] as const)('preserves private/cache metadata and recipe snapshots through %s', async (format) => {
    const { personal, remote } = await seedFoods();
    const original = harness.database as TestDatabase;
    const beforeRows = foodRows(original);
    const beforeRecipes = (await getFoodRecipePage()).items;
    if (format === 'stream') {
      const workingFileUri = 'file:///private/no_backup/encrypted-backups/backup-test.container';
      const exported = await createHealthBackupFile(workingFileUri);
      expect(exported.file.uri).toBe(workingFileUri);
      expect(exported.summary.counts.food_catalog_cache).toBe(2);
      // This is precisely the opaque container handed to native compression /
      // encryption and returned by decryption. Native crypto is not mocked as
      // a schema-aware JSON transform, nor claimed to execute in this JS test.
      const exportedBytes = harness.files.get(exported.file.uri)!;
      harness.files.set('file:///decrypted.container', exportedBytes.slice());
      const prepared = await readHealthBackupFile('file:///decrypted.container');
      expect(prepared.kind).toBe('stream');
      useEmptyDatabase();
      await mergePreparedHealthBackup(prepared);
    } else {
      const tables = Object.fromEntries(BACKUP_TABLE_NAMES.map((table) => [table,
        table === 'portable_app_state' ? [] : original.sqlite.prepare(`SELECT * FROM "${table}"`).all(),
      ]));
      const counts = Object.fromEntries(Object.entries(tables).map(([table, rows]) => [table, rows.length]));
      const validated = validateHealthBackupDocument(JSON.parse(JSON.stringify({ manifest: {
        format: HEALTH_BACKUP_FORMAT, version: HEALTH_BACKUP_VERSION, createdAt: Date.now(),
        timeZone: 'Europe/London', counts, totalRecords: Object.values(counts).reduce((a, b) => a + b, 0),
        excludes: ['credentials'],
      }, tables })));
      useEmptyDatabase();
      await mergeHealthBackup(validated);
    }
    expect(foodRows(harness.database as TestDatabase)).toEqual(beforeRows);
    expect(await listMyFoods()).toMatchObject([{ id: personal.id, personalServingAmount: 55,
      personalServingUnit: 'g', personalServingLabel: 'My bowl', nutrientDefinitions: {
        carbohydrate: 'available', energy: 'reported', note: 'Personal label definition',
      }, nutritionPerBasis: { carbohydrateGrams: 24, fatGrams: 0, energyKcal: undefined },
    }]);
    expect((await getFoodBarcodeCacheEntry('012345678905'))?.food).toMatchObject({
      personalServingAmount: 180, personalServingUnit: 'ml', personalServingLabel: 'My glass',
      catalogueObservedAt: remote.catalogueObservedAt, catalogueStatus: 'stale',
      nutrientDefinitions: { carbohydrate: 'total', energy: 'atwater-general' },
    });
    expect((await getFoodRecipePage()).items).toEqual(beforeRecipes);
  });

  it('records the pre-backup recipe metadata boundary without mistaking it for restore loss', async () => {
    await seedFoods();
    const recipe = (await getFoodRecipePage({ query: 'Cached recipe' })).items[0]!;
    expect(recipe.ingredients[0]!.food).toMatchObject({ basisAmount: 480, basisUnit: 'ml',
      nutritionPerBasis: { carbohydrateGrams: 57.6, energyKcal: 230.4 },
    });
    expect(recipe.ingredients[0]!.food.nutrientDefinitions).toBeUndefined();
    expect(recipe.ingredients[0]!.food.catalogueObservedAt).toBeUndefined();
    expect(recipe.ingredients[0]!.food.personalServingAmount).toBeUndefined();
    expect((await getFoodBarcodeCacheEntry('012345678905'))?.food.personalServingAmount).toBe(180);
  });
});
