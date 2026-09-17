import { describe, expect, it } from 'vitest';

import { createPriorityTransactionScheduler } from '@/data/persistence/priorityTransactionScheduler';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((release) => {
    resolve = release;
  });
  return { promise, resolve };
}

describe('priority transaction scheduler', () => {
  it('finishes the active writer, then runs critical work before queued bulk work', async () => {
    const scheduler = createPriorityTransactionScheduler();
    const active = deferred();
    const order: string[] = [];
    let running = 0;
    let maximumRunning = 0;
    const work = async (label: string, wait?: Promise<void>) => {
      running += 1;
      maximumRunning = Math.max(maximumRunning, running);
      order.push(`${label}:start`);
      await wait;
      order.push(`${label}:end`);
      running -= 1;
      return label;
    };

    const first = scheduler.schedule('normal', () =>
      work('normal-active', active.promise),
    );
    const queuedNormal = scheduler.schedule('normal', () =>
      work('normal-queued'),
    );
    const critical = scheduler.schedule('critical', () => work('critical'));

    await Promise.resolve();
    expect(order).toEqual(['normal-active:start']);
    active.resolve();

    await expect(Promise.all([first, queuedNormal, critical])).resolves.toEqual([
      'normal-active',
      'normal-queued',
      'critical',
    ]);
    expect(order).toEqual([
      'normal-active:start',
      'normal-active:end',
      'critical:start',
      'critical:end',
      'normal-queued:start',
      'normal-queued:end',
    ]);
    expect(maximumRunning).toBe(1);
  });

  it('continues draining after a failed transaction', async () => {
    const scheduler = createPriorityTransactionScheduler();
    const failed = scheduler.schedule('normal', async () => {
      throw new Error('write failed');
    });
    const next = scheduler.schedule('critical', async () => 'recovered');

    await expect(failed).rejects.toThrow('write failed');
    await expect(next).resolves.toBe('recovered');
  });
});
