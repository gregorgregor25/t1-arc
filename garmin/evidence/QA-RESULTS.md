# Final beta checks — 17 September 2026

## Clearer setup and public source — 18 September 2026 (pack 0.4)

- Rewrote every installation step to identify the phone app, Garmin app, watch or computer explicitly. The phone setting now uses its actual labels: T1 Arc Garmin Beta > Sources > Displays & watch > Glucose at a glance > Keep glucose visible. Split long steps into separate paragraphs and aligned the packaged guide.
- Release APK build and TypeScript passed. JavaScript suite: 109 files / 1,093 tests passed with T1ARC_GARMIN_BETA=1. The brand identity check now verifies the explicit beta identity and preserves the default normal app identity. Native module tests: 6 passed.
- Installed over pack 0.3 on emulator-5580. All eight guide steps reachable by scrolling; Close instructions remains visible. Android Back and Close dismiss the guide. Visually inspected the revised first step (android-install-guide.png).
- The branch publishes the tested 1.6.9 (26) phone baseline, not current main's 1.7.10. Watch binaries are unchanged. The licence is aligned with public main's MIT licence. Toolchains, private signing keys and generated APKs remain outside Git; the tester ZIP is a pre-release asset.
- No physical Garmin validation has been performed. Historical checks below remain attributed to their original beta version.

## In-app installation guide — 18 September 2026 (pack 0.3)

- Added offline Installation instructions under Sources > Displays & watch > Garmin. Explains the computer/USB requirement, exact Venu 2 Plus file and folder, first watch launch, phone linking, optional diagnostic face and report sharing. No store listing or direct watch installation is implied.
- TypeScript and release APK build passed. Installed the APK over 0.2 on emulator-5580 with the same signing certificate. Watch binaries and diagnostic event/report logic are unchanged; the report build label is now 0.3.
- Emulator UI: all eight instruction steps reachable by scrolling; Close instructions remained visible. Android Back and the Close button both dismissed the guide; reopening worked. Visual evidence: android-install-guide.png. Physical USB installation still requires the tester's watch.

## Diagnostics update — 18 September 2026 (pack 0.2)

- Release APK rebuilt, installed over pack 0.1 on emulator-5580, same beta package and signing certificate. The normal app is unaffected. Android base version remains 1.6.9 (26); the Garmin card and report identify diagnostics build 0.2.
- TypeScript passed. Native unit tests: 6 passed, including three diagnostics tests for retention age, maximum count/correlation, and a schema that cannot accept free-text payloads or identifiers. The full JS suite below belongs to the preceding beta build; it was not rerun for this native diagnostics addition.
- Opened Sources > Displays & watch > Garmin > Share diagnostic report. Android share sheet opened; an emulator-only receiver with no network permission successfully read the ZIP using the temporary URI grant. Direct access from the ungranted shell was rejected with SecurityException.
- Verified readable report.txt and valid events.json, including missing Garmin Connect guidance and RETRY events. Force-stopped/reopened the phone app and shared again: the earlier event history survived. No SDK start was triggered by export. No crashes in the test window.
- Evidence: android-diagnostics.png, diagnostics-report-qa.zip, diagnostics-report-after-restart.zip. These reports contain only emulator metadata. No reports were emailed or uploaded.
- Watch binaries are unchanged from 0.1. Foreground/background ACK logging is wired into the existing acknowledgement handler; live Garmin Connect hardware paths still require the volunteer's watch.

## Original companion checks

- Android release build: passed, arm64-v8a and x86_64, package app.daymark.garminbeta, private test certificate. Installed and launched on emulator-5580.
- Android Garmin setup: navigated Sources > Displays & watch > Garmin; missing Garmin Connect guidance displayed correctly. No crashes recorded after final APK installation.
- TypeScript: passed. Existing T1 Arc tests: 109 files / 1,092 tests passed.
- Watch: 10 target builds, 20 runtime test functions passed. Coverage includes missing data, six-/twelve-minute boundaries, clock error, units, input validation, duplicate handling and out-of-order clear protection.
- Visual checks: Venu 2 Plus, fēnix 7 and Venu Sq 2 startup. Manually injected beta-protocol reading and Venu 2 Plus diagnostic complication display passed.
- Not proven: real Garmin Connect device/app discovery, Bluetooth delivery, closed-app background delivery on hardware, third-party face compatibility, battery or overnight reliability. The tester guide covers these gates.
- Nothing published or sent to the tester. Normal T1 Arc app/data and physical Android devices were not changed.
