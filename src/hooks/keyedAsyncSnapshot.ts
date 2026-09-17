export interface KeyedAsyncSnapshot<Key, Value> {
  key: Key;
  value: Value;
}

/**
 * Keeps a completed async request invisible once its consumer has moved to a
 * different date key. The request cleanup still prevents stale writes; this
 * selector also closes the render between a key change and that cleanup.
 */
export function snapshotValueForKey<Key, Value>(
  snapshot: KeyedAsyncSnapshot<Key, Value> | undefined,
  key: Key,
) {
  return snapshot?.key === key ? snapshot.value : undefined;
}
