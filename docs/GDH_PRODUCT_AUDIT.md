# GlucoDataHandler patterns relevant to T1 Arc

Reviewed against upstream GlucoDataHandler `2.4.2` at commit
`114460bc29973c78580095e2e9b0f212eed9df20`. GDH is MIT licensed; T1 Arc
retains attribution in `THIRD_PARTY_NOTICES.md`.

This is a product and engineering audit, not a plan to clone GDH. T1 Arc is a
private, evidence-first health record with a much broader long-term role. GDH
is strongest as a reliable glucose distribution and device-display utility.

## What the Pixel always-on implementation actually does

GDH does not use an ordinary notification to place a full glucose value on the
Pixel always-on display. It uses an Android `AccessibilityService` scoped to
System UI and adds a `TYPE_ACCESSIBILITY_OVERLAY` after the display enters
`OFF`, `DOZE`, or `DOZE_SUSPEND`.

The implementation has five important parts:

1. It listens for both screen broadcasts and display-state changes.
2. It waits until the phone is genuinely non-interactive before adding the
   overlay.
3. It renders the glucose widget to a bitmap and places that bitmap through
   the accessibility window manager.
4. It refreshes the bitmap when glucose, time, settings, or chart data changes.
5. It shifts the position slightly to reduce OLED burn-in.

The user-enabled accessibility service is different from Android's optional
accessibility shortcut. The floating accessibility button only opens or
controls the service; it is not the always-on glucose display.

T1 Arc should keep the explicit privacy disclosure and use the service only
for this display. A future public Play Store release must reassess the policy
fit of this approach because Android documents accessibility services as tools
for assisting users with disabilities.

## GDH's range and colour model

GDH defines four ordered mmol/L boundaries:

- very-low threshold;
- target-range minimum;
- target-range maximum;
- very-high threshold.

Those boundaries produce five glucose states: very low, low, in range, high,
and very high. GDH uses one alarm colour for both extremes, one out-of-range
colour for low/high, one in-range colour, and a separate obsolete colour.

T1 Arc adopts the ordered boundary model but permits an independent colour
for each of the five ranges plus stale/missing. The UI always includes a text
label and freshness, so meaning never depends on colour alone. Colour choices
are semantic palette tokens with separate accessible light, dark, and AOD
values rather than arbitrary raw colours that can become unreadable.

## Adopt now

| GDH pattern | T1 Arc decision |
| --- | --- |
| Persistent current-glucose notification | Adopt with direction, provenance, age, and no sound/vibration |
| AOD accessibility overlay | Adopt for the private Pixel build with an explicit setup and diagnostics |
| Ordered glucose thresholds and semantic colours | Adopt with a lower-friction settings screen |
| Obsolete/stale state | Adopt everywhere; never leave an old value looking current |
| Boot and process recovery | Adopt; retain the latest display snapshot encrypted with Android Keystore |
| Data-source separation | Adopt; LibreLinkUp glucose and delayed Glooko insulin remain independently labelled |
| Exportable diagnostics | Adopt timings/stages/errors without credentials or health values |
| Home-screen widget | Adopted as a curated resizable value, direction, age, freshness, and source surface |
| Wear OS tile, complication, and watch face | Adopted with the phone as source of truth |
| Fallback trend calculation | Adopted only for source-missing arrows, with strict continuity checks, a calculated label, and exact supporting readings |
| User-configured safety alerts | Adopted off by default with explicit thresholds, hysteresis, repeat controls, Android channel controls, and no dose guidance |
| Lock-screen presentation | Adopted as a separate privacy choice from the true always-on display |

## High-value next surfaces

1. **Android Auto glance surface.** A minimal, non-interactive display can be
   considered after the core records and alert semantics are mature.

## Adapt later rather than copy

- **Local xDrip-compatible server/broadcasts:** useful for interoperability,
  but disabled by default, authenticated where possible, and clearly scoped to
  the local device/network.
- **Multiple widget layouts:** useful, but T1 Arc should offer a few curated
  layouts rather than GDH's large matrix of preferences.
- **Settings export/import:** fold display settings into T1 Arc's encrypted
  portable backup instead of creating a separate settings file.
- **Health Connect:** T1 Arc reads chosen activity and health categories
  through its existing on-device Health Connect integration. Writing glucose
  back to Health Connect should be an explicit later choice.

## Do not copy for the current setup

- Omnipod notification parsing does not solve the UK setup because the pump is
  controlled by a separate PDM, not an Omnipod phone app.
- A dummy media player for showing glucose in a car creates confusing system
  state and is not appropriate for T1 Arc.
- An unauthenticated open local web server should not be enabled by default.
- Three parallel persistent notifications add cognitive load without improving
  the core T1 Arc experience.
- Device-specific source hacks should not leak into the UI or normalized health
  record model.

## T1 Arc-specific additions GDH does not provide

- complete encrypted glucose and context history;
- delayed Glooko export retention and deterministic normalization;
- food search, barcode capture, and local meal records;
- Health Connect ingestion with source provenance;
- evidence-linked insights and summaries;
- portable encrypted backup;
- a unified timeline across glucose, insulin, food, activity, sleep, weight,
  medication, and user context.
