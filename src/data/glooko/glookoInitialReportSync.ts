interface InitialGlookoReportSyncDependencies<TOutcome> {
  sync(): Promise<TOutcome>;
  complete(outcome: TOutcome): Promise<unknown>;
  setSyncing(syncing: boolean): void;
}

/**
 * Starts the report side of first connection without allowing an optional
 * report failure to undo a successfully verified CSV connection.
 */
export async function runInitialGlookoReportSync<TOutcome>({
  sync,
  complete,
  setSyncing,
}: InitialGlookoReportSyncDependencies<TOutcome>): Promise<void> {
  setSyncing(true);
  try {
    await complete(await sync());
  } catch {
    // Report sync records ordinary connector/validation failures in its own
    // state. Unexpected startup failures must not reject first connection.
  } finally {
    setSyncing(false);
  }
}
