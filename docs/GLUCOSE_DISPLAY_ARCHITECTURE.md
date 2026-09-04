# Glucose display architecture

This document records the Android display design informed by the
MIT-licensed GlucoDataHandler repository at commit
`114460bc29973c78580095e2e9b0f212eed9df20`.

## What was inspected

- `PermanentNotification.kt`: ongoing, public, only-alert-once status
  notifications; generated glucose/trend small icons; reading timestamp; custom
  expanded content.
- `GlucoDataService.kt`: sticky special-use foreground service and boot
  recovery.
- `AODAccessibilityService.kt` and `AodWidget.kt`: a doze-only accessibility
  overlay with small position changes to reduce OLED burn-in.
- `WearPhoneConnection.kt` and the Wear complication providers: phone/watch
  transport separated from watch-face rendering.

T1 Arc does not copy GDH's broad accessibility configuration, notification
listener, overlay permission, exact alarms, wallpaper replacement, key-event
filtering, or unrelated device integrations.

## Current T1 Arc flow

```text
user enables Glucose at a glance
  -> Android notification permission
  -> special-use foreground display service
  -> adaptive Headless JS source trigger
  -> existing T1 Arc LibreLinkUp connector
  -> SQLCipher glucose history
  -> display snapshot + bounded graph window
       value, trend, reading timestamp, source error state
  -> ongoing status-bar/lock-screen notification
  -> optional doze-only AOD overlay
```

Credentials and LibreLinkUp sessions remain in Android secure storage. The
native service never receives them. The full glucose history remains in
SQLCipher. The current snapshot and a bounded six-hour display window cross
the native bridge. The window is used for the expanded notification graph and
Wear OS; it contains only timestamps and normalised mmol/L values.

The notification:

- is silent, ongoing, and `CATEGORY_STATUS`;
- shows the selected regional glucose unit, trend, reading age, and reading
  time in the selected locale and IANA timezone, with
  current/delayed/stale state;
- uses a compact value/trend-first hierarchy and an expanded three-hour graph
  when enough history is present;
- uses the reading timestamp rather than the notification update time;
- has an optional redacted public version for a locked phone;
- opens T1 Arc for inspection;
- never offers dosing or pump-setting actions.

The foreground service is started only from the user's in-app control. It uses
Android's `specialUse` type because an indefinite personal glucose display and
collector does not fit another foreground-service category. It requests
LibreLinkUp on an adaptive schedule: once a minute normally, every 15 seconds
around the expected next sensor reading, and less often after a stale source
or rate-limit response. The existing connector deduplicates readings and
preserves cached history on source failure.

Android ranks notifications across apps. T1 Arc can request the correct
ongoing foreground importance and sort its own notifications, but it cannot
guarantee placement above another app such as ChatGPT or GDH. A
high-importance alert channel would add intrusive heads-up behaviour and is
reserved for explicit glucose alerts, not the quiet persistent status surface.

## Always-on display

Android does not provide an ordinary third-party API for drawing arbitrary
full-value content onto Pixel AOD. A normal notification can contribute its
icon, but full content depends on system/OEM lock-screen behaviour.

T1 Arc therefore makes full-value AOD a separate advanced opt-in. Android
shows its Accessibility warning before enabling it. T1 Arc's service:

- cannot retrieve window content;
- cannot request or filter keys;
- ignores accessibility events;
- draws only while the default display is off/dozing and non-interactive;
- removes the overlay as soon as the display becomes interactive;
- uses `TYPE_ACCESSIBILITY_OVERLAY`, is non-focusable and non-touchable;
- keeps the value at the explicit position and size chosen in T1 Arc.

The overlay does not move automatically. A static high-contrast element can
contribute to OLED image retention, so this remains an advanced opt-in and the
user should change its position periodically. Automatic movement needs separate
visual validation before it can replace the predictable fixed-position option.

Turning the in-app AOD control off removes the overlay. Android retains final
control over whether the Accessibility service itself remains enabled.

## Wear OS contract

The phone and watch share a versioned current snapshot:

```json
{
  "schemaVersion": 1,
  "available": true,
  "mmolL": 6.4,
  "trend": "flat",
  "trendOrigin": "source",
  "timestampMs": 1785060000000,
  "sourceLabel": "LibreLinkUp",
  "sourceHasError": false,
  "category": "inRange",
  "colorToken": "inRange",
  "staleColorToken": "stale",
  "glucoseUnit": "mgDl",
  "localeTag": "en-US",
  "timeZone": "America/New_York"
}
```

The phone publishes the snapshot through the Message Client for immediate
delivery and as an urgent retained `DataItem` for recovery. A second versioned
payload carries no more than 144 timestamp/value pairs from the latest six
hours. The watch encrypts both locally rather than treating Data Layer as
storage.

The glucose complication exposes short text (`6.4→`) plus
direction/freshness. Tapping it opens the detailed three-hour graph; another
tap changes to six hours. Phone and watch packages and signatures match so
Google Play services permits the Data Layer connection.

## Glooko independence

Glooko remains a separate delayed source. Every newly captured export enters
`prepareGlookoImport`, which uses the measured-byte ZIP parser before the
records and exact source archive are committed to SQLCipher. “Re-read saved
export” is only a recovery route for archives retained by older builds; it is
not required after each sync.
