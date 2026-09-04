import { NightscoutConnection, NightscoutError } from './types';

export function normalizeNightscoutConnection(
  site: string,
  accessToken?: string,
  apiSecret?: string,
  includeIobCob = true,
): NightscoutConnection {
  const value = site.trim();
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new NightscoutError(
      'invalid-connection',
      'Enter the full HTTPS address of the Nightscout site.',
    );
  }
  if (url.protocol !== 'https:') {
    throw new NightscoutError(
      'invalid-connection',
      'T1 Arc requires HTTPS so glucose and the read-only token are encrypted in transit.',
    );
  }
  if (url.username || url.password) {
    throw new NightscoutError(
      'invalid-connection',
      'Do not put a username or password in the Nightscout address.',
    );
  }
  const tokenFromUrl = url.searchParams.get('token')?.trim();
  const token = accessToken?.trim() || tokenFromUrl || undefined;
  url.search = '';
  url.hash = '';
  url.pathname = url.pathname.replace(/\/+$/, '');
  return {
    baseUrl: url.toString().replace(/\/+$/, ''),
    accessToken: token,
    apiSecret: apiSecret?.trim() || undefined,
    includeIobCob,
  };
}

/**
 * Returns the browser security origin used by a Nightscout connection.
 * Credentials may only be silently reused while this value is unchanged.
 */
export function nightscoutOrigin(value: string) {
  try {
    const url = new URL(value.trim());
    return url.protocol === 'https:' && !url.username && !url.password
      ? url.origin.toLocaleLowerCase()
      : undefined;
  } catch {
    return undefined;
  }
}

export function isSameNightscoutOrigin(
  saved: NightscoutConnection | undefined,
  site: string,
) {
  const savedOrigin = saved ? nightscoutOrigin(saved.baseUrl) : undefined;
  const draftOrigin = nightscoutOrigin(site);
  return savedOrigin !== undefined && savedOrigin === draftOrigin;
}

export function normalizedNightscoutBaseUrl(value: string) {
  try {
    return normalizeNightscoutConnection(value).baseUrl;
  } catch {
    return undefined;
  }
}

export function isSameNightscoutBaseUrl(
  saved: NightscoutConnection | undefined,
  site: string,
) {
  const draftBaseUrl = normalizedNightscoutBaseUrl(site);
  return (
    saved !== undefined &&
    normalizedNightscoutBaseUrl(saved.baseUrl) === draftBaseUrl
  );
}

/**
 * Builds an edited connection without ever carrying a credential across an
 * origin boundary. A token pasted in the URL still counts as an explicit new
 * credential and is extracted by normalizeNightscoutConnection.
 */
export function resolveNightscoutDraftConnection(input: {
  site: string;
  accessToken: string;
  apiSecret: string;
  includeIobCob: boolean;
  saved?: NightscoutConnection;
}) {
  const explicit = normalizeNightscoutConnection(
    input.site,
    input.accessToken || undefined,
    input.apiSecret || undefined,
    input.includeIobCob,
  );
  if (!isSameNightscoutBaseUrl(input.saved, explicit.baseUrl)) {
    return explicit;
  }
  return normalizeNightscoutConnection(
    explicit.baseUrl,
    explicit.accessToken ?? input.saved?.accessToken,
    explicit.apiSecret ?? input.saved?.apiSecret,
    input.includeIobCob,
  );
}

export function nightscoutDraftFromSaved(saved: NightscoutConnection) {
  return {
    site: saved.baseUrl,
    accessToken: '',
    apiSecret: '',
    includeIobCob: saved.includeIobCob !== false,
  } as const;
}

export function nightscoutHost(connection: NightscoutConnection) {
  try {
    return new URL(connection.baseUrl).host;
  } catch {
    return 'Nightscout site';
  }
}
