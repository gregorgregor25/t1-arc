const BASE_CARD_MIN_HEIGHT = 238;
const BASE_TRACE_TOP = 78;
const CARD_HEIGHT_PER_FONT_SCALE = 80;
const TRACE_TOP_PER_FONT_SCALE = 20;

export function currentGlucoseCardLayout(fontScale: number) {
  const normalizedFontScale = Number.isFinite(fontScale)
    ? Math.max(1, fontScale)
    : 1;
  const expansion = normalizedFontScale - 1;

  return {
    minHeight: BASE_CARD_MIN_HEIGHT + CARD_HEIGHT_PER_FONT_SCALE * expansion,
    traceTop: BASE_TRACE_TOP + TRACE_TOP_PER_FONT_SCALE * expansion,
  };
}
