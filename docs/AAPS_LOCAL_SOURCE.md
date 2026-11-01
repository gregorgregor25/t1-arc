# AAPS local source

T1 Arc can read the local status broadcast from AndroidAPS. This route is for the phone running AAPS and T1 Arc together: Juggluco receives the sensor over Bluetooth and sends glucose to AAPS through the existing xDrip broadcast; AAPS sends its status broadcast to T1 Arc. T1 Arc only reads. It does not configure the sensor, AAPS, Pod or pump, deliver insulin, or send treatments back to AAPS.

The implementation targets the `info.nightscout.androidaps.status` broadcast in AAPS **4.0.0-dev-e, build c20c229 (30 October 2026)**. The source code for that build exposes glucose in mg/dL with its own measurement timestamp, trend and delta, and AAPS-calculated IOB and COB. COB `-1` means unavailable; zero is a valid estimate. IOB may be negative. AAPS status updates have a separate receipt time and do not always contain every field. T1 Arc stores them with provenance rather than turning estimates into doses, meals, or pump events.

Past Glooko insulin history stays in T1 Arc. If Glooko stops updating after the PDM change, it does not supply new delivery records. AAPS status supplies current IOB and COB estimates, not a replacement treatment history. Today shows **No data** for insulin delivery when no delivery records exist for that day, even if older Glooko history is still saved.

## Enable on the phone

1. Confirm that Juggluco is still supplying fresh glucose to AAPS using Juggluco’s **xDrip broadcast** recipient `info.nightscout.androidaps` and AAPS’s **xDrip+ BG** source. Leave this working setup in place.
2. In AAPS, open **Config Builder → Synchronization → External Companion Apps** and enable it. This is the name in the verified dev build. Its [broadcast implementation](https://github.com/nightscout/AndroidAPS/blob/c20c2298298d17325ccf010608a26c6a1373e0a5/plugins/sync/src/androidMain/kotlin/app/aaps/plugins/sync/tizen/TizenPlugin.kt) discovers installed receivers; there is no extra Juggluco recipient to add for T1 Arc.
3. In T1 Arc, open **Settings → AAPS local**, then tap **Use AAPS as glucose source**.
4. Wait for a new AAPS status update. Compare T1 Arc’s glucose and measurement time with AAPS, then check IOB and COB under the glucose card on **Today**. No notification access, Nightscout login, mobile signal or internet is required for the local phone ingestion path.

When AAPS is selected, its glucose source is exclusive. An old LibreLinkUp value cannot silently replace a missing or stale AAPS value. **Stop using AAPS** leaves no glucose source selected. You can select AAPS again after restoring its feed. The separate LibreLinkUp connection remains available in Settings.

Re-enabling AAPS starts a new intake session and waits for another broadcast. Earlier sessions remain in encrypted historical storage and backups, but cannot revive as the current session's reading. Demo mode stops AAPS intake; choosing AAPS again explicitly returns to personal data.

Glucose uses T1 Arc’s existing phone-to-Wear OS data protocol, so an installed compatible watch companion should keep working without a reinstall. IOB and COB are shown on the phone, not on the existing watch face or complication. Local phone-to-watch delivery needs a paired, reachable watch connection; actual background, screen-off, reboot and offline behaviour requires physical-device verification.

## Provenance and retention

AAPS's status broadcast does not always expose an authenticated sender identity. T1 Arc rejects a different sender when Android supplies its identity and validates every payload, but another installed app could imitate an unidentified broadcast. Selecting AAPS enables this local input; it does not establish cryptographic proof of origin. T1 Arc does not send pump commands or treatment data through this integration.

The native encrypted buffer holds up to 10,080 status updates while database ingestion is unavailable. Buffer overflow is reported in the source screen; missing history is not interpolated or recovered through a cloud source. Stored status observations retain up to 90 days, capped at 150,000 records. IOB and COB retain their receipt time because this broadcast does not provide a separate calculation timestamp. Their receipt age does not prove when AAPS last recalculated them. Glucose retains its source measurement timestamp.

## Verification and remaining device checks

Implemented and checked on 1 November 2026. This is a development branch, not a published or installed Pixel update.

- Automated checks: lint, TypeScript, 5,550 tests across 416 suites; Android APK build; 120 native phone and 38 unchanged Wear companion unit tests; public-source and source-reachability checks. Coverage includes units, timestamps, trend labels, duplicates, older/future readings, missing versus zero COB, signed IOB, source generations, privacy erase, backup restoration and historical Glooko gaps.
- Android 17/API 37 emulator: a separate synthetic sender supplied the exact AAPS typed broadcast contract. Verified foreground glucose/IOB/COB display, IOB-only updates, missing COB, screen-off reception with Wi-Fi/mobile data disabled, force-stop/reopen recovery, reboot/unlock recovery with another offline broadcast, and stopped-source rejection. Re-enabling waited for a new reading instead of reviving the preceding session. The reusable [emulator fixture](../scripts/aaps-qa/README.md) has no sensor or pump capabilities.
- These checks do not establish behaviour of the actual AAPS dev build on the Pixel, prolonged Doze/battery restriction behaviour, or Bluetooth delivery to the physical Galaxy Watch 8. No physical AAPS, Juggluco, sensor or pump settings were changed.

The reusable sender also verified receiver discovery through `queryBroadcastReceivers`, using the same launcher visibility declaration as AAPS, before sending only to the isolated T1 Arc development package.

After installing a production-signed phone build, enable the setting above and compare several successive glucose measurement times, trends, IOB and COB values against AAPS. Then turn off Wi-Fi/mobile data while keeping Bluetooth on, leave the phone screen off, and check that phone and watch receive subsequent readings. Reopen T1 Arc and repeat after restarting the phone and unlocking it. Confirm that a stopped feed ages visibly rather than appearing current. The companion does not need reinstalling or watch debugging for this check; its protocol is unchanged. Battery restrictions and the availability of the paired local Wear connection still determine physical-device delivery.
