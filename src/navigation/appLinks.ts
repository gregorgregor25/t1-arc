export const APP_LINK_PREFIXES: string[] = ['t1arc://'];

export const GLOOKO_SHARED_REPORT_LINK =
  't1arc://sources/glooko?shared-report=1';

export function isGlookoSourceLink(url: string) {
  return /^t1arc:\/\/sources\/glooko(?:[/?#]|$)/i.test(url);
}
