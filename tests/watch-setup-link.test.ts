import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('watch setup documentation link', () => {
  it('uses the canonical repository default branch rather than a preparation branch', () => {
    const source = readFileSync(new URL('../src/components/WatchFaceChooser.tsx', import.meta.url), 'utf8');
    const match = source.match(/const GUIDE = '([^']+)'/);
    expect(match).not.toBeNull();
    if (!match?.[1]) throw new Error('Watch setup URL is missing');
    const guide = new URL(match[1]);
    expect(guide.origin).toBe('https://github.com');
    expect(guide.pathname).toBe('/gregorgregor25/t1-arc/blob/HEAD/docs/WATCH_SETUP.md');
    expect(existsSync(new URL('../docs/WATCH_SETUP.md', import.meta.url))).toBe(true);
    expect(source).toContain('Linking.openURL(GUIDE)');
  });
});
