import {
  LibreLinkUpCredentials,
  LibreLinkUpError,
} from '@/data/libreLinkUp/types';
import { isLocalDataWriteSupersededError } from '@/data/privacy/localDataWriteEpoch';
import { isSourceConnectionSupersededError } from '@/data/live/sourceConnectionOwnership';

const UNEXPECTED_LIBRE_SETUP_MESSAGE =
  'T1 Arc could not finish saving this connection. Your existing data is safe. Please tap Check connection again.';

export const LIBRE_VERIFICATION_DEADLINE_MS = 90_000;

const LIBRE_VERIFICATION_TIMEOUT_MESSAGE =
  'The LibreLinkUp connection check took too long. Check your internet connection and try again.';

export function libreSetupErrorForDisplay(error: unknown) {
  if (error instanceof LibreLinkUpError) return error;
  // Native database and secure-storage details are diagnostics, not useful or
  // safe UI copy. The user only needs the recovery action here.
  return new LibreLinkUpError('network', UNEXPECTED_LIBRE_SETUP_MESSAGE);
}

export interface LibreVerificationGuard {
  generation: number;
  draftKey: string;
}

export interface LibreVerificationRequest {
  generation: number;
  draftKey: string;
}

export type LibreVerificationOutcome<T> =
  | { kind: 'success'; value: T }
  | { kind: 'error'; error: unknown }
  | { kind: 'superseded' };

export type LibreVerificationStage = 'checking' | 'saving' | 'publishing';

export function libreVerificationActionLabel(
  stage?: LibreVerificationStage,
  idleLabel = 'Test, save and use connection',
) {
  if (stage === 'saving') return 'Saving securely…';
  if (stage === 'publishing') return 'Updating your glucose…';
  if (stage === 'checking') return 'Checking LibreLinkUp…';
  return idleLabel;
}

export function libreCredentialDraftKey(
  credentials: LibreLinkUpCredentials,
) {
  return JSON.stringify([
    credentials.email.trim().toLowerCase(),
    credentials.password,
    credentials.topLevelDomain,
  ]);
}

export function createLibreVerificationGuard(
  draft: LibreLinkUpCredentials,
): LibreVerificationGuard {
  return {
    generation: 0,
    draftKey: libreCredentialDraftKey(draft),
  };
}

export function invalidateLibreVerification(
  guard: LibreVerificationGuard,
  draft: LibreLinkUpCredentials,
) {
  guard.generation += 1;
  guard.draftKey = libreCredentialDraftKey(draft);
}

export function beginLibreVerification(
  guard: LibreVerificationGuard,
  draft: LibreLinkUpCredentials,
): LibreVerificationRequest {
  invalidateLibreVerification(guard, draft);
  return {
    generation: guard.generation,
    draftKey: guard.draftKey,
  };
}

export function isCurrentLibreVerification(
  guard: LibreVerificationGuard,
  request: LibreVerificationRequest,
  draft: LibreLinkUpCredentials,
) {
  return (
    request.generation === guard.generation &&
    request.draftKey === guard.draftKey &&
    request.draftKey === libreCredentialDraftKey(draft)
  );
}

export async function runLibreVerification<T>({
  request,
  verify,
  commit,
  activate,
  isCurrent,
  onStage,
  signal,
  verifyDeadlineMs = LIBRE_VERIFICATION_DEADLINE_MS,
}: {
  request: LibreVerificationRequest;
  verify: (signal: AbortSignal) => Promise<T>;
  commit: (value: T) => Promise<void>;
  activate: (value: T) => Promise<void>;
  isCurrent: (request: LibreVerificationRequest) => boolean;
  onStage?: (stage: LibreVerificationStage) => void;
  signal?: AbortSignal;
  verifyDeadlineMs?: number;
}): Promise<LibreVerificationOutcome<T>> {
  try {
    onStage?.('checking');
    const value = await runBoundedLibreVerification(
      verify,
      signal,
      verifyDeadlineMs,
    );
    if (!isCurrent(request)) return { kind: 'superseded' };

    onStage?.('saving');
    await commit(value);

    // Once credentials have been durably committed, repository activation is
    // part of the same operation. Navigation/generation only controls whether
    // the originating screen may present the result; it must not split stored
    // credentials from the active repository.
    onStage?.('publishing');
    await activate(value);
    if (!isCurrent(request)) return { kind: 'superseded' };

    return { kind: 'success', value };
  } catch (error) {
    if (
      isLocalDataWriteSupersededError(error) ||
      isSourceConnectionSupersededError(error)
    ) {
      return { kind: 'superseded' };
    }
    return isCurrent(request)
      ? { kind: 'error', error }
      : { kind: 'superseded' };
  }
}

async function runBoundedLibreVerification<T>(
  verify: (signal: AbortSignal) => Promise<T>,
  parentSignal: AbortSignal | undefined,
  deadlineMs: number,
) {
  const controller = new AbortController();
  let rejectAbort!: (error: LibreLinkUpError) => void;
  const aborted = new Promise<never>((_resolve, reject) => {
    rejectAbort = reject;
  });
  const abort = (message: string) => {
    if (controller.signal.aborted) return;
    rejectAbort(new LibreLinkUpError('network', message));
    controller.abort();
  };
  const cancelForParent = () =>
    abort('The LibreLinkUp connection check was cancelled.');
  if (parentSignal?.aborted) cancelForParent();
  else parentSignal?.addEventListener('abort', cancelForParent, { once: true });
  const timeout = setTimeout(
    () => abort(LIBRE_VERIFICATION_TIMEOUT_MESSAGE),
    Math.max(1, deadlineMs),
  );
  try {
    return await Promise.race([verify(controller.signal), aborted]);
  } finally {
    clearTimeout(timeout);
    parentSignal?.removeEventListener('abort', cancelForParent);
  }
}
