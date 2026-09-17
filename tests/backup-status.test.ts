import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BACKUP_STATUS_KEY, clearBackupStatus, isBackupReminderDue, loadBackupStatus, parseBackupStatus, recordSuccessfulBackupExport, setBackupReminder } from "@/data/backup/backupStatus";

const mocks = vi.hoisted(() => ({ state: undefined as unknown, epoch: 1, clear: vi.fn(), save: vi.fn() }));
vi.mock("@/data/privacy/localDataWriteEpoch", () => ({ acquireLocalDataWriteLease: async () => ({ epoch: mocks.epoch }) }));
vi.mock("@/data/privacy/localDataEpochSecureStore", () => ({
  loadEpochBoundSecureStoreValue: async (_key: string, lease: { epoch: number }, parse: (v: unknown) => unknown) => {
    if (lease.epoch !== mocks.epoch) throw new Error("superseded");
    return mocks.state ? parse(mocks.state) : undefined;
  },
  saveEpochBoundSecureStoreValue: async (key: string, next: unknown, lease: { epoch: number }) => {
    if (lease.epoch !== mocks.epoch) throw new Error("superseded");
    mocks.save(key, next, lease);
    mocks.state = next;
  },
  forceClearEpochBoundSecureStoreValue: mocks.clear,
}));

beforeEach(() => { mocks.epoch = 1; mocks.state = undefined; vi.clearAllMocks(); });

describe("device-local backup confidence", () => {
  it("defaults to no recorded backup and reminders off", async () => {
    expect(await loadBackupStatus()).toEqual({ reminderEnabled: false });
    expect(parseBackupStatus({ reminderEnabled: "true", lastExportedAt: "not a date" })).toEqual({ reminderEnabled: false, lastExportedAt: undefined, reminderEnabledAt: undefined });
  });
  it("records only successful exports after the save destination has returned", async () => {
    const source = readFileSync("src/components/EncryptedBackupCard.tsx", "utf8");
    expect(source.indexOf('if (saved.status === "cancelled") return;')).toBeLessThan(source.indexOf("await recordSuccessfulBackupExport(backupLease)"));
    await recordSuccessfulBackupExport({ epoch: 1 }, "2026-09-08T12:00:00.000Z");
    expect(await loadBackupStatus()).toMatchObject({ lastExportedAt: "2026-09-08T12:00:00.000Z", reminderEnabled: false });
  });
  it("retains the backup date when toggling the reminder", async () => {
    await recordSuccessfulBackupExport({ epoch: 1 }, "2026-09-01T12:00:00.000Z");
    await setBackupReminder(true, "2026-09-08T12:00:00.000Z");
    expect(await loadBackupStatus()).toMatchObject({ lastExportedAt: "2026-09-01T12:00:00.000Z", reminderEnabled: true });
  });
  it("does not let concurrent reminder and export writes lose each other", async () => {
    await Promise.all([setBackupReminder(true, "2026-09-08T12:00:00.000Z"), recordSuccessfulBackupExport({ epoch: 1 }, "2026-09-08T13:00:00.000Z")]);
    expect(await loadBackupStatus()).toMatchObject({ lastExportedAt: "2026-09-08T13:00:00.000Z", reminderEnabled: true });
  });
  it("rejects a backup-status write captured before a privacy erase", async () => {
    mocks.epoch = 2;
    await expect(recordSuccessfulBackupExport({ epoch: 1 })).rejects.toThrow("superseded");
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it("gives a newly enabled reminder a week, even if no backup exists", () => {
    const status = { reminderEnabled: true, reminderEnabledAt: "2026-09-01T12:00:00.000Z" };
    expect(isBackupReminderDue(status, Date.parse("2026-09-08T11:59:00.000Z"))).toBe(false);
    expect(isBackupReminderDue(status, Date.parse("2026-09-08T12:00:00.000Z"))).toBe(true);
    expect(isBackupReminderDue({ ...status, lastExportedAt: "2026-09-07T12:00:00.000Z" }, Date.parse("2026-09-08T12:00:00.000Z"))).toBe(false);
    expect(isBackupReminderDue({ reminderEnabled: false }, Date.now())).toBe(false);
  });
  it("clears device status, and does not make it a portable backup credential", async () => {
    await clearBackupStatus();
    expect(mocks.clear).toHaveBeenCalledWith(BACKUP_STATUS_KEY);
    expect(readFileSync("src/data/backup/healthBackup.ts", "utf8")).not.toContain(BACKUP_STATUS_KEY);
    expect(readFileSync("src/providers/DataProvider.tsx", "utf8")).toContain("clearBackupStatus(),");
    expect(readFileSync("src/data/privacy/localDataVault.ts", "utf8")).toContain("clearBackupStatus(),");
  });
});
