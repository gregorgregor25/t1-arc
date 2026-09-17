export class TarvisScreenLifecycleSupersededError extends Error {
  constructor() {
    super("This Tarv1s screen operation was superseded by a scope change.");
    this.name = "TarvisScreenLifecycleSupersededError";
  }
}

export function isTarvisScreenLifecycleSupersededError(
  error: unknown,
): error is TarvisScreenLifecycleSupersededError {
  return error instanceof TarvisScreenLifecycleSupersededError;
}

export interface TarvisScreenOperationLease {
  readonly signal: AbortSignal;
  assertCurrent(): void;
  isCurrent(): boolean;
  release(): void;
}

export interface TarvisScreenScopeLease {
  readonly identity: string;
  assertCurrent(): void;
  beginOperation(): TarvisScreenOperationLease;
  close(): void;
}

interface ScopeGeneration {
  readonly controller: AbortController;
  readonly identity: string;
  readonly operations: Set<AbortController>;
}

/**
 * Gives each mounted conversation scope a synchronous generation fence. A
 * scope transition invalidates and aborts every operation from the old scope
 * before the replacement scope can publish or persist conversation state.
 */
export function createTarvisScreenLifecycleCoordinator() {
  let current: ScopeGeneration | undefined;

  function invalidate(scope: ScopeGeneration) {
    scope.controller.abort();
    for (const operation of scope.operations) operation.abort();
    scope.operations.clear();
    if (current === scope) current = undefined;
  }

  function isScopeCurrent(scope: ScopeGeneration) {
    return current === scope && !scope.controller.signal.aborted;
  }

  function assertScopeCurrent(scope: ScopeGeneration) {
    if (!isScopeCurrent(scope)) {
      throw new TarvisScreenLifecycleSupersededError();
    }
  }

  return {
    enterScope(identity: string): TarvisScreenScopeLease {
      if (current) invalidate(current);
      const scope: ScopeGeneration = {
        controller: new AbortController(),
        identity,
        operations: new Set(),
      };
      current = scope;
      return {
        identity,
        assertCurrent: () => assertScopeCurrent(scope),
        beginOperation() {
          assertScopeCurrent(scope);
          const controller = new AbortController();
          scope.operations.add(controller);
          return {
            signal: controller.signal,
            assertCurrent() {
              assertScopeCurrent(scope);
              if (controller.signal.aborted) {
                throw new TarvisScreenLifecycleSupersededError();
              }
            },
            isCurrent() {
              return isScopeCurrent(scope) && !controller.signal.aborted;
            },
            release() {
              scope.operations.delete(controller);
            },
          };
        },
        close() {
          if (current === scope) invalidate(scope);
        },
      };
    },
  };
}
