/** No free-text fields: errors, stacks, URLs and source payloads cannot enter this log. */
export const DIAGNOSTIC_CODES = [
  'app_opened', 'app_foreground', 'app_background', 'interface_error',
  'refresh_started', 'refresh_finished', 'refresh_failed', 'health_refresh_failed',
  'source_check',
] as const;
export type DiagnosticCode = typeof DIAGNOSTIC_CODES[number];
export const DIAGNOSTIC_SOURCES = ['nightscout', 'xdrip', 'dexcom', 'medtrum'] as const;
export const SOURCE_FAILURE_REASONS = ['authentication', 'network', 'invalid-response', 'invalid-connection', 'no-patient', 'sensor-state', 'unknown'] as const;
export interface SourceDiagnostic {
  source: typeof DIAGNOSTIC_SOURCES[number];
  operation: 'connect' | 'refresh';
  outcome: 'succeeded' | 'failed';
  reason?: typeof SOURCE_FAILURE_REASONS[number];
}
export interface DiagnosticEvent { at: number; code: DiagnosticCode; sourceCheck?: SourceDiagnostic }
export const DIAGNOSTIC_LIMIT = 60;
export const DIAGNOSTIC_MAX_AGE = 24 * 60 * 60 * 1000;
export const DIAGNOSTIC_STORAGE_KEY = 'support-diagnostics-v1';

/** Reconstruct on read as well as write; never spread persisted objects. */
export function safeDiagnosticEvents(value: unknown, now = Date.now()): DiagnosticEvent[] {
  if (!Array.isArray(value)) return [];
  const events = value.filter((item): item is DiagnosticEvent => !!item && typeof item === 'object' &&
    Number.isSafeInteger(item.at) && item.at > 0 && item.at <= now &&
    item.at >= now - DIAGNOSTIC_MAX_AGE && DIAGNOSTIC_CODES.includes(item.code))
    .sort((a, b) => a.at - b.at)
    .flatMap(item => {
      const base = { at: Math.floor(item.at / 60000) * 60000, code: item.code };
      if (item.code !== 'source_check') return [base];
      const check = item.sourceCheck;
      if (!check || !DIAGNOSTIC_SOURCES.includes(check.source) ||
        !['connect', 'refresh'].includes(check.operation) || !['succeeded', 'failed'].includes(check.outcome)) return [];
      return [{ ...base, sourceCheck: { source: check.source, operation: check.operation, outcome: check.outcome,
        ...(check.outcome === 'failed' ? { reason: SOURCE_FAILURE_REASONS.includes(check.reason!) ? check.reason : 'unknown' as const } : {}),
      } }];
    });
  // Frequent foreground refresh events must not immediately evict a failed sign-in.
  const source = events.filter(event => event.code === 'source_check').slice(-20);
  const general = events.filter(event => event.code !== 'source_check').slice(-(DIAGNOSTIC_LIMIT - source.length));
  return [...general, ...source].sort((a, b) => a.at - b.at);
}

export function diagnosticLines(value: unknown, now = Date.now()): string {
  const events = safeDiagnosticEvents(value, now);
  return events.length ? events.map(event => `${new Date(event.at).toISOString()} ${event.code}${event.sourceCheck
    ? ` ${event.sourceCheck.source} ${event.sourceCheck.operation} ${event.sourceCheck.outcome}${event.sourceCheck.reason ? ` ${event.sourceCheck.reason}` : ''}` : ''}`).join('\n')
    : 'No recent technical events available.';
}

export interface SupportDeviceInfo {
  version: string; build: string; os: string; model: string;
}

/** Device/build labels only, supplied by platform APIs, never by records or credentials. */
function label(value: string) { return value.replace(/[^a-zA-Z0-9 ._()+-]/g, '').slice(0, 80) || 'unknown'; }
export function supportDiagnosticSummary(info: SupportDeviceInfo, events: unknown, now = Date.now()): string {
  return `Technical diagnostics (optional)\nApp: ${label(info.version)} (${label(info.build)})\nOS: ${label(info.os)}\nModel: ${label(info.model)}\nEvents (UTC, minute precision; up to 60 within 24 hours, including recent source transitions):\n${diagnosticLines(events, now)}\nThese are selected app events, not a complete crash log. A successful source check does not prove the reading is current. Network failures may need further investigation. refresh_finished means the refresh attempt ended, not that every source supplied new data.`;
}

export const SUPPORT_MESSAGE_LIMIT = 6000;
export function supportReportText(message: string, diagnostics?: string) {
  if (!message.trim() || message.length > SUPPORT_MESSAGE_LIMIT) throw new Error('Describe the problem before continuing.');
  return `T1 Arc app problem\n\n${message.trim()}${diagnostics ? `\n\n${diagnostics}` : ''}`;
}
