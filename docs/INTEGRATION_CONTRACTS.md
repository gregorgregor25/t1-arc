# Real-data integration handoff

No live credentials or real health records belong in this repository. Never
commit or send LibreLinkUp or Glooko passwords, auth tokens, session cookies,
Tailscale keys, device serials, or identifiable exports.

## Independent source boundaries

Daymark keeps each input independent:

1. **Current and historical glucose:** Daymark's direct LibreLinkUp connector
   reads the accepted follower connection and writes normalised readings to an
   encrypted local database. It has no GDH runtime dependency.
2. **Insulin:** the UK Omnipod 5 PDM reaches Glooko through its own delayed
   cloud route. Version 1.3.6 can request an export through a local Glooko
   WebView session or read a manually selected ZIP/CSV fallback. This source is
   always labelled delayed and never presented as live pump state. Automated
   capture accepts only a genuine ZIP signature; intermediate export responses
   remain in the secure window while Daymark waits for the archive. A
   privacy-safe stage/timing trace is stored on-device for the last attempt.
   The exact captured export is retained in SQLCipher. Bounded extraction keeps
   oversized or not-yet-supported files compressed while supported records are
   normalised, so one large file cannot reject the whole export.
3. **Food:** CoFID search is bundled and offline. Barcode lookup uses Open Food
   Facts and transmits only the barcode. Each saved item keeps a nutrient and
   provenance snapshot so later catalog changes cannot rewrite history.
4. **Phone and wearable context:** Health Connect is the Android aggregation
   boundary. Daymark stores normalized records with their originating package,
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

Daymark retains both `FactoryTimestamp` and `Timestamp` from Libre where they
are present. Factory UTC time is authoritative for the record; a material
factory/local disagreement is exposed as a source warning rather than hidden.

If a future response reports `unsupported-api`, provide only Daymark's
non-secret error code and message. Do not copy request headers, bearer tokens,
encrypted payloads, or passwords. Daymark will not accept legal terms
automatically or attempt to bypass a newer encrypted interface.

## Optional glucose migration

The old xDrip response adapter remains available as an import/migration
boundary, not a runtime dependency. For a VPS import, provide 5–10 anonymised
records in this minimum shape:

```json
{
  "sgv": 108,
  "direction": "FortyFiveUp",
  "date": 1752960000000
}
```

Also provide:

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

## Glooko insulin: foreground sync, fallback import, and exact input needed

Daymark opens Glooko's own HTTPS sign-in page inside a screenshot-protected,
domain-restricted Android WebView. The native connector does not receive or
store the password. Glooko's WebView cookies and site storage stay local to the
app so subsequent syncs can reuse the session; **Forget saved Glooko sign-in**
clears them without removing normalized insulin.

After sign-in, Daymark attempts Glooko's normal Export to CSV flow for an
overlapping 30-day window. It handles normal attachments, octet-stream
responses, generated browser blobs, links and secondary download windows. The
compressed download is capped at 50 MB and must use HTTPS. Glooko cookies are
sent only to Glooko domains; a separate signed file host never receives them.
The transient cache file is deleted after the exact source bytes are committed
to encrypted SQLCipher storage. Supported records are normalised separately.
Overlapping exports are expected and stable record IDs prevent duplication;
identical whole exports are content-addressed by SHA-256.

This is a foreground convenience bridge, not a claimed official API or
guaranteed killed-app background sync. Glooko can change the page at any time.
When automation cannot locate the export control, the protected page remains
interactive and manual ZIP/CSV selection remains available as a fallback. If
the user returns without a captured file, the Sources card shows a selectable,
privacy-safe event trace containing stages only—never URLs, filenames,
credentials, cookies, account identifiers, or response bodies.

The parser already recognises the public Glooko-shaped basal and bolus headers
listed below, tab/comma/semicolon delimiters, quoted fields, naive London
timestamps, ISO timestamps, overlapping exports, and pump carbohydrate rows.
Glooko CGM/BG files are retained in the source archive but are not currently
normalised, so direct Libre glucose remains the independent displayed source.
Retained archives are device-local in this version and are not yet included in
portable `.daymark` backups.

For this account's final compatibility check, import a normal Glooko ZIP in
Daymark first. If the preview reports an unrecognised file, provide only:

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
changed. Daymark discovers actual data origins from record metadata and can
filter each category to a preferred package. It cannot grant Samsung Health,
Google Fit, or another app permission to write into Health Connect on the
user's behalf; Android deliberately keeps that consent under user control.

For a source compatibility problem, provide the source app package name,
category, Daymark's non-secret status/error text, and a description of the
expected time range. Do not provide a Health Connect database dump.

## Food data boundary

The offline baseline is the UK Composition of Foods Integrated Dataset 2021.
For a packaged product, Daymark calls Open Food Facts by barcode and caches the
normalized product locally. A saved food log contains immutable item snapshots,
quantities, nutrition, provider, source label, barcode and source URL.

For an unrecognized product, the smallest useful test input is:

- Barcode
- Product name and brand
- Nutrition per 100 g or 100 ml
- Whether the package reports serving size
- The non-secret lookup error shown by Daymark

No food diary or account login is required.

## Portable backup boundary

A `.daymark` backup is a versioned logical export of normalized records. The
file is gzip-compressed and encrypted with AES-256-GCM. Its passphrase key is
derived using PBKDF2-HMAC-SHA256 with a random 16-byte salt and 600,000
iterations; the header is authenticated as additional data. Restore validates
the table schema and counts, then inserts missing records in one transaction.
It never deletes or replaces newer local records.

Backups explicitly exclude:

- LibreLinkUp email, password, tickets and tokens
- Glooko WebView cookies and site storage
- SQLCipher database keys

There is intentionally no Daymark recovery service. Losing the backup
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
- A glucose conclusion is withheld when either seven-day window has under 70%
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
