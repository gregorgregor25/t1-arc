import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { createReusableConnection } from '@/data/persistence/reusableConnection';

function pool() {
  let opened = 0;
  const closed: number[] = [];
  const open = vi.fn(async () => {
    opened += 1;
    return opened;
  });
  const connection = createReusableConnection(open, async (id: number) => {
    closed.push(id);
  });
  return { connection, open, closed };
}

describe('reusable keyed writer connection', () => {
  it('keys one connection for a run of serial transactions', async () => {
    const { connection, open, closed } = pool();
    for (let index = 0; index < 50; index += 1) {
      const current = await connection.take();
      await connection.release(current, true);
    }
    expect(open).toHaveBeenCalledTimes(1);
    expect(closed).toEqual([]);
  });

  it('replaces a connection that ended in an unknown state', async () => {
    const { connection, open, closed } = pool();
    const first = await connection.take();
    await connection.release(first, false);
    const second = await connection.take();
    expect(second).not.toBe(first);
    expect(closed).toEqual([first]);
    expect(open).toHaveBeenCalledTimes(2);
  });

  it('never shares a connection between overlapping users', async () => {
    const { connection, closed } = pool();
    const first = await connection.take();
    const second = await connection.take();
    expect(second).not.toBe(first);
    await connection.release(first, true);
    await connection.release(second, true);
    // Only one idle connection is kept; the extra one is closed.
    expect(closed).toEqual([second]);
    expect(await connection.take()).toBe(first);
  });

  it('closes the idle connection before an erase', async () => {
    const { connection, open, closed } = pool();
    const first = await connection.take();
    await connection.release(first, true);
    await connection.discardIdle();
    expect(closed).toEqual([first]);
    await connection.take();
    expect(open).toHaveBeenCalledTimes(2);
  });

  it('keeps the transaction runner on the reused, already-keyed writer', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'src/data/persistence/t1arcDatabase.ts'),
      'utf8',
    );
    const start = source.indexOf('async function runT1ArcTransaction');
    const end = source.indexOf('/**', start);
    const runner = source.slice(start, end);
    expect(runner).toContain('writerConnection.take()');
    expect(runner).toContain('writerConnection.release(transaction, reusable)');
    expect(runner).not.toMatch(/PRAGMA key/);
    expect(runner).not.toContain('openDatabaseAsync');
    const erase = source.slice(
      source.indexOf('export async function withT1ArcSanitizedEraseTransaction'),
    );
    expect(erase.indexOf('writerConnection.discardIdle()')).toBeGreaterThan(0);
    expect(erase.indexOf('writerConnection.discardIdle()')).toBeLessThan(
      erase.indexOf('openKeyedPrivateConnection('),
    );
  });
});
