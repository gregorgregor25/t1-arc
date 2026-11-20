/**
 * Shared presentation primitives for the 2026 redesign.
 *
 * All of them read colours and sizes from `useAppTheme()` (light and dark),
 * keep font scaling on, meet the 48 dp touch-target guidance and never use
 * colour as the only signal. Existing building blocks stay where they are and
 * can be combined with these: `SectionCard` (gradient card with free content),
 * `SegmentedControl`, `StatusPill` (data freshness) and `AppMenuButton`
 * (settings gear; pass it to `ScreenHeader` as `trailing`).
 */
export { ListGroup, type ListGroupProps } from './ListGroup';
export { ListRow, listRowAccessibilityLabel, type ListRowProps } from './ListRow';
export { NavCard, navCardAccessibilityLabel, type NavCardProps } from './NavCard';
export {
  ScreenHeader,
  screenHeaderBackLabel,
  type ScreenHeaderAction,
  type ScreenHeaderBack,
  type ScreenHeaderProps,
} from './ScreenHeader';
export {
  StatusIndicator,
  statusToneColor,
  statusToneWord,
  type StatusIndicatorProps,
  type StatusTone,
} from './StatusIndicator';
export {
  StatusLine,
  statusLineAccessibilityLabel,
  type StatusLineAction,
  type StatusLineProps,
} from './StatusLine';
export { flatSurfaceStyle } from './surface';
