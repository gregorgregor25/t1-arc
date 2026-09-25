export interface NativeErrorDiagnostic {
  code?: string;
  status?: string;
  param?: string;
  reason?: string;
}

function boundedToken(value: unknown) {
  const token = typeof value === "number" && Number.isSafeInteger(value)
    ? String(value) : typeof value === "string" ? value : "";
  return token.length > 0 && token.length <= 80 && /^[A-Za-z0-9_.:/-]+$/.test(token) &&
    !/^(?:sk-|AIza|AQ\.)/i.test(token) ? token : undefined;
}

/** Extracts only known machine fields; never includes provider message text. */
export function boundedNativeErrorDiagnostic(raw: unknown): NativeErrorDiagnostic | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const source = raw as Record<string, unknown>;
  const error = source.error;
  if (!error || typeof error !== "object" || Array.isArray(error)) return undefined;
  const fields = error as Record<string, unknown>;
  const details = Array.isArray(fields.details) ? fields.details : [];
  const first = details[0];
  const detail = first && typeof first === "object" && !Array.isArray(first)
    ? first as Record<string, unknown> : {};
  const result: NativeErrorDiagnostic = {
    code: boundedToken(fields.code),
    status: boundedToken(fields.status),
    param: boundedToken(fields.param),
    reason: boundedToken(fields.reason) ?? boundedToken(detail.reason) ?? boundedToken(fields.type),
  };
  return Object.values(result).some(Boolean) ? result : undefined;
}

export function boundedAppFailureMessage(error: unknown): string | undefined {
  if (!(error instanceof Error) || !/^(?:Google Gemini|Anthropic Claude|Tarv1s|TARV1S)\b/.test(error.message)) return undefined;
  return error.message.replace(/sk-ant-\S+|\b(?:AIza|AQ\.)\S+|sk-[A-Za-z0-9_-]{20,}/g, "[REDACTED]")
    .replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, 300);
}
