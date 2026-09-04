export type TransactionPriority = 'normal' | 'critical';

interface ScheduledTransaction {
  run(): Promise<void>;
}

export interface PriorityTransactionScheduler {
  schedule<T>(priority: TransactionPriority, work: () => Promise<T>): Promise<T>;
}

/**
 * Keeps one writer active in a JS runtime and lets latency-critical work run
 * before already-queued bulk chunks. The active transaction is never
 * interrupted; SQLite atomicity is preserved at every hand-off.
 */
export function createPriorityTransactionScheduler(): PriorityTransactionScheduler {
  const critical: ScheduledTransaction[] = [];
  const normal: ScheduledTransaction[] = [];
  let draining = false;

  const drain = async () => {
    if (draining) return;
    draining = true;
    try {
      while (critical.length > 0 || normal.length > 0) {
        const next = critical.shift() ?? normal.shift();
        if (next) await next.run();
      }
    } finally {
      draining = false;
      // A job can be queued between the final length check and this finally.
      if (critical.length > 0 || normal.length > 0) void drain();
    }
  };

  return {
    schedule<T>(
      priority: TransactionPriority,
      work: () => Promise<T>,
    ): Promise<T> {
      return new Promise<T>((resolve, reject) => {
        const job: ScheduledTransaction = {
          run: async () => {
            try {
              resolve(await work());
            } catch (error) {
              reject(error);
            }
          },
        };
        (priority === 'critical' ? critical : normal).push(job);
        void drain();
      });
    },
  };
}
