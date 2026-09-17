import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { DIAGNOSTIC_LIMIT, DIAGNOSTIC_MAX_AGE, diagnosticLines, safeDiagnosticEvents, supportDiagnosticSummary, supportReportText } from '../src/data/support/diagnostics';
import { reportPayload, REPORT_TEXT_LIMIT } from '../src/data/tarvis/responseReport';

const now = 1800000000000;
describe('safe support diagnostic contract', () => {
  it('retains source failure categories through frequent refreshes and removes private extras', () => {
    const events = safeDiagnosticEvents([
      { at: now - 60000, code: 'source_check', sourceCheck: { source: 'nightscout', operation: 'connect', outcome: 'failed', reason: 'authentication', url: 'https://private/?token=secret', glucose: 7, message: 'private' } },
      ...Array.from({ length: 100 }, () => ({ at: now, code: 'refresh_finished' })),
    ], now);
    expect(events).toHaveLength(DIAGNOSTIC_LIMIT);
    expect(events[0]).toEqual({ at: now - 60000, code: 'source_check', sourceCheck: { source: 'nightscout', operation: 'connect', outcome: 'failed', reason: 'authentication' } });
    expect(diagnosticLines(events, now)).toContain('nightscout connect failed authentication');
    expect(JSON.stringify(events)).not.toMatch(/private|secret|glucose/);
    expect(safeDiagnosticEvents([{ at: now, code: 'source_check', sourceCheck: { source: 'private site', operation: 'connect', outcome: 'failed' } }], now)).toEqual([]);
  });

  it('bounds the expanded diagnostics within the support transport limit', () => {
    const events = Array.from({ length: 60 }, (_, index) => ({ at: now - index * 60000, code: index < 20 ? 'source_check' : 'health_refresh_failed', sourceCheck: { source: 'nightscout', operation: 'connect', outcome: 'failed', reason: 'invalid-connection' } }));
    const summary = supportDiagnosticSummary({ version: 'x'.repeat(80), build: 'x'.repeat(80), os: 'x'.repeat(80), model: 'x'.repeat(80) }, events, now);
    expect(supportReportText('x'.repeat(6000), summary).length).toBeLessThanOrEqual(REPORT_TEXT_LIMIT);
  });
  it('drops raw messages, stacks, unknown codes, invalid times and extra fields', () => {
    expect(safeDiagnosticEvents([
      { at: now, code: 'refresh_failed', message: 'secret', key: 'sk-secret', glucose: 7 },
      { at: now, code: 'secret message' }, { at: now + 1, code: 'app_opened' },
      { at: NaN, code: 'app_opened' }, null, 'secret', { at: -1, code: 'app_opened' },
    ], now)).toEqual([{ at: now, code: 'refresh_failed' }]);
    expect(safeDiagnosticEvents({ error: 'secret' }, now)).toEqual([]);
  });
  it('caps retention, sorts by time and reduces precision', () => {
    const events = Array.from({ length: 150 }, (_, i) => ({ at: now - i * 60000 - 100, code: 'app_foreground' }));
    const result = safeDiagnosticEvents([...events, { at: now - DIAGNOSTIC_MAX_AGE - 1, code: 'app_opened' }], now);
    expect(result).toHaveLength(DIAGNOSTIC_LIMIT);
    expect(result.every(x => x.at % 60000 === 0)).toBe(true);
    expect(result[0]!.at).toBeLessThan(result.at(-1)!.at);
    expect(diagnosticLines(result, now)).not.toContain('app_opened');
  });
  it('keeps the report below the existing service limit even at maximum sizes', () => {
    const summary = supportDiagnosticSummary({ version: 'a'.repeat(200), build: '3'.repeat(200), os: 'Android 17', model: 'x'.repeat(200) },
      Array.from({ length: 60 }, () => ({ at: now, code: 'health_refresh_failed' })), now);
    const text = supportReportText('x'.repeat(6000), summary);
    expect(text.length).toBeLessThanOrEqual(REPORT_TEXT_LIMIT);
    expect(summary).not.toContain('undefined');
  });
  it('supports a text-only report and requires a nonempty description', () => {
    expect(supportReportText('  Cannot open settings. ')).toBe('T1 Arc app problem\n\nCannot open settings.');
    expect(() => supportReportText(' ')).toThrow();
    expect(() => supportReportText('x'.repeat(6001))).toThrow();
    expect(diagnosticLines([], now)).toContain('No recent');
  });
  it('uses the existing explicit-consent transport contract without hidden attachments', () => {
    const input = { id: 'f44a3ba4-c029-4af7-8b15-a9aab7cd8af7', reason: 'other' as const, version: '1.7.5', consent: true,
      text: supportReportText('Synthetic test'), hiddenRecords: ['private'] };
    expect(reportPayload(input)).not.toHaveProperty('hiddenRecords');
    expect(() => reportPayload({ ...input, consent: false })).toThrow();
  });
  it('wires accessible settings, consent reset, fallbacks, safe events and privacy erasure', () => {
    const form = readFileSync('src/components/SupportReportCard.tsx', 'utf8');
    expect(form).toContain('Exact report preview');
    expect(form).toContain('setMessage(value); setConsent(false)');
    expect(form).toContain('setIncludeDiagnostics(value => !value); setConsent(false)');
    expect(form).toContain('Save report to a file');
    expect(form).toContain('Share report');
    expect(form).toContain('unencrypted text file');
    expect(form).toContain('active.current');
    expect(form).toContain('Do not include passwords or API keys');
    expect(readFileSync('src/screens/SourcesScreen.tsx', 'utf8')).toContain('<SupportReportCard');
    expect(readFileSync('src/data/privacy/localDataVault.ts', 'utf8')).toContain("DELETE FROM app_metadata WHERE key = 'support-diagnostics-v1'");
    const store = readFileSync('src/data/support/diagnosticStore.ts', 'utf8');
    expect(store).toContain('withLocalDataWriteLeaseTransaction');
    expect(store).not.toMatch(/fetch\(|console\.|error\.message|\.stack/);
  });
});
