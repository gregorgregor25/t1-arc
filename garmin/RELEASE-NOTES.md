# T1 Arc Garmin hardware beta 0.4

An experimental Garmin companion and a separately installed Android beta for volunteer hardware testing. This is a GitHub pre-release, not a production release or a Connect IQ Store listing.

## Download and start

Download **T1Arc-Garmin-Beta-0.4.zip** from **Assets** below. GitHub's automatic **Source code** downloads contain source, not the ready-to-install tester pack.

The tester ZIP includes the Android APK, exact-model Garmin watch files, an optional Venu 2 Plus diagnostic face, TESTER-GUIDE.md, QA results, build information and checksums. Install the phone APK alongside normal T1 Arc. A computer and the watch's USB data cable are required to install the Garmin file.

In **T1 Arc Garmin Beta on the phone**, open **Sources > Displays & watch > Garmin > Installation instructions**. Each step now names the app or device to use. For background refresh, return to **T1 Arc Garmin Beta > Sources > Displays & watch > Glucose at a glance** and turn on **Keep glucose visible**. This setting is not in Garmin Connect or on the watch.

## Scope and known limits

- **Phone baseline: T1 Arc 1.6.9 (26).** The current main release is newer (1.7.10). This isolated beta does not replace or update the normal app. Its glucose-source settings are separate. Garmin support must be ported to current main before a production release.
- The watch companion publishes a complication for compatible third-party faces. The optional diagnostic face is for Venu 2 Plus. Real-watch pairing, background delivery, face redraw and battery reliability still require hardware testing.
- Exact simulator-tested targets: Venu 2 Plus, Venu 2S, Venu 3, Venu Sq 2, vivoactive 5, Forerunner 255, Forerunner 265, Forerunner 965, fenix 7 and epix (Gen 2). This is not a hardware compatibility claim or support for other sizes/variants. Use the exact model's file.
- **Share diagnostic report** in the phone beta exports connection/delivery metadata through Android's share menu. It excludes glucose values and credentials and does not upload automatically. Send the ZIP to the person helping you test, along with what happened and the watch/face details.

## Validation and source

TypeScript, release APK build, 1,093 JavaScript tests and 6 native module tests passed. The revised instructions were checked in the Android emulator, including all eight steps and both close controls. Watch binaries retain the earlier ten-target build and twenty simulator runtime test-function results. Physical hardware has not been tested.

Source is on **codex/garmin-companion-beta**; this release tag pins the exact source commit. The branch uses the public repository's MIT licence. The APK uses the same private test certificate as earlier Garmin packs; signing keys are not published. Existing Garmin beta users can install this APK over their previous beta. Watch files have not changed since pack 0.1.
