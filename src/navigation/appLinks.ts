export const APP_LINK_PREFIXES: string[] = ['t1arc://'];

/** Reject malformed/oversized intents before the navigation query decoder. */
export function isSafeNavigationLink(url: string): boolean {
  if (url.length > 2048 || !url.startsWith('t1arc://')) return false;
  try {
    // The downstream decoder has an expensive fallback for invalid UTF-8.
    // All T1 Arc shortcuts and shared-report links use valid URI encoding.
    decodeURIComponent(url);
    return true;
  } catch {
    return false;
  }
}

export const GLOOKO_SHARED_REPORT_LINK =
  't1arc://sources/glooko?shared-report=1';

export function isGlookoSourceLink(url: string) {
  return /^t1arc:\/\/sources\/glooko(?:[/?#]|$)/i.test(url);
}
