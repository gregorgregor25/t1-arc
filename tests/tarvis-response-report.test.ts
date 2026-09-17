import { describe, expect, it, vi } from 'vitest';
import { REPORT_ENDPOINT, reportPayload, sendResponseReport, type ResponseReport } from '../src/data/tarvis/responseReport';

const report: ResponseReport = { id: 'f44a3ba4-c029-4af7-8b15-a9aab7cd8af7', reason: 'incorrect', text: 'Please check the period label.', version: '1.7.2', consent: true };
describe('private response reporting', () => {
  it('requires affirmative consent, content, a reason and safe metadata', () => {
    for (const change of [{consent:false}, {text:''}, {text:' '.repeat(2)}, {text:'x'.repeat(12001)}, {id:'bad'}, {version:'bad\nheader'}, {reason:'bad'}]) {
      expect(() => reportPayload({...report, ...change} as ResponseReport)).toThrow();
    }
  });
  it('serialises an explicit allowlist without hidden records or credentials', async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(Response.json({status:'accepted', id:report.id}, {status:202}));
    await sendResponseReport({...report, apiKey:'must-not-send', evidence:['private']} as ResponseReport, undefined, transport);
    expect(transport).toHaveBeenCalledTimes(1);
    const [endpoint, options] = transport.mock.calls[0]!;
    expect(endpoint).toBe(REPORT_ENDPOINT);
    expect(JSON.parse(options!.body as string)).toEqual(report);
    expect(options!.credentials).toBe('omit');
    expect(options!.redirect).toBe('error');
  });
  it('does not start a cancelled request', async () => {
    const controller = new AbortController(); controller.abort();
    const transport = vi.fn<typeof fetch>();
    await expect(sendResponseReport(report, controller.signal, transport)).rejects.toThrow('could not confirm');
    expect(transport).not.toHaveBeenCalled();
  });
  it('requires an accepted receipt for the exact report, never auto retries', async () => {
    for (const response of [Response.json({}, {status:200}), Response.json({status:'accepted', id:'wrong'}, {status:202}), Response.json({}, {status:503})]) {
      const transport = vi.fn<typeof fetch>().mockResolvedValue(response);
      await expect(sendResponseReport(report, undefined, transport)).rejects.toThrow('could not confirm');
      expect(transport).toHaveBeenCalledTimes(1);
    }
  });
  it('explains rate limiting without claiming delivery', async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(Response.json({}, {status:429}));
    await expect(sendResponseReport(report, undefined, transport)).rejects.toThrow('wait a minute');
  });
  it('aborts a stalled request without automatic retries or exposing transport errors', async () => {
    vi.useFakeTimers();
    try {
      const transport = vi.fn<typeof fetch>().mockImplementation((_url, options) => new Promise((_resolve, reject) => {
        options?.signal?.addEventListener('abort', () => reject(new Error('sensitive transport detail')), {once:true});
      }));
      const result = expect(sendResponseReport(report, undefined, transport)).rejects.toThrow('could not confirm');
      await vi.advanceTimersByTimeAsync(20000);
      await result;
      expect(transport).toHaveBeenCalledTimes(1);
    } finally { vi.useRealTimers(); }
  });
});
