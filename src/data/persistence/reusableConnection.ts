/**
 * Holds at most one idle connection for reuse by serial work.
 *
 * SQLCipher derives the page key with PBKDF2 (256,000 iterations) whenever a
 * connection is keyed, so opening and keying a fresh connection per write
 * transaction costs a key derivation every time. The writer scheduler runs
 * one transaction at a time in a JS runtime, so a single idle connection is
 * enough. A connection is reused only when its owner reports that it ended
 * outside any transaction; anything else is closed and replaced.
 */
export interface ReusableConnection<C> {
  take(): Promise<C>;
  release(connection: C, reusable: boolean): Promise<void>;
  /** Closes the idle connection, if any, so the next take opens a new one. */
  discardIdle(): Promise<void>;
}

export function createReusableConnection<C>(
  open: () => Promise<C>,
  close: (connection: C) => Promise<void>,
): ReusableConnection<C> {
  let idle: C | undefined;
  const closeQuietly = (connection: C) => close(connection).catch(() => undefined);
  return {
    async take() {
      const connection = idle;
      idle = undefined;
      return connection ?? open();
    },
    async release(connection, reusable) {
      if (reusable && idle === undefined) {
        idle = connection;
        return;
      }
      await closeQuietly(connection);
    },
    async discardIdle() {
      const connection = idle;
      idle = undefined;
      if (connection !== undefined) await closeQuietly(connection);
    },
  };
}
