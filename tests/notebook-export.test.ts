import { beforeEach, describe, expect, it, vi } from "vitest";
import { exportNotebookReport } from "@/data/notebook/exportNotebookReport";

const mocks = vi.hoisted(() => ({ save: vi.fn(), write: vi.fn(), create: vi.fn(), remove: vi.fn(), directory: vi.fn(), checkLease: vi.fn() }));
vi.mock("expo-crypto", () => ({ randomUUID: () => "unique-report" }));
vi.mock("expo-file-system", () => ({
  Paths: { cache: "file:///private/cache" },
  Directory: class { create = mocks.directory; },
  File: class {
    exists = true;
    uri = "file:///private/cache/encrypted-backups/backup-notebook-unique-report.html";
    create = mocks.create;
    write = mocks.write;
    delete = mocks.remove;
  },
}));
vi.mock("../modules/t1arc-backup-crypto", () => ({ default: { saveTemporaryFileAsync: mocks.save } }));
vi.mock("@/data/privacy/localDataWriteEpoch", () => ({ acquireLocalDataWriteLease: async () => ({ epoch: 1 }), assertLocalDataWriteLeaseCurrent: mocks.checkLease }));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.checkLease.mockResolvedValue(undefined);
  mocks.save.mockResolvedValue({ status: "saved" });
});

describe("explicit printable notebook export", () => {
  it("writes the previewed HTML into the native-allowlisted private directory and removes it after saving", async () => {
    expect(await exportNotebookReport({ text: "Personal text", html: "<html>Previewed</html>" })).toBe("saved");
    expect(mocks.write).toHaveBeenCalledWith("<html>Previewed</html>");
    expect(mocks.save).toHaveBeenCalledWith(expect.stringContaining("/encrypted-backups/backup-notebook-"), expect.stringMatching(/^T1-Arc-appointment-notes-\d{4}-\d{2}-\d{2}\.html$/), "text/html");
    expect(mocks.remove).toHaveBeenCalledOnce();
  });
  it("does not claim a save after picker cancellation and still cleans up", async () => {
    mocks.save.mockResolvedValue({ status: "cancelled" });
    expect(await exportNotebookReport({ text: "", html: "<html>Private</html>" })).toBe("cancelled");
    expect(mocks.remove).toHaveBeenCalledOnce();
  });
  it("cleans up if the destination provider fails", async () => {
    mocks.save.mockRejectedValue(new Error("provider failed"));
    await expect(exportNotebookReport({ text: "", html: "<html>Private</html>" })).rejects.toThrow("provider failed");
    expect(mocks.remove).toHaveBeenCalledOnce();
  });
  it("does not offer a pending export after privacy erase invalidates its lease", async () => {
    mocks.checkLease.mockRejectedValue(new Error("superseded"));
    await expect(exportNotebookReport({ text: "", html: "<html>Private</html>" })).rejects.toThrow("superseded");
    expect(mocks.save).not.toHaveBeenCalled();
    expect(mocks.remove).toHaveBeenCalledOnce();
  });
});
