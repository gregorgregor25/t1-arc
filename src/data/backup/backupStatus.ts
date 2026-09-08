import {
  forceClearEpochBoundSecureStoreValue,
  loadEpochBoundSecureStoreValue,
  saveEpochBoundSecureStoreValue,
} from "@/data/privacy/localDataEpochSecureStore";
import { acquireLocalDataWriteLease, type LocalDataWriteLease } from "@/data/privacy/localDataWriteEpoch";

export const BACKUP_STATUS_KEY = "t1arc.backup-status.v1";
export interface BackupStatus {
  lastExportedAt?: string;
  reminderEnabled: boolean;
  reminderEnabledAt?: string;
}

function validDate(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value));
}

export function parseBackupStatus(value: unknown): BackupStatus {
  const candidate = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return {
    lastExportedAt: validDate(candidate.lastExportedAt) ? candidate.lastExportedAt : undefined,
    reminderEnabled: candidate.reminderEnabled === true,
    reminderEnabledAt: validDate(candidate.reminderEnabledAt) ? candidate.reminderEnabledAt : undefined,
  };
}

export function isBackupReminderDue(status: BackupStatus, now = Date.now()): boolean {
  if (!status.reminderEnabled) return false;
  const dates = [status.lastExportedAt, status.reminderEnabledAt]
    .filter((date): date is string => !!date).map(Date.parse);
  if (!dates.length) return true;
  return now - Math.max(...dates) >= 7 * 24 * 60 * 60 * 1_000;
}

export async function loadBackupStatus(lease?: LocalDataWriteLease): Promise<BackupStatus> {
  return await loadEpochBoundSecureStoreValue(
    BACKUP_STATUS_KEY, lease ?? await acquireLocalDataWriteLease(), parseBackupStatus,
  ) ?? { reminderEnabled: false };
}

// Serialize same-runtime read/modify/write operations so saving a backup and
// changing its reminder cannot overwrite one another. Epoch checks fence erase.
let pending: Promise<unknown> = Promise.resolve();
function update(lease: LocalDataWriteLease, transform: (previous: BackupStatus) => BackupStatus) {
  const operation = pending.catch(() => undefined).then(async () => {
    const next = transform(await loadBackupStatus(lease));
    await saveEpochBoundSecureStoreValue(BACKUP_STATUS_KEY, next, lease);
    return next;
  });
  pending = operation;
  return operation;
}

/** Call only after the native destination write returns status: saved. */
export function recordSuccessfulBackupExport(lease: LocalDataWriteLease, exportedAt = new Date().toISOString()) {
  if (!validDate(exportedAt)) return Promise.reject(new Error("Invalid backup timestamp"));
  return update(lease, (previous) => ({ ...previous, lastExportedAt: exportedAt }));
}

export async function setBackupReminder(enabled: boolean, now = new Date().toISOString()) {
  if (!validDate(now)) throw new Error("Invalid reminder timestamp");
  const lease = await acquireLocalDataWriteLease();
  return update(lease, (previous) => ({
    ...previous, reminderEnabled: enabled,
    reminderEnabledAt: enabled && !previous.reminderEnabled ? now : previous.reminderEnabledAt,
  }));
}

export function clearBackupStatus() {
  return forceClearEpochBoundSecureStoreValue(BACKUP_STATUS_KEY);
}
