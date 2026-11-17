import type { GlucoseRange } from '@/domain/glucoseAppearance';
import { recordSourceLabel } from '@/domain/recordSourceLabels';
import type { SourceFreshness } from '@/domain/models';

/**
 * What the Today "Now" card is saying, in one word plus a shape. The shape
 * keeps the state readable without colour:
 *
 * - `circle`: in range
 * - `triangle-up`: high or very high
 * - `triangle-down`: low or very low
 * - `ring`: no recent reading
 */
export type NowCardMode = 'normal' | 'low' | 'stale';
export type NowStateShape = 'circle' | 'triangle-up' | 'triangle-down' | 'ring';

export interface NowCardState {
  mode: NowCardMode;
  word: string;
  shape: NowStateShape;
}

/**
 * The whole card changes only when it matters: a current low or very low
 * value, or a reading that is too old to treat as current.
 */
export function nowCardState(range: GlucoseRange, freshness: SourceFreshness): NowCardState {
  if (freshness === 'stale' || freshness === 'missing' || range === 'stale') {
    return { mode: 'stale', word: 'No new reading', shape: 'ring' };
  }
  switch (range) {
    case 'veryLow':
      return { mode: 'low', word: 'Very low', shape: 'triangle-down' };
    case 'low':
      return { mode: 'low', word: 'Low', shape: 'triangle-down' };
    case 'high':
      return { mode: 'normal', word: 'High', shape: 'triangle-up' };
    case 'veryHigh':
      return { mode: 'normal', word: 'Very high', shape: 'triangle-up' };
    case 'target':
      return { mode: 'normal', word: 'In range', shape: 'circle' };
  }
}

const SHORT_SOURCE_NAMES: Readonly<Record<string, string>> = {
  'aaps-local': 'AAPS',
  'android-notification': 'The notification source',
};

/** Short source name for "3 min ago · AAPS" and the stale message. */
export function nowCardSourceName(sourceId: string | undefined): string | undefined {
  if (!sourceId) return undefined;
  return SHORT_SOURCE_NAMES[sourceId] ?? recordSourceLabel(sourceId);
}

/**
 * Plain explanation for a reading that stopped updating. Says what is known
 * (the last time) and where to look, without guessing at the cause.
 */
export function staleReadingMessage(sourceName: string | undefined, lastTime: string) {
  const source = sourceName && sourceName !== 'Other source' ? sourceName : 'Your glucose source';
  const check = sourceName && sourceName !== 'Other source' ? `your sensor and ${sourceName}` : 'your sensor and glucose source';
  return `${source} has not sent a glucose reading since ${lastTime}. Check ${check}. Use a meter if you need a reading now.`;
}

/** Plain statement of which configured level the current value is below. */
export function lowReadingMessage(range: GlucoseRange, levelText: string) {
  return range === 'veryLow'
    ? `At or below your very low level of ${levelText}.`
    : `Below your low level of ${levelText}.`;
}
