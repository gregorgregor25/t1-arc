export class TarvisConnectionSupersededError extends Error {
  constructor() {
    super("This Tarv1s request was superseded by a connection change.");
    this.name = "TarvisConnectionSupersededError";
  }
}

export class TarvisConnectionRequestAbortedError extends Error {
  constructor() {
    super("This Tarv1s request was cancelled before it could finish.");
    this.name = "TarvisConnectionRequestAbortedError";
  }
}

export function isTarvisConnectionSupersededError(
  error: unknown,
): error is TarvisConnectionSupersededError {
  return error instanceof TarvisConnectionSupersededError;
}

interface ActiveRequest {
  readonly controller: AbortController;
  readonly generation: object;
}

export interface TarvisConnectionRequestLease {
  readonly signal: AbortSignal;
  abort(): void;
  assertGenerationCurrent(): void;
  assertCurrent(): void;
  release(): void;
}

let connectionGeneration: object = {};
let connectionMutationTail: Promise<void> = Promise.resolve();
const activeRequests = new Set<ActiveRequest>();

function supersedeActiveRequests() {
  connectionGeneration = {};
  for (const request of activeRequests) {
    request.controller.abort();
  }
  activeRequests.clear();
}

/**
 * Waits for credential mutations to settle, then registers synchronously so a
 * later disconnect or replacement can abort the request before it publishes.
 */
export async function beginTarvisConnectionRequest(): Promise<TarvisConnectionRequestLease> {
  while (true) {
    const observedMutationTail = connectionMutationTail;
    await observedMutationTail;
    if (observedMutationTail !== connectionMutationTail) continue;

    const request: ActiveRequest = {
      controller: new AbortController(),
      generation: connectionGeneration,
    };
    activeRequests.add(request);
    const assertGenerationCurrent = () => {
      if (request.generation !== connectionGeneration) {
        throw new TarvisConnectionSupersededError();
      }
    };
    return {
      signal: request.controller.signal,
      abort: () => request.controller.abort(),
      assertCurrent: () => {
        assertGenerationCurrent();
        if (request.controller.signal.aborted) {
          throw new TarvisConnectionRequestAbortedError();
        }
      },
      assertGenerationCurrent,
      release: () => {
        activeRequests.delete(request);
      },
    };
  }
}

/**
 * Invalidates requests at invocation time and serializes SecureStore changes
 * so the most recently invoked connect/disconnect action wins deterministically.
 */
export async function runTarvisConnectionMutation<T>(
  task: () => Promise<T>,
): Promise<T> {
  const previousMutation = connectionMutationTail;
  let finishMutation!: () => void;
  connectionMutationTail = new Promise<void>((resolve) => {
    finishMutation = resolve;
  });
  supersedeActiveRequests();
  try {
    await previousMutation;
    return await task();
  } finally {
    finishMutation();
  }
}

export function resetTarvisConnectionCoordinatorForTests() {
  supersedeActiveRequests();
  connectionMutationTail = Promise.resolve();
}
