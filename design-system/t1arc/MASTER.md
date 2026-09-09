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
| Background | `#F5F1EA` | `#111217` |
| Surface | `#FFFDF9` | `#1B1D24` |
| Elevated surface | `#FFFFFF` | `#252731` |
| Primary text | `#1B1D24` | `#F8F5EE` |
| Secondary text | `#50535E` | `#C4C1BC` |
| Primary / glucose | `#3156B8` | `#8EA7FF` |
| Insulin | `#B85A2A` | `#F0A06A` |
| Positive accent | `#527038` | `#A7C978` |
| Low / danger | `#B72D4B` | `#FF8DA2` |
| High / warning | `#92520B` | `#F2B66E` |

The active direction is editorial rather than conventionally clinical: warm
ivory and graphite foundations, cobalt for glucose and navigation, apricot for
insulin, and olive for positive/context states. Avoid broad purple glows,
lavender card gradients and default teal chrome; those directions either feel
AI-branded or too close to the app's original visual identity.

The previous mineral teal palette remains in `src/theme/theme.tsx`. Change only
`ACTIVE_COLOR_PALETTE` in `src/domain/appPalette.ts` from `editorial` to
`mineral` to restore it without touching saved light/dark preferences or layout.

The launcher identity uses the same semantic quartet: graphite foundation,
ivory trace, cobalt glucose point and apricot insulin point. Do not introduce
purple gradients, sparkle motifs or a separate “AI” visual identity for
Tarv1s. Regenerate bitmap launcher and splash assets with
`scripts/generate_brand_assets.py` after changing their checked-in SVG sources.

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
- Numbers and units stay together. Use the selected regional glucose,
  measurement and energy formats, and the selected analysis timezone. Never
  hard-code UK units or London time into a shared screen.

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
  the selected analysis timezone.
- Insights name the period, calculation and evidence records. They never
  recommend insulin doses, correction boluses or pump-setting changes.
- Health metric detail uses one current value, one seven-day chart and one
  exact-value row per day. Missing days are labelled, never plotted as zero.
- History presents glucose and insulin in one metabolic-summary container while
  preserving separate labels, units and evidence.
- Today should not duplicate the same meal or activity in both the combined
  timeline and a second permanent list.

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
