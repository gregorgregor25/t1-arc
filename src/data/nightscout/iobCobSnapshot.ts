import { NightscoutIobCobSnapshot } from './types';
import { parseExternalAbsoluteTimestamp } from '@/domain/externalTimestamp';

export const NIGHTSCOUT_IOB_COB_MAX_AGE_MS = 12 * 60_000;
const EARLIEST_PLAUSIBLE_TIMESTAMP = Date.UTC(2000, 0, 1);

function finiteSnapshotNumber(value: unknown) {
  if (typeof value === 'number')
    return Number.isFinite(value) ? value : undefined;
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function payloadTimestamp(source: Record<string, unknown> | undefined) {
  if (!source) return undefined;
  for (const field of [
    'datetime',
    'date',
    'mills',
    'timestamp',
    'dateString',
  ]) {
    const value = source[field];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value !== 'string' || !value.trim()) continue;
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return numeric;
    const parsed = parseExternalAbsoluteTimestamp(value);
    if (parsed !== undefined) return parsed;
  }
  return undefined;
}

export function isFreshNightscoutIobCobSnapshot(
  snapshot: NightscoutIobCobSnapshot,
  now = Date.now(),
) {
  const validIob =
    snapshot.iobUnits === undefined ||
    (typeof snapshot.iobUnits === 'number' &&
      Number.isFinite(snapshot.iobUnits));
  const validCob =
    snapshot.cobGrams === undefined ||
    (typeof snapshot.cobGrams === 'number' &&
      Number.isFinite(snapshot.cobGrams) &&
      snapshot.cobGrams >= 0);
  return (
    validIob &&
    validCob &&
    (snapshot.iobUnits !== undefined || snapshot.cobGrams !== undefined) &&
    Number.isFinite(snapshot.timestamp) &&
    snapshot.timestamp >= EARLIEST_PLAUSIBLE_TIMESTAMP &&
    snapshot.timestamp <= now + 60_000 &&
    now - snapshot.timestamp <= NIGHTSCOUT_IOB_COB_MAX_AGE_MS
  );
}

export function normalizeNightscoutPebbleIobCob(
  payload: unknown,
  now = Date.now(),
): NightscoutIobCobSnapshot | undefined {
  const root =
    payload && typeof payload === 'object'
      ? (payload as Record<string, unknown>)
      : undefined;
  const first =
    Array.isArray(root?.bgs) && root.bgs[0] && typeof root.bgs[0] === 'object'
      ? (root.bgs[0] as Record<string, unknown>)
      : undefined;
  const source =
    root && (root.iob !== undefined || root.cob !== undefined) ? root : first;
  if (!source) return undefined;

  const iobUnits = finiteSnapshotNumber(source.iob);
  const rawCob = finiteSnapshotNumber(source.cob);
  const timestamp = payloadTimestamp(source) ?? payloadTimestamp(first);
  if (iobUnits === undefined && rawCob === undefined) return undefined;
  if (timestamp === undefined) return undefined;

  const snapshot: NightscoutIobCobSnapshot = {
    iobUnits,
    cobGrams: rawCob === undefined ? undefined : Math.max(0, rawCob),
    timestamp,
  };
  return isFreshNightscoutIobCobSnapshot(snapshot, now) ? snapshot : undefined;
}
