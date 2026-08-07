import { SQLiteDatabase } from 'expo-sqlite';

import {
  openDaymarkDatabase,
  withDaymarkTransaction,
} from '@/data/persistence/daymarkDatabase';

import {
  NOTIFICATION_PARSER_VERSION,
  StoredNotificationEvent,
} from './types';

export interface NotificationEventBounds {
  earliest?: number;
  latest?: number;
  count: number;
}

export class NotificationEventStore {
  private database?: SQLiteDatabase;

  private async getDatabase() {
    this.database ??= await openDaymarkDatabase();
    return this.database;
  }

  async save(events: StoredNotificationEvent[]) {
    if (events.length === 0) return;
    await this.getDatabase();
    await withDaymarkTransaction(async (transaction) => {
      for (const event of events) {
        const { observation, importedAt } = event;
        const { envelope } = observation;
        await transaction.runAsync(
          `INSERT INTO notification_source_events (
             id, package_name, posted_at_ms, notification_when_ms,
             received_at_ms, is_ongoing, payload_json, parser_version,
             parsed_glucose_id, parsed_iob_units, parsed_pump_mode,
             imported_at_ms
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             parser_version = excluded.parser_version,
             parsed_glucose_id = excluded.parsed_glucose_id,
             parsed_iob_units = excluded.parsed_iob_units,
             parsed_pump_mode = excluded.parsed_pump_mode,
             imported_at_ms = excluded.imported_at_ms`,
          envelope.id,
          envelope.packageName,
          envelope.postedAt,
          envelope.notificationWhen ?? null,
          envelope.receivedAt,
          envelope.isOngoing ? 1 : 0,
          JSON.stringify(envelope),
          NOTIFICATION_PARSER_VERSION,
          observation.glucose?.id ?? null,
          observation.pump?.iobUnits ?? null,
          observation.pump?.mode ?? null,
          importedAt,
        );
      }
    });
  }

  async getBounds(): Promise<NotificationEventBounds> {
    const database = await this.getDatabase();
    const row = await database.getFirstAsync<{
      earliest: number | null;
      latest: number | null;
      count: number;
    }>(
      `SELECT MIN(posted_at_ms) AS earliest, MAX(posted_at_ms) AS latest,
         COUNT(*) AS count
       FROM notification_source_events`,
    );
    return {
      earliest: row?.earliest ?? undefined,
      latest: row?.latest ?? undefined,
      count: row?.count ?? 0,
    };
  }
}
