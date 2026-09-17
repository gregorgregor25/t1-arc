import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearDiagnosticEvents, readDiagnosticEvents, recordDiagnostic, recordSourceCheck } from '../src/data/support/diagnosticStore';
import type { DiagnosticCode } from '../src/data/support/diagnostics';
const fixture = vi.hoisted(() => ({ raw: undefined as string | undefined, lease: vi.fn(), run: vi.fn() }));
vi.mock('@/data/privacy/localDataWriteEpoch', () => ({
  acquireLocalDataWriteLease: fixture.lease,
  withLocalDataWriteLeaseTransaction: fixture.run,
}));
beforeEach(() => {
  fixture.raw = undefined; vi.resetAllMocks(); fixture.lease.mockResolvedValue({ epoch: 1 });
  let queue = Promise.resolve();
  fixture.run.mockImplementation((_lease, task) => {
    const next = queue.then(() => task({
      getFirstAsync: async () => fixture.raw ? { value: fixture.raw } : null,
      runAsync: async (sql: string, _key: string, value?: string) => { fixture.raw = sql.startsWith('DELETE') ? undefined : value; },
    }));
    queue = next.then(() => undefined, () => undefined);
    return next;
  });
});
describe('local-only diagnostic persistence', () => {
  it('keeps failed and recovered source transitions without persisting exceptions or flooding on polls', async () => {
    const error = Object.assign(new Error('private password and URL'), { code: 'authentication', token: 'secret' });
    recordSourceCheck('nightscout', 'connect', 'failed', error);
    recordSourceCheck('nightscout', 'connect', 'failed', error);
    recordSourceCheck('nightscout', 'connect', 'succeeded');
    recordSourceCheck('nightscout', 'refresh', 'succeeded');
    recordSourceCheck('nightscout', 'refresh', 'succeeded');
    await vi.waitFor(() => expect(fixture.raw).toContain('refresh'));
    const events = await readDiagnosticEvents();
    expect(events).toHaveLength(3);
    expect(events[0]?.sourceCheck?.reason).toBe('authentication');
    expect(fixture.raw).not.toMatch(/private|password|URL|secret|token/);
  });
  it('serialises concurrent events and never serialises caller payloads', async () => {
    recordDiagnostic('app_opened'); recordDiagnostic('refresh_started'); recordDiagnostic('refresh_failed');
    await vi.waitFor(() => expect(fixture.raw).toContain('refresh_failed'));
    const result = await readDiagnosticEvents();
    expect(result.map(x => x.code)).toEqual(['app_opened', 'refresh_started', 'refresh_failed']);
    expect(result.every(x => Object.keys(x).join(',') === 'at,code')).toBe(true);
  });
  it('removes expired/unknown/extra fields and copes with a corrupt log', async () => {
    fixture.raw = JSON.stringify([{ at: Date.now(), code: 'interface_error', message: 'private' }, { at: 1, code: 'app_opened' }]);
    expect(await readDiagnosticEvents()).toHaveLength(1);
    expect(fixture.raw).not.toContain('private');
    fixture.raw = 'not json'; expect(await readDiagnosticEvents()).toEqual([]);
  });
  it('rejects unknown codes without opening storage', () => {
    recordDiagnostic('raw error with key' as DiagnosticCode);
    expect(fixture.lease).not.toHaveBeenCalled();
  });
  it('deduplicates immediate identical events and clears on request', async () => {
    recordDiagnostic('app_opened'); recordDiagnostic('app_opened');
    await vi.waitFor(() => expect(fixture.raw).toContain('app_opened'));
    expect(await readDiagnosticEvents()).toHaveLength(1);
    await clearDiagnosticEvents(); expect(fixture.raw).toBeUndefined();
  });
  it('swallows log failures while inspection clearly reports unavailability', async () => {
    fixture.lease.mockRejectedValue(new Error('database unavailable'));
    expect(recordDiagnostic('interface_error')).toBeUndefined();
    await expect(readDiagnosticEvents()).rejects.toThrow('database unavailable');
  });
});
