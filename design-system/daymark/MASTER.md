# T1 Arc design system

T1 Arc is a calm personal health instrument, not a clinical dashboard and not
a gamified wellness app. The interface should reduce diabetes administration:
show what matters immediately, make logging fast, and keep every interpretation
inspectable.

## Product character

- Calm, precise, private and human.
- Premium comes from typography, spacing, restraint and dependable behaviour.
- Glucose, insulin and freshness are more visually important than connector
  names or implementation details.
- No decorative glass, fake gauges, pulsing readings, celebratory confetti or
  movement that competes with health data.
- Never use colour as the only indication of range, freshness or failure.

## Native colour tokens

The source of truth is `src/theme/theme.tsx`.

| Role | Light | Dark |
|---|---|---|
| Background | `#F1F8FA` | `#071519` |
| Surface | `#FFFFFF` | `#102328` |
| Elevated surface | `#FFFFFF` | `#153038` |
| Primary text | `#102B34` | `#F2FAFB` |
| Secondary text | `#46636D` | `#B7CDD2` |
| Primary / glucose | `#087F99` | `#65D2E7` |
| Insulin | `#6C4FB3` | `#BBA6F5` |
| Positive accent | `#087A5C` | `#69D5AC` |
| Low / danger | `#B74F64` | `#FF9BAE` |
| High / warning | `#A75C13` | `#F1B66F` |

Use the configurable glucose range colours for glucose presentation once the
user has chosen them. Maintain readable labels and trend arrows alongside the
colour.

## Type and hierarchy

- Use the Android system sans-serif stack; do not require a network font.
- Current glucose is the largest value in the product.
- Screen titles: 28–32sp, bold, compact tracking.
- Card titles: 16–18sp, 700–800 weight.
- Body: 13–15sp with generous line height.
- Metadata: 10–12sp, never used for essential actions or safety state.
- Numbers and units stay together; use `mmol/L`, `U`, `g`, `kg` and London time.

## Spacing and shape

- Base spacing: 4, 8, 16, 24, 32 and 48dp.
- Minimum interactive target: 48×48dp.
- Cards: 22dp radius; nested controls: 10–16dp; pills only for short states.
- Prefer whitespace and a thin border to heavy shadows.
- Bottom navigation has at most five destinations and must never cover content.

## Interaction rules

- One primary action per card or step.
- Common actions such as refresh, repeat meal and log food should take one tap
  from their relevant surface.
- Connection details and diagnostics are progressive disclosure, not page
  headlines.
- Destructive actions require confirmation and explain what is retained.
- Background work must show its last successful data time, not just a spinner.
- Respect reduced-motion settings. No automatic glucose animation or AOD
  repositioning.

## Data presentation

- Every current value shows reading time/freshness and trend in plain language.
- Stale, missing and failed are distinct states.
- Glooko freshness is stored and visible in sync details without dominating the
  private app’s everyday UI.
- Charts support exact inspection and align glucose, basal, bolus and context in
  Europe/London time.
- Insights name the period, calculation and evidence records. They never
  recommend insulin doses, correction boluses or pump-setting changes.

## Wear and always-on display

- Pure black ambient background, restrained pixels and no blinking.
- Glucose remains legible at arm’s length; trend and age remain available.
- User-selected position and size are stable.
- Burn-in protection may be platform-managed, but T1 Arc must not visibly jump
  the reading itself.

## Accessibility and QA

- Support system font scaling without clipping key values or controls.
- Text contrast should meet WCAG AA; state colours need labels/icons.
- Icon-only actions require accessibility labels.
- Test 360dp and 412dp phone widths, dark and light themes, large text, stale
  data, missing data and offline conditions.
- Verify all modal footers remain reachable above system navigation and the
  keyboard.
