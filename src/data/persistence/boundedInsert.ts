import type { SQLiteBindValue } from 'expo-sqlite';

interface InsertDatabase {
  runAsync(
    sql: string,
    ...parameters: SQLiteBindValue[]
  ): Promise<{ changes: number }>;
}

/** Caller owns the transaction. SQL is a static INSERT prefix, never user input. */
export function createBoundedInsert(
  database: InsertDatabase,
  insert: string,
  columns: number,
) {
  const maxRows = Math.min(40, Math.floor(900 / columns));
  if (!Number.isInteger(columns) || columns < 1 || maxRows < 1) {
    throw new Error('Invalid insert column count.');
  }
  let rows: SQLiteBindValue[][] = [];
  const placeholder = `(${Array.from({ length: columns }, () => '?').join(', ')})`;
  async function flush() {
    if (!rows.length) return 0;
    const pending = rows;
    rows = [];
    const result = await database.runAsync(
      `${insert} VALUES ${pending.map(() => placeholder).join(', ')}`,
      ...pending.flat(),
    );
    return result.changes;
  }
  return {
    async add(values: SQLiteBindValue[]) {
      if (values.length !== columns)
        throw new Error('Insert values do not match columns.');
      rows.push(values);
      return rows.length >= maxRows ? flush() : 0;
    },
    flush,
  };
}
