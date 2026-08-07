import {
  NightscoutConnection,
  NightscoutError,
} from './types';

export function normalizeNightscoutConnection(
  site: string,
  accessToken?: string,
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
  };
}

export function nightscoutHost(connection: NightscoutConnection) {
  try {
    return new URL(connection.baseUrl).host;
  } catch {
    return 'Nightscout site';
  }
}
