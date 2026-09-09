# Troubleshooting

## The APK will not install

- Confirm the file came from the official T1 Arc Releases page.
- Confirm it is named `T1-Arc-vX.Y.Z.apk`, not a source-code archive.
- Allow installs from the browser or Files app currently opening the APK.
- Confirm the phone runs Android 8.0 or newer and has enough free storage.

If Android reports an app conflict or invalid signature during an update, stop.
Do not uninstall the working app to force it. Report both T1 Arc versions and
the exact Android error without including health data.

## The app opens to a blank screen

Open Android's app information for T1 Arc, choose **Force stop**, then reopen
it. Restart the phone if the blank screen repeats. Do not clear storage or
uninstall before creating an encrypted backup.

Include the T1 Arc version, phone model, Android version and the screen shown
immediately before the problem in a bug report.

## Android Back does not leave Settings

Try the close button at the top of Settings and the Android Back control. If the
problem repeats after a cold launch, include the exact settings page and
Android version in the report.

## A colour or regional option did not change

Some detail screens have their own **Save** button. Save the choice, close the
screen and reopen it. Confirm that the chosen region, unit or range colour is
still selected before reporting a display problem.

Changing a glucose display unit or region does not rewrite stored health data.

## Glucose is missing from the lock screen

Android and the phone manufacturer keep final control. Check:

- T1 Arc notification permission and notification-channel settings;
- lock-screen notification privacy;
- the T1 Arc lock-screen visibility choice;
- battery and background restrictions;
- **Allow restricted settings** and Accessibility permission if using the
  optional always-on display.

The value can remain hidden until the phone is unlocked. Stale glucose should
not be presented as current.

## A source will not connect

- Confirm the provider account region, which may differ from the phone region.
- Confirm the provider's own app or website still accepts the account.
- Check device time, timezone and network access.
- Re-enter the credential only on the relevant T1 Arc connection screen.
- Compare the newest timestamp with the official provider app after connecting.

Do not paste credentials, raw provider responses or unedited exports into an
issue.

## A Glooko import appears stuck

A large first export can take several minutes to read and organise locally with
limited progress detail. Keep T1 Arc open until the control becomes available
again or a result appears. Avoid starting the same import repeatedly.

If it never completes, report the approximate export size, duration and safe
error category. Do not attach the export.

## Food search or barcode scan returns nothing

- Confirm the regional profile and search language.
- Reference-food search for GB, US, Japan, Canada, France and Germany is
  bundled and works offline. Canada, France and Germany prepare their local
  index on first use.
- Saved personal foods and cached barcodes work offline. The optional US branded
  catalogue also works offline once enabled.
- For other packaged products, submit **Search** or scan with network access.
  Typing searches local foods; it does not send a request on every keystroke.
- Check the package label because public food records can be missing or wrong.
- A US barcode miss may use a low-rate USDA fallback and can be throttled.

If a barcode is missing, enter its label details and save it to **My Foods**.
The same barcode can then find that food on this phone without a network request.
See [Food logging](FOOD_LOGGING.md).

## Health Connect shows no records

Open T1 Arc's Health Connect permissions and allow only the record types you
want to share. Confirm another app has written those records. Recent data can
work without the optional older-history permission.

In **Settings > Health Connect**, expand the data options to inspect sources
and **Health refresh** status for each record area. **View imported data** opens
the saved records. The Health tab presents daily summaries and trends instead.
One empty or failed area should not erase data imported from another.

## Tarv1s rejects an OpenAI key

Use a current standard key from a dedicated OpenAI API project. A ChatGPT plan
does not automatically include API credit. Check the project's budget, limits
and Responses API access, then read the [Tarv1s BYOK guide](TARV1S_BYOK.md).

Never include an API key in a screenshot, issue or diagnostic.

## An update appears to have lost data

Stop using destructive controls. Do not clear storage or uninstall. Confirm the
new APK was installed as an update rather than as a different package, then use
the latest encrypted backup if necessary.

Open a bug report with the old and new public release versions and the visible
symptoms. Do not upload the backup or database.

## Reporting a useful problem

You do not need ADB or developer logs. Include:

- T1 Arc version;
- phone model and Android version;
- country, locale and provider region when relevant;
- the smallest sequence that reproduces the problem;
- expected and actual behaviour using invented values.

Use GitHub's private security reporting for a security or privacy vulnerability.
