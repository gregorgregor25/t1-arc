import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

// Execute the actual migration body against SQLite without loading native Expo.
const source = readFileSync(resolve(process.cwd(), 'src/data/persistence/t1arcDatabase.ts'), 'utf8');
const migrationSource = source.slice(source.indexOf('export async function ensureRegionalFoodProviderKinds('), source.indexOf('async function openAndMigrate()'));
const compiled = ts.transpileModule(migrationSource, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;

function oldDatabase() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys = ON; CREATE TABLE food_logs (id TEXT PRIMARY KEY); CREATE TABLE food_recipes (id TEXT PRIMARY KEY);');
  for (const name of ['food_catalog_cache', 'food_log_items', 'food_recipe_items']) {
    const statement = migrationSource.match(new RegExp(`CREATE TABLE ${name}_regional \\([\\s\\S]*?\\n      \\);`))?.[0];
    if (!statement) throw new Error(`Missing production table definition: ${name}`);
    sqlite.exec(statement.replace(`${name}_regional`, name).replace("'cnf', 'ciqual', 'bls', 'fineli', ", ''));
  }
  sqlite.exec(`
    INSERT INTO food_logs VALUES ('meal'); INSERT INTO food_recipes VALUES ('recipe');
    INSERT INTO food_catalog_cache (id, provider, external_id, name, basis_amount, basis_unit,
      carbohydrate_grams, nutrition_quality_json, source_label, cached_at_ms, is_favorite, use_count)
      VALUES ('food', 'cofid', '1', 'Historic oats', 100, 'g', 60, '{}', 'CoFID', 1234, 1, 7);
    INSERT INTO food_log_items (id, food_log_id, ordinal, catalog_id, provider, external_id,
      name_snapshot, amount, unit, carbohydrate_grams, source_label)
      VALUES ('item', 'meal', 0, 'food', 'cofid', '1', 'Historic oats', 50, 'g', 30, 'CoFID');
    INSERT INTO food_recipe_items (id, recipe_id, ordinal, catalog_id, provider, external_id,
      name_snapshot, amount, unit, carbohydrate_grams, source_label)
      VALUES ('ingredient', 'recipe', 0, 'food', 'cofid', '1', 'Historic oats', 200, 'g', 120, 'CoFID');
  `);
  return sqlite;
}

describe('regional food provider migration', () => {
  it('widens existing CHECK constraints while preserving rows, links, indexes and future deletes', async () => {
    const sqlite = oldDatabase();
    try {
      const adapter = {
        execAsync: async (sql: string) => { sqlite.exec(sql); },
        getFirstAsync: async (sql: string, ...args: SQLInputValue[]) => sqlite.prepare(sql).get(...args) ?? null,
      };
      const exports: { ensureRegionalFoodProviderKinds?: (database: typeof adapter) => Promise<void> } = {};
      runInNewContext(compiled, { exports });
      const before = ['food_catalog_cache', 'food_log_items', 'food_recipe_items'].map((name) => sqlite.prepare(`SELECT * FROM ${name}`).all());
      await exports.ensureRegionalFoodProviderKinds!(adapter);
      expect(['food_catalog_cache', 'food_log_items', 'food_recipe_items'].map((name) => sqlite.prepare(`SELECT * FROM ${name}`).all())).toEqual(before);
      expect(sqlite.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
      expect(sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE 'idx_food_%'").all()).toHaveLength(5);
      for (const provider of ['cnf', 'ciqual', 'bls', 'fineli']) {
        sqlite.prepare(`INSERT INTO food_catalog_cache (id, provider, external_id, name, basis_amount,
          basis_unit, nutrition_quality_json, source_label, cached_at_ms) VALUES (?, ?, ?, ?, 100, 'g', '{}', ?, 0)`)
          .run(provider, provider, provider, provider, provider);
      }
      await exports.ensureRegionalFoodProviderKinds!(adapter);
      expect(sqlite.prepare('SELECT COUNT(*) AS count FROM food_catalog_cache').get()).toEqual({ count: 5 });
      sqlite.exec("DELETE FROM food_catalog_cache WHERE id = 'food'");
      expect(sqlite.prepare('SELECT catalog_id, carbohydrate_grams FROM food_log_items').get()).toEqual({ catalog_id: null, carbohydrate_grams: 30 });
      expect(sqlite.prepare('SELECT catalog_id, carbohydrate_grams FROM food_recipe_items').get()).toEqual({ catalog_id: null, carbohydrate_grams: 120 });
    } finally { sqlite.close(); }
  });
});
