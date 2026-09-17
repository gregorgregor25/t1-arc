import { DatabaseSync } from 'node:sqlite';

import { describe, expect, it } from 'vitest';

import { backfillNativeFoodLogContextNutrition } from '@/data/food/foodLogContextBackfill';

describe('native food-log context nutrition backfill', () => {
  it('hydrates native context without modifying imported summary meals', async () => {
    const database = new DatabaseSync(':memory:');
    database.exec(`
      CREATE TABLE context_events (
        id TEXT PRIMARY KEY,
        source_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        carbs_grams REAL,
        energy_kcal REAL,
        protein_grams REAL,
        fat_grams REAL,
        fibre_grams REAL,
        sugars_grams REAL,
        saturated_fat_grams REAL
      );
      CREATE TABLE food_logs (
        context_event_id TEXT PRIMARY KEY,
        carbohydrate_grams REAL,
        energy_kcal REAL,
        protein_grams REAL,
        fat_grams REAL,
        fibre_grams REAL,
        sugars_grams REAL,
        saturated_fat_grams REAL
      );
      INSERT INTO context_events VALUES
        ('native', 't1arc-food', 'meal', NULL, NULL, NULL, 4, NULL, NULL, NULL),
        ('imported', 'health-connect:mfp', 'meal', NULL, 350, NULL, NULL, NULL, NULL, NULL);
      INSERT INTO food_logs VALUES
        ('native', 42, 510, 21, 18, 8, 5, 3),
        ('imported', 99, 999, 99, 99, 99, 99, 99);
    `);
    const adapter = {
      runAsync: async (sql: string, ...parameters: any[]) => {
        const result = database.prepare(sql).run(...parameters);
        return { changes: Number(result.changes) };
      },
    };

    try {
      await backfillNativeFoodLogContextNutrition(adapter);

      expect(
        database.prepare('SELECT * FROM context_events WHERE id = ?').get('native'),
      ).toMatchObject({
        carbs_grams: 42,
        energy_kcal: 510,
        protein_grams: 21,
        fat_grams: 4,
        fibre_grams: 8,
        sugars_grams: 5,
        saturated_fat_grams: 3,
      });
      expect(
        database.prepare('SELECT * FROM context_events WHERE id = ?').get('imported'),
      ).toMatchObject({
        carbs_grams: null,
        energy_kcal: 350,
        protein_grams: null,
      });
    } finally {
      database.close();
    }
  });
});
