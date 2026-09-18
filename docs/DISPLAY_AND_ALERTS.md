# Display and alerts

Open **Settings > Display and alerts**. Start with the one display you want;
there is no need to enable every option. Displays show reading age. None
replaces the official CGM or pump display.

## Appearance and glucose colours

**App appearance** follows the phone or uses a fixed light or dark theme.
For glucose colours, open **Phone and lock screen > Glucose ranges and colours**,
choose a range and colour, then press **Save**. The preview uses example values.
New installations use green for in-range glucose; you can change it. Existing
saved colour choices are preserved. Display units are chosen separately under **Region and services**. Neither
choice rewrites stored readings.

## Persistent notification and lock screen

Under **Phone and lock screen**, enable **Keep glucose visible** and grant
Android notification permission when asked. This starts the quiet background
collector and ongoing notification. It is separate from audible glucose alerts.

**Show value on lock screen** is another opt-in because anyone who sees the
screen may see the reading. Android's notification privacy settings have final
control. T1 Arc cannot override a system restriction.

**Glucose on always-on display** needs Android Accessibility permission. If
Android blocks it after a sideload, follow its **Allow restricted settings**
instructions for T1 Arc. Enable the service itself, not just the floating
Accessibility shortcut. Do not uninstall a working app just to expose a
permission menu.

The always-on overlay uses the position and size you choose. It does not move
automatically, so consider image retention on an OLED display and change its
position periodically. Manufacturer power and lock-screen policies can affect it.

## Glucose alerts

Open **Glucose alerts**, enable **Allow T1 Arc alerts**, then choose low, high
or stale-reading alerts. After editing numeric thresholds, press **Save
thresholds**. Stale means the last personal reading is over 12 minutes old.
Repeat settings control whether an unresolved zone alerts again.

Use each alert's test control to check Android delivery. Its Android channel
settings determine sound and vibration; Do Not Disturb and notification
permissions can also affect delivery. A test alert checks the notification path,
not sensor accuracy or continuous background availability. Your provider's own
alerts remain separate and may also sound.

Recording a sensor change does not disable these alerts or start the sensor.
See [Sensor changes](USING_T1_ARC.md#when-you-start-a-new-sensor).

## Home-screen widget

Open **Home screen widget > Add to home screen**. If the launcher cannot show
the picker, long-press the home screen, choose **Widgets**, then **T1 Arc**.
The settings preview is illustrative, not a live reading.

The widget uses Today's card design: the value and direction, reading age,
four-hour glucose trace, observed history duration, trend and range badge.
It follows the app's theme, units and configured glucose colours. Tap the card
to open Today; the calculated-trend button opens its supporting readings.
The default is four columns by two rows, subject to your launcher's grid.

The widget reads the encrypted display snapshot published from the same saved
reading selection and history as Today. A pinned widget keeps the existing
collector active, even with **Keep glucose visible** off. New source readings
refresh the card immediately; the collector also checks its age each minute.
Android can defer background work, so updates are not a hard real-time guarantee.
Force-stopping the app or restricting its background work can stop updates.
Check timestamps rather than assuming a visible value is current.

## Android Auto and Wear OS

The **Experimental Android Auto glance** switch is under **Phone and lock
screen**. A GitHub APK needs Android Auto developer mode and its **Unknown
sources** option for this route. Availability also depends on the car and
Android Auto configuration. It is not a driving safety system; do not interact
with it while driving.

Open **Settings → Watch & watch faces** for companion setup, connection and face
controls. The independent phone APK bundles the matching companion and installs
it through the guided steps. On supported Wear OS 6 watches, its five faces are
also included. See [Watch setup](WATCH_SETUP.md) for older-watch compatibility
and the optional manual download route.

For permissions or stale displays, see [Troubleshooting](TROUBLESHOOTING.md).
