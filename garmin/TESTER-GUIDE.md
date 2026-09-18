# T1 Arc Garmin hardware beta 0.4

This is the first hardware trial, not a released or hardware-verified integration. The beta has its own Android identity, **T1 Arc Garmin Beta**, so it installs alongside your normal T1 Arc app. It starts with separate data and source settings. Keep your normal CGM app and alerts available.

## Which app or device does each instruction mean?

- **T1 Arc Garmin Beta** is our Android phone app. Sources, Displays & watch, Keep glucose visible, Check Garmin connection and Share diagnostic report are all inside this app.
- **Garmin Connect** is Garmin’s own phone app. Use it to pair your phone and watch.
- **T1 Arc Beta** is the companion installed on the Garmin watch. **T1 Arc Diagnostic** is the optional watch face.
- **Your computer** is where you extract the tester ZIP and copy a file to the watch connected by USB.

If you have not installed the phone beta yet, install **T1Arc-Garmin-Beta-Android.apk** from the tester pack on your Android phone. Keep your normal T1 Arc app installed.

The same instructions are available in **T1 Arc Garmin Beta on your phone → Sources → Displays & watch → Garmin → Installation instructions**.

## 1. Set up the two phone apps

On your Android phone, open T1 Arc Garmin Beta. Connect your glucose source and check the reading and its time. The beta has separate settings from your normal T1 Arc app.

On the same phone, install or open Garmin Connect (Garmin’s own app). Sign in to your Garmin account and pair your Venu 2 Plus using Garmin Connect.

Now leave Garmin Connect and return to T1 Arc Garmin Beta on your phone. Tap Sources → Displays & watch. In the Glucose at a glance section near the top, turn on Keep glucose visible. Allow notifications if Android asks. Keep this switch on during testing.

All Sources and Displays & watch instructions in this guide refer to T1 Arc Garmin Beta on your phone. Keep your normal CGM app and alerts available.

## 2. On your computer: extract the tester pack

On a Windows PC or Mac, download the T1Arc-Garmin-Beta-0.4.zip attachment from the GitHub beta release linked by the person inviting you. Extract the ZIP (on Windows, right-click it and choose Extract All). Choose the tester ZIP, not GitHub’s Source code download.

Inside the extracted folder, T1Arc-Garmin-Beta-Android.apk is for the phone. The watch folder contains separate Garmin files. Installing the phone APK does not install anything on the watch.

## 3. On your computer: find the watch folder

Connect the Venu 2 Plus to your computer using the watch’s USB data cable. On Windows, open File Explorer → This PC → your Garmin watch, then Internal Storage if shown. Open the GARMIN folder on the watch, then its APPS folder.

On a Mac, an MTP file-transfer app may be needed to browse the watch. If you cannot see the watch or its GARMIN/APPS folder, contact the person who invited you before continuing.

## 4. On your computer: copy the companion to the watch

In the tester pack you extracted on your computer, open the watch folder. Copy T1Arc-venu2plus.prg from that folder into the GARMIN/APPS folder on the connected watch. Do not copy the ZIP or Android APK to the watch.

T1Arc-venu2plus.prg is only for Venu 2 Plus. For another model, use its exact matching file listed in TESTER-GUIDE.md in the tester pack. Never rename another model’s file to make it fit.

## 5. On your watch: open T1 Arc Beta once

Safely eject the watch from your computer and unplug its USB cable. On the watch itself, open its app list, find T1 Arc Beta and open it once. This registers the companion to receive updates when you return to your watch face.

## 6. On your phone: choose the Garmin watch

Open T1 Arc Garmin Beta on your phone. Tap Sources → Displays & watch, then scroll down to the Garmin section. If this guide is open, tap Close instructions.

In that Garmin section, tap Check Garmin connection. Choose mmol/L or mg/dL, then tap your watch in the paired-watch list. Pairing in Garmin Connect (step 1) and selecting the watch in T1 Arc Garmin Beta are both needed.

Wait for T1 Arc Garmin Beta on the phone to say “The watch acknowledged the latest update”. On the watch, open T1 Arc Beta and compare its value, units and measurement time with the reading in the phone beta. If your watch is missing from the phone’s list, open Garmin Connect on the phone and check that the watch is paired and connected; then return to the Garmin section in T1 Arc Garmin Beta and check again.

## 7. On your watch: display the complication

Choose a watch face that supports third-party Connect IQ complications. In that face’s own settings, choose T1 Arc glucose (beta) for a complication slot. Depending on the face, its settings may be on the watch or in the Connect IQ Store app on your phone. These are the watch face’s settings, not the Sources screen in T1 Arc Garmin Beta. The exact menu depends on the face.

Check that the face shows the full reading time and units. An ordinary stock data field may not support this complication. If your face cannot select it, Venu 2 Plus testers can use the optional diagnostic face: reconnect the watch to the computer, copy watch/T1Arc-Diagnostic-venu2plus.prg from the extracted tester pack into the watch’s GARMIN/APPS folder, then safely eject it. On the watch, select T1 Arc Diagnostic as the watch face. Keep the T1 Arc Beta companion installed and open it once before switching to the face.

## 8. Test the watch and send feedback from the phone

On the watch, return to the chosen watch face. Lock your phone and check that new readings continue to arrive on the watch. Follow TESTER-GUIDE.md in the extracted tester pack for the full test checklist.

If something goes wrong, unlock the phone and open T1 Arc Garmin Beta → Sources → Displays & watch → Garmin. Tap Share diagnostic report before tapping Check Garmin connection or restarting. In Android’s share menu, choose your email or messaging app, select the person helping you test, attach a short description and send it. Creating a report does not send it automatically.

Include what happened, the approximate time, your watch firmware and watch face name. On the watch, OLD means stale and D means delayed or a source error. Always check the reading time.

## Other exact watch models

For another included model, use its exact file from the pack’s `watch` folder: Venu 2S — `T1Arc-venu2s.prg`; Venu 3 — `T1Arc-venu3.prg`; Venu Sq 2 — `T1Arc-venusq2.prg`; vívoactive 5 — `T1Arc-vivoactive5.prg`; Forerunner 255 — `T1Arc-fr255.prg`; Forerunner 265 — `T1Arc-fr265.prg`; Forerunner 965 — `T1Arc-fr965.prg`; fēnix 7 — `T1Arc-fenix7.prg`; epix (Gen 2) — `T1Arc-epix2.prg`. These are exact simulator-tested models, not blanket support for similarly named sizes or variants.

## What the display means

- Normal text includes value, trend and the original measurement time, for example `6.8 > 14:32`. The label supplies mmol/L or mg/dL.
- `D` means delayed (over six minutes) or a source error.
- `OLD` means over twelve minutes. Scheduled background checks can run later than the exact boundary, so always check the measurement time.
- `--` means no reading. `CLOCK` means the reading time is unexpectedly in the future.
- Text trend fallbacks: `vv` rapidly falling, `v` falling, `\` slightly falling, `>` steady, `/` slightly rising, `^` rising, `^^` rapidly rising, `?` unknown.

Watch receipt acknowledges publication, not proof that another face has redrawn. A third-party face may cache text or omit its label. The beta is not a dosing or alarm system.

## First test session

Record watch model/firmware, Android version, Garmin Connect version and face name/version. No passwords or account tokens are needed in feedback.

1. With the watch app open, confirm a new real reading arrives and the phone reports an acknowledgement.
2. Close the watch app and return to the chosen complication face. Lock the phone. Observe several normal readings. The phone should show acknowledgements labelled **watch app in background**, without reopening the watch app.
3. Briefly disconnect Bluetooth, allow a newer reading on the phone, then reconnect. Check that the newest reading arrives, with its original time.
4. Stop phone updates for at least 20 minutes. The complication must stop looking current, eventually show OLD, and never silently treat an old measurement as fresh. Note the actual timing and any face truncation.
5. Reopen/restart the phone app and restart the watch. Check recovery without losing the measurement time. Check both units, and normal watch use/activity if applicable.
6. If those pass, observe 24–48 hours including overnight use, battery change and any gaps. A failure to update in the background is a failed beta result, not something to work around by repeatedly opening the watch app.

## Send feedback or diagnose a problem

In **T1 Arc Garmin Beta on your phone → Sources → Displays & watch → Garmin**, tap **Share diagnostic report** as soon as a problem happens, preferably before tapping Check Garmin connection or restarting. Choose your usual email or messaging app and send the attached ZIP back to the person who invited you. Nothing is sent until you choose a recipient and send it. You can also share a report after a successful test session so we can compare.

Add a short description of what happened and roughly when (including your time zone), watch model/firmware, face name/version, and whether the phone was locked. A photo or screenshot with personal details removed is useful for display problems. You do not need to find logs or connect the phone to a computer.

The ZIP contains a readable `report.txt` and structured `events.json`: phone model, Android/app/Garmin Connect versions, sync status, connection changes, send attempts and foreground/background watch acknowledgements. It retains up to the latest 2,000 events from seven days; older entries may roll off sooner during frequent updates. History survives a phone app restart. Events are recorded only from beta 0.2 onward.

It excludes glucose values, credentials, account/source details, watch identifiers and unrelated app logs. It does include activity times and device/software metadata, so share it only with the person helping test the beta. Reports remain in the app's private cache (at most three); uninstalling the beta removes its local history. Copies already shared belong to the receiving app.

Phone logs cannot capture a watch crash or prove that a third-party face redrew. Please describe what the watch actually showed. Do not rely on this beta while background delivery and freshness remain unverified on hardware.

## Stop the beta

In **T1 Arc Garmin Beta on your phone → Sources → Displays & watch → Garmin**, tap **Stop sharing with Garmin**. This stops future sends; cached watch text may remain until its scheduled expiry. Remove the beta watch app/diagnostic face and the separate Android beta when finished. Your normal T1 Arc installation is separate.

## Distribution

The source and tester pack are shared through a GitHub development branch and tagged pre-release. These binaries are for experimental sideload testing, not a stable release or a Garmin Store listing. Nothing has been submitted to Garmin or sent directly to a tester. Garmin's developer beta links are only visible within the developer's own account, so they are not an external invitation mechanism. If USB is unavailable, arrange a suitable reviewed store distribution route before inviting phone-only installation; do not share developer-account credentials.

Sources: [Garmin beta apps](https://developer.garmin.com/connect-iq/articles/core-topics/Beta_Apps.html), [Garmin Android companion SDK](https://developer.garmin.com/connect-iq/articles/core-topics/Mobile_SDK_for_Android.html).
