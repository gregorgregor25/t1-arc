# Garmin Venu 2 Plus feasibility — T1 Arc

Investigated 17 September 2026, followed by an authorised isolated simulator trial. No production integration, publication or physical-device testing performed.

**Hardware-beta follow-up:** a separate Android beta and a real-reading Garmin publisher are now implemented on branch `codex/garmin-companion-beta`. Ten exact watch targets compile and pass runtime logic tests. The GitHub development pre-release remains hardware-unverified and is not published to Garmin. See [beta scope and compatibility evidence](../../garmin/README.md) and [tester guide](../../garmin/TESTER-GUIDE.md); the architecture discussion below records the original investigation.

**Simulator results:** Android-emulator delivery to a Venu 2 Plus simulator and foreground display pass for synthetic fresh, stale, missing and source-error states. SDK 8.1 also returns matching acknowledgements to Android; bounded retry timeout, duplicate replay and phone process-restart persistence pass. A manually targeted simulator phone event updates the public complication behind a separate test face and returns a background acknowledgement. Automatic Android-triggered delivery while the publisher is closed remains unproven. See [trial results, evidence and reproduction steps](../../experiments/garmin-simulator/README.md).

SDK 9.2 failed watch transmission in this trial, so the working comparison uses official SDK 8.1. Android's missing Kotlin dependency and the simulator's missing sender UUID were handled in the isolated probe. Computer Use and device setup now work. These simulator results do not establish production Garmin Connect/Bluetooth reliability or compatibility with existing faces.

**Unattended expiry also passed:** after a nearly stale reading reached the publisher, it was closed normally and the separate consumer displayed `6.8 D`. Without another phone message or manual event, scheduled background publication changed the face to `OLD`. This establishes eventual expiry in this simulator setup; exact freshness-boundary timing and behaviour on a real face still require validation.

## Recommendation

Continue the **complication-first approach**: one small Connect IQ device app publishes glucose for compatible existing faces. No T1 Arc Garmin watch faces are required. A simple glance/detail screen in that same app is useful for setup, reading age and troubleshooting; it is not a collection of faces. Defer an activity data field.

The exact Venu 2 Plus is technically eligible. Reliable background delivery, safe stale display and at least one usable existing face must pass real-watch testing before announcing support. The creator currently lacks this hardware.

## What this watch supports

| Surface | Finding | Qualification |
| --- | --- | --- |
| Third-party complication | Venu 2 Plus is explicitly listed by the Complications API, introduced in API 4.2.0. | A publishing device app is needed; the receiving face must implement consumption of third-party data. |
| Glance/widget | Device reference lists a glance built as watch app/widget, with 64 KiB glance memory. | Implement `getGlanceView`; shows in the glance list, not permanently on the clock face. |
| Activity data field | Device reference lists data fields, with 256 KiB memory. | Separate application type/package for supported activity screens; not a clock-face complication. |
| Background phone message | Exact watch appears in `registerForPhoneAppMessageEvent` and `ServiceDelegate.onPhoneAppMessage`, API 3.2.0. | Register the event and implement the background delegate; installation alone is insufficient setup. |

Garmin currently lists this model as 416 × 416 AMOLED, API 5.0. That is a current compatibility listing, not proof of the prospective user's installed firmware. Target `venu2plus`, minimum API 4.2 for the publisher, and require compatible firmware. [Device list][devices], [device reference][device], [Complications API][complications], [Background API][background], [service delegate][delegate].

## Which existing faces can display it?

Connect IQ watch faces need `ComplicationSubscriber` permission plus code that discovers/selects the public T1 Arc complication and reads/subscribes to its value. A face displaying steps, heart rate or a selectable “data field” does **not** establish third-party compatibility. Publish with `access="public"`; protected/private visibility does not make data available to arbitrary other developers' faces. [Complications guide][guide].

Garmin documents **Face It** as a complication consumer, with display rules and resource metadata. Its guide still mixes future-tense introductory wording with implemented-looking instructions. Treat Face It as the first existing-face route to verify on this exact watch and current phone software, not as hardware-proven support. Do not imply stock/built-in Venu 2 Plus faces accept arbitrary Connect IQ complications: the reviewed documentation does not establish that capability. No named store face was independently verified in this investigation. A release needs a short tested face list, including exact versions and setup steps. [Complications guide][guide].

The receiving face controls layout, redraws, text truncation, units and whether labels are visible. Hold-to-launch also requires consumer implementation; do not promise it merely because the watch supports the API. Glance remains useful when the chosen face is unsuitable.

## Current T1 Arc code inspected

This task's isolated checkout contains the original Expo starter, not the current Android/Wear implementation. Read-only inspection therefore used `C:/Users/amazo/Documents/Codex/2026-07-25/daymark`, HEAD `e0e01b42f8523f96a4f83cf9df67bb7cb7c4332d`. Existing untracked `website/` was not modified. Paths below refer to that checkout.

| Code | Relevant behaviour |
| --- | --- |
| `src/data/live/configuredGlucoseSources.ts` | Refreshes configured LibreLinkUp, notification, Nightscout and xDrip sources into shared history. |
| `src/data/glucoseDisplay/glucoseDisplayCoordinator.ts` | Reads latest SQLite glucose, derives trend where needed, carries source-error state to native display; also sends six hours/up to 144 history points for Wear. Cached readings remain available after source failure. |
| `modules/daymark-glucose-display/android/src/main/java/app/daymark/glucosedisplay/DaymarkGlucoseDisplayModule.kt` | Holds encrypted native snapshot; `updateReadingAsync` and `updateMissingAsync` publish to Wear. `DaymarkWearSync` sends immediate MessageClient messages plus retained urgent DataClient items. Payload includes availability, mmol/L, original timestamp, trend/origin, source error and appearance. A request service republishes cached state. |
| Same native module, `DaymarkGlucoseDisplayService` | Existing foreground service requests Headless JS sync on a 15-second tick and renders phone notification every minute. It is gated by display enablement and notification permission; this is not a guarantee of a new source reading every 15 seconds or of continuous sync with display disabled. |
| `wear/companion/src/main/java/app/daymark/wear/data/DaymarkDataLayerService.kt`, `DaymarkWearRepository.kt` | Accept immediate and retained data, refresh surfaces, validate and encrypt local cached glucose. |
| `wear/companion/src/main/java/app/daymark/wear/data/GlucoseSnapshot.kt` | Current through six minutes; delayed through twelve; stale thereafter. Source error changes otherwise-current to delayed. Missing is distinct. |
| `wear/companion/src/main/java/app/daymark/wear/complication/DaymarkGlucoseComplicationService.kt` | Uses timed Wear complication entries and stale fallback, so freshness can change without another phone update. |

Reuse the normalised snapshot and semantics, not the Wear transport or Android complication classes. Garmin is a new Monkey C component and a native Android transport adapter. Avoid porting all graph history for the first version. Keep credentials and glucose-source fetching on the phone.

## Simplest proposed route

`Existing glucose sources → T1 Arc native snapshot → Connect IQ Android Mobile SDK → Garmin Connect Mobile → Bluetooth → T1 Arc Connect IQ app → public complication → compatible face`

The Android SDK explicitly requires Garmin Connect Mobile; it provides paired-device discovery, connection events, installed-app lookup and `sendMessage` to the watch application's mailbox. No new cloud relay or direct CGM integration is needed. Internet remains necessary where the existing glucose source requires it. [Android SDK][android], [Mobile SDK FAQ][faq].

Setup would require Garmin Connect installed and paired, Bluetooth available, compatible watch firmware, the T1 Arc watch app installed and opened once to initialise registrations, and an eligible face configured to select T1 Arc. T1 Arc needs opt-in device selection and clear missing-app/disconnected status. Check SDK readiness before calls and identify the watch app by its stable UUID. Garmin Connect and T1 Arc must be allowed to operate in the background; validate Android lifecycle behaviour rather than assume Wear's service behaviour transfers unchanged.

Suggested payload: schema version, stream/source identity, monotonic revision, available flag, original reading timestamp, canonical mmol/L, display-unit preference, trend and origin, source-error flag. Preserve timestamps through all retries. On-watch validate types, finite ranges and clock anomalies. Unit preference is explicit: Garmin has no glucose-specific built-in unit; do not infer it from distance units.

Persist only the latest desired state on Android. Send when reading or meaningful status changes, on SDK readiness/reconnect, and in response to an explicit watch refresh. Coalesce updates while a send is pending; use bounded backoff. Reconnection sends the newest state, not every missed reading. Handle duplicate/out-of-order messages and explicit missing-data revisions so an older reading cannot resurrect after a clear. Add a watch acknowledgement if the phone reports “received on watch”; SDK send success alone does not prove rendering. These are proposed application responsibilities, not guarantees of Garmin's queue.

The FAQ describes messages waiting until an inactive app opens. The Background API supplies the additional registered phone-message event that can wake this model's app without foreground launch. Test both foreground reception and inactive/background reception; do not treat the FAQ's mailbox alone as live background updating. [FAQ][faq], [Background API][background].

## Background updates, age and battery

**Phone-triggered events and scheduled events are different.** `registerForPhoneAppMessageEvent` documents an event on receipt; it does not specify a five-minute minimum. Temporal scheduling requires intervals of at least five minutes, and its exception also refers to scheduling less than five minutes after the last background event. Therefore one-minute incoming readings are a plausible push use case, not a promised one-minute delivery SLA. Verify interaction between frequent phone events and expiry scheduling. [Background API][background].

Background services have limited memory, may be pre-empted, and must exit within 30 seconds. The exact model has 64 KiB background memory. Validate, persist, publish and exit promptly; avoid network work, continuous loops or a permanently open screen. Deduplicating the phone's repeated sync ticks and sending only compact changed state should reduce radio and CPU work. Measure watch and phone battery with actual reading cadence, existing-face redraw behaviour, Bluetooth loss and always-on display settings. No battery-life estimate is justified yet. [Background guide][background-guide], [delegate][delegate], [device reference][device].

Preserve the existing six-/twelve-minute freshness policy as a display-consistency choice, not a new clinical recommendation. Compute age from measurement time, not receipt time. In the glance/detail view show value, units, original measurement time/age, delayed or last-known status, and missing-data text; distinguish link loss from source failure. Handle unknown trend explicitly. For stale complication data prefer an unmistakable text value such as `OLD` or `--`; do not depend on colour or combining strike-through glyphs surviving another face's renderer.

**Critical limitation:** Garmin's documented complication object has no measurement timestamp, expiry or Wear-style future timeline. A published `6.8` or `2m ago` can remain cached. Use an absolute reading time in a tested text format where space permits; recompute age whenever our own UI renders. A temporal watchdog can publish stale/missing status after phone silence, but cannot promise an exact six-/twelve-minute transition: timing rules, pre-emption and consumer redraws intervene. Merely sending a fresh value on each reading is inadequate. Release is blocked until disconnected ageing is demonstrated on the supported face, or that face independently expires data using an agreed timestamp convention. Do not offer a bare-number mode that silently freezes as current. [Complication object][object], [Background API][background].

For Face It, use its documented text/no-conversion mode when encoding status, and test units and length carefully. Prefer Latin text fallbacks for trend; Garmin recommends Latin characters for published strings. The guide's sample uses `:units`, whereas the API signature uses `:unit`: follow the API/type checker, not copied sample code. [Guide][guide], [API][complications].

## Likely implementation scope, if authorised later

1. Android Garmin adapter at native snapshot publication, independent of Wear success: lifecycle, device selection, installed-app checks, durable latest-state retry and diagnostics. Explicitly resolve continuous sync when the phone display is disabled.
2. One `venu2plus` Connect IQ device app: Background/Communications/ComplicationPublisher permissions, public resource, foreground and background message handlers, cached state, expiry handling, minimal setup/detail UI; optional glance in the same package.
3. Shared payload specification and semantic fixtures covering units, missing, delayed, stale, calculated trends, revision ordering and clock skew. Recheck Wear/phone output regressions.
4. Simulator prototype followed by a hardware beta gate. No custom face collection, cloud service, full graph/history transfer or watch alarms in initial scope.

An optional activity data field is a later separate app UUID with its own message delivery/cache while an activity uses it. Only faces subscribe to complications, so do not assume a data field can consume the publisher or share its private storage. Phone delivery would need to target that application as well. Verify supported activity layouts and live updates before adding it. [Guide][guide], [device reference][device].

## Can both ends run on the computer?

Yes, an Android emulator plus the Connect IQ simulator is a sensible prototype setup: run an isolated T1 Arc development build using `IQConnectType.TETHERED`, load the publisher for `venu2plus`, forward port 7381 to the selected Android emulator with `adb -s <emulator-serial> forward tcp:7381 tcp:7381`, then enable the simulator's Connection → Start. Both apps must use the same watch-app UUID. Start with Garmin's Comm Android/Comm Watch samples to confirm the toolchain before introducing T1 Arc code.

Garmin explicitly documents the ADB simulator route using an Android handset. The follow-up trial successfully applied the same ADB forwarding to an Android emulator for foreground delivery and acknowledgements on SDK 8.1. The older communication guide names `IQCommProtocol.ADB_SIMULATOR`; the current Android SDK guide uses `IQConnectType.TETHERED`. A USB-connected test phone plus the Garmin simulator is another documented route, still requiring no watch. Neither setup fully emulates watch firmware, Garmin Connect pairing, real Bluetooth reconnection or production third-party faces.

Sources: [Garmin ADB simulator instructions](https://developer.garmin.com/connect-iq/articles/core-topics/Communicating_with_Mobile_Apps.html), [current Android SDK][android], [official sample projects](https://github.com/garmin/connectiq-android-sdk).

## Practical test plan

| Stage | Work and pass evidence |
| --- | --- |
| Simulator, no watch needed | Use official `venu2plus` target; compile and inspect 416-pixel layout and 64 KiB background/glance budgets. Test valid/malformed/missing payloads, all trends, unit conversion, clock shifts, duplicate/out-of-order/clear messages, restart persistence and freshness boundaries. See the trial README for the completed subset and evidence. |
| Phone-to-simulator | Garmin documents Android SDK `TETHERED` communication over ADB. Use an isolated Android test environment and simulator to exercise serialization and reception. This bypasses the production Garmin Connect/Bluetooth path and cannot validate its reliability. [Android SDK][android]. |
| Background registration | Trigger services manually and via phone messages with publisher closed. Garmin's simulator can manually invoke the most recently run app's service **even if it never registered**; a manual callback test alone cannot prove setup works. Test actual event registration separately. [Background guide][background-guide]. |
| Consumer | Use a development consumer fixture to inspect published values; then test an existing selectable consumer such as Face It on hardware. Record face/version, provider discovery, labels/units, glyphs, truncation, sleep/always-on redraw and missing/stale behaviour. A fixture is test tooling, not a shipped T1 Arc face. |
| Real Venu 2 Plus required | Borrow/buy a watch or arrange a willing tester later. Record firmware, Android model/version, Garmin Connect version and face. Test installation/first launch, phone locked, overnight background operation, source errors, Bluetooth off/out of range, app/process restart, phone/watch reboot, Garmin Connect restart, activity/music use, disable/unpair and reinstall. Never contact the commenter without authorisation. |
| Acceptance | At least 24–48 hours normal and disrupted use; record source timestamp, send, watch receipt and visible update times. After reconnect the newest state appears without reopening the watch app; no old packet overwrites it. Cut all phone updates and demonstrate safe ageing on the actual face without user action. Measure battery against the same watch/face/settings baseline. Any unresolved stale-current display or need to open the app for each update is a blocker to announcing dependable complication support. |

## Primary sources

All checked 17 September 2026. Some Garmin guide pages returned only navigation through the web extractor; their official article HTML was read directly from Garmin's `connect-iq/articles/` URLs below. Claims above distinguish documented capability from proposed design and untested hardware behaviour.

[devices]: https://developer.garmin.com/connect-iq/compatible-devices/
[device]: https://developer.garmin.com/connect-iq/articles/device-reference/venu2plus.html
[complications]: https://developer.garmin.com/connect-iq/api-docs/Toybox/Complications.html
[object]: https://developer.garmin.com/connect-iq/api-docs/Toybox/Complications/Complication.html
[guide]: https://developer.garmin.com/connect-iq/articles/core-topics/Complications.html
[background]: https://developer.garmin.com/connect-iq/api-docs/Toybox/Background.html
[delegate]: https://developer.garmin.com/connect-iq/api-docs/Toybox/System/ServiceDelegate.html
[background-guide]: https://developer.garmin.com/connect-iq/articles/core-topics/Backgrounding.html
[android]: https://developer.garmin.com/connect-iq/articles/core-topics/Mobile_SDK_for_Android.html
[faq]: https://developer.garmin.com/connect-iq/articles/connect-iq-faq/How_Do_I_Use_the_Connect_IQ_Mobile_SDK.html

Additional reference: [Glance lifecycle and implementation](https://developer.garmin.com/connect-iq/articles/core-topics/Glances.html).
