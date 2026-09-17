interface ActiveGlookoWork<T> {
  promise: Promise<T>;
  interactive: boolean;
  generation: number;
}

export interface GlookoSingleFlightLease {
  readonly generation: number;
  isCurrent(): boolean;
}

/**
 * Reserves a connector before its asynchronous policy/state work begins.
 * Native code also rejects overlapping exports, but the JavaScript owner must
 * be stable so a late planner cannot replace the promise for a newer run.
 */
export class GlookoSingleFlight<T> {
  private active?: ActiveGlookoWork<T>;
  private generation = 0;

  run(
    factory: (lease: GlookoSingleFlightLease) => Promise<T>,
    interactive = false,
  ): Promise<T> {
    if (this.active?.generation === this.generation) {
      return this.active.promise;
    }
    const predecessor = this.active?.promise;
    if (!predecessor) {
      return this.reserve(factory, interactive, this.generation);
    }
    return this.reserve(
      async (lease) => {
        await predecessor?.catch(() => undefined);
        return factory(lease);
      },
      interactive,
      this.generation,
    );
  }

  /**
   * Interactive work waits behind a quiet refresh already in progress. A
   * second interactive caller joins the same request instead of opening a
   * second native export.
   */
  runInteractive(
    factory: (lease: GlookoSingleFlightLease) => Promise<T>,
  ): Promise<T> {
    if (
      this.active?.interactive &&
      this.active.generation === this.generation
    ) {
      return this.active.promise;
    }

    const predecessor = this.active?.promise;
    return this.reserve(
      async (lease) => {
        await predecessor?.catch(() => undefined);
        return factory(lease);
      },
      true,
      this.generation,
    );
  }

  /**
   * Invalidates every older lease and reserves a distinct run immediately.
   * This is used at credential-change boundaries: the new account must never
   * join work that authenticated with the previous account.
   */
  runFresh(
    factory: (lease: GlookoSingleFlightLease) => Promise<T>,
    interactive = false,
  ): Promise<T> {
    this.generation += 1;
    const generation = this.generation;
    const predecessor = this.active?.promise;
    return this.reserve(
      async (lease) => {
        await predecessor?.catch(() => undefined);
        return factory(lease);
      },
      interactive,
      generation,
    );
  }

  private reserve(
    factory: (lease: GlookoSingleFlightLease) => Promise<T>,
    interactive: boolean,
    generation: number,
  ): Promise<T> {
    let tracked: Promise<T>;
    const lease: GlookoSingleFlightLease = {
      generation,
      isCurrent: () => this.generation === generation,
    };
    // Deferring the factory by one microtask makes the reservation observable
    // before even the first state read or policy calculation can yield.
    const work = Promise.resolve().then(() => factory(lease));
    tracked = work.finally(() => {
      if (this.active?.promise === tracked) this.active = undefined;
    });
    this.active = { promise: tracked, interactive, generation };
    return tracked;
  }
}
