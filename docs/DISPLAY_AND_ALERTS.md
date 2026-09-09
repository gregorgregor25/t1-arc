# Display and alerts

Open **Settings > Display and alerts**. Start with the one display you want;
there is no need to enable every option. Displays show reading age. None
replaces the official CGM or pump display.

## Appearance and glucose colours

**App appearance** follows the phone or uses a fixed light or dark theme.
For glucose colours, open **Phone and lock screen > Glucose ranges and colours**,
choose a range and colour, then press **Save**. The preview uses example values.
Display units are chosen separately under **Region and services**. Neither
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

The widget reads the app's saved display snapshot. It updates with the app;
with **Keep glucose visible** active, the collector also refreshes its age.
Force-stopping the app or restricting its background work can stop updates.
Check timestamps rather than assuming a visible value is current.

## Android Auto and Wear OS

The **Experimental Android Auto glance** switch is under **Phone and lock
screen**. A GitHub APK needs Android Auto developer mode and its **Unknown
sources** option for this route. Availability also depends on the car and
Android Auto configuration. It is not a driving safety system; do not interact
with it while driving.

**Wear OS** contains companion connection and face controls. The watch needs
its own matching APK from the same release. Follow [Watch setup](WATCH_SETUP.md)
before enabling it, especially if two T1 Arc phone apps are installed.

For permissions or stale displays, see [Troubleshooting](TROUBLESHOOTING.md).
