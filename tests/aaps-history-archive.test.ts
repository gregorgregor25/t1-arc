import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { describe, expect, it } from 'vitest';

import { archiveAapsGlucoseInTransaction } from '@/data/aaps/archiveAapsHistory';
import { GLUCOSE_READINGS_CREATE_SQL } from '@/data/persistence/glucoseReadingIdentitySchema';

describe('AAPS session archive', () => {
  it.each(['flat', 'tripleUp', 'tripleDown'])('preserves %s glucose while excluding it from the next live session', async (trend) => {
    const db = new DatabaseSync(':memory:');
    db.exec(GLUCOSE_READINGS_CREATE_SQL);
    const insert = db.prepare(`INSERT INTO glucose_readings
      (id, source_id, timestamp_ms, received_at_ms, mmol_l, trend, quality)
      VALUES (?, 'aaps-local', ?, ?, ?, ?, 'measured')`);
    insert.run('aaps-local:1000', 1000, 1100, 6.5, trend);
    const transaction = {
      async runAsync(sql: string, ...params: unknown[]) {
        return db.prepare(sql).run(...params as SQLInputValue[]);
      },
    };

    await archiveAapsGlucoseInTransaction(transaction, 5, 3);
    expect(db.prepare("SELECT COUNT(*) AS count FROM glucose_readings WHERE source_id = 'aaps-local'")
      .get()).toMatchObject({ count: 0 });
    expect(db.prepare("SELECT source_id, timestamp_ms, mmol_l, trend FROM glucose_readings WHERE source_id = 'aaps-history'")
      .get()).toMatchObject({ source_id: 'aaps-history', timestamp_ms: 1000, mmol_l: 6.5, trend });

    insert.run('aaps-local:1000', 1000, 2100, 7.1, trend);
    await archiveAapsGlucoseInTransaction(transaction, 5, 5);
    expect(db.prepare("SELECT COUNT(*) AS count FROM glucose_readings WHERE source_id = 'aaps-history'")
      .get()).toMatchObject({ count: 2 });
    db.close();
  });
});
