/** Only fixed categories leave the restore implementation; never SQL or row data. */
export function restoreFailureReason(error: unknown) {
  const message = error instanceof Error ? error.message.toLowerCase() : '';
  if (message.includes('foreign key constraint')) return 'missing-related-record';
  if (message.includes('check constraint')) return 'record-constraint';
  if (message.includes('not null constraint')) return 'missing-required-value';
  if (message.includes('database is locked') || message.includes('sqlite_busy')) return 'database-busy';
  if (message.includes('disk') && message.includes('full')) return 'storage-full';
  if (message.includes('owner')) return 'ownership-check';
  if (message.includes('no such column') || message.includes('no such table')) return 'database-schema';
  if (message.includes('too many sql variables')) return 'batch-size';
  if (message.includes('out of memory') || message.includes('cursorwindow')) return 'memory-limit';
  if (message.includes('backup') || message.includes('frame')) return 'backup-read';
  return 'unexpected';
}

export class BackupRestoreError extends Error {
  readonly diagnosticCode: string;

  constructor(stage: string, error: unknown) {
    // Callers supply static operation/table names, never record identifiers.
    const safeStage = /^[a-z_]+$/.test(stage) ? stage : 'restore';
    const diagnosticCode = `${safeStage}/${restoreFailureReason(error)}`;
    // Preserve the internal exception for callers/tests. UI and support output
    // must use diagnosticCode only, never this message.
    super(error instanceof Error ? error.message : 'Backup restore failed.');
    this.name = 'BackupRestoreError';
    this.diagnosticCode = diagnosticCode;
  }
}
