import type { SQLiteBindValue } from 'expo-sqlite';

interface FoodLogContextBackfillDatabase {
  runAsync(
    sql: string,
    ...parameters: SQLiteBindValue[]
  ): Promise<unknown>;
}

/**
 * Older T1 Arc meal context stored carbohydrate only even though food_logs
 * retained every macro. Run this after schema migration and after additive
 * restores so the timeline/Tarv1s view is immediately complete.
 */
export async function backfillNativeFoodLogContextNutrition(
  database: FoodLogContextBackfillDatabase,
) {
  await database.runAsync(`
    UPDATE context_events
       SET carbs_grams = COALESCE(
             carbs_grams,
             (SELECT carbohydrate_grams FROM food_logs
               WHERE food_logs.context_event_id = context_events.id)
           ),
           energy_kcal = COALESCE(
             energy_kcal,
             (SELECT energy_kcal FROM food_logs
               WHERE food_logs.context_event_id = context_events.id)
           ),
           protein_grams = COALESCE(
             protein_grams,
             (SELECT protein_grams FROM food_logs
               WHERE food_logs.context_event_id = context_events.id)
           ),
           fat_grams = COALESCE(
             fat_grams,
             (SELECT fat_grams FROM food_logs
               WHERE food_logs.context_event_id = context_events.id)
           ),
           fibre_grams = COALESCE(
             fibre_grams,
             (SELECT fibre_grams FROM food_logs
               WHERE food_logs.context_event_id = context_events.id)
           ),
           sugars_grams = COALESCE(
             sugars_grams,
             (SELECT sugars_grams FROM food_logs
               WHERE food_logs.context_event_id = context_events.id)
           ),
           saturated_fat_grams = COALESCE(
             saturated_fat_grams,
             (SELECT saturated_fat_grams FROM food_logs
               WHERE food_logs.context_event_id = context_events.id)
           )
     WHERE kind = 'meal'
       AND source_id = 't1arc-food'
       AND EXISTS (
         SELECT 1 FROM food_logs
          WHERE food_logs.context_event_id = context_events.id
       );
  `);
}
