export const REPORT_ENDPOINT = 'https://reports.t1arc.com/v1/reports';
export const REPORT_TEXT_LIMIT = 12000;
export const REPORT_REASONS = [
  { value: 'unsafe', label: 'Unsafe advice' },
  { value: 'incorrect', label: 'Incorrect answer' },
  { value: 'offensive', label: 'Offensive content' },
  { value: 'privacy', label: 'Privacy concern' },
  { value: 'other', label: 'Something else' },
] as const;
export type ReportReason = typeof REPORT_REASONS[number]['value'];
export interface ResponseReport {
  id: string;
  reason: ReportReason;
  text: string;
  version: string;
  consent: boolean;
}

export function reportPayload(report: ResponseReport) {
  if (report.consent !== true || !report.text.trim() || report.text.length > REPORT_TEXT_LIMIT ||
      !REPORT_REASONS.some(reason => reason.value === report.reason) ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(report.id) ||
      !/^[0-9A-Za-z.+_-]{1,40}$/.test(report.version)) {
    throw new Error('Check your report and confirm you want to share it.');
  }
  // Deliberate allowlist. Never serialise an exchange, evidence, account or API key.
  return { id: report.id, reason: report.reason, text: report.text, version: report.version, consent: true };
}

/** One attempt only. An interrupted request may already have reached support. */
export async function sendResponseReport(report: ResponseReport, signal?: AbortSignal, transport: typeof fetch = fetch): Promise<void> {
  const body = JSON.stringify(reportPayload(report));
  const controller = new AbortController();
  const cancel = () => controller.abort();
  signal?.addEventListener('abort', cancel, { once: true });
  if (signal?.aborted) controller.abort();
  const timer = setTimeout(cancel, 20000);
  try {
    if (controller.signal.aborted) throw new Error('cancelled');
    const response = await transport(REPORT_ENDPOINT, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body,
      signal: controller.signal, credentials: 'omit', redirect: 'error',
    });
    if (response.status === 429) throw new Error('Please wait a minute before trying again. Your draft is still here.');
    if (response.status !== 202) throw new Error('We could not confirm delivery. Your draft is still here; support may already have received it.');
    const receipt: unknown = await response.json();
    if (!receipt || typeof receipt !== 'object' || !('status' in receipt) || receipt.status !== 'accepted' || !('id' in receipt) || receipt.id !== report.id) {
      throw new Error('We could not confirm delivery. Your draft is still here; support may already have received it.');
    }
  } catch (error) {
    if (error instanceof Error && (error.message.startsWith('Please wait') || error.message.startsWith('We could not'))) throw error;
    throw new Error('We could not confirm delivery. Check your connection before retrying. Support may already have received it.');
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', cancel);
  }
}
