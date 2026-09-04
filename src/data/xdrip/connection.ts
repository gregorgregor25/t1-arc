import {
  XdripConnection,
  XdripError,
} from './types';

const DEFAULT_LOCAL_PORT = '17580';
const SGV_PATH = '/sgv.json';
const LOCAL_HTTP_HOSTS = new Set(['127.0.0.1', 'localhost']);

function withDefaultScheme(value: string) {
  const trimmed = value.trim();
  if (/^[a-z][a-z\d+.-]*:\/\//i.test(trimmed)) return trimmed;
  return `http://${trimmed}`;
}

export function normalizeXdripConnection(
  value: string,
): XdripConnection {
  let url: URL;
  try {
    url = new URL(withDefaultScheme(value));
  } catch {
    throw new XdripError(
      'invalid-connection',
      'Enter a valid xDrip endpoint, such as 127.0.0.1:17580.',
    );
  }

  const host = url.hostname.toLowerCase();
  if (!host) {
    throw new XdripError(
      'invalid-connection',
      'The xDrip endpoint must include a host.',
    );
  }
  if (url.username || url.password) {
    throw new XdripError(
      'invalid-connection',
      'Do not put a username or password in the xDrip address.',
    );
  }
  if (url.search || url.hash) {
    throw new XdripError(
      'invalid-connection',
      'Remove query parameters and fragments from the xDrip address.',
    );
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new XdripError(
      'invalid-connection',
      'The xDrip endpoint must use HTTPS, or local HTTP on this phone.',
    );
  }
  if (url.protocol === 'http:' && !LOCAL_HTTP_HOSTS.has(host)) {
    throw new XdripError(
      'invalid-connection',
      'Unencrypted xDrip access is allowed only on this phone. Use 127.0.0.1 or localhost, or use HTTPS.',
    );
  }

  const path = url.pathname.replace(/\/+$/, '');
  if (path && path !== SGV_PATH) {
    throw new XdripError(
      'invalid-connection',
      'The xDrip address must end in /sgv.json.',
    );
  }
  if (url.protocol === 'http:' && !url.port) {
    url.port = DEFAULT_LOCAL_PORT;
  }
  url.pathname = SGV_PATH;

  return { endpointUrl: url.toString().replace(/\/$/, '') };
}

export function xdripEndpointLabel(connection: XdripConnection) {
  const url = new URL(connection.endpointUrl);
  return `${url.host}${url.pathname}`;
}

export function isLocalXdripConnection(connection: XdripConnection) {
  const url = new URL(connection.endpointUrl);
  return url.protocol === 'http:' && LOCAL_HTTP_HOSTS.has(url.hostname);
}
