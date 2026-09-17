import { describe, expect, it } from 'vitest';
import { BackupRestoreError } from '@/data/backup/restoreError';

describe('backup restore diagnostics', () => {
  it.each([
    ['FOREIGN KEY constraint failed in private row', 'missing-related-record'],
    ['CHECK constraint failed: private SQL', 'record-constraint'],
    ['The recovered records do not have one verified owner.', 'ownership-check'],
    ['database is locked', 'database-busy'],
    ['Unexpected private account@example.com', 'unexpected'],
  ])('exports a fixed category without the original detail', (message, category) => {
    const error = new BackupRestoreError('portable_app_state', new Error(message));
    expect(error.diagnosticCode).toBe(`portable_app_state/${category}`);
    expect(error.diagnosticCode).not.toContain(message);
  });
});
