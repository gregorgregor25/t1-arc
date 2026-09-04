export async function runBackupPostCommitRefreshes(
  refreshes: readonly (() => Promise<unknown> | unknown)[],
) {
  const outcomes = await Promise.allSettled(
    refreshes.map(async (refresh) => refresh()),
  );
  return outcomes.some(({ status }) => status === "rejected");
}
