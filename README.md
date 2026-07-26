# Daymark

Daymark is a private, evidence-first Android app for understanding Type 1
diabetes data. It is built for one person, mmol/L, metric units, and
`Europe/London`.

Version 1.4.0 has two deliberately separate experiences:

- **Personal glucose** uses Daymark's own LibreLinkUp connector. It does not
  require GlucoDataHandler (GDH). Readings are deduplicated into an encrypted
  local SQLCipher database. Delayed Glooko pump records can be synced through
  an on-device Glooko web session or imported from a ZIP/CSV fallback. Food can
  be logged from an offline UK catalog, recents, favourites, or a barcode;
  compatible phone and wearable records can be selected through Health
  Connect.
- **Demo lab** uses clearly labelled synthetic glucose, basal, bolus, meal,
  activity, sleep, and weight records to demonstrate the wider evidence-linked
  product vision without pretending those records are personal data.

Synthetic records are never silently combined with personal records.

## What works

- Current glucose, direction, reading time, and explicit current, delayed,
  stale, or missing state.
- Direct LibreLinkUp follower connection using the legacy v4 interface observed
  in GDH's public MIT-licensed source.
- Encrypted, deduplicated glucose history that survives restarts.
- Immediate refresh on app foregrounding, foreground refresh no more often than
  once per minute, pull-to-refresh, and opportunistic Android background sync.
- An opt-in, Daymark-owned one-minute foreground collector and silent ongoing
  glucose notification. It shows value, direction and explicit freshness in
  the status bar/notification shade, can redact the locked-phone value, and
  restores after reboot. An advanced, separately consented Accessibility
  service can draw the full value during Pixel always-on display without
  reading screen content or key presses.
- Retention of both Libre factory UTC and local timestamps, with a warning when
  they disagree materially.
- Combined glucose and insulin timeline with tap-to-inspect values.
- 6-hour, 12-hour, 24-hour, 3-day, and 7-day views.
- A foreground, on-device Glooko sync flow. The user signs into Glooko's own
  page; Daymark retains only the WebView session, requests an overlapping
  30-day ZIP export, waits for the real archive rather than treating an
  intermediate acknowledgement as a download, retains the exact source export
  in SQLCipher, selectively extracts bounded files, normalises supported
  records locally, removes the transient raw cache copy, and never presents
  the result as live pump state. Oversized and not-yet-supported files remain
  available inside the encrypted source archive rather than being discarded. The
  Sources screen retains a privacy-safe stage/timing trace for the latest
  attempt. ZIP entries are bounded using the bytes actually extracted rather
  than Glooko's sometimes misleading advertised sizes, and a retained export
  can be re-read after parser updates without another sign-in or download.
  Manual ZIP/CSV import remains available when Glooko changes its web interface.
- Health Connect permission, category and source controls for steps, distance,
  active calories, workouts, heart rate, resting heart rate, sleep and weight.
  Imported records retain their originating Android package.
- Low-friction food logging using the bundled UK CoFID 2021 catalog, recent and
  favourite foods, multi-item meals, deterministic quantity scaling, and
  Open Food Facts barcode lookup. Only the barcode is sent for an online
  product lookup.
- Duration-weighted time in range, glucose average, standard deviation,
  coefficient of variation, coverage, and daily insulin totals.
- Clearly labelled manual meal, activity, sleep, weight, and medication
  records, stored in the same encrypted database and individually removable.
- A Records screen exposing the normalised source records used by charts and
  calculations, with history navigation bounded by the earliest record
  actually stored rather than an arbitrary retention window.
- A deterministic Insights experience comparing the last seven complete days
  with the previous seven. Every finding expands to its source, exact date
  range and stable IDs, then opens the complete normalized record set used in
  that claim. Missing referenced IDs are reported explicitly. It includes
  variability, sustained high/low reading runs, and well-covered post-meal
  windows alongside insulin and recorded context comparisons.
- User-owned portable backup and merge-only restore. A consistent logical
  snapshot is compressed and encrypted with AES-256-GCM using a
  PBKDF2-HMAC-SHA256 passphrase key (600,000 iterations). Credentials, tokens,
  and Glooko cookies are excluded.
- Automatic light and dark appearance, 48 dp touch targets, pull-to-refresh,
  and a Pixel-friendly edge-to-edge layout.

Personal insulin is always a separately imported, delayed Glooko source. It is
never described as a live pump connection, and synthetic insulin is never
mixed into personal mode.

Daymark never recommends an insulin dose, correction bolus, or pump-setting
change. It is for personal review, not medical decision-making.

## Saved connection and refresh behaviour

LibreLinkUp credentials and the reusable session are stored with Android secure
storage on the device. Updating the APK in place with the same signing key keeps
the saved connection, so the email and password do not need to be entered for
every build or test.

When saved credentials exist and no mode has previously been selected, Daymark
starts in Personal glucose mode and refreshes immediately. The app remains
usable from encrypted history during a temporary network or source failure and
shows that failure alongside the age of the last reading.

A successful connection test writes the verified LibreLinkUp snapshot to the
encrypted history before switching modes. Today therefore shows that exact
reading immediately, even if the next cloud request is delayed. If the source
reading is already old, Daymark shows it as stale rather than substituting demo
data.

Ordinary Android background work is opportunistic; the operating system
controls its exact timing and its requested minimum interval is 15 minutes.
Opening or foregrounding Daymark triggers an immediate refresh, and an open app
checks once per minute. If the user explicitly enables **Glucose at a glance**,
Daymark also runs a visible foreground service and checks LibreLinkUp once per
minute while the app is closed. Turning the display off stops that service.

## Privacy boundaries

- No credentials, auth tokens, cookies, health records, APKs, or remote
  attachments belong in Git.
- Credentials and session tickets use Android secure storage.
- Normalised glucose history uses a per-install 256-bit SQLCipher key held in
  secure storage. Insulin and context use the same encrypted database.
- Glooko sign-in happens on Glooko's own HTTPS page in a screenshot-protected
  Android WebView. Daymark does not receive or persist the password. Android
  WebView cookies are retained locally for faster later sync and can be erased
  independently with **Forget saved Glooko sign-in**.
- Glooko exports are processed on-device. Daymark removes temporary raw copies
  after the exact export has been copied into SQLCipher, so they are not left
  in the public Downloads folder. Supported records are normalised separately;
  the original encrypted archive preserves files and fields that are not yet
  indexed. Its saved connector trace contains only stage names and relative
  timings, never credentials, cookies, filenames, account details or health
  values.
- Android backups are disabled.
- Portable `.daymark` backups are user initiated, passphrase encrypted and
  contain normalized health records only. Restore adds missing records and
  never replaces the database or secure-store credentials. Retained source
  archives currently remain device-local and are not included in this portable
  backup format.
- Removing a LibreLinkUp connection deletes the saved credentials and session;
  existing encrypted history is retained unless a separate data-deletion
  control is added.
- Daymark does not accept account terms automatically, intercept traffic, or
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

The packaged ARM64 build is:

```powershell
adb install -r .\artifacts\Daymark-v1.4.0.apk
```

The `-r` update path preserves existing app data and secure-store connections
when the signing certificate matches. Version 1.4.0 also retains each captured
Glooko source export in encrypted on-device storage, can re-read the saved
archive after parser improvements, and does not use unreliable ZIP size
metadata to decide whether a table can be normalised.

To rebuild:

```powershell
$env:JAVA_HOME = 'C:\path\to\jdk-21'
$env:NODE_ENV = 'production'
npx expo prebuild --platform android --clean
Set-Location android
.\gradlew.bat assembleRelease -PreactNativeArchitectures=arm64-v8a
Set-Location ..
```

The release APK embeds the JavaScript bundle and does not need Metro. On
Windows, use a short physical checkout path if CMake reports a path-length
error.

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
  in each seven-day window. Otherwise the conclusion is withheld.
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
