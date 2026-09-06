import { readFileSync } from 'node:fs';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SqliteHealthRecordStore } from '@/data/persistence/SqliteHealthRecordStore';
import { getHealthMetricRecordsByIds } from '@/data/healthConnect/dailyHealthMetrics';
import type { BasalDelivery, BolusDelivery, MealEvent } from '@/domain/models';

const state = vi.hoisted(() => ({ database: undefined as unknown }));
vi.mock('@/data/persistence/t1arcDatabase', () => ({
  openT1ArcDatabase: async () => state.database,
  withT1ArcTransaction: async (
    work: (database: unknown) => Promise<unknown>,
  ) => {
    const adapter = state.database as Adapter;
    adapter.sqlite.exec('BEGIN IMMEDIATE');
    try {
      const result = await work(adapter);
      adapter.sqlite.exec('COMMIT');
      return result;
    } catch (error) {
      adapter.sqlite.exec('ROLLBACK');
      throw error;
    }
  },
}));

class Adapter {
  failContext = false;
  constructor(readonly sqlite: DatabaseSync) {}
  async runAsync(sql: string, ...params: SQLInputValue[]) {
    if (
      this.failContext &&
      sql.includes('INSERT OR IGNORE INTO context_events')
    )
      throw new Error('fixture write failure');
    const result = this.sqlite.prepare(sql).run(...params);
    return {
      changes: Number(result.changes),
      lastInsertRowId: Number(result.lastInsertRowid),
    };
  }
  async getFirstAsync(sql: string, ...params: SQLInputValue[]) {
    return this.sqlite.prepare(sql).get(...params) ?? null;
  }
  async getAllAsync(sql: string, ...params: SQLInputValue[]) {
    return this.sqlite.prepare(sql).all(...params);
  }
}

const batch = {
  id: 'fixture-import',
  sourceId: 'glooko-export',
  fileName: 'synthetic.csv',
  fileSha256: 'fixture-sha',
  importedAt: 1000,
  skippedCount: 0,
  warnings: [],
};
const basal = (id: string, start = 1000): BasalDelivery => ({
  id,
  sourceId: batch.sourceId,
  start,
  end: start + 1_800_000,
  rateUnitsPerHour: 0.8,
  units: 0.4,
});
const bolus = (id: string): BolusDelivery => ({
  id,
  sourceId: batch.sourceId,
  timestamp: 1000,
  units: 2.5,
  carbsInputGrams: 30,
  carbRatioGramsPerUnit: 12,
});
const meal = (id: string): MealEvent => ({
  id,
  sourceId: batch.sourceId,
  origin: 'imported',
  kind: 'meal',
  start: 1000,
  title: 'Fixture lunch',
  mealType: 'lunch',
  carbsGrams: 45,
});

describe('batched imports against real SQLite', () => {
  let sqlite: DatabaseSync;
  let adapter: Adapter;
  beforeEach(() => {
    sqlite = new DatabaseSync(':memory:');
    // Exercise the production table definitions, including their constraints.
    const schema = readFileSync(
      'src/data/persistence/t1arcDatabase.ts',
      'utf8',
    );
    for (const table of [
      'insulin_basal',
      'insulin_bolus',
      'insulin_daily_totals',
      'context_events',
      'context_notes',
      'import_batches',
      'import_source_payloads',
      'import_raw_records',
      'glooko_report_payloads',
      'health_connect_sources',
      'app_metadata',
    ]) {
      const sql = schema.match(
        new RegExp(
          `CREATE TABLE IF NOT EXISTS ${table} \\([\\s\\S]*?\\n    \\);`,
        ),
      )?.[0];
      if (!sql) throw new Error(`Production schema not found: ${table}`);
      sqlite.exec(sql);
    }
    adapter = new Adapter(sqlite);
    state.database = adapter;
  });
  afterEach(() => sqlite.close());

  it('preserves every value, counts duplicates and never duplicates an identical reimport', async () => {
    const deliveries = Array.from({ length: 4320 }, (_, index) =>
      basal(`basal-${index}`, 1000 + index * 1_800_000),
    );
    const boluses = Array.from({ length: 180 }, (_, index) =>
      bolus(`bolus-${index}`),
    );
    const meals = Array.from({ length: 270 }, (_, index) =>
      meal(`meal-${index}`),
    );
    const store = new SqliteHealthRecordStore();
    const result = await store.writeImport(batch, deliveries, boluses, meals);
    expect(result).toMatchObject({
      insertedBasal: 4320,
      insertedBoluses: 180,
      insertedContext: 270,
      duplicateCount: 0,
    });
    const before = ['insulin_basal', 'insulin_bolus', 'context_events'].map(
      (table) => sqlite.prepare(`SELECT * FROM ${table} ORDER BY id`).all(),
    );
    expect(before[0]?.[0]).toMatchObject({
      units: 0.4,
      rate_units_per_hour: 0.8,
    });
    expect(before[1]?.[0]).toMatchObject({
      units: 2.5,
      carbs_input_grams: 30,
      carb_ratio_grams_per_unit: 12,
    });
    expect(before[2]?.[0]).toMatchObject({
      carbs_grams: 45,
      origin: 'imported',
    });
    const duplicate = await store.writeImport(
      batch,
      deliveries,
      boluses,
      meals,
    );
    expect(duplicate).toMatchObject({
      insertedBasal: 0,
      insertedBoluses: 0,
      insertedContext: 0,
      duplicateCount: 4770,
    });
    expect(
      ['insulin_basal', 'insulin_bolus', 'context_events'].map((table) =>
        sqlite.prepare(`SELECT * FROM ${table} ORDER BY id`).all(),
      ),
    ).toEqual(before);
  });
  it('flushes ordinary rows before an ordered legacy-ID replacement', async () => {
    const store = new SqliteHealthRecordStore();
    const result = await store.writeImport(
      batch,
      [basal('old'), { ...basal('new'), legacyId: 'old' }, basal('after')],
      [bolus('old'), { ...bolus('new'), legacyId: 'old' }, bolus('after')],
      [],
    );
    expect(result).toMatchObject({ insertedBasal: 2, insertedBoluses: 2 });
    expect(
      sqlite.prepare('SELECT id FROM insulin_basal ORDER BY id').all(),
    ).toEqual([{ id: 'after' }, { id: 'new' }]);
    expect(
      sqlite.prepare('SELECT id FROM insulin_bolus ORDER BY id').all(),
    ).toEqual([{ id: 'after' }, { id: 'new' }]);
  });
  it('rolls back already flushed batches and metadata when a later write fails', async () => {
    adapter.failContext = true;
    await expect(
      new SqliteHealthRecordStore().writeImport(
        batch,
        Array.from({ length: 81 }, (_, index) => basal(`basal-${index}`)),
        [],
        [meal('meal')],
      ),
    ).rejects.toThrow('fixture write failure');
    expect(
      sqlite.prepare('SELECT COUNT(*) AS count FROM insulin_basal').get(),
    ).toEqual({ count: 0 });
    expect(
      sqlite.prepare('SELECT COUNT(*) AS count FROM import_batches').get(),
    ).toEqual({ count: 0 });
  });
  it('resolves manual metric evidence from the original record after edits and deletions', async () => {
    const store = new SqliteHealthRecordStore();
    const weight = {
      id: 'manual-weight',
      sourceId: 'manual-entry',
      origin: 'manual' as const,
      kind: 'weight' as const,
      start: 1000,
      title: 'Weight',
      kilograms: 80,
    };
    await store.saveManualContext(weight, {
      insightInvalidation: 'mark-dirty',
    });
    expect(
      await getHealthMetricRecordsByIds(['context-weight:manual-weight']),
    ).toMatchObject([{ value: 80, sourceLabel: 'Manual log' }]);
    await store.saveManualContext(
      { ...weight, kilograms: 81 },
      { insightInvalidation: 'mark-dirty' },
    );
    expect(
      await getHealthMetricRecordsByIds(['context-weight:manual-weight']),
    ).toMatchObject([{ value: 81 }]);
    sqlite.prepare('DELETE FROM context_events WHERE id = ?').run(weight.id);
    expect(
      await getHealthMetricRecordsByIds(['context-weight:manual-weight']),
    ).toEqual([]);
  });
});
