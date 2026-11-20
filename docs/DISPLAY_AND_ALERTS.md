# Display and alerts

These choices are in **Settings** under **Phone, widget and car**, **Alarms**,
**Appearance, ranges and colours**, **Advanced and experimental** and
**Watch**. Start with the one display you want; there is no need to enable
every option. Displays show reading age. None replaces the official CGM or
pump display.

## Appearance and glucose colours

Open **Settings > Appearance, ranges and colours**. Under **Choose your theme**,
follow the phone or use a fixed light or dark theme.
For your target range, low and high levels and their colours, open
**Glucose ranges** at the top of that page, choose a range and
colour, then press **Save**. The preview uses example values.
New installations use green for in-range glucose; you can change it. Existing
saved colour choices are preserved. Display units are chosen separately under
**Units and region**. Neither choice rewrites stored readings.

## Persistent notification and lock screen

Under **Phone, widget and car**, enable **Keep glucose visible** and grant
Android notification permission when asked. This starts the quiet background
collector and ongoing notification. It is separate from audible glucose alerts.

**Show value on lock screen** is another opt-in because anyone who sees the
screen may see the reading. Android's notification privacy settings have final
control. T1 Arc cannot override a system restriction.

**Show insulin and carbs on board** is on by default. When AAPS or Nightscout
reports them, the notification shows them beside glucose, for example
`IOB 1.35 U · COB 20 g`, and the expanded notification says who calculated
them. A value the source did not report is left out rather than shown as zero.
After 12 minutes the estimate shows its own age; after an hour it is hidden.
If glucose is hidden on the lock screen, IOB and COB are hidden too. These
are your looping system's estimates, not records of insulin delivered or carbs
eaten. The watch does not show them yet; that would come in a later, optional
companion update.

**Glucose on always-on display** is experimental and lives in **Settings >
Advanced and experimental**. It appears there once **Keep glucose visible** is
on. It needs Android Accessibility permission. If
Android blocks it after a sideload, follow its **Allow restricted settings**
instructions for T1 Arc. Enable the service itself, not just the floating
Accessibility shortcut. Do not uninstall a working app just to expose a
permission menu.

The always-on overlay uses the position and size you choose. It does not move
automatically, so consider image retention on an OLED display and change its
position periodically. Manufacturer power and lock-screen policies can affect it.

## Bedside view

On **Today**, tap the moon button beside the gear to open **Bedside view**. It shows the
latest glucose, direction arrow and reading age in large, dim text on a black
screen. Tap anywhere to close it. A delayed reading is labelled **Delayed**; a
stale one is struck through and labelled **Last known**. With no reading in
the last hour it says **No recent reading** instead of a number. The view does
not keep the screen awake, so your phone's screen timeout still applies.

## Glucose alerts

Open **Settings > Alarms**, enable **Allow T1 Arc alerts**, then choose low,
high or stale-reading alerts. After editing numeric thresholds, press **Save
alert choices**. Stale means the last personal reading is over 12 minutes old.
Repeat settings control whether an unresolved zone alerts again.

Use each alert's test control to check Android delivery. Its Android channel
settings determine sound and vibration; Do Not Disturb and notification
permissions can also affect delivery. A test alert checks the notification path,
not sensor accuracy or continuous background availability. Your provider's own
alerts remain separate and may also sound.

Recording a sensor change does not disable these alerts or start the sensor.
See [Sensor changes](USING_T1_ARC.md#when-you-start-a-new-sensor).

## Home-screen widget

In **Settings > Phone, widget and car**, find **Home-screen glucose** and tap
**Add to home screen**. If the launcher cannot show the picker, long-press the
home screen, choose **Widgets**, then **T1 Arc**.
The settings preview is illustrative, not a live reading.

The widget uses Today's card design: the value and direction, reading age,
four-hour glucose trace, observed history duration, trend and range badge.
It follows the app's theme, units and configured glucose colours. Tap the card
to open Today; the calculated-trend button opens its supporting readings.
The default is four columns by two rows, subject to your launcher's grid.
When AAPS or Nightscout reports insulin and carbs on board, the card shows
them in a row above the trend, following the same setting and age rules as
the notification.

You can also resize the widget smaller than before. Below 280 × 110 dp it
switches to a compact card: the value, direction arrow and reading age, plus
IOB and COB when there is room. A stale value is struck through, as on Today.
Widgets at their existing sizes keep the full card.

The widget reads the encrypted display snapshot published from the same saved
reading selection and history as Today. A pinned widget keeps the existing
collector active, even with **Keep glucose visible** off. New source readings
refresh the card immediately; the collector also checks its age each minute.
Android can defer background work, so updates are not a hard real-time guarantee.
Force-stopping the app or restricting its background work can stop updates.
Check timestamps rather than assuming a visible value is current.

## Android Auto and Wear OS

The **Experimental Android Auto glance** switch is in **Settings > Advanced and
experimental**. A GitHub APK needs Android Auto developer mode and its **Unknown
sources** option for this route. Availability also depends on the car and
Android Auto configuration. It is not a driving safety system; do not interact
with it while driving.

Open **Settings → Watch** for companion setup, connection and face
controls. The independent phone APK bundles the matching companion and installs
it through the guided steps. On supported Wear OS 6 watches, its five faces are
also included. See [Watch setup](WATCH_SETUP.md) for older-watch compatibility
and the optional manual download route.

For permissions or stale displays, see [Troubleshooting](TROUBLESHOOTING.md).
