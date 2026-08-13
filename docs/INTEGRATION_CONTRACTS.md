# Real-data integration handoff

No live credentials or real health records belong in this repository. Never
commit or send LibreLinkUp or Glooko passwords, auth tokens, session cookies,
Tailscale keys, device serials, or identifiable exports.

## Independent source boundaries

T1 Arc keeps each input independent:

1. **Current and historical glucose:** T1 Arc's direct LibreLinkUp,
   Nightscout, xDrip-compatible and notification connectors write normalised
   readings to an encrypted local database through the same source contract.
   The direct LibreLinkUp route has no GDH runtime dependency.
2. **Insulin:** the UK Omnipod 5 PDM reaches Glooko through its own delayed
   cloud route. T1 Arc can request a synchronous v3 ZIP through its native
   UK consumer connector on Glooko's EU service or read a manually selected
   UK-format ZIP/CSV fallback.
   This source is always labelled delayed and never presented as live pump
   state. A privacy-safe outcome category is stored on-device for the last
   attempt.
   The exact captured export is retained in SQLCipher. Bounded extraction keeps
   oversized or not-yet-supported files compressed while supported records are
   normalised, so one large file cannot reject the whole export.
3. **Food:** CoFID search is bundled and offline. Explicit branded text search
   and barcode lookup use Open Food Facts and transmit only the typed food
   query or barcode. Search is never performed on each keystroke. Each saved
   item keeps a nutrient and provenance snapshot so later catalog changes
   cannot rewrite history.
4. **Phone and wearable context:** Health Connect is the Android aggregation
   boundary. T1 Arc stores normalized records with their originating package,
   while permission decisions remain in Android's Health Connect controls.
5. **Other context:** manual entries and imported pump carbohydrate rows use the
   same independent `ContextSource` boundary.

The UI depends on `GlucoseSource`, `InsulinSource`, and `ContextSource`
contracts in `src/data/contracts.ts`. A source can be replaced without changing
the screens or deterministic calculation layer.

Personal mode never fills a missing real source with synthetic data.

## Direct LibreLinkUp

The successful on-device connection test has already validated the response
shape needed for this account. The saved connection is reused after an in-place
APK update; no password needs to be sent to a developer or re-entered for each
test.

The connector implements the legacy v4 behaviour found in GDH's public
MIT-licensed source:

1. Log in through the global LibreView endpoint.
2. Follow the account's regional redirect.
3. Retain the expiring auth ticket in Android secure storage.
4. Load accepted follower connections.
5. Read graph/current measurements.
6. Convert mg/dL to mmol/L using `18.016`.
7. Store stable normalised readings keyed by source and timestamp.

T1 Arc retains both `FactoryTimestamp` and `Timestamp` from Libre where they
are present. Factory UTC time is authoritative for the record; a material
factory/local disagreement is exposed as a source warning rather than hidden.

If a future response reports `unsupported-api`, provide only T1 Arc's
non-secret error code and message. Do not copy request headers, bearer tokens,
encrypted payloads, or passwords. T1 Arc will not accept legal terms
automatically or attempt to bypass a newer encrypted interface.

## xDrip-compatible glucose

T1 Arc can poll a bounded xDrip-compatible `/sgv.json` endpoint directly, as
well as use the same adapter for a historical migration. The default
same-phone request is:

```text
GET http://127.0.0.1:17580/sgv.json
```

Release network policy permits cleartext only for `127.0.0.1` and
`localhost`; every remote endpoint must use HTTPS. Connection validation
rejects URL credentials, query material and non-`/sgv.json` paths. A response
is limited to 1,000,000 characters and 512 readings, and timestamps outside
the year-2000-to-five-minutes-in-the-future window are withheld.

The minimum accepted object is:

```json
{
  "sgv": 108,
  "direction": "FortyFiveUp",
  "date": 1752960000000
}
```

An array of the same objects is also accepted. For a separate VPS migration,
provide 5–10 anonymised records plus:

- Whether the response is one object or an array.
- The response shape for empty, delayed, and unavailable data.
- Stable IDs, if the collector has them.
- Source metadata containing `lastUpdatedAt` and `dataThrough`.
- Confirmation that the desired glucose stale threshold is 12 minutes.

The normalised result is:

```json
{
  "id": "historical-xdrip:1752960000000:108",
  "timestamp": 1752960000000,
  "receivedAt": 1752960010000,
  "mmolL": 6.0,
  "trend": "slightUp",
  "quality": "measured",
  "sourceId": "historical-xdrip"
}
```

## Nightscout read-only glucose

T1 Arc can connect directly to a user-owned Nightscout site without a T1 Arc
server. The accepted configuration is:

```json
{
  "baseUrl": "https://your-nightscout.example",
  "accessToken": "reader-anonymised-token"
}
```

The token is optional for a publicly readable site. For a secured site, create
a Nightscout subject with the `readable` role and paste either the token or the
full `?token=...` link. Do not provide an API secret or an admin token.

T1 Arc makes an HTTPS read request shaped like:

```text
GET /api/v1/entries/sgv.json?count=96&token=<readable-token>
```

An initial connection may add a bounded `find[date][$gte]` value and request up
to 5,000 entries, covering up to 14 recent days. If the user chooses an
earliest-history date, subsequent requests add both `find[date][$gte]` and
`find[date][$lt]` and walk backwards through exact, continuous 14-day ranges:

```text
GET /api/v1/entries/sgv.json?count=5000&find[date][$gte]=<start>&find[date][$lt]=<end>&token=<readable-token>
```

The cursor is encrypted on the device, advances even when a range is empty,
and resumes opportunistically at most once every 15 minutes while Android
allows the app to run. A process-level single-flight guard prevents foreground
and background refreshes from importing the same block concurrently. This makes sparse
history continuous without repeatedly asking the user to trigger imports. A
representative response is:

```json
[
  {
    "_id": "anonymised",
    "sgv": 126,
    "direction": "FortyFiveUp",
    "date": 1785128100000,
    "dateString": "2026-07-27T04:55:00.000Z",
    "device": "anonymised"
  }
]
```

`sgv`, `direction`, and the millisecond `date` are sufficient. T1 Arc converts
the stored mg/dL SGV to mmol/L, retains the source and timestamp in its stable
normalised record, ignores malformed entries, and rejects a non-array response
or a response where every entry is unusable. No treatment, profile, food,
insulin, or write endpoint is called.

## Glooko history: on-device sync, fallback import, and exact input needed

T1 Arc's Android connector uses the same regional Glooko consumer login and
synchronous v3 CSV-export exchange proven by the local Hermes collector. The
connector is currently exposed only for single-patient UK consumer
accounts whose exports use UK local time (`Europe/London`) and day/month/year
dates. The EU endpoint and current ZIP metadata do not identify that locale
reliably, so setup requires an explicit user confirmation. The confirmation is
stored separately from the encrypted secret; legacy credentials fail closed
until it is supplied and can be confirmed without re-entering the password.
The raw email and password are opt-in and encrypted with a
non-exportable Android Keystore key; they are never returned to React Native,
logged, backed up or sent to a T1 Arc server. The bridge exposes only a masked
email, non-secret region label, and an installation-keyed HMAC of the
dynamically discovered account identity. The HMAC key is non-exportable; the
opaque fingerprint cannot be correlated across installations and the raw
`glooko_code` still never crosses the bridge. It binds imported data to the
account, so a password update or forget/reconnect can resume when the identity
matches while a different account is rejected before any database write.
**Forget saved Glooko sign-in** removes the credentials without removing
already normalised insulin or glucose history.

For every sync, the native connector starts with an empty in-memory cookie jar,
fetches a fresh Rails CSRF token, signs in over HTTPS, and discovers that
account's own `glooko_code` from an authenticated page. The identifier is never
hardcoded, persisted or returned across the native bridge. It is used once to
request an inclusive date range from the matching regional v3 CSV endpoint,
which returns the ZIP synchronously; T1 Arc no longer clicks or scrapes Glooko's
CSV export interface. A successful password save is only
`pending-verification`: automatic refresh is enabled only after a real ZIP is
validated, parsed and committed. A successful explicit recovery also re-enables
automation and re-registers Android background work; credential generations
only invalidate exports that were already in flight.

Transient network, timeout, rate-limit and server failures are retried up to
three times with bounded backoff. Authentication challenges, rejected
credentials, region mismatch, protocol drift, missing account identifiers and
invalid ZIPs remain separate privacy-safe outcomes. The compressed download is
capped at 50 MB, expanded ZIP data and entry count are bounded, and temporary
bytes use app-private cache before being erased. Hourly recent checks,
reconciliation windows and Android background execution remain best effort.
Retained source archives are committed to encrypted SQLCipher storage;
frequent snapshots are normalised without retaining redundant raw copies.
Overlapping exports are expected and stable record IDs prevent duplication;
identical whole exports are content-addressed by SHA-256.

Glooko's documented maximum is 90 days per CSV export, including a custom
range. T1 Arc therefore exposes a resumable historical backfill rather than
pretending one download can contain an entire account. Starting from the
earliest represented source date, each deliberate step requests the next older
non-overlapping 90 calendar days through the protected foreground connector.
The start cursor advances only after a genuine archive is captured and stored,
including for an empty period, while normalised records continue to deduplicate
by stable IDs.

An optional earliest-date target removes the repeated manual step. The silent
connector requests no more than one historical range per 24 hours, shortens
the final request to the exact target, and uses the same complete-archive
retention path. The schedule prioritises a due 30-day reconciliation and any
recent window older than four hours. Authentication failure marks the retained
session as needing sign-in and pauses both recent and historical automation.

The consumer v3 exchange is a private Glooko interface, not a claimed official
partner API. Glooko can change it, introduce MFA/CAPTCHA, or restrict an account
type. Multiple-patient accounts and accounts without the explicit UK export-
format confirmation also fail closed. This is user attestation, not automatic
locale detection; non-UK timestamps cannot be made safe from the current ZIP
metadata alone. Detectable month/day/year timestamps set an archive-level
safety failure: automatic sync writes none of the archive, even when another
recognised file contains otherwise valid UK-format rows.
Those cases pause automatic CSV work with an explicit reason; manual
Glooko ZIP/CSV selection remains a fallback only when the selected export
already follows the UK time/date contract, such as an authentication or
protocol failure. It is not a locale converter: non-UK timezone-free timestamps
remain unsafe until explicit timezone and date-locale selection is implemented.
A sanctioned Glooko partnership is still being pursued. Daily Overview PDF automation is paused; a PDF
can still be selected and processed locally. Diagnostics never include URLs, query
strings, filenames, credentials, cookies, CSRF tokens, account identifiers,
response bodies or health values.

The parser recognises Glooko-shaped CGM, basal, bolus, reported daily insulin
total, exercise, food, medication and note headers,
tab/comma/semicolon delimiters, quoted fields, naive London timestamps, ISO
timestamps, overlapping exports, and pump carbohydrate rows. CGM values in
mmol/L or mg/dL are normalised into a dedicated historical source with the
original filename, row number, timestamp and anonymisable device identifier.
Phone-derived Libre readings always win clear overlaps and remain the source
for the current-glucose surface; Glooko fills older history. Retained archives
are device-local and included in passphrase-encrypted `.t1arc` backups.
Reported daily totals remain aggregate verification records and are never
converted into bolus deliveries. The Data map compares the latest total for
each date with the detailed basal and bolus rows it can organise, with exact
source file and row provenance and no dosing interpretation. Multi-day
reconciliation uses only complete London dates represented on both sides. A
material mismatch becomes an evidence-linked Insights limitation and suppresses
the detailed-row insulin comparison for that report.

For this account's final compatibility check, import a normal Glooko ZIP in
T1 Arc first. If the preview reports an unrecognised file, provide only:

- The exact filename and header row of that CSV.
- Two or three anonymised data rows with names, account identifiers, serials,
  notes, and exact dates shifted or removed.
- Whether the displayed time is local UK time or includes an offset.
- The preview warning text and counts.

No password, browser session, cookies, full identifiable export, or screenshot
containing credentials should ever be sent to a developer.

For a broader fixture, provide either option A or B.

### Option A: anonymised Glooko v3 export

Provide one ZIP covering two or three ordinary days and preserve the original
filenames and unmodified header rows for:

- Basal delivery.
- Bolus delivery.
- CGM history.
- Daily insulin totals, if present.
- Export metadata or timezone information.
- At least one day crossing midnight. A UK daylight-saving transition is
  especially useful if available.

Names, email addresses, device serials, account IDs, and notes may be removed.
Times may be shifted by one consistent offset, but keep
intervals, ordering, decimal precision, column names, empty cells, event IDs,
and timezone offsets intact.

### Option B: normalised collector JSON

Basal interval:

```json
{
  "externalId": "redacted-basal-001",
  "kind": "basal",
  "deliveredAt": "2026-07-25T12:00:00+01:00",
  "endAt": "2026-07-25T12:30:00+01:00",
  "units": 0.3,
  "rateUnitsPerHour": 0.6
}
```

Bolus:

```json
{
  "externalId": "redacted-bolus-001",
  "kind": "bolus",
  "deliveredAt": "2026-07-25T12:47:00+01:00",
  "units": 4.2
}
```

Snapshot metadata:

```json
{
  "sourceId": "glooko-export",
  "importedAt": "2026-07-25T07:15:00+01:00",
  "dataThrough": "2026-07-25T06:50:00+01:00",
  "timeZone": "Europe/London",
  "isLive": false
}
```

All timestamps must be ISO 8601 with `Z` or an explicit offset. `dataThrough`
means the newest pump record in the export, not the download time.

## Preferred private collector API

If the existing VPS remains the historical source of truth, the smallest useful
read-only API is:

```text
GET /v1/glucose?from=<ISO-8601>&to=<ISO-8601>
GET /v1/insulin?from=<ISO-8601>&to=<ISO-8601>
GET /v1/sources
```

Responses should contain stable external IDs, normalised records, and:

```json
{
  "sourceId": "glooko-export",
  "lastAttemptAt": "2026-07-25T07:15:00+01:00",
  "lastSuccessAt": "2026-07-25T07:15:03+01:00",
  "dataThrough": "2026-07-25T06:50:00+01:00",
  "recordCount": 8421,
  "isLive": false
}
```

The API should be reachable only over the private network and should never
return account credentials or browser cookies.

## Health Connect boundary

The Android bridge currently supports:

- Steps
- Distance
- Active calories
- Workouts
- Heart rate and resting heart rate
- Sleep
- Weight

The in-app setup chooses categories, requests the matching permissions, and
opens Android's source/settings surface when source-app consent must be
changed. T1 Arc discovers actual data origins from record metadata and can
filter each category to a preferred package. It cannot grant Samsung Health,
Google Fit, or another app permission to write into Health Connect on the
user's behalf; Android deliberately keeps that consent under user control.

For a source compatibility problem, provide the source app package name,
category, T1 Arc's non-secret status/error text, and a description of the
expected time range. Do not provide a Health Connect database dump.

## Food data boundary

The offline baseline is the UK Composition of Foods Integrated Dataset 2021.
For a packaged product, T1 Arc calls Open Food Facts by barcode and caches the
normalized product locally. A saved food log contains immutable item snapshots,
quantities, nutrition, provider, source label, barcode and source URL.

For an unrecognized product, the smallest useful test input is:

- Barcode
- Product name and brand
- Nutrition per 100 g or 100 ml
- Whether the package reports serving size
- The non-secret lookup error shown by T1 Arc

No food diary or account login is required.

## Portable backup boundary

A `.t1arc` backup is a versioned logical export of normalised records,
retained original Glooko exports, raw notification-source evidence and saved
deterministic reviews. The file is gzip-compressed and encrypted with
AES-256-GCM. Its passphrase key is derived using PBKDF2-HMAC-SHA256 with a
random 16-byte salt and 600,000 iterations; the header is authenticated as
additional data. Restore validates the table schema and counts, then inserts
missing records in one transaction. It never deletes or replaces newer local
records. Version 5 introduced bounded binary frames so retained source archives and
large record sets are validated and merged incrementally instead of being
materialised as one JavaScript string.

Version 7 also preserves each food's last personally used portion without
changing its labelled serving. Version 8 adds Glooko-reported daily insulin
totals as provenance-rich verification records, kept separate from individual
deliveries. Version 9 preserves meals pinned for one-tap repeat. Version 10
adds saved recipes and their ingredient snapshots. Versions 1–9 remain
readable, and the picker continues to accept legacy `.daymark` files.

Backups explicitly exclude:

- LibreLinkUp email, password, tickets and tokens
- Glooko email, password, native session material, WebView cookies and site storage
- SQLCipher database keys
- device-specific background execution diagnostics
- Health Connect change tokens, which must be reissued for the destination
  Android data store

Backup creation checks the live migrated database schema before writing. Every
application table and column must be either portable or explicitly classified
as device-bound, so adding a future health field cannot silently produce an
incomplete successful-looking backup.

There is intentionally no T1 Arc recovery service. Losing the backup
passphrase makes that file unrecoverable.

## Context contracts

Manual entries and the synthetic context layer establish these minimum
normalised shapes. A future external provider should use stable IDs, source
provenance, and explicit timestamps.

```json
{
  "id": "meal-001",
  "kind": "meal",
  "timestamp": "2026-07-25T19:10:00+01:00",
  "carbohydrateGrams": 62,
  "sourceId": "future-food-source"
}
```

```json
{
  "id": "activity-001",
  "kind": "activity",
  "timestamp": "2026-07-25T17:30:00+01:00",
  "durationMinutes": 32,
  "activityType": "walk",
  "sourceId": "future-health-source"
}
```

```json
{
  "id": "sleep-001",
  "kind": "sleep",
  "startAt": "2026-07-24T23:40:00+01:00",
  "endAt": "2026-07-25T06:45:00+01:00",
  "sourceId": "future-health-source"
}
```

Version 1.3.6 stores manual context locally, writes food logs with nutrient
snapshots, and imports supported context from Health Connect.

## Evidence invariants

- Every displayed statistic is reproducible from normalised records.
- Every insight finding carries source record IDs and its exact comparison
  range.
- Every evidence block can resolve and open the complete normalised record set;
  missing referenced IDs are shown as an incomplete-evidence warning.
- A glucose conclusion is withheld when either selected comparison window has under 70%
  coverage or fewer than 100 readings.
- Missing intervals remain gaps and reduce coverage.
- Context is described as an association to inspect, not a cause.
- Glooko insulin always remains delayed/not live.
- No component recommends insulin doses or pump-setting changes.

## Acceptance checks for personal data

- Re-importing a glucose or insulin period creates no duplicates.
- London calendar days remain correct across BST/GMT changes.
- A missing glucose interval appears as a gap and reduces coverage.
- Glucose becomes stale after 12 minutes.
- Temporary refresh failure keeps encrypted history visible with an error.
- Basal plus bolus reconciles with Glooko's daily total within known export
  rounding.
- The Records screen can trace chart points and calculations to normalised
  source records.
- Updating the APK preserves the saved LibreLinkUp connection and history.
- Creating and restoring an encrypted backup reproduces the same record counts,
  and restoring it twice creates no duplicates.
