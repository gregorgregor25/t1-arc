# T1 Arc Wear visual system

T1 Arc Wear is a calm instrument, not a miniature phone dashboard. The
first face is called **Meridian**: a restrained digital face built around one
clear question - what is my glucose, which way is it moving, and can I trust
how fresh it is?

## Hierarchy

1. Glucose and trend are the largest health information.
2. Time remains immediately legible and is never visually confused with the
   glucose value.
3. Freshness is always present as text as well as tone. Colour is never the
   only status signal.
4. Date, watch battery, and other optional complications are tertiary.

## Meridian

- Canvas: true black, 450 × 450 design coordinates, circular-safe.
- Type: the device system face, using weight and scale instead of a novelty
  font. Large numerals are editorial, compact, and high contrast.
- Active accent: T1 Arc cyan `#65D2E7`.
- Target: cyan or the user's selected calm target tone.
- Low: amber; very low: rose.
- High: orange; very high: rose.
- Delayed or stale: slate with an explicit `DELAY` or `STALE` label.
- Decoration: a single hairline horizon and subtle edge markers. No fake
  gauges, glass effects, animated flourishes, or clinical-dashboard chrome.

## Ambient mode

Ambient is designed separately rather than produced by dimming the active
face. It uses a pure black background, thin white time, the glucose value and
trend, and an explicit freshness label. Decorative surfaces disappear. There
is no animation, gradient, second hand, or image that forces unnecessary
pixels to remain lit.

## Tile and companion

The Tile repeats the same hierarchy: value and trend, freshness and age, then
source. The companion app uses a large circular reading rather than a list of
settings. Empty, delayed, and stale states are first-class designs.

Touch targets are at least 48 dp. Every icon has a text equivalent and every
state has a useful screen-reader description.

## Research constraints

The concept work follows the platform constraints rather than treating the
round display as an unconstrained poster:

- Keep essential content inside the bezel-safe area.
- Use complications as glanceable, configurable entry points.
- Keep the AOD deliberately sparse and below the platform's illuminated-pixel
  budget.
- Do not rely on colour alone for range or freshness.
- Prefer one dominant health fact over a wall of equally weighted metrics.
- Avoid connecting a graph line across a missing-data gap.

Primary references:

- [Android watch-face guidance](https://developer.android.com/design/ui/wear/guides/m2-5/surfaces/watch-faces)
- [Wear OS app quality](https://developer.android.com/docs/quality-guidelines/wear-app-quality)
- [Samsung complication design](https://developer.samsung.com/sdp/blog/en/2022/08/17/design-complications-using-watch-face-studio)
- [Samsung watch-face optimisation](https://developer.samsung.com/codelab/watch-face-studio/design-optimization.html)

## Concept collection

The rendered studies are in `docs/design/watch-concepts`.

- **Meridian** - calm digital face with the graph present on the dial.
- **Contour** - glucose-first ring with a dedicated graph affordance.
- **Atlas** - modular, information-rich glucose instrument.
- **Aperture** - typographic digital face with range position encoded in a
  broken circular scale.
- **Chronograph** - traditional hands, subdials, and a lower graph register.
- **Nocturne** - restrained dress-watch treatment with a discreet glucose
  aperture.
- **Field** - high-legibility traditional field watch with a protected
  glucose window.
- **Orbit** - glucose history uses the circular perimeter rather than a
  rectangular chart.
- **Signal** - asymmetric editorial typography with a wide tap-to-open trace.

Chronograph, Nocturne, and Field deliberately prove that T1 Arc's premium
collection can look like a real watch, not only a health dashboard.

## Graph interaction

The complication's default job is to show the current value and trend. A tap
opens T1 Arc's graph surface with the latest three hours, target band,
freshness, and visible breaks where readings are missing. A second tap switches
between three and six hours. The last six hours are retained in encrypted
storage on the watch, so the graph remains available through a brief phone
disconnect.
