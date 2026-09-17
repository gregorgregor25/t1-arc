import { acquireLocalDataWriteLease, withLocalDataWriteLeaseTransaction } from '@/data/privacy/localDataWriteEpoch';
import { DIAGNOSTIC_CODES, DIAGNOSTIC_STORAGE_KEY, SOURCE_FAILURE_REASONS, safeDiagnosticEvents, type DiagnosticCode, type SourceDiagnostic } from './diagnostics';

function parse(raw?: string) {
  try { return raw ? JSON.parse(raw) : []; } catch { return []; }
}

/** The keyed local DB protects this bounded log; app_metadata is excluded from backups. */
export async function readDiagnosticEvents() {
  const lease = await acquireLocalDataWriteLease();
  return withLocalDataWriteLeaseTransaction(lease, async db => {
    const row = await db.getFirstAsync<{ value: string }>('SELECT value FROM app_metadata WHERE key = ?', DIAGNOSTIC_STORAGE_KEY);
    const events = safeDiagnosticEvents(parse(row?.value));
    await db.runAsync('INSERT OR REPLACE INTO app_metadata (key, value) VALUES (?, ?)', DIAGNOSTIC_STORAGE_KEY, JSON.stringify(events));
    return events;
  });
}

/** Best effort: logging must never delay an interaction or make a failing app fail again. */
export function recordDiagnostic(code: DiagnosticCode, sourceCheck?: SourceDiagnostic): void {
  if (!DIAGNOSTIC_CODES.includes(code)) return;
  const at = Math.floor(Date.now() / 60000) * 60000;
  void (async () => {
    const lease = await acquireLocalDataWriteLease();
    await withLocalDataWriteLeaseTransaction(lease, async db => {
      const row = await db.getFirstAsync<{ value: string }>('SELECT value FROM app_metadata WHERE key = ?', DIAGNOSTIC_STORAGE_KEY);
      const events = safeDiagnosticEvents(parse(row?.value));
      // Repeated lifecycle notifications in the same minute add no useful detail.
      const last = events.at(-1);
      if (sourceCheck) {
        const previous = events.findLast(event => event.sourceCheck?.source === sourceCheck.source && event.sourceCheck.operation === sourceCheck.operation);
        if (previous && JSON.stringify(previous.sourceCheck) === JSON.stringify(sourceCheck)) return;
      } else if (last?.at === at && last.code === code) return;
      const next = safeDiagnosticEvents([...events, { at, code, sourceCheck }]);
      await db.runAsync('INSERT OR REPLACE INTO app_metadata (key, value) VALUES (?, ?)', DIAGNOSTIC_STORAGE_KEY, JSON.stringify(next));
    });
  })().catch(() => undefined);
}

/** Only a typed code is accepted; never copy an exception message or account data. */
export function recordSourceCheck(source: SourceDiagnostic['source'], operation: SourceDiagnostic['operation'], outcome: SourceDiagnostic['outcome'], error?: unknown) {
  const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
  const reason = SOURCE_FAILURE_REASONS.find(candidate => candidate === code) ?? 'unknown';
  recordDiagnostic('source_check', { source, operation, outcome, ...(outcome === 'failed' ? { reason } : {}) });
}

export async function clearDiagnosticEvents() {
  const lease = await acquireLocalDataWriteLease();
  await withLocalDataWriteLeaseTransaction(lease, db => db.runAsync('DELETE FROM app_metadata WHERE key = ?', DIAGNOSTIC_STORAGE_KEY));
}
