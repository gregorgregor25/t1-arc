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
2. **Insulin:** an Omnipod 5 PDM can reach Glooko through its own delayed cloud
   route. T1 Arc can request a synchronous v3 ZIP through its native regional
   consumer connector or read a manually selected ZIP/CSV fallback. EU and US
   service hosts are explicit; the account timezone and numeric date order are
   selected separately and validated before records are committed. The UK/EU
   path remains the field-tested baseline, while the US route is experimental
   and has not been validated with a production US account.
   This source is always labelled delayed and never presented as live pump
   state. A privacy-safe outcome category is stored on-device for the last
   attempt.
   The exact captured export is retained in SQLCipher. Bounded extraction keeps
   oversized or not-yet-supported files compressed while supported records are
   normalised, so one large file cannot reject the whole export.
3. **Food:** regional reference search is bundled and offline: GB uses CoFID
   2021, the US uses the curated FoodData Central Foundation/FNDDS catalogue,
   Japan uses MEXT 2023, Canada uses CNF 2026, France uses Ciqual 2025 and Germany
   uses BLS 4.0. The larger US branded catalogue is an optional local index.
   Only local search runs while typing. Explicit online branded search and
   barcode lookup can send the query or barcode, plus country/language context,
   directly to Open Food Facts. After an Open Food Facts barcode miss, the US
   profile can use the low-rate public USDA exact-GTIN fallback; normal US text
   search does not consume USDA API quota. Android label capture reads a photo
   locally into a reviewable form and never saves a food automatically.
   Each saved item keeps a nutrient and provenance snapshot so later catalogue
   changes cannot rewrite history.
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

The token is optional for a publicly readable site. For a secured site, prefer
a Nightscout subject with the `readable` role and paste either its token or the
full `?token=...` link. Legacy sites may instead use the optional API-secret
field: T1 Arc keeps it in Android secure storage and sends only Nightscout's
SHA-1 `api-secret` header on read requests. Do not use an admin token, and do
not grant T1 Arc write access.

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

T1 Arc's Android connector uses a regional Glooko consumer login and synchronous
v3 CSV-export exchange. It has explicit EU and US consumer-host routes for
single-patient accounts. Setup records the selected service region and requires
separate confirmation of the account's IANA timezone and numeric date order,
because the current ZIP metadata does not identify that context reliably. The
EU route with `Europe/London` and day/month/year dates is the field-tested
regression baseline. The US route with month/day/year handling is implemented
and selectable, but remains an experimental, contract-tested route pending
production-account validation. The confirmation is
stored with the current vault state; automatic work fails closed until it is
supplied. Imported Glooko rows without a current account fingerprint require an
explicit same-person confirmation before a new connection can bind them.
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
type. Multiple-patient accounts and accounts without explicit regional export-
format confirmation fail closed. This is user attestation, not automatic locale
detection. The parser applies the selected timezone and day-first or month-first
date order; a conflicting numeric date order, skipped local time, or unresolved
repeated hour sets an archive-level safety failure, so automatic sync writes
none of the archive even when a sibling file would otherwise parse.
Those cases pause automatic CSV work with an explicit reason. Manual Glooko
ZIP/CSV selection remains a fallback only when the export follows the selected
regional time/date contract, such as after an authentication or protocol
failure. It is not a locale converter and does not guess missing context.
A sanctioned Glooko partnership is still being pursued. Glooko's documented
PDF endpoint is a clinical/EHR integration rather than a personal-account API.
The Android implementation reuses the fresh in-memory consumer session
established from the encrypted saved sign-in and mirrors Glooko's current web
report flow: authenticated v3 session-user discovery, Glooko's
`endDateReport`, the same-origin `/pdf_loading` canonicalisation page, and
`/api/v3/pdf/download`. The request asks for a rolling one-week colour Daily
Overview with events. Only the current session display-user identifier is
accepted; it must be exactly bound to the authenticated account, and a missing
or ambiguous identity fails closed. Before the PDF can be committed, its credential
generation and installation-keyed account HMAC must still match the verified
CSV connection. These routes are unsupported, can change without notice, and
no patient identity is hardcoded, persisted, or exposed to JavaScript.

Android Share/Open-with and a persisted user-approved folder remain the report
inbox fallback. Direct refresh is attempted after the Glooko source advances or
periodically, with a six-hour minimum interval; the fallback inbox is used when
the direct route cannot supply a report. Only a validated one-week Daily
Overview is indexed, identical files dedupe by SHA-256, and failed or partial
files never replace retained evidence.
Diagnostics never include URLs, query strings, filenames, credentials,
cookies, CSRF tokens, account identifiers, response bodies or health values.

The parser recognises Glooko-shaped CGM, basal, bolus, reported daily insulin
total, exercise, food, medication and note headers,
tab/comma/semicolon delimiters, quoted fields, region-configured naive local
timestamps, ISO timestamps, overlapping exports, and pump carbohydrate rows.
CGM values in
mmol/L or mg/dL are normalised into a dedicated historical source with the
original filename, row number, timestamp and anonymisable device identifier.
Phone-derived Libre readings always win clear overlaps and remain the source
for the current-glucose surface; Glooko fills older history. Retained archives
remain device-local and are excluded from `.t1arc` backups; the parsed/indexed
rows and their source provenance are portable.
Reported daily totals remain aggregate verification records and are never
converted into bolus deliveries. The Data map compares the latest total for
each date with the detailed basal and bolus rows it can organise, with exact
source file and row provenance and no dosing interpretation. Multi-day
reconciliation uses only complete dates in the selected analysis timezone that
are represented on both sides. A
material mismatch becomes an evidence-linked Insights limitation and suppresses
the detailed-row insulin comparison for that report.

For an account's compatibility check, import a normal Glooko ZIP in
T1 Arc first. If the preview reports an unrecognised file, provide only:

- The exact filename and header row of that CSV.
- Two or three anonymised data rows with names, account identifiers, serials,
  notes, and exact dates shifted or removed.
- The account service region, selected IANA timezone and numeric date order,
  and whether displayed timestamps include an offset.
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

The Android bridge currently exposes 13 permission categories and keeps the
underlying record kind and source package inspectable:

- Steps.
- Distance, elevation gained and floors climbed.
- Active and total calories.
- Workouts, including session segments/laps, power, speed, walking cadence and
  cycling cadence when the source supplies them.
- Heart rate and resting heart rate.
- Sleep sessions and stages.
- Weight.
- Body composition: body fat, lean/body-water/bone mass, height and basal
  metabolic rate.
- Blood glucose.
- Vitals: blood pressure, oxygen saturation, respiratory rate, heart-rate
  variability (RMSSD), VO2 max and body temperature.
- Cycle data: menstruation period/flow, ovulation tests, basal body
  temperature, cervical mucus and intermenstrual bleeding.
- Hydration.
- Nutrition, including energy and available macro/micronutrient fields.

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

This section describes the current source contract. The new country packs,
optional US branded index and label camera are not a claim about an already
published APK; use its release notes to identify included features.

The selected country chooses the offline reference catalogue: GB CoFID 2021,
5,742 US FoodData Central Foundation/FNDDS foods, 2,538 Japan MEXT 2023 foods,
5,993 Canada CNF 2026 foods, 3,483 France Ciqual 2025 foods or 7,140 Germany BLS
4.0 foods. The Canadian, French and German indexes are prepared from bundled
assets on first use. Other profiles retain saved/user-created foods and online
branded-product search. No Finnish index is included.

The optional US branded snapshot contains 409,329 foods from 30 April 2026.
Its compressed APK asset is 40,804,016 bytes; enabling its local index needs
150,691,840 bytes plus temporary preparation space. Preparation verifies the
file against its manifest before activation. Disabling or removing this public
catalogue does not delete personal foods, recipes or historical meal snapshots.
Neither reference search nor the enabled branded index needs a paid API,
account or user-supplied key.

Normal typeahead stays local. Explicit online search sends typed text and
country/language context to Open Food Facts, whose server also sees the phone's
network address. Barcode lookup checks saved products and the enabled US
branded index before Open Food Facts. After an Open Food Facts miss, the US
profile can try the low-rate public USDA exact-GTIN fallback; normal US text
search does not depend on that API. Successful complete barcode results are
cached independently of meal saving, with source freshness and regional
context. They do not increment use counts, create health records or overwrite
personal label corrections. Recognised but incomplete products open a label
form instead of silently treating missing carbohydrate as zero.

Saved foods, recipes and meals have independent searchable pages. A personal
portion definition is separate from the last logged quantity and source
serving. Recipe ingredients describe the batch; adding a recipe scales the
chosen number of servings. Mass and volume are not interchanged without a
source conversion. Missing nutrients remain distinct from reported zero, and
known carbohydrate definitions are retained without inventing net-carbohydrate
adjustments. A saved food log contains immutable item snapshots, quantities,
nutrition, provider, source label, barcode and source URL. Catalogue refreshes
and personal-food edits do not rewrite those historical nutrition values.
USDA branded nutrients retain the source's 100 g or 100 ml basis, with a
separate exact source-labelled serving where available. Reference-food values
remain per 100 g. Contradictory repeated values for the same nutrient stay
unknown, including conflicting energy values; alternate energy definitions
are not substituted to hide a conflict. Products with missing or conflicting
carbohydrate need manual completion. Unsupported source basis units are not
converted using an assumed density.

Android nutrition-label capture uses a bundled Latin text-recognition model,
including offline first use. Its English-focused parser proposes values only
when the table basis is identifiable; ambiguous or missing values need manual
review. The photo and recognised text are not sent to a cloud OCR service.
Temporary camera and recognition copies are removed on success, cancellation
or failure, with OS cache cleanup as the fallback if deletion fails. The user
reviews the form and saves explicitly. Manual label entry remains available.
Local image/text processing does not mean the SDK makes no network requests:
Google documents ML Kit performance/usage telemetry and maintenance contacts.
The bundled SDK's diagnostics are disclosed separately in
[the privacy model](../PRIVACY.md#network-flows-chosen-by-the-user), following
[Google's ML Kit terms](https://developers.google.com/ml-kit/terms).

For an unrecognized product, the smallest useful test input is:

- Barcode
- Product name and brand
- Nutrition per 100 g or 100 ml
- Whether the package reports serving size
- The non-secret lookup error shown by T1 Arc

No food diary or account login is required.

## Portable backup boundary

A `.t1arc` backup is a versioned logical export of normalised records,
parsed/indexed source evidence, raw notification-source evidence and saved
deterministic reviews. Replaceable original import/download payloads, including
Glooko ZIP and PDF files, remain device-local and are deliberately excluded.
The file is gzip-compressed and encrypted with
AES-256-GCM. Its passphrase key is derived using PBKDF2-HMAC-SHA256 with a
random 16-byte salt and 600,000 iterations; the header is authenticated as
additional data. Restore validates the table schema and counts, then inserts
missing records in one transaction. It never deletes or replaces newer local
records. Version 5 introduced bounded frames so large record sets (and binary
payloads present in older backup versions) are validated and merged
incrementally instead of being materialised as one JavaScript string.

Version 7 also preserves each food's last personally used portion without
changing its labelled serving. Version 8 adds Glooko-reported daily insulin
totals as provenance-rich verification records, kept separate from individual
deliveries. Version 9 preserves meals pinned for one-tap repeat. Version 10
adds saved recipes and their ingredient snapshots. Version 11 adds indexed raw
import rows plus richer insulin and meal provenance. Version 12 adds explicit
Health Connect source-selection state and compatibility for retained Glooko
report payloads from that older format. Version 13 adds Hevy workout records;
version 14 adds portable Tarv1s conversation state; version 15 adds fibre,
sugars and saturated-fat meal context without inventing those values while
upgrading older rows; and the current version 16 adds canonical mmol/L values
for imported meter-check context so display units can change safely. Versions
1–15 remain readable through the same `.t1arc` picker.

Backups explicitly exclude:

- LibreLinkUp email, password, tickets and tokens
- Glooko email, password, native session material, WebView cookies and site storage
- replaceable original import/download payloads, including Glooko ZIP and PDF files
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

The current app stores manual context locally, writes food logs with nutrient
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
- Calendar days remain correct in the selected IANA timezone, including London
  and New York DST changes, Tokyo, and half-hour-offset zones.
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
