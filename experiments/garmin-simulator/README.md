# Garmin simulator transport probe

Isolated feasibility experiment, 17 September 2026. Synthetic glucose only; no released T1 Arc code or physical devices changed.

## Actual result

**Android emulator → Venu 2 Plus simulator → Android acknowledgement works on SDK 8.1. A manually targeted phone event also updates the public complication behind a separate face and returns a background acknowledgement. Automatic Android-to-background delivery remains unproven.**

### Follow-up investigation

- SDK 9.2 fails even when the watch transmits a simple string. An independently reported [Garmin simulator defect, CIQQA-4579](https://forums.garmin.com/developer/connect-iq/i/bug-reports/simulator-segfaults-on-communications-transmit-over-the-tethered-adb-connection-sdk-9-1-0-and-9-2-0-linux) describes a matching one-way failure. No simulator binary was patched.
- Downloaded official SDK 8.1.0 alongside 9.2 using Garmin's SDK manifest. Added kotlin-stdlib 2.2.21 after Android receipt exposed a missing runtime dependency in Garmin's IQMessageHelper. Also added a TETHERED-only empty-app-ID listener for the [reported simulator sender-ID issue](https://forums.garmin.com/developer/connect-iq/f/discussion/379720/android-mobile-sdk---tethered-connection---app-status-unknown/1823943). **CONFIRMED** now passes for an old snapshot and a fresh 6.8 reading, with matching watch revisions and no Android crash.
- Phone snapshots now survive process termination without changing their original revision or timestamp. Verified by sending a 780-second-old snapshot, force-stopping only the test Android app, then observing RESTORED with identical revision 1789680302887 and timestamp 1789679522887.
- Retry limit passed: with the publisher closed, three transport-success attempts at 12-second intervals received no watch acknowledgement; Android then reported UNCONFIRMED. Duplicate replay passed: the same revision was acknowledged again with its original timestamp retained and its display now delayed.
- Mobile SDK 2.4.0's tethered Android strategy sends serialized bytes without the target app ID. With both simulator versions, live ADB messages did not trigger the closed publisher's background receiver. This is a simulator-path limitation observed here, not proof about production Garmin Connect routing.
- On SDK 8.1, **Simulation → Phone App Message**, explicitly targeting T1 Arc Test while T1 Arc Test Consumer was foreground, updated the displayed complication from 6.8 to 7.2. Android received a matching `route=background` acknowledgement at 22:58:24. This input was manually injected, not delivered by Android. It proves the handler, publication, subscriber redraw and return path separately.
- Computer Use is working after the user removed the blocking Windows picker overlay.
- Unattended expiry passed on the test consumer. At 22:59:21 Android created revision 1789682361524 with a timestamp 710 seconds old. The foreground publisher acknowledged `6.8 D`, was closed normally, and the consumer initially displayed `6.8 D`. By 23:02:02 the consumer displayed `OLD`, with `Background: PROBE_PUBLISH value=OLD` in the log. No further phone payload or manual background event was sent. This demonstrates eventual scheduled expiry in this setup, not an exact twelve-minute transition or a hardware timing guarantee.

Follow-up evidence: [confirmed Android exchanges and retry timeout](evidence/android-confirmed.log), [watch duplicate and foreground reception](evidence/watch-confirmed.log), [manually triggered background complication](evidence/consumer-manual-background.jpg). Earlier diagnosis: [SDK 8.1 watch output](evidence/sdk-8-watch.log), [Android dependency crash and restart persistence](evidence/android-followup.log). Both watch components compile on SDK 8.1; the fixed APK is installed on emulator-5580.

| Check | Observed result |
| --- | --- |
| Android build/install | PASS: Gradle 8.14.3, AGP 8.13.2, Java 17, Android 36 x86_64; dedicated T1Arc_Garmin_Desktop, emulator-5580. |
| Garmin toolchain | PASS: Connect IQ 9.2.0, official venu2plus bundle; publisher and separate consumer compile. |
| Live transport | PASS: Mobile SDK 2.4.0 TETHERED, port 7381, CONNECTED and SUCCESS; matching revision logged by foreground watch receiver. Garmin Connect is not installed in this emulator. |
| Fresh reading | PASS: synthetic 6.8 displayed on simulated watch. |
| Already stale reading | PASS: age 780 seconds displays OLD. This does not prove unattended expiry after loss of updates. |
| Explicit missing reading | PASS: displays --. |
| Source error | PASS: displays 6.8 D. |
| Public complication discovery | PASS: separate test consumer discovers publisher and reads persisted values. |
| Complication updates behind consumer | PASS for manually targeted simulator phone event; actual Android-triggered background delivery remains UNRESOLVED. |
| Watch acknowledgement | PASS end to end on SDK 8.1; SDK 9.2 fails watch transmission. |
| Bounded retry / duplicate replay | PASS: three unsuccessful attempts end as UNCONFIRMED; duplicate revision receives an acknowledgement without timestamp refresh. |
| Unattended stale transition | PASS: consumer changes from 6.8 D to OLD after scheduled background publication, without another phone message or manual event. Exact boundary timing is not guaranteed. |
| Hardware/third-party faces | NOT TESTED. |

Evidence: [Android log](evidence/android-probe.log), [watch log excerpts](evidence/watch-observations.log), [fresh](evidence/watch-fresh.jpg), [stale](evidence/watch-stale.jpg), [missing](evidence/watch-missing.jpg), [source error](evidence/watch-source-error.jpg). The Android screenshot android-probe.png records the earlier disconnected stage.

Unattended expiry evidence: [before](evidence/consumer-before-expiry.jpg), [after](evidence/consumer-after-expiry.jpg), [temporal publication log](evidence/consumer-expiry.log), and the absence of further sends after revision 1789682361524 in [Android's transcript](evidence/android-confirmed.log). Simulator shell output did not capture every consumer callback; the screenshots establish the visible transition.

## Reproduce

Garmin SDK Manager and SDK are in ignored .local/garmin/manager and .local/garmin/sdk at repository root. The user completed Garmin setup; the Venu 2 Plus device package is now installed. Earlier Computer Use startup errors are resolved. The SDK Manager window previously appeared absent because it was launched hidden; interactive launch corrected that.

The AVD lives under G:/CodexScratch/T1ArcGarmin/avd because C: lacked room. An earlier unused T1Arc_Garmin_QA definition remains. Existing AVDs and physical devices were not changed.

1. Boot T1Arc_Garmin_Desktop on port 5580. Build the Android project from android/ using Gradle 8.14.3: `gradle :app:assembleDebug`.
2. From this experiment directory, install and start only on the dedicated emulator:

```powershell
adb -s emulator-5580 install -r android/app/build/outputs/apk/debug/app-debug.apk
adb -s emulator-5580 forward tcp:7381 tcp:7381
adb -s emulator-5580 shell am start -n app.t1arc.garminprobe/.ProbeActivity
```

3. From repository root, compile with a local developer signing key (the existing experiment key is ignored):

```powershell
& .local/garmin/sdk-8.1.0/bin/monkeyc.bat -f experiments/garmin-simulator/watch/monkey.jungle -d venu2plus -y .local/garmin/probe-key.der -o .local/garmin/Probe-8.prg -l 0
& .local/garmin/sdk-8.1.0/bin/monkeyc.bat -f experiments/garmin-simulator/consumer/monkey.jungle -d venu2plus -y .local/garmin/probe-key.der -o .local/garmin/Consumer-8.prg -l 0
```

4. Open the SDK 8.1 simulator, run `.local/garmin/sdk-8.1.0/bin/monkeydo.bat .local/garmin/Probe-8.prg venu2plus`, then choose **adb Connection → Start** (Ctrl+F1). Reinstalling the Android activity disconnects this link; dismiss the notification and reconnect.
5. Exercise scenarios below. Require both Android send result and matching watch PROBE_RECEIVE revision; send-success alone proved insufficient in the consumer test.

```powershell
adb -s emulator-5580 shell am start -n app.t1arc.garminprobe/.ProbeActivity --el ageSeconds 780
adb -s emulator-5580 shell am start -n app.t1arc.garminprobe/.ProbeActivity --ez missing true
adb -s emulator-5580 shell am start -n app.t1arc.garminprobe/.ProbeActivity --ez sourceError true
adb -s emulator-5580 shell am start -n app.t1arc.garminprobe/.ProbeActivity
adb -s emulator-5580 logcat -d -s GarminProbe:I AndroidRuntime:E
```

For the consumer test, first run the publisher to register events and publish a value. Close it with the watch's lower-right Back button, keep the simulator open, then run:

```powershell
& .local/garmin/sdk-8.1.0/bin/monkeydo.bat .local/garmin/Consumer-8.prg venu2plus
```

## Implementation and next checks

Android sends a copied synthetic snapshot on a single worker thread because TETHERED sending on the UI thread produced NetworkOnMainThreadException. The activity polls every three seconds, saves the latest synthetic snapshot, validates acknowledgements, retries at ten-second intervals up to three attempts and clears delivery state on disconnection. A normal cold start restores the original timestamp. There is no production background service. The local preferences are for synthetic test data only.

The publisher validates schema, revision ordering and basic value/timestamp ranges, persists the latest snapshot and publishes a public text complication. It renders current, delayed/source-error, stale, missing and clock-error labels. It registers phone-message and five-minute temporal events when its foreground view starts. The consumer iterates Complication objects (not IDs) and subscribes using complicationId.

Remaining checks include actual Android-triggered background reception, watch restart/reconnection, malformed and out-of-order messages, trends and unit conversion. Manual simulator injection is not a substitute for real background routing. Android process restart persistence, foreground acknowledgement, bounded retries and duplicate replay have passed.

This is test tooling, not a proposed shipped watch face or production bridge. Real Garmin Connect/Bluetooth operation, battery, firmware and existing-face compatibility require hardware validation.
