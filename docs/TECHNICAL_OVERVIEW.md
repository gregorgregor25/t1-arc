# T1 Arc technical overview

> This is a detailed snapshot of the current development implementation. The app is changing quickly, so verify behaviour against the code and tests before relying on this document.

T1 Arc is a local-first, evidence-first Android app for understanding Type 1
diabetes data. It is built for one person, mmol/L, metric units, and
`Europe/London`.

Version 1.6.9 has two deliberately separate experiences:

- **Personal data** is usable without requiring any one glucose provider.
  T1 Arc's own LibreLinkUp connector does not require GlucoDataHandler (GDH),
  while xDrip-compatible endpoints, notification glucose, Glooko, food,
  context and Health Connect can be used independently. Readings are
  deduplicated into an encrypted local
  SQLCipher database. Glooko exports can backfill historical CGM and delayed
  pump records through an on-device Glooko consumer export or UK-format
  ZIP/CSV fallback.
  Food can
  be logged from an offline UK catalog, recents, favourites, or a barcode;
  compatible phone and wearable records can be selected through Health
  Connect.
- **Demo lab** uses clearly labelled synthetic glucose, basal, bolus, meal,
  activity, sleep, and weight records to demonstrate the wider evidence-linked
  product vision without pretending those records are personal data.

Synthetic records are never silently combined with personal records.

## What works

- A polished first-run path that explains T1 Arc in plain language, connects
  LibreLinkUp without sending the sign-in to a T1 Arc server, or opens a
  clearly labelled demo. People using Nightscout, xDrip, notification glucose,
  or no glucose source yet can enter Personal mode directly and land on the
  complete Sources screen instead of being forced through LibreLinkUp. A
  compact source chooser jumps directly to LibreLinkUp, Nightscout, xDrip,
  notification glucose, Health Connect, or Glooko setup on the otherwise long
  connection page.
  Existing connected users bypass onboarding automatically.
- Current glucose, direction, reading time, and explicit current, delayed,
  stale, or missing state. If a source omits its direction, T1 Arc derives a
  clearly labelled fallback only from a coherent, gap-free set of recent
  readings from that same source. The original values remain inspectable, and
  noisy or incomplete windows are withheld rather than forced into an arrow.
- Direct LibreLinkUp follower connection using the legacy v4 interface observed
  in GDH's public MIT-licensed source.
- A read-only Nightscout connector for user-owned sites. T1 Arc accepts an
  HTTPS site address plus an optional readable access token, extracts a token
  from a pasted Nightscout link, and stores it only in Android secure storage.
  Connection imports up to 14 recent days into the same encrypted,
  deduplicated glucose history; ordinary refreshes then request only a bounded
  recent window. The user can choose the earliest date once and T1 Arc works
  backwards automatically in exact, resumable 14-day ranges, at most one
  range every 15 minutes while Android gives the app execution time, until the
  requested local history is complete.
  Empty ranges still advance the continuous cursor, and changing or removing
  the connection clears only that connection's backfill state. Publicly
  readable sites work without a token. T1 Arc does not accept an API secret
  or request write access.
- A bounded xDrip-compatible connector for `/sgv.json` feeds. The normal
  same-phone setup is one tap plus a connection test at
  `127.0.0.1:17580`; release builds permit unencrypted HTTP only for
  `localhost` and `127.0.0.1`, while any remote endpoint must use HTTPS.
  T1 Arc accepts either the GDH-style single object or a bounded xDrip array,
  rejects oversized, implausibly timed or malformed responses, and stores
  usable readings with stable xDrip provenance in the same encrypted,
  deduplicated history. The source automatically participates in foreground,
  background, notification, AOD, widget and Wear refreshes without exposing
  a T1 Arc HTTP server.
- Encrypted, deduplicated glucose history that survives restarts.
- Historical Glooko CGM backfill in mmol/L, with exact source file, row,
  timestamp and device provenance. Overlapping phone readings remain the
  preferred live source while Glooko fills older gaps.
- Immediate refresh on app foregrounding, foreground refresh no more often than
  once per minute, pull-to-refresh, and opportunistic Android background sync.
  Background diagnostics name the exact configured source that could not
  refresh without retaining its raw error, endpoint, credentials or glucose
  value. Notification capture only counts as connected when Android access and
  a capture rule are both active, and T1 Arc does not keep a glucose worker
  registered when no live glucose source is configured.
- An opt-in, T1 Arc-owned one-minute foreground collector and silent ongoing
  glucose notification. It shows value, direction and explicit freshness in
  the status bar/notification shade, can redact the locked-phone value, and
  restores after reboot. Tapping it returns to Today, while its explicit
  **Log food** and **Log context** actions open either full logger directly.
  Long-pressing the T1 Arc launcher icon offers the same two direct actions.
  An advanced, separately consented Accessibility
  service can draw the full value during Pixel always-on display without
  reading screen content or key presses. The user chooses one of nine fixed
  screen positions and three sizes; T1 Arc keeps one overlay window and
  redraws its bitmap in place so minute-age updates do not move, blink, or
  rebuild it. A fallback direction remains marked as calculated in the app,
  notification, widget, AOD, watch app, tile, and complication.
- A resizable Pixel home-screen widget showing value, direction, reading age,
  freshness and source using the same user-selected range colours. It reads
  only T1 Arc's encrypted native display snapshot, opens the app when tapped,
  and can be requested directly from Sources without sharing data with a
  launcher service.
- Off-by-default local low, high, and stale-reading alerts using thresholds the
  user chooses. Enabling alerts starts T1 Arc's quiet one-minute foreground
  collector; state changes use asymmetric hysteresis to avoid threshold
  chatter, repeats can be disabled or spaced by 30, 60, or 120 minutes, and
  Android retains control of channel sound and vibration. Alert copy contains
  no dose or treatment calculation.
- Retention of both Libre factory UTC and local timestamps, with a warning when
  they disagree materially.
- Combined glucose and insulin timeline with tap-to-inspect values.
- 6-hour, 12-hour, 24-hour, 3-day, 7-day, and 30-day views. A native date
  picker jumps directly to any day stored on the device. Long-range chart
  sampling retains local highs, lows, and the boundaries of genuine data gaps;
  statistics and inspection always use the complete reading series. Monthly
  insulin is condensed into DST-aware daily basal/bolus totals so the chart
  stays readable while exact deliveries remain available in Records. Multi-day
  History also provides a day-by-day comparison of time in range, average,
  coverage, insulin, carbohydrate and reading count. A day opens directly into
  its full timeline, and low coverage is highlighted rather than mistaken for
  stability. Seven- and 30-day views add a local-clock aggregate glucose
  profile: half-hour medians, middle-50% bands and 10th-to-90th-percentile
  whiskers appear only when enough separate days contribute. The profile opens
  every exact reading behind it.
- An opt-in, on-device Glooko sync for single-patient UK consumer
  accounts whose exports use UK local time and day/month/year dates. Setup
  requires an explicit confirmation of that format because Glooko's EU service
  and ZIP metadata do not prove the account timezone. Android Keystore encrypts
  the saved email and password. Every run
  creates a fresh in-memory Rails session, discovers that account's export
  identifier, and requests overlapping
  14-day automatic updates every hour, a 30-day reconciliation every
  24 hours, and a 90-day reconciliation weekly. Manual sync requests 90 days.
  The connector calls Glooko's synchronous v3 ZIP exchange directly, validates
  the real archive, and retains selected source exports
  in SQLCipher, selectively extracts bounded files, normalises supported
  records locally, removes the transient raw cache copy, and never presents
  the result as live pump state. Automatic 14-day snapshots are normalised
  without retaining many redundant raw copies; each nightly/manual 30-day
  archive preserves the complete source data. Oversized and not-yet-supported
  CGM, basal, bolus, pump carbohydrate, activity, medication and Glooko note
  context are indexed with stable IDs and exact
  CSV provenance. CGM files receive a separately bounded larger allowance for
  realistic exports. Oversized and not-yet-supported files remain available
  inside that encrypted archive rather than being discarded. The
  Sources screen retains a privacy-safe stage/timing trace for the latest
  attempt. ZIP entries are bounded using the bytes actually extracted rather
  than Glooko's sometimes misleading advertised sizes, and a retained export
  can be re-read after parser updates without another sign-in or download.
  Glooko's reported daily insulin totals are retained as separate verification
  records rather than being mislabelled as delivered boluses. Records shows
  their exact file and row, while the Data map compares each latest reported
  day with the basal and bolus rows T1 Arc could organise.
  Because Glooko limits one CSV export to 90 days, Sources can also walk
  backwards through non-overlapping 90-day historical ranges. Each successful
  step retains the complete encrypted archive, merges stable record IDs, and
  advances a local cursor even when that period contains no supported rows, so
  a user can progressively build the full history available in the account.
  The user can instead choose an earliest date once: T1 Arc then retains at
  most one older range per day through the silent on-device connector. A
  30-day reconciliation remains first priority, recent data more than four
  hours old is refreshed before history, and an expired Glooko session pauses
  the backfill rather than repeatedly interrupting the user. The final range
  is shortened to end exactly on the chosen date.
  A bounded reorganisation action walks every retained snapshot oldest-first,
  loads and clears one encrypted payload at a time, and continues past an
  unreadable copy so newly supported historical fields are recovered without
  putting the entire archive in memory.
  Sources shows an inspectable private-archive summary with retained snapshot
  count, encrypted on-device bytes, latest retention time, represented file
  count and source-data coverage; it reads metadata only and does not load the
  archived health bytes into the UI.
  Large CGM files remain byte-backed after extraction and are decoded in
  bounded chunks rather than duplicated as one full JavaScript string.
  Rejected credentials or an authentication challenge pause retries instead of
  repeatedly failing. A saved password enables automation only after a genuine
  ZIP contains a recognised Glooko table, parses, and commits. Multiple-patient
  accounts fail closed until explicit patient selection exists. US automatic
  sync is not exposed because its date locale and timezone are not yet modelled
  safely. If any recognised file proves it uses month/day/year timestamps, the
  entire automatic archive is rejected before any sibling file is written.
  Existing saved credentials also remain paused after upgrade until
  the UK export-format confirmation is supplied; the encrypted password does
  not need to be re-entered for that confirmation. Manual ZIP/CSV import
  remains available for MFA/CAPTCHA, protocol changes and unsupported account
  types only when the selected export already follows the UK time/date
  contract. It is not a safe fallback for non-UK timezone-free timestamps;
  those require explicit timezone and date-locale selection. Daily Overview PDF automation is
  paused; an existing Glooko PDF can still be selected and processed locally.
- Health Connect permission, category and source controls spanning 37 stored
  record types: movement, energy, workouts, heart and recovery, sleep, body
  composition, vitals, hydration, nutrition, cycle and hormone context.
  Imported records retain their originating Android package. Selected-source
  daily totals are visible on Today, while every retained row, including sleep
  stages, workout sessions, nutrition and cycle records, can be paged and
  inspected with its exact source payload in Records. Connected data refreshes
  on app use and, when the optional Android background permission is allowed,
  through opportunistic on-device background work. The first connection reads
  all history Android permits; a confirmed **Recheck all health history**
  action can later reconcile older corrections or a changed source app without
  replacing or uploading the local archive.
  Active energy and total energy remain separate: a provider's total-calorie
  record is never relabelled as active calories when active energy is absent.
  If more than one provider supplies sleep, workouts, nutrition, weight or
  cycle context, those overlapping copies are withheld from summaries until
  the user chooses a source; every raw copy remains available in Records.
- Low-friction food logging from Today using the bundled UK CoFID 2021 catalog,
  reusable recent meals, actionable favourites, user-created foods, multi-item
  meals, deterministic quantity scaling, Open Food Facts barcode lookup, and
  explicit branded-product text search. CoFID results appear locally as the
  user types; an online search happens only when the user submits it, is
  cached for the session, and returns only products with reported carbohydrate.
  Reported branded-food serving sizes survive recents, favourites, upgrades
  and encrypted backup/restore, with one-tap half, one and double-serving
  portions in the logger instead of silently reverting to 100 g. Once a food
  is logged, its most recently used personal portion becomes the next prefill
  without overwriting the product's labelled serving or source evidence.
  Whole meals can be pinned above recents so a regular combination remains a
  one-tap repeat even after newer meals are logged. When only a carbohydrate
  total is known, a quick carb-only entry records that fact without inventing
  calories, protein or fat.
  Only the typed food query or barcode is sent for an online lookup. Today and History
  include a real food diary: T1 Arc logs expand to their exact foods,
  quantities, source labels and saved nutrient snapshots, while imported
  source-only meals remain visible without invented item detail. Removing a
  T1 Arc meal also removes its linked item snapshots transactionally. A
  logged meal can be corrected later by adding or removing foods, changing
  portions, time, meal type or its optional label. The original meal identity,
  creation time, item/source provenance and linked timeline identity are
  preserved while item snapshots, totals and context are reconciled together
  in one local transaction.
  Any itemised meal can also be logged again at the current time with one
  confirmation, reusing its exact saved foods, portions and source provenance.
  When a meal has at least two hours of sufficiently continuous glucose
  coverage, its diary details also show the observed near-meal baseline,
  subsequent peak, rise and time to peak. Tapping the observation opens the
  exact supporting glucose and nearby insulin records; incomplete windows stay
  hidden and timing is not presented as proof of a food effect.
  Insights can also group repeated meal labels only after at least three
  separately covered occurrences, rank their observed baseline-to-peak
  windows, and open every meal and glucose record behind the comparison.
- Duration-weighted time in range, glucose average, standard deviation,
  coefficient of variation, coverage, and daily insulin totals.
- Clearly labelled manual meal, activity, sleep, weight, medication, and
  factual health-context notes. Notes cover illness, stress, pod/site issues,
  sensor issues, hormones, travel, and other user-observed context. They are
  stored in an additive encrypted table, merged onto the same timeline,
  editable from Today, History, or Records, individually removable, and never
  treated as proof of causation. Corrections retain the stable record ID and
  original entered time, while the entry type and owning source stay fixed so
  provenance cannot silently change. Any
  non-meal context event can open an evidence inspector containing the exact
  event plus nearby glucose, insulin, and other context records.
- A Records screen exposing the normalised source records used by charts and
  calculations, with history navigation bounded by the earliest record
  actually stored rather than an arbitrary retention window.
- A per-day local data map that measures represented glucose and basal time,
  identifies the longest uncovered interval, separates glucose counts by
  source, and treats absent bolus/context rows as unknown rather than proof
  that nothing happened.
- A per-day glucose episode review ranks the largest sustained high/low
  periods by observed excursion burden. Each episode opens the exact
  qualifying readings together with nearby meal/context, bolus, and
  overlapping basal records. Proximity is explicitly presented as context,
  never as proof of cause.
- A per-meal response review aligns each logged meal with a nearby glucose
  baseline and at least two hours of continuous follow-up. It shows the
  observed baseline-to-peak change and time to peak, then opens every glucose,
  meal and nearby insulin record behind the result. Incomplete sensor windows
  are withheld rather than filled in, and timing is never presented as proof
  of cause or as dose advice.
- A deterministic Insights experience comparing adjacent 3-, 7-, 14-, or
  30-day completed periods. The user can choose any historical period end
  date, including dates across UK clock changes, and the comparison remains
  aligned to London calendar days. Rolling seven-day reviews are generated opportunistically
  on-device, refreshed after Glooko imports, retained for 120 days inside
  SQLCipher, and presented as a calm review history. Each report is
  fingerprinted so unchanged evidence is not presented as a new finding.
  Android background work requests a six-hour minimum interval; Android
  ultimately chooses the execution time. An off-by-default weekly review
  reminder can quietly announce when a complete evidence-backed report is
  ready, at most once per London calendar week and never with health values or
  conclusions on the notification itself.
  Every on-demand window uses the same deterministic calculations and
  record-level evidence rather than persisting a second hidden analysis copy.
  Every finding expands to its source, exact date range and stable IDs, then
  opens the complete normalized record set used in that claim. Missing
  referenced IDs are reported explicitly. It includes
  variability, sustained high/low reading runs, the three most prominent
  recent episodes with exact nearby-record evidence, and well-covered
  post-meal windows alongside insulin and recorded context comparisons.
  Time-of-day high and low comparisons are duration-weighted across exact
  Europe/London six-hour blocks rather than counting samples; UK clock changes
  alter the expected overnight minutes correctly, and a block is withheld
  unless both periods have at least 70% observed coverage.
  Insulin comparisons are normalised by London calendar day and separate
  observed basal from bolus delivery, including across UK clock changes.
  Source-selected
  Health Connect steps, distance, active energy and heart-rate records can
  contribute contextual comparisons; every such claim resolves back to the
  exact imported Health Connect rows and ambiguous providers are withheld.
  Manual or Health Connect weight records are also compared conservatively,
  with measurement timing and hydration called out as limitations rather than
  weight being presented as a proven cause.
  User-recorded context notes are compared by category and linked to their
  exact entries; the app explicitly warns that note frequency may reflect
  logging behaviour and does not prove why glucose changed.
  Recorded medication events have their own conservative comparison and exact
  evidence path. Treatment, medication-change, dose and pump-setting questions
  hit the same explicit advice hard stop.
  Material sensor gaps and incomplete basal timelines are surfaced as explicit
  evidence-backed limitations so missing data is never interpreted as stable
  glucose or zero insulin delivery. When Glooko's source-reported daily total
  materially differs from the detailed basal and bolus rows for those same
  complete London days, Insights links to both sides of the reconciliation and
  withholds the detailed-row insulin comparison rather than presenting false
  precision.
  The question router understands combined glucose, insulin, food, sleep,
  activity, heart-rate, weight, illness, stress, pod/site, sensor, hormone,
  travel, and data-quality language and has an explicit hard stop for dose or
  pump-setting requests.
- User-owned portable backup and merge-only restore. A consistent logical
  snapshot includes normalised records, retained original Glooko source
  exports, raw notification-source evidence and saved deterministic reviews,
  plus factual context notes. It streams records and binary source files
  without constructing one giant
  in-memory document, then is compressed and encrypted with AES-256-GCM using a
  PBKDF2-HMAC-SHA256 passphrase key (600,000 iterations). Credentials, tokens,
  and Glooko cookies are excluded. Non-secret glucose range colours and
  thresholds, AOD position and size, lock-screen privacy, the weekly-review
  choice, and inactive glucose-alert thresholds travel with the encrypted
  backup. Restoring never grants Android permissions or silently enables an
  alert, collector, notification, or AOD service.
- A live on-device data inventory and a deliberately guarded full erase.
  Two confirmations precede deletion. T1 Arc first stops collectors and
  clears LibreLinkUp credentials, Glooko cookies, pending notification
  captures, alert state and the native phone/Wear/widget snapshot; it then
  removes normalised health rows, food history, Health Connect copies,
  retained source archives and saved reviews from SQLCipher. Health Connect
  categories are left switched off so Android-granted access cannot silently
  refill the erased database. Non-health display colours and layout choices
  remain.
- Automatic light and dark appearance, 48 dp touch targets, pull-to-refresh,
  and a Pixel-friendly edge-to-edge layout.

Personal insulin is always a separately imported, delayed Glooko source. It is
never described as a live pump connection, and synthetic insulin is never
mixed into personal mode.

T1 Arc never recommends an insulin dose, correction bolus, or pump-setting
change. It is for personal review, not medical decision-making.

## Saved connection and refresh behaviour

LibreLinkUp credentials, its reusable session, an optional Nightscout readable
token, and the selected xDrip endpoint are stored with Android secure storage
on the device. Updating the APK in place with the same signing key keeps saved
connections, so they do not need to be entered for every build or test.

When a saved LibreLinkUp, Nightscout, or xDrip connection exists and no mode has
previously been selected, T1 Arc starts in Personal data mode and refreshes
immediately. Personal mode is also usable without either connection for
notification glucose, food, context, Health Connect and Glooko history. The app
remains usable from encrypted history during a temporary network or source
failure and shows that failure alongside the age of the last reading.

A successful LibreLinkUp or xDrip connection test writes the verified snapshot
to encrypted history before switching modes. Today therefore shows that exact
reading immediately, even if the next source request is delayed. If the source
reading is already old, T1 Arc shows it as stale rather than substituting demo
data.

Ordinary Android background work is opportunistic; the operating system
controls its exact timing and its requested minimum interval is 15 minutes.
Opening or foregrounding T1 Arc triggers an immediate refresh, and an open app
checks once per minute. If the user explicitly enables **Glucose at a glance**,
T1 Arc also runs a visible foreground service and checks LibreLinkUp once per
minute while the app is closed. The same collector checks a configured
Nightscout or xDrip source through the shared refresh pipeline. Turning the
display off stops that service.

Glooko uses a separate delayed schedule. When automatic refresh is enabled,
T1 Arc requests a 14-day export after one hour, a complete 30-day
reconciliation after 24 hours, and a 90-day reconciliation weekly. Opening or
foregrounding the app performs a due check. The shared Android worker is
eligible every 15 minutes and runs the Glooko export only when its hourly or
reconciliation policy is due; Android may defer execution for battery or
system conditions. Rejected credentials or an authentication challenge stop
silent retries until the saved connection is updated or a ZIP is imported
manually.

Health Connect uses a 15-minute eligibility check in both the foreground and
the shared Android background worker when background health access is
available and allowed. Android remains responsible for the actual execution
time, so the app reports eligibility separately from a completed background
run. Multiple providers for one metric are never silently added together:
the user chooses the active source while all raw copies remain encrypted and
inspectable. The same rule applies to contextual sessions and events, not only
numeric daily totals.

The Sources automation card records value-free outcomes for each shared worker
run. A current Nightscout refresh and its resumable older-history import are
reported separately, so a backfill retry cannot make current glucose look
broken.

## Privacy boundaries

- No credentials, auth tokens, cookies, health records, APKs, or remote
  attachments belong in Git.
- Credentials and session tickets use Android secure storage.
- Nightscout is restricted to HTTPS. T1 Arc requests only the v1 SGV read
  endpoint and recommends a token with Nightscout's `readable` role; it never
  asks for or stores the API secret.
- xDrip-compatible cleartext access is restricted in the Android release
  network policy to `localhost` and `127.0.0.1`. Connection validation rejects
  credentials, query material and every other cleartext host; remote feeds
  must use HTTPS.
- Normalised glucose history uses a per-install 256-bit SQLCipher key held in
  secure storage. Insulin and context use the same encrypted database.
- Glooko automatic CSV sync is opt-in for single-patient accounts on Glooko's
  EU service only after the user confirms that exports use UK local time and
  day/month/year dates. The endpoint and ZIP do not establish that locale.
  The raw email and password are
  encrypted with Android Keystore and used only by the native on-device
  connector. Each run creates a fresh in-memory Glooko session, discovers that
  user's export identifier, validates the returned ZIP, and discards session
  material; the password, raw email and export identifier never cross the React
  Native bridge or enter backups. An installation-keyed, nonreversible HMAC of
  the identifier crosses only to bind local records to that account; it cannot
  be correlated across installations. This permits same-account password
  rotation or reconnect while rejecting another account before writes. The
  bridge otherwise exposes only a masked email and non-secret region label.
  **Forget saved Glooko sign-in** erases the encrypted sign-in.
- Glooko exports are processed on-device. T1 Arc removes temporary raw copies
  after the exact export has been copied into SQLCipher, so they are not left
  in the public Downloads folder. Supported records are normalised separately;
  the original encrypted archive preserves files and fields that are not yet
  indexed. Connector diagnostics contain only stable outcome categories,
  never credentials, cookies, URLs, filenames, account details or health
  values. Manual Glooko ZIP/CSV selection remains available for UK-format
  exports if the private consumer protocol changes or an account requires an
  interactive authentication challenge. It does not make non-UK naive
  timestamps safe to normalise.
- Android backups are disabled.
- Portable `.t1arc` backups are user initiated, passphrase encrypted and
  contain normalised health records, raw source evidence and saved reviews.
  Restore adds missing records and never replaces the database or secure-store
  credentials. Credentials, session tokens and Glooko web cookies remain
  device-local and are never included.
- Removing a LibreLinkUp connection deletes the saved credentials and session;
  existing encrypted history is retained unless a separate data-deletion
  control is added.
- T1 Arc does not accept account terms automatically, intercept traffic, or
  bypass an unsupported encrypted API.

## Run locally

Prerequisites are Node.js, Android Studio/SDK, and JDK 21.

```powershell
npm ci
npm test
npm run typecheck
npx expo-doctor
npx expo run:android
```

SQLCipher is a native dependency, so this project must be built as a native
Android app; Expo Go is not a valid runtime for this configuration.

## Build and install the Pixel APK

The current release build is:

```powershell
adb install -r .\android\app\build\outputs\apk\release\app-release.apk
```

The `-r` update path preserves existing app data and secure-store connections
when the signing certificate matches. Version 1.6.9 includes the Pixel always-on
glucose overlay, encrypted display recovery after Android process restarts,
and user-configurable glucose ranges and colours shared by the app,
notification, and always-on display.

To rebuild:

```powershell
$env:JAVA_HOME = 'C:\path\to\jdk-21'
$env:NODE_ENV = 'production'
$env:T1ARC_PRIVATE_TEST_BUILD = '1' # Private phone/watch sideloads only.
npx expo prebuild --platform android --clean
Set-Location android
.\gradlew.bat assembleRelease -PreactNativeArchitectures=arm64-v8a
Set-Location ..
```

Without `T1ARC_PRIVATE_TEST_BUILD=1`, a release APK requires all four
`T1ARC_RELEASE_*` production-signing variables. Store bundles always require
the production key and never accept the private test certificate.

Use JDK 21 for Android releases. JDK 25 emits a restricted-native-access
warning from the Android PREFAB tool which Android Gradle Plugin 9 currently
misclassifies as a native configuration failure.

The release APK embeds the JavaScript bundle and does not need Metro. On
Windows, use a short physical checkout path if CMake reports a path-length
error.

Verify the finished APK before installing it:

```powershell
.\scripts\verify-android-apk.ps1 `
  -ApkPath .\android\app\build\outputs\apk\release\app-release.apk
```

## Build and install Wear OS locally

The tracked `wear/` package contains four deliberately separate Android apps:

- `:wear` is the T1 Arc companion, encrypted glucose cache, complication
  provider, and Tile. It uses the phone package name and signing certificate so
  Wear OS Data Layer will accept it.
- `:watchface-meridian`, `:watchface-chronograph`, and `:watchface-orbit` are
  resource-only Watch Face Format packages. They contain no health-source or
  account logic.

Expo's `with-daymark-wear` configuration plugin attaches all four projects again
after every clean native generation. Build them from the generated Android
project:

```powershell
Set-Location android
$env:T1ARC_PRIVATE_TEST_BUILD = '1'
.\gradlew.bat :wear:testDebugUnitTest :wear:assembleRelease `
  :watchface-meridian:assembleRelease `
  :watchface-chronograph:assembleRelease `
  :watchface-orbit:assembleRelease
Set-Location ..
.\scripts\verify-wear-apks.ps1
```

Install the companion and whichever faces you want onto the watch with its ADB
target selected:

```powershell
adb -s <watch-serial> install -r .\wear\companion\build\outputs\apk\release\wear-release.apk
adb -s <watch-serial> install -r .\wear\watchface-meridian\build\outputs\apk\release\watchface-meridian-release.apk
adb -s <watch-serial> install -r .\wear\watchface-chronograph\build\outputs\apk\release\watchface-chronograph-release.apk
adb -s <watch-serial> install -r .\wear\watchface-orbit\build\outputs\apk\release\watchface-orbit-release.apk
```

Then choose the face in the watch's face picker. The phone's
**Sources → Wear OS** card reports whether the signed companion is reachable.
The complication becomes delayed at six minutes and stale at twelve minutes
from the original measurement time, even if the phone stops sending updates.

For emulator-only rendering checks, the debug companion exposes a fixture
receiver that is completely absent from release builds:

```powershell
adb -s <watch-serial> shell am broadcast `
  -n app.daymark.personal/app.daymark.wear.debug.DebugSnapshotReceiver `
  -a app.daymark.wear.DEBUG_SET_GLUCOSE `
  --es mmol 6.8 --es trend flat --es category target
```

## Calculation rules

- Units are mmol/L and insulin units.
- Calendar calculations use `Europe/London`, including 23-hour and 25-hour
  daylight-saving days.
- The target range is 3.9–10.0 mmol/L.
- Time in range is duration weighted.
- Variability is time weighted across observed sensor intervals.
- A glucose interval contributes at most 12 minutes; longer gaps reduce
  coverage instead of being treated as observed.
- A sustained high/low run requires at least two qualifying readings, at least
  four minutes apart, with no gap over 12 minutes.
- Post-meal comparisons require a nearby baseline, at least 18 readings, at
  least two hours of follow-up, and no glucose gap over 20 minutes.
- Basal totals are prorated where an interval overlaps the selected range.
- Boluses are included by delivery timestamp.
- Evidence comparison requires at least 70% glucose coverage and 100 readings
  in each selected window. Otherwise the conclusion is withheld.
- Context changes are described as associations to inspect, never proven causes.

## Project structure

```text
src/
  data/          LibreLinkUp, Glooko, Health Connect, food, SQLCipher, backup
  domain/        Models, London time, freshness, statistics, evidence engine
  components/    Consumer-health UI, timeline, loggers, evidence inspection
modules/         Android bridges for Health Connect, Glooko, glucose display, backup crypto
  screens/       Today, History, Insights, Records, Sources
  providers/     Personal/demo source selection and lifecycle refresh
plugins/         Expo native-generation configuration
tests/           Connector, adapter, persistence, DST, statistics, evidence
docs/            Real-data contracts and privacy-conscious handoff
```

See [docs/INTEGRATION_CONTRACTS.md](docs/INTEGRATION_CONTRACTS.md) before
sharing any anonymised export or source response.

See [docs/GLUCOSE_DISPLAY_ARCHITECTURE.md](docs/GLUCOSE_DISPLAY_ARCHITECTURE.md)
for the GDH-informed notification/AOD design and future Wear OS snapshot
contract.
