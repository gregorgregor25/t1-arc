import { openDaymarkDatabase } from '@/data/persistence/daymarkDatabase';
import { MedicationEvent, TimeRange } from '@/domain/models';

interface MedicationRow {
  id: string;
  source_id: string;
  origin: MedicationEvent['origin'];
  start_ms: number;
  title: string;
  amount: number | null;
  unit: string | null;
  recorded_at_ms: number | null;
  source_file: string | null;
  source_row: number | null;
}

export async function getMedicationHistory(
  range: TimeRange,
  limit = 200,
): Promise<MedicationEvent[]> {
  const database = await openDaymarkDatabase();
  const rows = await database.getAllAsync<MedicationRow>(
    `SELECT id, source_id, origin, start_ms, title, amount, unit,
       recorded_at_ms, source_file, source_row
     FROM context_events
     WHERE kind = 'medication'
       AND start_ms >= ?
       AND start_ms < ?
     ORDER BY start_ms DESC
     LIMIT ?`,
    range.start,
    range.end,
    Math.max(1, Math.min(1_000, Math.floor(limit))),
  );
  return rows.map((row) => ({
    id: row.id,
    sourceId: row.source_id,
    origin: row.origin,
    kind: 'medication',
    start: row.start_ms,
    title: row.title,
    amount: row.amount ?? undefined,
    unit: row.unit ?? undefined,
    recordedAt: row.recorded_at_ms ?? undefined,
    sourceFile: row.source_file ?? undefined,
    sourceRow: row.source_row ?? undefined,
  }));
}
