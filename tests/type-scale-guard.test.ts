import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  MIN_DECORATIVE_FONT_SIZE,
  MIN_READABLE_FONT_SIZE,
  MIN_TOUCH_TARGET,
  touchSlop,
} from '@/theme/tokens';

const SRC = join(__dirname, '..', 'src');

/**
 * Places allowed to use the decorative micro size (11). Each is either
 * artwork with its own accessibility label or a supplementary badge whose
 * information is shown elsewhere.
 */
const DECORATIVE_FILES = new Set([
  'components/LaunchArtwork.tsx',
  'components/WatchFacePreview.tsx',
  'components/WearCompanionCard.tsx',
  'components/CombinedTimeline.tsx',
  'screens/onboarding/TourArtwork.tsx',
]);

/**
 * Chart text drawn in SVG may use the micro size. Two timeline lane captions
 * stay at 8 because the lanes are 16dp apart; the layer chips name them.
 */
const SVG_LANE_CAPTION_EXCEPTIONS = 2;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(name) ? [path] : [];
  });
}

const files = sourceFiles(SRC).map((path) => ({
  path: relative(SRC, path).split('\\').join('/'),
  text: readFileSync(path, 'utf8'),
}));

describe('type scale guard', () => {
  it('keeps style fontSize values at the readable minimum', () => {
    const failures: string[] = [];
    for (const { path, text } of files) {
      const minimum = DECORATIVE_FILES.has(path) ? MIN_DECORATIVE_FONT_SIZE : MIN_READABLE_FONT_SIZE;
      for (const match of text.matchAll(/fontSize:\s*(\d+(?:\.\d+)?)\b/g)) {
        if (Number(match[1]) < minimum) failures.push(`${path}: fontSize ${match[1]}`);
      }
    }
    expect(failures).toEqual([]);
  });

  it('keeps SVG chart labels at the decorative minimum', () => {
    const small: string[] = [];
    for (const { path, text } of files) {
      for (const match of text.matchAll(/fontSize=\{(\d+(?:\.\d+)?)\}/g)) {
        if (Number(match[1]) < MIN_DECORATIVE_FONT_SIZE) small.push(`${path}: fontSize={${match[1]}}`);
      }
    }
    expect(small).toHaveLength(SVG_LANE_CAPTION_EXCEPTIONS);
    expect(small.every((entry) => entry.startsWith('components/CombinedTimeline.tsx'))).toBe(true);
  });

  it('does not switch off font scaling', () => {
    const disabled = files.filter(({ text }) => /allowFontScaling=\{false\}/.test(text)).map(({ path }) => path);
    expect(disabled).toEqual([]);
  });
});

describe('touchSlop', () => {
  it('grows a small control to the minimum target', () => {
    expect(touchSlop(28)).toEqual({ top: 8, bottom: 8, left: 8, right: 8 });
    expect(touchSlop(36, 40)).toEqual({ top: 2, bottom: 2, left: 4, right: 4 });
  });

  it('adds nothing to a control that is already large enough', () => {
    expect(touchSlop(MIN_TOUCH_TARGET)).toEqual({ top: 0, bottom: 0, left: 0, right: 0 });
    expect(touchSlop(60, 48)).toEqual({ top: 0, bottom: 0, left: 0, right: 0 });
  });
});
