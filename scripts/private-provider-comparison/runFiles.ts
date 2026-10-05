import { join } from "node:path";

/** A deliberate run name isolates results and the cumulative $1 ledger. */
export function privateComparisonPaths(directory: string, runId: string | undefined) {
  if (!runId || !/^[a-z0-9][a-z0-9-]{0,23}$/.test(runId)) {
    throw new Error("Set T1ARC_PRIVATE_COMPARISON_RUN_ID to 1-24 lowercase letters, digits or hyphens, starting with a letter or digit.");
  }
  return {
    ledgerFile: join(directory, `provider-comparison-ledger-${runId}.json`),
    resultsFile: join(directory, `provider-comparison-results-${runId}.json`),
  };
}
