import { beforeEach, describe, expect, it, vi } from "vitest";

import { SqliteHealthRecordStore } from "@/data/persistence/SqliteHealthRecordStore";

const { clearReports, database, openDatabase, withTransaction } = vi.hoisted(
  () => {
    const database = { runAsync: vi.fn() };
    return {
      clearReports: vi.fn(),
      database,
      openDatabase: vi.fn(async () => database),
      withTransaction: vi.fn(
        async (work: (transaction: typeof database) => Promise<unknown>) =>
          work(database),
      ),
    };
  },
);

vi.mock("@/data/persistence/t1arcDatabase", () => ({
  openT1ArcDatabase: openDatabase,
  withT1ArcTransaction: withTransaction,
}));

vi.mock("@/data/insights/insightReportRepository", () => ({
  clearSavedInsightReportsInTransaction: clearReports,
}));

describe("atomic manual context deletion", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearReports.mockResolvedValue({ changes: 1 });
  });

  it("invalidates derived insight copies in the same transaction as a committed delete", async () => {
    database.runAsync
      .mockResolvedValueOnce({ changes: 1 })
      .mockResolvedValueOnce({ changes: 0 });

    await expect(
      new SqliteHealthRecordStore().deleteManualContext("manual-ketone"),
    ).resolves.toBe(true);

    expect(withTransaction).toHaveBeenCalledOnce();
    expect(clearReports).toHaveBeenCalledWith(database);
  });

  it("does not erase derived reports when no manual record was deleted", async () => {
    database.runAsync
      .mockResolvedValueOnce({ changes: 0 })
      .mockResolvedValueOnce({ changes: 0 });

    await expect(
      new SqliteHealthRecordStore().deleteManualContext("missing"),
    ).resolves.toBe(false);
    expect(clearReports).not.toHaveBeenCalled();
  });

  it("fails the transaction when its derived evidence cannot be invalidated", async () => {
    database.runAsync
      .mockResolvedValueOnce({ changes: 1 })
      .mockResolvedValueOnce({ changes: 0 });
    clearReports.mockRejectedValueOnce(new Error("invalidation failed"));

    await expect(
      new SqliteHealthRecordStore().deleteManualContext("manual-ketone"),
    ).rejects.toThrow("invalidation failed");
  });
});
