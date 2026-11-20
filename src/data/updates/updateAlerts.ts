import * as SecureStore from 'expo-secure-store';

import CommunityReminder from '../../../modules/t1arc-community-reminder';
import {
  automaticCheckDue,
  installedVersionCode,
  isPublicReleaseVersion,
  nextAutomaticCheckAt,
  normalizeUpdateAlertState,
  pendingUpdateFor,
  shouldNotify,
  UPDATE_CHECK_INTERVAL_MS,
  withNotifiedVersionCode,
  type PendingUpdate,
  type UpdateAlertState,
} from '@/domain/updateAlerts';

import { thisInstalledApp } from './installedApp';
import {
  checkPublicRelease,
  OFFICIAL_PHONE_PACKAGE,
  officialReleaseLinks,
  type InstalledAppIdentity,
  type PublicReleaseCheck,
} from './publicRelease';
import { resetUpdateCheckHint } from './updateCheckOpportunity';

/**
 * Automatic update alerts, on by default. At most once a day this makes the
 * same anonymous GitHub request as About T1 Arc > Check for updates, and a
 * newer verified public release is announced once with a quiet notification.
 * Nothing is downloaded or installed. The switch and the check bookkeeping
 * live in Android secure storage and are not part of encrypted backups.
 */
export const UPDATE_ALERTS_SETTING_KEY = 't1arc.update-alerts.setting.v1';
export const UPDATE_ALERTS_STATE_KEY = 't1arc.update-alerts.state.v1';

export type UpdateAlertsSetting = 'enabled' | 'disabled';

export interface UpdateNotifier {
  show(version: string): Promise<boolean>;
  cancel(): Promise<unknown>;
}

const nativeNotifier: UpdateNotifier = {
  show: (version) => CommunityReminder.showUpdateNotificationAsync(version),
  cancel: () => CommunityReminder.cancelUpdateNotificationAsync(),
};

export type ReleaseChecker = (
  installed: InstalledAppIdentity,
  options: { signal: AbortSignal },
) => Promise<PublicReleaseCheck>;

export interface AutomaticUpdateCheckOptions {
  installed: InstalledAppIdentity;
  now?: number;
  check?: ReleaseChecker;
  notifier?: UpdateNotifier;
}

/**
 * Bumped when the switch is turned off, so a run that began earlier can
 * neither notify nor recreate the pending release it cleared.
 */
let generation = 0;
let inFlight: Promise<number> | undefined;
let activeRequest: AbortController | undefined;
let stateQueue: Promise<unknown> = Promise.resolve();
/** A switch-off write still landing; runs wait for it before reading the switch. */
let pendingSettingWrite: Promise<unknown> = Promise.resolve();

/** Default is enabled; only the explicit off switch disables automatic checks. */
export async function getUpdateAlertsSettingAsync(): Promise<UpdateAlertsSetting> {
  return (await SecureStore.getItemAsync(UPDATE_ALERTS_SETTING_KEY)) === 'disabled' ? 'disabled' : 'enabled';
}

/**
 * Invalid stored fields are left out and unreadable content reads as empty.
 * A storage failure throws, so a run stops before it can overwrite what is
 * stored or reach the network.
 */
export async function loadUpdateAlertState(): Promise<UpdateAlertState> {
  const raw = await SecureStore.getItemAsync(UPDATE_ALERTS_STATE_KEY);
  try {
    return normalizeUpdateAlertState(JSON.parse(raw ?? 'null'));
  } catch {
    return {};
  }
}

async function saveUpdateAlertState(state: UpdateAlertState): Promise<void> {
  await SecureStore.setItemAsync(UPDATE_ALERTS_STATE_KEY, JSON.stringify(state));
}

/** Serialises read-modify-write updates between runs and the switch. */
function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const next = stateQueue.then(task);
  stateQueue = next.catch(() => undefined);
  return next;
}

function mutateState(
  expectedGeneration: number,
  update: (state: UpdateAlertState) => UpdateAlertState,
): Promise<UpdateAlertState | undefined> {
  return enqueue(async () => {
    if (generation !== expectedGeneration) return undefined;
    const current = await loadUpdateAlertState();
    const updated = update(current);
    if (generation !== expectedGeneration) return undefined;
    if (updated !== current) await saveUpdateAlertState(updated);
    return updated;
  });
}

/** Forgets the pending release after any write already queued by an older run. */
function clearPendingAfterQueuedWrites(): Promise<void> {
  return enqueue(async () => {
    const current = await loadUpdateAlertState();
    if (current.pending) await saveUpdateAlertState({ ...current, pending: undefined });
  });
}

interface AnnouncementClaim {
  versionCode: number;
  previous: number | undefined;
}

/**
 * Saves the release and, when it has not been announced yet, marks it as
 * announced before any notification appears. A failed save therefore never
 * leads to a second notification for the same version. Resolves with the
 * claim when this run should show the notification.
 */
function savePendingAndClaim(
  expectedGeneration: number,
  pending: PendingUpdate,
): Promise<AnnouncementClaim | undefined> {
  return enqueue(async () => {
    if (generation !== expectedGeneration) return undefined;
    const current = await loadUpdateAlertState();
    if (generation !== expectedGeneration) return undefined;
    const announce = shouldNotify(current, pending.versionCode);
    const marked = announce ? withNotifiedVersionCode(current, pending.versionCode) : current;
    await saveUpdateAlertState({ ...marked, pending });
    return announce ? { versionCode: pending.versionCode, previous: current.notifiedVersionCode } : undefined;
  });
}

/**
 * A mark whose notification never appeared and could not be removed. The next
 * run removes it before deciding what to announce, so the version is still
 * announced once storage works again. Kept in memory only.
 */
let owedRelease: AnnouncementClaim | undefined;

/** Removes a mark whose notification never appeared, so a later check can try again. */
async function releaseClaim(claim: AnnouncementClaim): Promise<void> {
  try {
    await enqueue(async () => {
      const current = await loadUpdateAlertState();
      if (current.notifiedVersionCode !== claim.versionCode) return;
      await saveUpdateAlertState(withNotifiedVersionCode(current, claim.previous));
    });
    if (owedRelease === claim) owedRelease = undefined;
  } catch {
    owedRelease = claim;
  }
}

async function alertsAllowed(expectedGeneration: number) {
  if (generation !== expectedGeneration) return false;
  await pendingSettingWrite;
  const setting = await getUpdateAlertsSettingAsync();
  // The switch may have moved while secure storage was being read.
  return generation === expectedGeneration && setting === 'enabled';
}

export async function setUpdateAlertsEnabledAsync(
  enabled: boolean,
  notifier: UpdateNotifier = nativeNotifier,
): Promise<void> {
  if (enabled) {
    await SecureStore.setItemAsync(UPDATE_ALERTS_SETTING_KEY, 'enabled');
    resetUpdateCheckHint();
    return;
  }
  // Save 'disabled' first so a run starting mid-switch reads it, then stop
  // earlier runs and cancel a request on the wire, then remove the alert.
  const write = SecureStore.setItemAsync(UPDATE_ALERTS_SETTING_KEY, 'disabled');
  pendingSettingWrite = write.catch(() => undefined);
  try {
    await write;
  } finally {
    generation += 1;
    activeRequest?.abort();
    activeRequest = undefined;
    resetUpdateCheckHint();
  }
  await notifier.cancel().catch(() => undefined);
  await clearPendingAfterQueuedWrites();
}

/**
 * The newer release an automatic check found, while alerts are on and it is
 * still newer than this installation. Used to open its details directly.
 */
export async function getPendingUpdateAsync(
  installed: InstalledAppIdentity,
): Promise<PendingUpdate | undefined> {
  if (installed.applicationId !== OFFICIAL_PHONE_PACKAGE || !isPublicReleaseVersion(installed.version)) {
    return undefined;
  }
  if ((await getUpdateAlertsSettingAsync()) !== 'enabled') return undefined;
  return pendingUpdateFor(await loadUpdateAlertState(), installedVersionCode(installed.buildNumber));
}

/** The release a daily check verified, in the form About shows. Makes no request. */
export function releaseCheckFromPending(pending: PendingUpdate): PublicReleaseCheck {
  const { releaseUrl, apkUrl } = officialReleaseLinks(pending.version);
  return {
    kind: 'available',
    version: pending.version,
    versionCode: pending.versionCode,
    notes: pending.notes,
    releaseUrl,
    apkUrl,
  };
}

/** True when this installation never checks automatically (test builds, other packages). */
export function automaticChecksUnsupported(installed: InstalledAppIdentity): boolean {
  return (
    installed.applicationId !== OFFICIAL_PHONE_PACKAGE ||
    !isPublicReleaseVersion(installed.version) ||
    installedVersionCode(installed.buildNumber) === undefined
  );
}

/**
 * Runs an automatic check when one is due. Never throws and runs one check at
 * a time. Resolves with the earliest time another check could be due.
 */
export function runAutomaticUpdateCheckAsync(options: AutomaticUpdateCheckOptions): Promise<number> {
  const now = options.now ?? Date.now();
  inFlight ??= run({ ...options, now })
    .catch(() => now + UPDATE_CHECK_INTERVAL_MS / 24)
    .finally(() => {
      inFlight = undefined;
    });
  return inFlight;
}

export function runAutomaticUpdateCheckForThisAppAsync(now = Date.now()): Promise<number> {
  return runAutomaticUpdateCheckAsync({ installed: thisInstalledApp(), now });
}

async function run({
  installed,
  now,
  check = checkPublicRelease,
  notifier = nativeNotifier,
}: AutomaticUpdateCheckOptions & { now: number }): Promise<number> {
  // Test builds and other packages never check automatically; nothing is sent.
  if (automaticChecksUnsupported(installed)) return Number.POSITIVE_INFINITY;
  const installedCode = installedVersionCode(installed.buildNumber)!;
  const startGeneration = generation;
  if (!(await alertsAllowed(startGeneration))) return now + UPDATE_CHECK_INTERVAL_MS;

  const state = await loadUpdateAlertState();
  if (state.pending && !pendingUpdateFor(state, installedCode)) {
    // The announced release (or a newer one) is installed: remove the old alert.
    await notifier.cancel().catch(() => undefined);
    await mutateState(startGeneration, (current) =>
      current.pending ? { ...current, pending: undefined } : current,
    );
  }
  if (!automaticCheckDue(state, now)) return nextAutomaticCheckAt(state, now);

  // Record the attempt first, so a failure or crash never repeats the request.
  if (!(await mutateState(startGeneration, (current) => ({ ...current, lastCheckedAt: now })))) {
    return now + UPDATE_CHECK_INTERVAL_MS;
  }
  const nextCheck = now + UPDATE_CHECK_INTERVAL_MS;
  // The switch may have been turned off while the attempt was being saved.
  // Nothing is awaited between the final generation check and registering the
  // request, so a switch-off from then on aborts it.
  if (!(await alertsAllowed(startGeneration)) || generation !== startGeneration) return nextCheck;
  const controller = new AbortController();
  activeRequest = controller;
  let result: PublicReleaseCheck;
  try {
    result = await check(installed, { signal: controller.signal });
  } finally {
    if (activeRequest === controller) activeRequest = undefined;
  }
  if (generation !== startGeneration) return nextCheck;

  if (result.kind === 'current') {
    await notifier.cancel().catch(() => undefined);
    await mutateState(startGeneration, (current) =>
      current.pending ? { ...current, pending: undefined } : current,
    );
    return nextCheck;
  }
  // Unavailable, incompatible or failed checks change nothing; try again tomorrow.
  if (result.kind !== 'available' || result.versionCode <= installedCode) return nextCheck;
  // The switch may have moved during the request.
  if (!(await alertsAllowed(startGeneration))) return nextCheck;

  const pending: PendingUpdate = { version: result.version, versionCode: result.versionCode, notes: result.notes };
  // First remove a mark an earlier run could not, so its version is not skipped.
  if (owedRelease) await releaseClaim(owedRelease);
  // Stops here, without a notification, if the mark cannot be saved.
  const claim = await savePendingAndClaim(startGeneration, pending);
  if (!claim) return nextCheck;
  if (generation !== startGeneration) {
    await releaseClaim(claim);
    return nextCheck;
  }
  const shown = await notifier.show(pending.version).catch(() => false);
  if (!shown) {
    // Android did not show it, for example because notifications are off.
    await releaseClaim(claim);
    return nextCheck;
  }
  if (generation !== startGeneration) {
    // Switched off while the alert was being shown.
    await notifier.cancel().catch(() => undefined);
  }
  return nextCheck;
}
