# Offline country food packs

T1 Arc includes public food-composition catalogues for Canada, France and Germany.
The appropriate small SQLite pack prepares automatically on its first country
search. The existing UK, US reference and Japanese catalogues remain available.
An optional USDA US branded snapshot is compressed in the app and expands only
when the user enables it. No API key, provider account or paid lookup service is
required. No pack download URL or external publication is implied.

This guide describes the current source, including unreleased navigation
changes; check your installed APK's release notes for availability.

| Pack | Source records | Usable foods | Installed bytes | Compressed bytes |
| --- | ---: | ---: | ---: | ---: |
| CNF 2026, Canada | 5,993 | 5,993 | 2,506,752 | 648,588 |
| Ciqual 2025, France | 3,484 | 3,483 | 1,183,744 | 263,508 |
| BLS 4.0, Germany | 7,140 | 7,140 | 2,387,968 | 676,725 |
| USDA branded April 2026, US | 436,444 eligible market/barcode rows | 409,329 | 150,691,840 | 40,804,016 |

The first three gzip sizes are build measurements; their native `.db` files are
bundled directly. The US `.db.gz` asset adds approximately 40.8 MB before APK
packaging effects. Its installed database needs approximately 150.7 MB (143.7 MiB),
plus temporary compressed staging space during installation. This is an explicit
size tradeoff; it is not an estimate of the whole APK or JavaScript memory.

Rows with no supported numeric nutrients are omitted (France 1, Germany 0).
Numeric zero is retained, including spreadsheet zeros; trace/empty cells are not
converted to zero. US branded rejects 7,552 eligible rows, including 5,968 with
an unsupported or ambiguous source basis unit and the remainder with no supported
numeric nutrients. For the US pack, 19,563 duplicate barcode revisions are
resolved by normalized publication date and then numeric FDC identifier among
eligible rows. USDA dates are parsed from month/day/year before sorting.
Incomplete individual nutrients remain unknown. Contradictory repeated values
for the same USDA nutrient ID remain unknown; identical duplicates collapse and
distinct energy IDs are not treated as duplicates. There are 269 conflicting
source records before filtering/deduplication and 37 retained foods with at least
one conflict. A conflict note accompanies those foods; missing carbohydrate
requires manual entry. The actual all-conflicting Cheerios FDC 2517161 record is
omitted, while consistent FDC 2738631 retains 75 g carbohydrate per 100 g and its
28 g source serving. The original barcode snapshot
date remains visible through source attribution; formulations can change.

## Storage and installation

Files live under the dedicated `food-catalogues-v1` app document directory. A
separate `catalogue-registry.db` stores the active pointer. The health database,
meal snapshots and personal food library are not imported, modified or replaced.
Food names and aliases use an FTS5 index; barcode lookups use a dedicated index.
Queries are bound parameters with a bounded result count, not JavaScript scans.
BLS bread aliases are narrowly derived from original names: B-coded source foods
with a German word ending in `Brot` or standalone English `bread` receive those
two search aliases. This covers 115 foods, including compound bread names, without
aliasing breadfruit or spreads as bread.

The compiled manifest contains source archive SHA-256, transformed database
SHA-256, ordered 1 MiB verification hashes, schema/version, counts, nutrient
definitions, licence and attribution. Optional compressed data is checked before
streaming inflation; the decoded database is checked again. Inflation reads
16 KiB at a time. Database integrity, expected schema, metadata, row count and
nutrient ranges are checked before activation. Publication of the new active
pointer is one atomic SQLite statement. An interrupted/failed update retains the
previous working database unless it is a superseded unsafe data revision. US
revision 2 upgrades an already-enabled older snapshot before lookup; failed
replacement validation cannot fall back to revision 1. Explicitly disabled
optional packs remain disabled. A cancelled first install publishes no active pack.

Startup and per-pack retry recovery remove only exact generated staging/orphan
filenames, preserving every registry-referenced database and live install. This
recovers temporary space after process death without touching other user files.
Connections are isolated; Expo's raw-statement sweep on close is disabled because
FTS owns internal statements, while application query statements are finalized by
their normal SQLite helpers.

Catalogue reads use `query_only` and disable trusted schema. Only manifests
compiled into the app are accepted. The local-file installation interface accepts
only file/content URIs and requires exactly the trusted bytes; it is not a general
SQLite import feature. No app-provided URL is invented for a future release.

The public runtime API is in `src/data/food/countryPacks.ts`:

- `searchCountryPackFoods(query, { countryCode, locale, limit, signal })`
- `lookupCountryPackBarcode(barcode, { countryCode, locale, signal })`
- `getCountryFoodPackStatuses()` returns an asynchronous status snapshot.
- `subscribeCountryFoodPackStatus(listener)` emits on progress/state changes.
- `installCountryFoodPack(id, { signal })` / `removeCountryFoodPack(id)`
- `getCountryFoodPackRevision()` changes after activation/removal.

For a US profile, open **More options** on the meal page, choose **Offline food
catalogue**, then **Add offline catalogue**. The catalogue controls have their
own page; they are not expanded inside the meal form. **Back to food options**,
then **Back to meal**, returns to the same meal draft. Normal local search does
not wait for an online response and does not require enabling this extra pack.
Country source selection and API credentials are not onboarding tasks. Removing
a pack disables lookup and deletes only its own files. Personal foods and
previously logged meals remain.

## Source definitions and licensing

CNF carbohydrate is total carbohydrate by difference, including fibre. Ciqual
and BLS carbohydrate is available carbohydrate; BLS CHO includes polyols. USDA
branded carbohydrate is label total carbohydrate. These meanings are recorded
on candidates; changing country never silently subtracts fibre. Trace and
below-quantification cells remain non-numeric instead of invented zero values.
The generic packs use a 100 g basis. USDA branded nutrients use the documented
100 source-unit basis: `g`/`GRM` normalize to g and `ml`/`MLT` normalize to ml;
unsupported units are excluded. Portions and household labels become defaults
only when their units match the nutrient basis. Density is never inferred.
Validation caps gram nutrients at 100.1 per 100 g and conservatively at 200 per
100 ml; the mass cap is not treated as proof of a volume-to-mass relationship.
Energy is capped at 1,100 kcal per basis. Values outside these bounds stay unknown.
Dated snapshot versions retain their source date for cache
freshness; installing the April 2026 US snapshot does not make it a new observation.

See [third-party notices](../THIRD_PARTY_NOTICES.md) and each generated manifest.
Canada uses Open Government Licence – Canada, France Etalab Open Licence 2.0,
Germany CC BY 4.0, and USDA CC0 1.0. The processed packs are not endorsed by the
publishers. Finland is not included: the official bulk endpoint refused the
build download with HTTP 403. No replacement data or fictitious pack is shipped.

## Rebuild and verification

Run from the repository root, using Python with `openpyxl`:

```sh
python scripts/build_country_food_packs.py
python scripts/build_country_food_packs.py --usda-branded --only usda-branded
npx vitest run tests/country-food-packs.test.ts tests/country-pack-usda-source.test.ts tests/country-pack-recovery-concurrency.test.ts tests/unified-food-search.test.ts
```

Original archives are cached under `.qa/country-food-sources`. Generated small
assets go to `assets/food-packs`; the large uncompressed US database and its
release measurements stay in `.qa/country-food-release-assets`, while the
compressed US asset is bundled. The importer streams the multi-gigabyte USDA
JSON source. Builds do not upload artifacts, commit files, use personal data, or
contact paid APIs. For the same source version it rejects changed upstream
bytes unless the developer explicitly passes `--accept-source-change` after
review. Retain the build toolchain for byte-identical SQLite output; measured
builds used SQLite 3.53.1. Different SQLite versions may serialize equivalent
content differently and must regenerate the manifest/checksums together.

Actual-artifact tests verify all small-pack rows, indexed searches, original CNF
numbers, bilingual rank evidence, barcode indexes, corruption/truncation,
cancelled/failed activation and complete streaming expansion of the US asset.
The desktop benchmark measured warm US text queries at approximately 35 ms median
and 91 ms p95. Those are desktop SQLite figures, not Android performance or
memory measurements. Recheck real device installation and search before release.
