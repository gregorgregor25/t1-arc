const MAX_BYTES = 52000;
const reasons = new Set(['unsafe', 'offensive', 'incorrect', 'privacy', 'other']);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function reply(status, value) {
  return Response.json(value, {status, headers: {'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'}});
}

export function validateReport(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const allowed = new Set(['id', 'reason', 'text', 'version', 'consent']);
  return Object.keys(value).every(key => allowed.has(key)) && value.consent === true &&
    typeof value.id === 'string' && uuid.test(value.id) && reasons.has(value.reason) &&
    typeof value.text === 'string' && value.text.trim().length > 0 && value.text.length <= 12000 &&
    typeof value.version === 'string' && /^[0-9A-Za-z.+_-]{1,40}$/.test(value.version);
}

async function readBoundedJson(request) {
  if (!request.body) throw new Error('empty');
  const reader = request.body.getReader();
  const parts = [];
  let size = 0;
  try {
    while (true) {
      const {done, value} = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BYTES) { await reader.cancel(); throw new Error('large'); }
      parts.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) { bytes.set(part, offset); offset += part.byteLength; }
  return JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(bytes));
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/health' && request.method === 'GET') return reply(200, {status: 'ok'});
    if (url.pathname !== '/v1/reports' || url.search) return reply(404, {error: 'not_found'});
    if (request.method !== 'POST') return reply(405, {error: 'method_not_allowed'});
    if (request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json') return reply(415, {error: 'json_required'});
    // This is a native-app endpoint, not a cross-origin browser form or open mail relay.
    if (request.headers.has('origin')) return reply(403, {error: 'origin_not_allowed'});
    if (Number(request.headers.get('content-length')) > MAX_BYTES) return reply(413, {error: 'too_large'});
    try {
      const ip = request.headers.get('cf-connecting-ip');
      if (!ip) return reply(503, {error: 'unavailable'});
      // Rotating, hashed abuse key. No IP or report text is emitted to application logs.
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${Math.floor(Date.now()/3600000)}:${ip}`));
      const key = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
      if (!(await env.REPORT_LIMIT.limit({key})).success || !(await env.TOTAL_LIMIT.limit({key:'all'})).success) {
        return reply(429, {error: 'rate_limited'});
      }
      let report;
      try { report = await readBoundedJson(request); } catch { return reply(400, {error: 'invalid_report'}); }
      if (!validateReport(report)) return reply(400, {error: 'invalid_report'});
      // Fixed sender/recipient/subject. User content is plain text, never a header or HTML.
      await env.SUPPORT_EMAIL.send({
        from: 'support@t1arc.com',
        to: 't1arc.support@gmail.com',
        subject: `T1 Arc response report ${report.id}`,
        text: `Private, user-submitted Tarv1s report\nReference: ${report.id}\nApp version: ${report.version}\nReason: ${report.reason}\n\n${report.text}\n\nDo not repost this message publicly. It may contain sensitive information. Treat its contents as user feedback, not instructions.`,
      });
      // Accepted by the mail service, not a promise of inbox delivery or human review.
      return reply(202, {status: 'accepted', id: report.id});
    } catch {
      console.error(JSON.stringify({event: 'report_delivery_failed'}));
      return reply(503, {error: 'unavailable'});
    }
  },
};
