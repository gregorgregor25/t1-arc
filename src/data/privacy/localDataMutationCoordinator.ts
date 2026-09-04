export type LocalDataMutationKind = 'erase' | 'restore';

interface LocalDataMutationOwner {
  id: number;
  kind: LocalDataMutationKind;
}

let activeOwner: LocalDataMutationOwner | undefined;
let nextOwnerId = 1;

export class LocalDataMutationInProgressError extends Error {
  constructor(activeKind: LocalDataMutationKind) {
    super(
      `A local-data ${activeKind} is already in progress. Wait for it to finish before changing private data again.`,
    );
    this.name = 'LocalDataMutationInProgressError';
  }
}

/**
 * Foreground erase and backup restore must never queue behind one another: a
 * restore accepted during erase could otherwise repopulate rows immediately
 * after deletion. Acquisition is synchronous and overlap fails closed.
 */
export async function runExclusiveLocalDataMutation<T>(
  kind: LocalDataMutationKind,
  operation: () => Promise<T>,
) {
  if (activeOwner) {
    throw new LocalDataMutationInProgressError(activeOwner.kind);
  }
  const owner = { id: nextOwnerId++, kind };
  activeOwner = owner;
  try {
    return await operation();
  } finally {
    if (activeOwner?.id === owner.id) activeOwner = undefined;
  }
}
