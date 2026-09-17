import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

function source(relativePath: string) {
  return readFileSync(path.join(process.cwd(), relativePath), "utf8").replace(
    /\r\n/g,
    "\n",
  );
}

const contextListSource = source("src/components/ContextEventList.tsx");
const todayScreenSource = source("src/screens/TodayScreen.tsx");
const historyScreenSource = source("src/screens/HistoryScreen.tsx");
const dataProviderSource = source("src/providers/DataProvider.tsx");
const sqliteHealthStoreSource = source(
  "src/data/persistence/SqliteHealthRecordStore.ts",
);

describe("manual ketone deletion UI", () => {
  it("offers a labelled, confirmation-gated destructive action only for recognised ketones", () => {
    expect(contextListSource).toContain("{ketone && onDeleteManualKetone ? (");
    expect(contextListSource).toContain(
      "accessibilityLabel={`Delete ${displayTitle}`}",
    );
    expect(contextListSource).toContain('accessibilityRole="button"');
    expect(contextListSource).toContain(
      "accessibilityState={{ disabled: anyDeletionPending }}",
    );
    expect(contextListSource).toContain(
      'Alert.alert(\n      "Remove this ketone reading?"',
    );
    expect(contextListSource).toContain('style: "destructive"');
  });

  it("reports both a missing record and a deletion failure with recovery guidance", () => {
    expect(contextListSource).toContain("Ketone reading not removed");
    expect(contextListSource).toContain(
      "Pull down to refresh, then try again.",
    );
    expect(contextListSource).toContain("Couldn't remove ketone reading");
    expect(contextListSource).toContain("then try again.");
  });

  it("makes deletion available from both current and historical ketone lists", () => {
    expect(todayScreenSource).toContain(
      "onDeleteManualKetone={deleteManualContext}",
    );
    expect(historyScreenSource).toContain(
      "onDeleteManualKetone={deleteManualContext}",
    );
    const retainedCountFormatting =
      /formatRegionalNumber\(retainedEvents\.length, regional\.locale, \{\s*maximumFractionDigits: 0,?\s*\}\)/g;
    expect(contextListSource.match(retainedCountFormatting)).toHaveLength(2);
    expect(contextListSource).toContain(
      'accessibilityLabel={`Show all ${formatRegionalNumber(retainedEvents.length, regional.locale, { maximumFractionDigits: 0 })} context events`}',
    );
  });

  it("locks conflicting actions and hides a committed deletion while props refresh", () => {
    expect(contextListSource).toContain("const [deletedIds, setDeletedIds]");
    expect(contextListSource).toContain(
      "setDeletedIds((current) => new Set(current).add(id))",
    );
    expect(contextListSource).toContain("disabled={rowDeleting}");
    expect(contextListSource).toContain("disabled={anyDeletionPending}");
  });

  it("surfaces a failed ketone timeline and refreshes derived data only after deletion", () => {
    expect(todayScreenSource).toContain("todayTimeline.error ? (");
    expect(todayScreenSource).toContain(
      "Saved ketone readings are temporarily unavailable.",
    );
    const deletionStart = dataProviderSource.indexOf(
      "const deleteManualContext = useCallback",
    );
    const deletionEnd = dataProviderSource.indexOf(
      "const value = useMemo<DataContextValue>",
      deletionStart,
    );
    const deletionSource = dataProviderSource.slice(deletionStart, deletionEnd);
    expect(deletionSource.indexOf(".deleteManualContext(id)")).toBeLessThan(
      deletionSource.indexOf("requestPostCommitInsightRefresh(writeLease"),
    );
    expect(deletionSource).toContain(
      "inputAlreadyInvalidated: true",
    );
    expect(deletionSource).not.toContain("generateInsightReviewIfDue");
    expect(deletionSource).not.toContain("clearSavedInsightReports(writeLease)");
    const storeDeleteStart = sqliteHealthStoreSource.indexOf(
      "async deleteManualContext(id: string)",
    );
    const storeDeleteEnd = sqliteHealthStoreSource.indexOf(
      "async clearImportedSource",
      storeDeleteStart,
    );
    const storeDeleteSource = sqliteHealthStoreSource.slice(
      storeDeleteStart,
      storeDeleteEnd,
    );
    expect(storeDeleteSource).toContain(
      "await clearSavedInsightReportsInTransaction(database)",
    );
  });
});
