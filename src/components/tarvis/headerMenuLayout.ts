import type { EdgeInsets } from 'react-native-safe-area-context';

/** Space kept above the sheet so the backdrop stays tappable and visible. */
export const TARVIS_MENU_TOP_GAP = 24;

/**
 * Where the Tarv1s "More" sheet may draw. Android draws the modal behind the
 * status and navigation bars, so the sheet keeps clear of them, and its height
 * is capped to what is left of the window. The list scrolls inside that, so
 * every action stays reachable in landscape or with large text.
 */
export function tarvisMenuSheetLayout(windowHeight: number, insets: EdgeInsets) {
  const top = Math.max(0, insets.top) + TARVIS_MENU_TOP_GAP;
  return {
    paddingTop: top,
    paddingLeft: Math.max(0, insets.left),
    paddingRight: Math.max(0, insets.right),
    bottomInset: Math.max(0, insets.bottom),
    maxHeight: Math.max(0, windowHeight - top),
  };
}
