export const CONNECTION_HISTORY_PREFIX = 'connection-history-v1:';
export interface ConnectionCheck {
  at: number;
  outcome: 'new-reading' | 'no-new-reading' | 'failed';
  measurementAt?: number;
  reason?: 'network' | 'rate-limited' | 'account' | 'source';
}
export function appendConnectionCheck(stored: string | undefined, check: ConnectionCheck) {
  const history = readConnectionHistory(stored).filter(item => item.at >= check.at - 7 * 86400000 && item.at <= check.at);
  const last = history[history.length - 1];
  if (last && check.outcome !== 'new-reading' && last.outcome === check.outcome && last.reason === check.reason && last.measurementAt === check.measurementAt && check.at - last.at < 60 * 60_000) return JSON.stringify(history);
  return JSON.stringify([...history, check].slice(-2500));
}
export function readConnectionHistory(stored: string | undefined): ConnectionCheck[] {
  try {
    const data: unknown = JSON.parse(stored ?? '[]');
    if (!Array.isArray(data)) return [];
    return data.filter((item): item is ConnectionCheck => Boolean(item && typeof item === 'object' && Number.isFinite(item.at) && ['new-reading', 'no-new-reading', 'failed'].includes(item.outcome))).map(item => ({
      at: item.at, outcome: item.outcome,
      ...(Number.isFinite(item.measurementAt) ? { measurementAt: item.measurementAt } : {}),
      ...(['network', 'rate-limited', 'account', 'source'].includes(item.reason ?? '') ? { reason: item.reason } : {}),
    })).slice(-2500);
  } catch { return []; }
}
