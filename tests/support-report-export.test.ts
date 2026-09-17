import { beforeEach, describe, expect, it, vi } from 'vitest';
import { exportSupportReport } from '../src/data/support/exportSupportReport';
const mocks = vi.hoisted(() => ({ write: vi.fn(), create: vi.fn(), save: vi.fn(), remove: vi.fn(), lease: vi.fn(), assert: vi.fn() }));
vi.mock('expo-file-system', () => ({ File: class { uri: string; constructor(uri: string) { this.uri = uri; } write = mocks.write; } }));
vi.mock('../modules/t1arc-backup-crypto', () => ({ default: { createWorkingFileAsync: mocks.create, saveTemporaryFileAsync: mocks.save, removeTemporaryFileAsync: mocks.remove } }));
vi.mock('@/data/privacy/localDataWriteEpoch', () => ({ acquireLocalDataWriteLease: mocks.lease, assertLocalDataWriteLeaseCurrent: mocks.assert }));
const report = { id: 'f44a3ba4-c029-4af7-8b15-a9aab7cd8af7', reason: 'other' as const, text: 'Reviewed report', version: '1.7.5', consent: true };
beforeEach(() => {
  vi.resetAllMocks(); mocks.create.mockResolvedValue('file:///private/report.txt');
  mocks.save.mockResolvedValue({ status: 'saved' }); mocks.remove.mockResolvedValue(true);
  mocks.lease.mockResolvedValue({ epoch: 1 }); mocks.assert.mockResolvedValue(undefined);
});
describe('explicit diagnostic report export', () => {
  it('writes exactly the preview to a private working file, then deletes it', async () => {
    await expect(exportSupportReport(report)).resolves.toBe('saved');
    expect(mocks.create).toHaveBeenCalledWith('.txt');
    expect(mocks.write).toHaveBeenCalledWith(`Reference: ${report.id}\nApp version: 1.7.5\n\nReviewed report`);
    expect(mocks.save).toHaveBeenCalledWith('file:///private/report.txt', `T1-Arc-support-${report.id}.txt`, 'text/plain');
    expect(mocks.remove).toHaveBeenCalledWith('file:///private/report.txt');
  });
  it('requires consent before creating a file', async () => {
    await expect(exportSupportReport({ ...report, consent: false })).rejects.toThrow();
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it('cleans up on cancellation and failure', async () => {
    mocks.save.mockResolvedValueOnce({ status: 'cancelled' });
    await expect(exportSupportReport(report)).resolves.toBe('cancelled');
    mocks.save.mockRejectedValueOnce(new Error('write failed'));
    await expect(exportSupportReport(report)).rejects.toThrow();
    expect(mocks.remove).toHaveBeenCalledTimes(2);
  });
  it('does not open the save picker after a privacy erase invalidates the lease', async () => {
    mocks.assert.mockRejectedValueOnce(new Error('superseded'));
    await expect(exportSupportReport(report)).rejects.toThrow();
    expect(mocks.save).not.toHaveBeenCalled();
    expect(mocks.remove).toHaveBeenCalled();
  });
});
