/**
 * Automatic update alerts: pure scheduling and "tell once per version" rules.
 *
 * The automatic check is the same anonymous GitHub request as the manual
 * About T1 Arc > Check for updates button. Nothing here reads health data.
 */
export const UPDATE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

/**
 * Public releases always use a plain version such as 1.7.22 (the release
 * check only accepts tags of that form). Test builds carry a suffix such as
 * 1.7.21-aaps.4 and may contain features a public release would remove.
 */
const PUBLIC_VERSION = /^\d{1,3}\.\d{1,3}\.\d{1,4}$/;

export function isPublicReleaseVersion(version: string | null | undefined): boolean {
  return typeof version === 'string' && PUBLIC_VERSION.test(version);
}

/** The release check trims release notes to this length. */
export const MAX_RELEASE_NOTES_LENGTH = 4_000;

export interface PendingUpdate {
  version: string;
  versionCode: number;
  /** Release notes as verified by the check, so About can show them without another request. */
  notes: string;
}

export interface UpdateAlertState {
  /** When the last automatic check started, whatever its outcome. */
  lastCheckedAt?: number;
  /** Highest release version code a notification has been shown for. */
  notifiedVersionCode?: number;
  /** A newer verified public release found by an automatic check. */
  pending?: PendingUpdate;
}

/** At most one automatic check a day. A future time means the clock moved back. */
export function automaticCheckDue(state: UpdateAlertState, now: number): boolean {
  const last = state.lastCheckedAt;
  if (last === undefined) return true;
  return now - last >= UPDATE_CHECK_INTERVAL_MS || now < last;
}

/** When the next automatic check may run; `now` when one is already due. */
export function nextAutomaticCheckAt(state: UpdateAlertState, now: number): number {
  return automaticCheckDue(state, now) ? now : (state.lastCheckedAt ?? now) + UPDATE_CHECK_INTERVAL_MS;
}

/** Each release is announced once; a later release is announced again. */
export function shouldNotify(state: UpdateAlertState, versionCode: number): boolean {
  return versionCode > (state.notifiedVersionCode ?? 0);
}

/** The installed build as a version code, or undefined when it cannot be confirmed. */
export function installedVersionCode(buildNumber: string | null | undefined): number | undefined {
  if (typeof buildNumber !== 'string' || !/^\d+$/.test(buildNumber)) return undefined;
  const code = Number(buildNumber);
  return Number.isSafeInteger(code) && code > 0 ? code : undefined;
}

/** The stored pending update, only while it is still newer than this installation. */
export function pendingUpdateFor(
  state: UpdateAlertState,
  installedCode: number | undefined,
): PendingUpdate | undefined {
  const pending = state.pending;
  if (!pending || installedCode === undefined) return undefined;
  return pending.versionCode > installedCode ? pending : undefined;
}

function isTime(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function isVersionCode(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

export function isUpdateAlertState(value: unknown): value is UpdateAlertState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  const pending = v.pending as Record<string, unknown> | undefined;
  return (
    (v.lastCheckedAt === undefined || isTime(v.lastCheckedAt)) &&
    (v.notifiedVersionCode === undefined || isVersionCode(v.notifiedVersionCode)) &&
    (pending === undefined ||
      (typeof pending === 'object' &&
        pending !== null &&
        isPublicReleaseVersion(pending.version as string) &&
        isVersionCode(pending.versionCode) &&
        typeof pending.notes === 'string' &&
        pending.notes.length <= MAX_RELEASE_NOTES_LENGTH))
  );
}

/** The same state with a different (or no) announced version. */
export function withNotifiedVersionCode(
  state: UpdateAlertState,
  versionCode: number | undefined,
): UpdateAlertState {
  const next = { ...state };
  if (versionCode === undefined) delete next.notifiedVersionCode;
  else next.notifiedVersionCode = versionCode;
  return next;
}
