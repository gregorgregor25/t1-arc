# T1 Arc Garmin companion beta

Hardware beta, first built 17 September 2026. This is a real-reading companion, separate from the synthetic feasibility probe in `experiments/garmin-simulator`. It has not been tested on a physical watch or published to Garmin.

## Download and source

Use the [GitHub pre-release](https://github.com/gregorgregor25/t1-arc/releases/tag/garmin-beta-0.4) to download the tester ZIP. The source is on `codex/garmin-companion-beta`; the release tag pins the exact source snapshot. This branch uses the tested **T1 Arc 1.6.9 (26)** Android baseline, not the newer main release. It is a separate experimental install and must be ported to current main before a production Garmin release. The licence matches the public repository’s MIT licence.

## What is built

- A Connect IQ device app that receives normalized readings, publishes a public glucose complication, and shows a small detail/setup screen. It registers phone-message and five-minute temporal events on first opening.
- An opt-in Android adapter in T1 Arc using Garmin's **WIRELESS** SDK through Garmin Connect. It discovers paired devices, checks installation, sends only to the selected watch, persists the latest payload encrypted with Android Keystore, coalesces unchanged readings, bounds retries, and requires a matching acknowledgement before reporting receipt.
- A Garmin setup card under **Sources → Displays & watch**, with watch selection, units, retry, receipt status and stop-sharing control.
- Pack 0.3 adds **Installation instructions** inside that card: an offline Venu 2 Plus guide covering USB installation, phone linking, complication selection and feedback. The private pack has no direct phone-to-watch installer or Connect IQ Store listing. A future store listing can be opened from the phone through Garmin's supported store flow.
- A separately installed **T1 Arc Garmin Beta** Android APK (`app.daymark.garminbeta`), signed for private sideload testing. The regular app identity remains unchanged unless `T1ARC_GARMIN_BETA=1` is set at prebuild/bundle time. The beta starts with separate source settings/data.
- An optional Venu 2 Plus diagnostic face for hardware investigation if the tester's normal face cannot consume third-party complications. It is not a proposed shipped face collection.

The initial beta deliberately uses the existing ongoing glucose-display service for background source refresh. Keep that display and notification permission enabled. Garmin itself remains opt-in; opening the settings card may initialize the SDK but does not send readings until a device is selected.

## Compatibility and evidence

All ten exact targets below compile with SDK 9.2 and pass two Monkey C runtime test functions (freshness/units/validation and duplicate/out-of-order/clear handling). Logs are in `evidence/test-<device>.log`. These are simulator-tested beta targets, **not hardware-verified support claims**.

| Model | Target | Build + runtime logic tests | Physical watch |
| --- | --- | --- | --- |
| Venu 2 Plus | venu2plus | Pass | Awaiting invited tester |
| Venu 2S | venu2s | Pass | Untested |
| Venu 3 | venu3 | Pass | Untested |
| Venu Sq 2 | venusq2 | Pass | Untested |
| vívoactive 5 | vivoactive5 | Pass | Untested |
| Forerunner 255 | fr255 | Pass | Untested |
| Forerunner 265 | fr265 | Pass | Untested |
| Forerunner 965 | fr965 | Pass | Untested |
| fēnix 7 | fenix7 | Pass | Untested |
| epix (Gen 2) | epix2 | Pass | Untested |

Venu 2 Plus, fēnix 7 and Venu Sq 2 startup layouts were visually checked. A manually injected synthetic beta-protocol message displayed `6.8`, units and original time on Venu 2 Plus, and the diagnostic face discovered/read its public complication. This is not a production phone-to-watch transport test. The simulator produced one transient symbol error when switching from a test binary/device to a foreground binary; reloading the same device succeeded. A first test-only launch before normal device initialization also crashed the simulator. Tests were subsequently run and explicitly confirmed as passing, rather than trusting MonkeyDo's exit status.

The earlier SDK 8.1 synthetic experiment proved Android acknowledgements, background publication via a manually targeted event, and unattended consumer expiry. SDK 9.2 has a known simulator watch-transmit issue; current device bundles such as Venu 3 require APIs newer than SDK 8.1 supports. Consequently the multi-device beta builds use SDK 9.2, and real Garmin Connect/Bluetooth delivery, app discovery and background acknowledgement must be verified by the tester.

T1 Arc TypeScript checking and all 1,092 existing tests pass; the Android native module and complete private release APK build. APK identity/signature and emulator installation/startup were checked separately. See [tester instructions](TESTER-GUIDE.md) for the hardware acceptance checklist.

Garmin lists many more eligible models, but we have not enabled entire families on assumption. Complications require API 4.2 and a compatible receiving face. Stock faces and older models cannot be assumed compatible. [Garmin's exact supported-device list](https://developer.garmin.com/connect-iq/api-docs/Toybox/Complications.html).

## Build

From the repository root, using an installed Garmin SDK and your local developer key:

```powershell
./garmin/build.ps1 -Sdk .local/garmin/sdk -Key .local/garmin/probe-key.der
./garmin/build.ps1 -Sdk .local/garmin/sdk -Key .local/garmin/probe-key.der -Tests
# With the simulator running and initialized for the device:
& .local/garmin/sdk/bin/monkeydo.bat .local/garmin-beta/T1Arc-venu2plus-tests.prg venu2plus /t
& .local/garmin/sdk/bin/monkeyc.bat -f garmin/diagnostic-face/monkey.jungle -d venu2plus -y .local/garmin/probe-key.der -o .local/garmin-beta/T1Arc-Diagnostic-venu2plus.prg -l 0
```

Tests are excluded from ordinary PRGs. Signing keys and generated artifacts stay local/ignored. Keep the beta key for future beta updates. Watch beta UUID is `784ac26ef56a40e2a15a6d8c93742b10`; diagnostic face UUID is `b90a9dd7885e4277a276420a4b308cdd`.

For the separate Android beta, with Node, Java 17 and Android SDK installed:

```powershell
npm ci
$env:T1ARC_GARMIN_BETA='1'
$env:T1ARC_PRIVATE_TEST_BUILD='1'
$env:NODE_ENV='production'
npx expo prebuild --platform android --no-install
./android/gradlew.bat -p android :app:assembleRelease '-PreactNativeArchitectures=arm64-v8a,x86_64'
```

This Windows host lacked space on C:, so generated native build outputs were redirected to G: through local junctions and `.local/garmin-beta-build.init.gradle`; a short `C:/t1g` junction avoided Ninja path-length failures. The local Metro config accounts for reused dependencies and excludes `.local` build/toolchain files. These are environment workarounds, not requirements on a normally provisioned build machine. Physical Android devices were not touched; QA used only `emulator-5580`.

## Protocol and limitations

`kind=t1arc.glucose`, schema version 1, a persisted monotonic revision, availability, canonical mmol/L, original timestamp in milliseconds, trend, source-error flag, and explicit display units. No source credentials or history are sent. Missing-data updates have their own revision. Watch-side validation precedes ordering checks; duplicates are acknowledged without replacing stored data. An acknowledgement contains `kind=t1arc.ack`, schema version, matching revision and foreground/background route. It acknowledges watch publication, not third-party face redraw.

The complication is text containing original reading time. It uses `D`, `OLD`, `--` and `CLOCK`; no bare-number mode is offered. The receiving face controls truncation and caching, and scheduled expiry is not an exact deadline. Production release needs hardware proof of background delivery, phone/watch restart and reconnection, safe expiry on an actual face, and 24–48-hour battery/reliability observation.

The beta requires the existing phone display service, supports one selected watch, and has not been validated against Garmin Connect's lifecycle on real hardware. Turning off sharing stops future messages; it does not remotely wipe cached watch data. No cloud service, watch alarm, activity data field or store publication is included.
## Feedback reports (since beta 0.2)

The Android Garmin card includes **Share diagnostic report**. It exports a ZIP through Android's share sheet, with a readable summary and bounded structured event history. See [the tester guide](TESTER-GUIDE.md) for the flow and privacy details. No upload service or recipient is configured. Phone-side acknowledgements do not establish that a watch face redrew.
