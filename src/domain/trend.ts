import { TrendDirection } from './models';

export interface TrendPresentation {
  arrow: string;
  label: string;
}

const TREND_PRESENTATION: Record<TrendDirection, TrendPresentation> = {
  doubleDown: { arrow: '⇊', label: 'falling quickly' },
  down: { arrow: '↓', label: 'falling' },
  slightDown: { arrow: '↘', label: 'gently falling' },
  flat: { arrow: '→', label: 'steady' },
  slightUp: { arrow: '↗', label: 'gently rising' },
  up: { arrow: '↑', label: 'rising' },
  doubleUp: { arrow: '⇈', label: 'rising quickly' },
  unknown: { arrow: '—', label: 'trend unavailable' },
};

export function presentTrend(trend: TrendDirection) {
  return TREND_PRESENTATION[trend];
}

export function trendFromDelta(deltaMmolLPerFiveMinutes: number): TrendDirection {
  if (deltaMmolLPerFiveMinutes >= 0.55) return 'doubleUp';
  if (deltaMmolLPerFiveMinutes >= 0.3) return 'up';
  if (deltaMmolLPerFiveMinutes >= 0.1) return 'slightUp';
  if (deltaMmolLPerFiveMinutes <= -0.55) return 'doubleDown';
  if (deltaMmolLPerFiveMinutes <= -0.3) return 'down';
  if (deltaMmolLPerFiveMinutes <= -0.1) return 'slightDown';
  return 'flat';
}
