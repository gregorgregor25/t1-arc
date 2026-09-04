export interface CoalescedPostCommitTask<Input> {
  schedule(input: Input): void;
  cancelPending(): void;
  dispose(): void;
}

interface CoalescedPostCommitTaskOptions<Input> {
  run: (input: Input, isActive: () => boolean) => Promise<unknown>;
  delayMs?: number;
  scheduleTask?: (task: () => void, delayMs: number) => void;
  onError?: (error: unknown) => void;
}

/**
 * Keeps slow derived work outside a caller's acknowledgement path while
 * coalescing bursts. A newer request received during a run gets one follow-up
 * pass with the latest input.
 */
export function createCoalescedPostCommitTask<Input>({
  run,
  delayMs = 250,
  scheduleTask = (task, delay) => {
    setTimeout(task, delay);
  },
  onError = () => undefined,
}: CoalescedPostCommitTaskOptions<Input>): CoalescedPostCommitTask<Input> {
  let disposed = false;
  let taskScheduled = false;
  let running = false;
  let pending = false;
  let latestInput: Input;
  let cancellationGeneration = 0;

  const drain = async () => {
    if (running || disposed) return;
    running = true;
    try {
      while (pending && !disposed) {
        pending = false;
        const input = latestInput;
        const runGeneration = cancellationGeneration;
        const isActive = () =>
          !disposed && runGeneration === cancellationGeneration;
        try {
          await run(input, isActive);
        } catch (error) {
          onError(error);
        }
      }
    } finally {
      running = false;
    }
  };

  return {
    schedule(input) {
      if (disposed) return;
      latestInput = input;
      pending = true;
      if (running || taskScheduled) return;
      taskScheduled = true;
      scheduleTask(() => {
        taskScheduled = false;
        void drain();
      }, delayMs);
    },
    cancelPending() {
      pending = false;
      cancellationGeneration += 1;
    },
    dispose() {
      disposed = true;
      pending = false;
      cancellationGeneration += 1;
    },
  };
}
