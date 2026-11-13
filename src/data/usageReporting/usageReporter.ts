import {
  duePings,
  markSent,
  recordMonitoringDay,
  recordOpen,
  type UsageState,
} from '@/domain/usageReporting';

import { resetMonitoringDayCache } from './monitoringDay';
import {
  clearUsageState,
  loadUsageConsent,
  loadUsageState,
  saveUsageConsent,
  saveUsageState,
  type UsageConsent,
} from './usageReportingStore';

/** Write-only collector for anonymous aggregate counts. */
export const USAGE_ENDPOINT = 'https://t1-events.gregorserver.com/v1/app-usage';
const TIMEOUT_MS = 10_000;
/** The collector accepts only plain release versions such as 1.7.20. */
const APP_VERSION = /^[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,4}$/;

export interface UsageFetchInit {
  method: 'POST';
  credentials: 'omit';
  headers: { 'Content-Type': 'application/json' };
  body: string;
  signal: AbortSignal;
}

export type UsageFetch = (
  url: string,
  init: UsageFetchInit,
) => Promise<{ ok: boolean; status: number }>;

export interface ReportUsageOptions {
  appVersion: string;
  fetchImpl?: UsageFetch;
  now?: number;
}

/**
 * Bumped whenever the switch is turned off or local data is erased, so work
 * that began earlier can neither send nor recreate deleted history.
 */
let generation = 0;
let inFlight: Promise<void> | undefined;
let activeRequest: AbortController | undefined;
let stateQueue: Promise<unknown> = Promise.resolve();
/** A switch-off write still landing; runs wait for it before reading consent. */
let pendingConsentWrite: Promise<unknown> = Promise.resolve();

/** Serialises read-modify-write updates from app opens and the collector. */
function mutateState(
  expectedGeneration: number,
  update: (state: UsageState) => UsageState,
): Promise<UsageState | undefined> {
  const next = stateQueue.then(async () => {
    if (generation !== expectedGeneration) return undefined;
    const current = await loadUsageState();
    const updated = update(current);
    if (generation !== expectedGeneration) return undefined;
    if (updated !== current) await saveUsageState(updated);
    return updated;
  });
  stateQueue = next.catch(() => undefined);
  return next;
}

async function reportingAllowed(expectedGeneration: number) {
  if (generation !== expectedGeneration) return false;
  await pendingConsentWrite;
  const consent = await loadUsageConsent();
  // The switch may have moved while secure storage was being read.
  return generation === expectedGeneration && consent === 'enabled';
}

/** Stops future work from this run and cancels a message already on the wire. */
function invalidateRuns() {
  generation += 1;
  activeRequest?.abort();
  activeRequest = undefined;
  resetMonitoringDayCache();
}

export async function getUsageConsentAsync(): Promise<UsageConsent> {
  return loadUsageConsent();
}

export async function setUsageConsentAsync(enabled: boolean): Promise<void> {
  if (enabled) {
    resetMonitoringDayCache();
    await saveUsageConsent('enabled');
    return;
  }
  // Switching off keeps only the switch position, never the activity history.
  // Save 'disabled' first so a run starting mid-switch reads it, then stop
  // earlier runs and cancel a message on the wire, then delete the history.
  const write = saveUsageConsent('disabled');
  pendingConsentWrite = write.catch(() => undefined);
  try {
    await write;
  } finally {
    invalidateRuns();
  }
  await clearUsageState();
}

/**
 * Full local-data erasure: remove the activity history. The switch position is
 * kept, so erasing data never turns counts back on for someone who opted out.
 */
export async function clearUsageReportingAsync(): Promise<void> {
  invalidateRuns();
  await clearUsageState();
}

/**
 * Records locally that the collector completed a sync today. Never sends
 * anything and never throws. Resolves false when storage could not be used.
 */
export async function noteMonitoringDayAsync(now = Date.now()): Promise<boolean> {
  try {
    const startGeneration = generation;
    if (!(await reportingAllowed(startGeneration))) return true;
    await mutateState(startGeneration, (state) => recordMonitoringDay(state, now));
    return true;
  } catch {
    return false;
  }
}

/** Called on app open. Never throws, never blocks the UI and never logs payloads. */
export function reportUsageOnOpenAsync(options: ReportUsageOptions): Promise<void> {
  inFlight ??= run(options)
    .catch(() => undefined)
    .finally(() => {
      inFlight = undefined;
    });
  return inFlight;
}

async function run({
  appVersion,
  fetchImpl = globalThis.fetch as unknown as UsageFetch,
  now = Date.now(),
}: ReportUsageOptions): Promise<void> {
  if (!APP_VERSION.test(appVersion)) return;
  const startGeneration = generation;
  if (!(await reportingAllowed(startGeneration))) return;
  const state = await mutateState(startGeneration, (current) => recordOpen(current, now));
  if (!state) return;
  for (const ping of duePings(state, { consent: true, appVersion, now })) {
    // The off switch stops sending immediately, including between messages.
    if (!(await reportingAllowed(startGeneration))) return;
    if (generation !== startGeneration) return;
    const controller = new AbortController();
    activeRequest = controller;
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const response = await fetchImpl(USAGE_ENDPOINT, {
        method: 'POST',
        credentials: 'omit',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(ping),
        signal: controller.signal,
      });
      if (response.ok) {
        await mutateState(startGeneration, (current) => markSent(current, ping.kind, now));
      }
    } catch {
      // Offline or blocked: try again on a later open. Never log the payload.
    } finally {
      clearTimeout(timer);
      if (activeRequest === controller) activeRequest = undefined;
    }
  }
}
