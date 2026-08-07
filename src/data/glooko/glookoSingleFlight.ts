interface ActiveGlookoWork<T> {
  promise: Promise<T>;
  interactive: boolean;
}

/**
 * Reserves a connector before its asynchronous policy/state work begins.
 * Native code also rejects overlapping exports, but the JavaScript owner must
 * be stable so a late planner cannot replace the promise for a newer run.
 */
export class GlookoSingleFlight<T> {
  private active?: ActiveGlookoWork<T>;

  run(factory: () => Promise<T>, interactive = false): Promise<T> {
    if (this.active) return this.active.promise;
    return this.reserve(factory, interactive);
  }

  /**
   * Interactive work waits behind a quiet refresh already in progress. A
   * second interactive caller joins the same request instead of opening a
   * second native export.
   */
  runInteractive(factory: () => Promise<T>): Promise<T> {
    if (this.active?.interactive) return this.active.promise;

    const predecessor = this.active?.promise;
    return this.reserve(async () => {
      await predecessor?.catch(() => undefined);
      return factory();
    }, true);
  }

  private reserve(
    factory: () => Promise<T>,
    interactive: boolean,
  ): Promise<T> {
    let tracked: Promise<T>;
    // Deferring the factory by one microtask makes the reservation observable
    // before even the first state read or policy calculation can yield.
    const work = Promise.resolve().then(factory);
    tracked = work.finally(() => {
      if (this.active?.promise === tracked) this.active = undefined;
    });
    this.active = { promise: tracked, interactive };
    return tracked;
  }
}
