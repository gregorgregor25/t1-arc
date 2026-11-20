# AAPS local source

T1 Arc can read the local status broadcast from AndroidAPS. This route is for the phone running AAPS and T1 Arc together: Juggluco receives the sensor over Bluetooth and sends glucose to AAPS through the existing xDrip broadcast; AAPS sends its status broadcast to T1 Arc. T1 Arc only reads. It does not configure the sensor, AAPS, Pod or pump, deliver insulin, or send treatments back to AAPS.

The implementation targets the `info.nightscout.androidaps.status` broadcast in AAPS **4.0.0-dev-e, build c20c229 (30 October 2026)**. The source code for that build exposes glucose in mg/dL with its own measurement timestamp, trend and delta, and AAPS-calculated IOB and COB. COB `-1` means unavailable; zero is a valid estimate. IOB may be negative. AAPS status updates have a separate receipt time and do not always contain every field. T1 Arc stores them with provenance rather than turning estimates into doses, meals, or pump events.

Past Glooko insulin history stays in T1 Arc. If Glooko stops updating after the PDM change, it does not supply new delivery records. The AAPS status broadcast supplies current IOB and COB estimates, not a treatment history. Insulin, carb and target history comes from two further optional routes described below: AAPS's xDrip+ broadcast on this phone, and the user's own Nightscout site. Today shows **No data** for insulin delivery when no delivery records exist for that day, even if older Glooko history is still saved.

## Enable on the phone

1. Confirm that Juggluco is still supplying fresh glucose to AAPS using Juggluco’s **xDrip broadcast** recipient `info.nightscout.androidaps` and AAPS’s **xDrip+ BG** source. Leave this working setup in place.
2. In AAPS, open **Config Builder → Synchronization → External Companion Apps** and enable it. This is the name in the verified dev build. Its [broadcast implementation](https://github.com/nightscout/AndroidAPS/blob/c20c2298298d17325ccf010608a26c6a1373e0a5/plugins/sync/src/androidMain/kotlin/app/aaps/plugins/sync/tizen/TizenPlugin.kt) discovers installed receivers; there is no extra Juggluco recipient to add for T1 Arc.
3. In T1 Arc, open **Settings → AAPS local**, then tap **Use AAPS as glucose source**.
4. Wait for a new AAPS status update. Compare T1 Arc’s glucose and measurement time with AAPS, then check IOB and COB within the glucose card on **Today**. No notification access, Nightscout login, mobile signal or internet is required for the local phone ingestion path.

When AAPS is selected, its glucose source is exclusive. An old LibreLinkUp value cannot silently replace a missing or stale AAPS value. **Stop using AAPS** leaves no glucose source selected. You can select AAPS again after restoring its feed. The separate LibreLinkUp connection remains available in Settings.

Re-enabling AAPS starts a new intake session and waits for another broadcast. Earlier sessions remain in encrypted historical storage and backups, but cannot revive as the current session's reading. Demo mode stops AAPS intake; choosing AAPS again explicitly returns to personal data.

Glucose uses T1 Arc’s existing phone-to-Wear OS data protocol, so an installed compatible watch companion should keep working without a reinstall. IOB and COB are shown on the phone, not on the existing watch face or complication. Local phone-to-watch delivery needs a paired, reachable watch connection; actual background, screen-off, reboot and offline behaviour requires physical-device verification.

## Insulin, carb and target history

AAPS glucose stays exclusive whichever route below is used. T1 Arc never fetches, stores or mixes Nightscout glucose while AAPS is the selected source. Both routes record what AAPS recorded; T1 Arc does not calculate doses or recommend treatment.

### On this phone: AAPS xDrip+ sync

This route is **off by default** because Android cannot confirm who sent these broadcasts. To use it, turn on **Also read AAPS's xDrip+ treatment broadcasts on this phone** on the AAPS card. The card explains: Android can't confirm these messages came from AAPS, so another app on this phone could send look-alike records; your Nightscout site is the checked route. Then, in AAPS, open **Config Builder → Synchronization → xDrip+** ("Send data to xDrip+") and enable it. AAPS then broadcasts boluses (including SMBs), carbs, extended boluses, temporary targets, profile switches and therapy events such as site and sensor changes. No internet is needed.

- T1 Arc receives them only while AAPS is the selected glucose source and the switch is on. With the switch off, every broadcast is ignored and turning it off empties the queue. Erase turns it off again.
- The receiver needs no permission and AAPS offers no authenticated local channel. Android names the sender only on Android 14 and later, and only when the sender chooses to share its identity, which AAPS does not. When Android does name a sender that is not AAPS (`info.nightscout.androidaps`), the broadcast is rejected even with the switch on. When it names no sender, the records are kept with the provenance **Received on this phone; sender not verified**. The decision is the pure function `AapsTreatmentSenderPolicy.decide`, covered by JVM unit tests.
- Each broadcast is capped in size and record count. Only listed fields within plausible ranges are kept, then stored in a Keystore-encrypted queue bound to the current selection and privacy epoch. Erase and choosing another glucose source clear that queue.
- Records are saved with `aaps-local` provenance and the label "Received on this phone; sender not verified", or "Received on this phone from AAPS; sender confirmed by Android" in the rare case Android named AAPS as the sender. Records stored by earlier versions keep their old label "AAPS xDrip+ broadcast" and are treated as unverified. Today's insulin figure says "sender not verified" whenever it includes such records. The broadcast carries no AAPS database ID, so each record is identified by its kind and time. AAPS re-sends a changed record and marks a deleted one withdrawn; T1 Arc replaces the earlier copy instead of keeping both.
- This route does **not** include temporary basals, running modes, scheduled basal or device status, and AAPS sends only the last 24 hours. Profile switches, therapy events and extended boluses carry only a `created_at` time, which the receiver now reads. Records that arrive while T1 Arc is closed wait in the queue until the app next refreshes.
- Any other installed app that declares the same receiver also receives what AAPS sends. If AAPS has no profile loaded, it drops the whole batch.

### From Nightscout: fill switch on the AAPS card

When AAPS is selected, the AAPS card shows **Fill insulin and carb history from my Nightscout site**. It needs a site connected in **Settings → Nightscout**; until then the card offers **Set up Nightscout**. With it on, T1 Arc reads the treatments AAPS uploaded: boluses and SMBs, carbs, temporary basals, extended boluses, profile switches, temporary targets and pump suspensions. It uses the internet and the saved read-only token. Nothing is sent to Nightscout. The choice is erased with other local data. If it was never set, it stays on, which matches how a connected site behaved before this switch existed.

- While AAPS is selected, the regular refresh, the older-history backfill and the Nightscout connection check all read treatments only. Connecting Nightscout then succeeds without a Nightscout glucose reading.
- Withdrawn records (`isValid: false`) and priming boluses are kept as raw evidence but not counted. A temporary basal ends when the next one starts or is cancelled. Large ranges are read page by page rather than cut off at 5,000 records.
- Nightscout carries temporary basals only. Without a pump export for the same period, scheduled basal is missing from the daily total, and Today says so.
- Today checks when the current Nightscout connection last fetched and saved its recent treatment history successfully. An unchanged response refreshes that time. Downloading older history does not. Disconnecting or erasing the connection clears the saved time.

### Counting each record once

The same delivery can arrive from Glooko, Nightscout and AAPS on this phone. All copies stay stored with their own provenance. At read time T1 Arc counts one copy, preferring Glooko, then Nightscout (read with your own token), then AAPS on this phone. Unverified on-phone records therefore only fill gaps Nightscout does not cover yet, such as the minutes before its next fetch. A bolus matches when the times are within 2 minutes and the amounts within 0.05 U; carbs match within 2 minutes and 0.5 g. One kept record hides at most one copy from each other source, so three copies of one bolus count once, while two real boluses close together in the same source both count. Carbs follow the same rule, including carbs from a Glooko export, so one meal counts once in Today, History, the period summary, exports and the clinic report. Basal periods already covered by a higher-preference source are not counted twice. Manual entries are never hidden.

While AAPS is selected, Today's insulin figure names where the AAPS records came from, shows the latest record time ("data through"), notes when scheduled basal is not included, and shows **No data** with the reason when nothing was recorded.

## AAPS settings history (therapy states)

T1 Arc reads the settings AAPS recorded as active: temporary targets, profile switches, the loop's running mode, pump suspensions and logged exercise. They are built when needed from the treatment records already stored from Nightscout and from AAPS on this phone, so no database change was needed and older history works too. They are only described. T1 Arc never uses them to calculate insulin or to suggest a setting.

### What each route carries

Checked against the AAPS source at commit `c20c229`.

| Setting | Nightscout upload | AAPS xDrip+ broadcast on this phone |
| --- | --- | --- |
| Temporary target | `Temporary Target`: reason (Custom, Hypo, Activity, Eating Soon, Automation, Wear), targets in mg/dL, duration in minutes and milliseconds. An early cancel shortens the same record. | Same reason and duration. Targets are in your display unit. A cancel is a new record with no reason and no targets. |
| Profile switch | `Profile Switch`: profile name, original name, percentage, time shift in hours, exact original duration (0 = until changed). | Name, percentage, time shift and duration. Before this change the phone dropped these records because they carry only `created_at`; it now reads that time. |
| Running mode | `OpenAPS Offline` with `mode` (closed, open, closed-loop LGS, disabled, suspended, disconnected, superbolus), `autoForced` and the older `reason` values. | Not sent. |
| Pump suspend | `Temp Basal` of type `PUMP_SUSPEND` or `EMULATED_PUMP_SUSPEND`; `Pump Suspend` / `Pump Resume` events from other uploaders. | Not sent. |
| Exercise | `Exercise` or a timed careportal note about exercise or activity. | Therapy events with a duration only. |
| Effective profile switch | Uploaded as a `Note`. | Not sent. |

Effective profile switches and the profile's internal schedule are not read. Glooko's Omnipod 5 "Activity mode" lanes stay separate and are not part of these answers.

### How an interval is built

- A setting ends at its recorded duration, at the next record of the same kind, or at a cancel or resume record, whichever comes first. With none of these it is shown as having **no recorded end** up to now or the end of the period, never as finished.
- AAPS writes an ongoing running mode with no duration and an open-ended disabled loop as ten years; both mean "until changed". A temporary suspension does not end the ongoing mode under it.
- A re-sent record replaces the stored copy when it is newer, so a target cancelled early shows its real end. Before this change the stored copy kept the original duration.
- The same record from Nightscout and from the phone is kept once: same kind, starts within 2 minutes, same reason, target, percentage or mode. Nightscout's copy is preferred; the other stays listed as a duplicate and both raw records can be opened from the evidence.
- Times are stored as exact instants and shown in local time, so a target across a clock change keeps its real length.
- Target values follow the glucose unit in Settings, including on previously imported timeline entries. mmol/L uses one decimal place and mg/dL uses whole numbers. The source record keeps the original values and units.
- A state that began before the displayed period can still appear in it. Overlapping pump and loop suspension records stay individually inspectable. Their shared minutes and glucose readings count once in the combined summary.
- Closed loop and a 100% profile with no end are the ordinary background state and are not listed as notable.

### Where they appear

- **History timeline:** an **AAPS** lane under the activity and pause lanes, with its own layer chip. The legend names the three colours: temporary target or exercise, profile switch, and loop mode or suspension. A fainter band has no recorded end. Tapping the chart lists the settings active at that moment.
- **Tarv1s, glucose episodes:** a high or low answer names any non-ordinary setting active in the six hours before or two hours after, with its times, source and "timing is context, not proof".
- **Tarv1s, direct questions:** for example "How did my glucose go during activity mode?", "How were my levels when my profile was at 80% last week?" or "How were my readings while the loop was suspended?". The answer is built on the phone. It lists the recorded intervals, gives glucose while they were active with coverage, and compares the same clock times on other days without that kind of setting. It withholds the glucose summary below 70% coverage, withholds the comparison with fewer than 3 matched windows, and always says the comparison is an observation, not proof that the setting made the difference. Without a time in the question it uses the last 30 days. Questions that ask what to set are not answered this way.

### Limits

- Nightscout records can arrive late, and none arrive while AAPS is offline.
- The phone broadcast covers only the last 24 hours, carries no running modes or temporary basals, and Android usually cannot confirm its sender. Answers say when an interval came only from an unverified sender.
- AAPS and Nightscout record a temporary basal's `percent` as the change from the profile rate. T1 Arc reads it as a percentage of the profile rate, including for earlier imports and restored backups. For example, a recorded change of −25 means 75% of the profile rate. The raw record retains −25. T1 Arc estimates delivered units from the reported absolute rate and duration. A percentage alone cannot establish delivered units. [AAPS upload format](https://github.com/nightscout/AndroidAPS/blob/c20c229/plugins/sync/src/commonMain/kotlin/app/aaps/plugins/sync/nsclientV3/extensions/TemporaryBasalExtension.kt)

## Provenance and retention

### What basal information is available now?

| Information | Current local AAPS integration | Existing Glooko importer |
| --- | --- | --- |
| Basal contribution to insulin on board | Stores AAPS's basal IOB estimate when supplied. Today shows total IOB, not a basal breakdown. Basal IOB can be negative; it is not insulin delivered. | No live IOB feed. |
| Basal delivery over time | No delivery intervals from the status receiver or the xDrip+ broadcast. With the Nightscout fill on, temporary basals AAPS uploaded, each ending at the next one and marked estimated. Scheduled basal is not included. | Imports dated intervals, rates and amounts where supplied. If an amount is derived from rate and duration, it is explicitly marked estimated. |
| Daily basal insulin total | Not available from this feed. IOB snapshots must not be summed into a total. | Imports daily basal, bolus and total insulin when present in the export. |
| Current programmed or temporary basal rate | AAPS exposes some current-state fields, but T1 Arc does not currently import them. They would be snapshots, not complete delivery history. | Can import basal settings and schedules where included. |

Historical Glooko records remain useful for their original dates. The retired PDM feed will not add new records. Complete basal history is parked; the card and trend changes do not modify AAPS or any pump controls.

### Card and trend behaviour

When AAPS is selected, Today combines glucose, trend, graph, IOB and COB in one card. Glucose age uses measurement time; estimates show their separate broadcast receipt age. Missing estimates remain unavailable, zero COB and negative IOB are preserved, and stale estimates are labelled. Other glucose sources keep their existing card.

AAPS `TripleUp` and `TripleDown` remain distinct on the phone, with three arrows and source details. At the existing Wear protocol boundary only, they become the companion's fastest supported double arrows. The detail view explains that compatibility mapping. No companion reinstall is required. Unknown source trends are reassessed against recent same-source history; insufficient history still shows unavailable rather than a made-up source arrow.

AAPS's status and xDrip+ broadcasts do not always expose an authenticated sender identity. T1 Arc rejects a different sender when Android supplies its identity and validates every payload, but another installed app could imitate an unidentified broadcast. Selecting AAPS enables the status input; the treatment broadcast needs its own opt-in and its records are labelled as not verified. Neither establishes cryptographic proof of origin. T1 Arc does not send pump commands or treatment data through this integration.

The native encrypted buffer holds up to 10,080 status updates while database ingestion is unavailable. Buffer overflow is reported in the source screen; missing history is not interpolated or recovered through a cloud source. Stored status observations retain up to 90 days, capped at 150,000 records. IOB and COB retain their receipt time because this broadcast does not provide a separate calculation timestamp. Their receipt age does not prove when AAPS last recalculated them. Glucose retains its source measurement timestamp.

### Battery

AAPS sends a status about once a minute, and IOB changes in almost every one. Each status is validated and stored in the native encrypted buffer, and glucose reaches the notification, widget, watch and alarms natively. The background database sync is requested straight away only when glucose is new or corrected, or when a timed alert check is due. A status that changes only IOB, COB or delta waits in the buffer for the next sync, and one is requested at least every 15 minutes while statuses keep arriving. With T1 Arc open, every status still refreshes the card at once.

Because AAPS pushes its statuses, the collector service does not poll for AAPS readings on a timer. Its own sync runs only when a timed alert check (a repeat or stale transition) is due, retried once a minute while an alert cannot be shown, and otherwise at most every 15 minutes, measured from the last new reading. Other sources keep the schedule in [Glucose display architecture](GLUCOSE_DISPLAY_ARCHITECTURE.md#sync-cadence). The notification, widget and always-on display still re-age every minute, and native alarms still reconcile every minute, so a stopped feed still shows as delayed or stale on time.

A status that repeats the shown reading without a trend keeps the trend already shown, including one calculated from recent history, instead of republishing the notification, widget and watch. A new or corrected value, or a trend from AAPS, still publishes at once. The watch history sent with a native AAPS reading covers the same six-hour window as the database sync, so the sync does not send the same history a second time.

Database writes reuse one already-keyed encrypted connection. Each new SQLCipher connection derives its key with 256,000 PBKDF2 iterations, which was previously repeated for every write transaction, including each small Health Connect batch. A connection whose transaction state is uncertain is closed and replaced, and erasing local data closes the idle connection first.

## Research: local treatment routes

Checked against the AAPS source at commit [`c20c229`](https://github.com/nightscout/AndroidAPS/blob/c20c2298298d17325ccf010608a26c6a1373e0a5) in November 2026.

| Route | Treatments for another app on the phone? | Notes |
| --- | --- | --- |
| xDrip+ sync plugin | **Yes.** Used by T1 Arc. | Off by default. Sends `info.nightscout.client.NEW_FOOD` with a `treatments` JSON array to every receiver it finds, with no permission or allow-list ([XdripPlugin.kt](https://github.com/nightscout/AndroidAPS/blob/c20c2298298d17325ccf010608a26c6a1373e0a5/plugins/sync/src/androidMain/kotlin/app/aaps/plugins/sync/xdrip/XdripPlugin.kt#L371-L412)). Content and 24-hour window: [DataSyncSelectorXdripImpl.kt](https://github.com/nightscout/AndroidAPS/blob/c20c2298298d17325ccf010608a26c6a1373e0a5/plugins/sync/src/androidMain/kotlin/app/aaps/plugins/sync/xdrip/DataSyncSelectorXdripImpl.kt#L72-L118). Bolus fields: [BolusExtension.kt](https://github.com/nightscout/AndroidAPS/blob/c20c2298298d17325ccf010608a26c6a1373e0a5/plugins/sync/src/androidMain/kotlin/app/aaps/plugins/sync/xdrip/extensions/BolusExtension.kt#L8). A missing profile drops the batch ([XdripPlugin.kt](https://github.com/nightscout/AndroidAPS/blob/c20c2298298d17325ccf010608a26c6a1373e0a5/plugins/sync/src/androidMain/kotlin/app/aaps/plugins/sync/xdrip/XdripPlugin.kt#L380-L388)). Plugin description: [strings.xml](https://github.com/nightscout/AndroidAPS/blob/c20c2298298d17325ccf010608a26c6a1373e0a5/plugins/sync/src/androidMain/res/values/strings.xml#L150-L156). AAPS can see launcher apps ([manifest](https://github.com/nightscout/AndroidAPS/blob/c20c2298298d17325ccf010608a26c6a1373e0a5/shared/impl/src/androidMain/AndroidManifest.xml#L3-L23)). |
| External Companion Apps status | No. | A current snapshot: glucose, IOB, COB, current basal and pump state, no history. |
| Content provider | No. | AAPS exports no provider for its database ([app manifest](https://github.com/nightscout/AndroidAPS/blob/c20c2298298d17325ccf010608a26c6a1373e0a5/app/src/main/AndroidManifest.xml#L180-L200)). |
| Wear broadcast | No. | Protected by a signature permission. |
| Garmin local server | No. | Localhost only, current values, no treatment history. |
| Nightscout upload | Via the internet. | Used by the Nightscout fill ([nsclientV3 extensions](https://github.com/nightscout/AndroidAPS/blob/c20c2298298d17325ccf010608a26c6a1373e0a5/plugins/sync/src/commonMain/kotlin/app/aaps/plugins/sync/nsclientV3/extensions)). Deletions are uploaded as `isValid: false`. |

Not yet checked on a device: that AAPS on the phone discovers the T1 Arc receiver and that its broadcasts arrive in the background.

## Verification and remaining device checks

### AAPS settings history, 17 November 2026

On `codex/tarvis-aaps-context`; nothing was installed on a phone. `npm run quality` passes (lint, TypeScript and the full Vitest suite). New tests cover parsing for each route and event type (mg/dL and mmol/L targets, cancel shapes, profile percentage and time shift, running modes and older offline reasons, suspend-type temporary basals, exercise, missing times and durations), interval ends (recorded duration, next record, cancel, no recorded end, suspension over an ongoing mode), duplicates across Nightscout and the phone, both clock changes in Europe/London, refreshing a re-sent record in memory and in real SQLite, Tarv1s routing, answer wording against the treatment-directive check, coverage and comparison thresholds, and the glucose-episode finding. The Kotlin test for `created_at` runs in CI only. Still to check on the phone: set an Activity temporary target and an 80% profile in AAPS, then confirm both appear once in the History AAPS lane and in a Tarv1s answer.

### Insulin and carb history, November 2026

On `codex/ov-aaps`; nothing was installed on a phone. TypeScript, lint and the full application test suite pass. New tests cover the Nightscout policy for each source, treatments-only reads while AAPS is selected (no Nightscout glucose fetched or stored), the fill switch and its erase binding, withdrawn and priming records, SMB labels, extended boluses, temporary basal truncation, paging, record replacement, the local queue drain, cross-source counting, and Europe/London clock-change days. Kotlin unit tests for the broadcast field checks run in CI only; the native receiver was not built locally. Still to check on the phone: enable AAPS xDrip+ sync, add a small test entry such as a carb record, and confirm it appears once in T1 Arc, also with Nightscout connected.

### Combined card and trend update, 2 November 2026

Implemented on `codex/aaps-local-source`; no new Pixel installation or public release was performed for this update. No additional AAPS setting is needed for an already working local source.

- Full lint, TypeScript and application suite passed: 5,593 tests across 418 suites. Native phone tests: 123 passed; unchanged Wear tests: 38 passed. Expo Doctor passed 21/21 checks, dependencies were current, and public-source/reachability checks passed. The final graph-only layout correction additionally passed focused lint, typecheck and 33 relevant tests. Independent code review found no outstanding actionable findings.
- A self-contained x86_64 debug APK with embedded JavaScript was built and installed only on Android 17/API 37 emulator `emulator-5582`. Synthetic broadcasts verified the combined card, negative IOB, zero COB, missing COB, exact triple directions and their detail dialog, mg/dL and mmol/L display, and `NONE` becoming an explicitly calculated trend with sufficient same-source history. Reopening recovered the stored reading. A screen-off synthetic update was received with Wi-Fi/mobile data disabled; both settings were confirmed off and no Metro connection was used.
- Native visual checks covered light/dark appearances, 320dp width and Android font scale 2.0. A graph/value overlap was found, fixed by placing the AAPS graph in normal layout, and visually rechecked. Accessibility labels and separate trend-detail controls were inspected through the UI tree; spoken TalkBack interaction was not tested.
- Automated tests cover stale/missing estimates, separate ages, source/session/erase boundaries, same-timestamp corrections, fallback reassessment, and triple preservation in archive/backup. Emulator checks do not establish prolonged Doze behaviour, the original intermittent payload on the real Pixel, or Bluetooth delivery to the physical watch. The frozen existing-Wear protocol tests pass; no companion source or schema changes were made. Triple source directions display as the existing companion's double arrows, as explained on the phone.

### Initial integration checks, 1 November 2026

The following records the initial pre-install verification of the development branch on 1 November 2026.

- Automated checks: lint, TypeScript, 5,550 tests across 416 suites; Android APK build; 120 native phone and 38 unchanged Wear companion unit tests; public-source and source-reachability checks. Coverage includes units, timestamps, trend labels, duplicates, older/future readings, missing versus zero COB, signed IOB, source generations, privacy erase, backup restoration and historical Glooko gaps.
- Android 17/API 37 emulator: a separate synthetic sender supplied the exact AAPS typed broadcast contract. Verified foreground glucose/IOB/COB display, IOB-only updates, missing COB, screen-off reception with Wi-Fi/mobile data disabled, force-stop/reopen recovery, reboot/unlock recovery with another offline broadcast, and stopped-source rejection. Re-enabling waited for a new reading instead of reviving the preceding session. The reusable [emulator fixture](../scripts/aaps-qa/README.md) has no sensor or pump capabilities.
- These checks do not establish behaviour of the actual AAPS dev build on the Pixel, prolonged Doze/battery restriction behaviour, or Bluetooth delivery to the physical Galaxy Watch 8. No physical AAPS, Juggluco, sensor or pump settings were changed.

The reusable sender also verified receiver discovery through `queryBroadcastReceivers`, using the same launcher visibility declaration as AAPS, before sending only to the isolated T1 Arc development package.

After installing a production-signed phone build, enable the setting above and compare several successive glucose measurement times, trends, IOB and COB values against AAPS. Then turn off Wi-Fi/mobile data while keeping Bluetooth on, leave the phone screen off, and check that phone and watch receive subsequent readings. Reopen T1 Arc and repeat after restarting the phone and unlocking it. Confirm that a stopped feed ages visibly rather than appearing current. The companion does not need reinstalling or watch debugging for this check; its protocol is unchanged. Battery restrictions and the availability of the paired local Wear connection still determine physical-device delivery.
