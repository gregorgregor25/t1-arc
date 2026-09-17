import type { SQLiteDatabase } from 'expo-sqlite';

import { HEVY_SOURCE_ID, hevyWorkoutToActivity } from './mapping';
import { parseHevyWorkout } from './validation';

interface HevyOwnershipRow {
  id: string;
  context_event_id: string;
  linked_source_id: string | null;
  title: string;
  start_ms: number;
  end_ms: number;
  payload_json: string;
  imported_at_ms: number;
}

function fallbackActivity(row: HevyOwnershipRow) {
  return {
    title: row.title,
    start: row.start_ms,
    end: row.end_ms,
    durationMinutes: Math.max(0, (row.end_ms - row.start_ms) / 60_000),
    intensity: 'unspecified' as const,
  };
}

function activityFromStoredWorkout(row: HevyOwnershipRow) {
  try {
    return hevyWorkoutToActivity(
      parseHevyWorkout(JSON.parse(row.payload_json)),
      row.imported_at_ms,
    );
  } catch {
    // Old detail must remain recoverable even if a future/partial payload can
    // no longer be fully decoded by this build.
    return fallbackActivity(row);
  }
}

/**
 * Repairs builds that linked Hevy detail directly to a Health Connect context
 * row. The operation is additive and idempotent: the Health Connect row is
 * never changed or removed, while every Hevy detail row is moved beneath a
 * source-owned `hevy:<workout id>` context row.
 *
 * This accepts an existing transaction as well as the startup database
 * connection, so backup restore can repair legacy portable rows immediately.
 */
export async function repairHevyWorkoutContextOwnership(
  database: SQLiteDatabase,
) {
  const rows = await database.getAllAsync<HevyOwnershipRow>(
    `SELECT h.id, h.context_event_id, c.source_id AS linked_source_id,
            h.title, h.start_ms, h.end_ms, h.payload_json, h.imported_at_ms
       FROM hevy_workouts h
       LEFT JOIN context_events c ON c.id = h.context_event_id
      WHERE c.source_id IS NULL
         OR c.source_id <> ?
         OR h.context_event_id <> ('hevy:' || h.id)
      ORDER BY h.id ASC`,
    HEVY_SOURCE_ID,
  );

  let repaired = 0;
  for (const row of rows) {
    const contextId = `hevy:${row.id}`;
    const conflicting = await database.getFirstAsync<{ source_id: string }>(
      'SELECT source_id FROM context_events WHERE id = ?',
      contextId,
    );
    if (conflicting && conflicting.source_id !== HEVY_SOURCE_ID) {
      throw new Error(
        `A non-Hevy context row already owns the reserved workout id ${contextId}.`,
      );
    }

    const activity = activityFromStoredWorkout(row);
    const activityEnd =
      activity.end ?? activity.start + activity.durationMinutes * 60_000;
    await database.runAsync(
      `INSERT INTO context_events (
         id, source_id, origin, kind, start_ms, end_ms, title,
         activity_type, duration_minutes, intensity, recorded_at_ms
       ) VALUES (?, ?, 'imported', 'activity', ?, ?, ?, 'strength', ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         source_id = excluded.source_id,
         origin = excluded.origin,
         kind = excluded.kind,
         start_ms = excluded.start_ms,
         end_ms = excluded.end_ms,
         title = excluded.title,
         activity_type = excluded.activity_type,
         duration_minutes = excluded.duration_minutes,
         intensity = excluded.intensity,
         recorded_at_ms = excluded.recorded_at_ms`,
      contextId,
      HEVY_SOURCE_ID,
      activity.start,
      activityEnd,
      activity.title,
      activity.durationMinutes,
      activity.intensity,
      row.imported_at_ms,
    );
    await database.runAsync(
      'UPDATE hevy_workouts SET context_event_id = ? WHERE id = ?',
      contextId,
      row.id,
    );

    if (
      row.linked_source_id === HEVY_SOURCE_ID &&
      row.context_event_id !== contextId
    ) {
      await database.runAsync(
        `DELETE FROM context_events
          WHERE id = ? AND source_id = ?
            AND NOT EXISTS (
              SELECT 1 FROM hevy_workouts
               WHERE context_event_id = context_events.id
            )`,
        row.context_event_id,
        HEVY_SOURCE_ID,
      );
    }
    repaired += 1;
  }
  return repaired;
}
