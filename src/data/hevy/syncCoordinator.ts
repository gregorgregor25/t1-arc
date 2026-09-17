import { HevySyncSupersededError } from "./ownership";

export interface HevySyncLease {
  readonly generation: number;
  readonly signal: AbortSignal;
  isCurrent(): boolean;
}

export interface HevyExclusiveChangeBarrier {
  ready: Promise<void>;
  release(): void;
}

/**
 * Serialises Hevy account/sync work in one JavaScript runtime. Exclusive data
 * changes invalidate older leases immediately, signal local request/sleep
 * cancellation, drain their real promises, and reject new reservations until
 * released. Aborting the client wait does not claim that a remote server has
 * stopped work it may already have received.
 */
export class HevySyncCoordinator {
  private blocked = false;
  private readonly controllers = new Set<AbortController>();
  private generation = 0;
  private tail: Promise<void> = Promise.resolve();

  run<T>(factory: (lease: HevySyncLease) => Promise<T>): Promise<T> {
    if (this.blocked) return Promise.reject(new HevySyncSupersededError());

    const generation = this.generation;
    const controller = new AbortController();
    this.controllers.add(controller);
    const lease: HevySyncLease = {
      generation,
      signal: controller.signal,
      isCurrent: () =>
        !controller.signal.aborted &&
        !this.blocked &&
        this.generation === generation,
    };
    const predecessor = this.tail;
    const run = predecessor.then(
      async () => {
        if (!lease.isCurrent()) throw new HevySyncSupersededError();
        return factory(lease);
      },
      async () => {
        if (!lease.isCurrent()) throw new HevySyncSupersededError();
        return factory(lease);
      },
    );
    this.tail = run.then(
      () => undefined,
      () => undefined,
    );
    void run.finally(() => this.controllers.delete(controller)).catch(() => {
      // The cleanup branch is detached from the caller-owned result.
    });
    return run;
  }

  beginExclusiveChange(): HevyExclusiveChangeBarrier {
    if (this.blocked) {
      throw new Error("A Hevy data change is already in progress.");
    }
    this.blocked = true;
    this.generation += 1;
    for (const controller of this.controllers) controller.abort();
    const ready = this.tail.then(
      () => undefined,
      () => undefined,
    );
    let released = false;
    return {
      ready,
      release: () => {
        if (released) return;
        released = true;
        this.generation += 1;
        this.blocked = false;
      },
    };
  }
}
