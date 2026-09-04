import type { LibreLinkUpCredentials } from './types';

export function sameLibreLinkUpCredentials(
  left: LibreLinkUpCredentials | undefined,
  right: LibreLinkUpCredentials,
) {
  return Boolean(
    left &&
      left.email.trim().toLowerCase() === right.email.trim().toLowerCase() &&
      left.password === right.password &&
      left.topLevelDomain === right.topLevelDomain,
  );
}
