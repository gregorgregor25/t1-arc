import { beforeEach, describe, expect, it, vi } from "vitest";
import { safeExportFileName, saveExportFile } from "@/data/export/saveExportFile";

const mocks = vi.hoisted(() => ({ save: vi.fn(), write: vi.fn(), remove: vi.fn(), workingFile: vi.fn(), checkLease: vi.fn() }));
vi.mock("expo-file-system", () => ({
  File: class {
    exists = true;
    uri: string;
    constructor(uri: string) { this.uri = uri; }
    write = mocks.write;
    delete = mocks.remove;
  },
}));
vi.mock("../modules/t1arc-backup-crypto", () => ({ default: {
  createWorkingFileAsync: mocks.workingFile,
  saveTemporaryFileAsync: mocks.save,
} }));
vi.mock("@/data/privacy/localDataWriteEpoch", () => ({ acquireLocalDataWriteLease: async () => ({ epoch: 1 }), assertLocalDataWriteLeaseCurrent: mocks.checkLease }));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.checkLease.mockResolvedValue(undefined);
  mocks.save.mockResolvedValue({ status: "saved" });
  mocks.workingFile.mockImplementation(async (suffix: string) => `file:///private/no_backup/encrypted-backups/backup-export${suffix}`);
});

describe("record export files", () => {
  it("saves a CSV through the existing save dialog and removes the private copy", async () => {
    expect(await saveExportFile("a,b\r\n", "T1-Arc-glucose-2026-11-02-to-2026-11-16", "csv")).toBe("saved");
    expect(mocks.workingFile).toHaveBeenCalledWith(".txt");
    expect(mocks.write).toHaveBeenCalledWith("a,b\r\n");
    expect(mocks.save).toHaveBeenCalledWith(
      "file:///private/no_backup/encrypted-backups/backup-export.txt",
      "T1-Arc-glucose-2026-11-02-to-2026-11-16.csv",
      "text/csv",
    );
    expect(mocks.remove).toHaveBeenCalledOnce();
  });

  it("saves the report as HTML", async () => {
    await saveExportFile("<html></html>", "T1-Arc-glucose-report-2026-11-16.html", "html");
    expect(mocks.workingFile).toHaveBeenCalledWith(".html");
    expect(mocks.save).toHaveBeenCalledWith(expect.any(String), "T1-Arc-glucose-report-2026-11-16.html", "text/html");
  });

  it("reports cancellation and still cleans up", async () => {
    mocks.save.mockResolvedValue({ status: "cancelled" });
    expect(await saveExportFile("x", "x", "csv")).toBe("cancelled");
    expect(mocks.remove).toHaveBeenCalledOnce();
  });

  it("does not offer the file after a privacy erase and still cleans up", async () => {
    mocks.checkLease.mockRejectedValue(new Error("superseded"));
    await expect(saveExportFile("x", "x", "csv")).rejects.toThrow("superseded");
    expect(mocks.save).not.toHaveBeenCalled();
    expect(mocks.remove).toHaveBeenCalledOnce();
  });

  it("keeps file names plain", () => {
    expect(safeExportFileName("../T1 Arc/glucose", "csv")).toBe("T1-Arc-glucose.csv");
    expect(safeExportFileName("", "html")).toBe("T1-Arc-export.html");
    expect(safeExportFileName("report.HTML", "html")).toBe("report.HTML");
  });
});
