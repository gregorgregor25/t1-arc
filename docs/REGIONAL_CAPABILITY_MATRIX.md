# T1 Arc regional capability matrix

Reviewed: 17 September 2026.

This is the authoritative status of the multi-region implementation. “Complete”
means the behaviour is implemented and covered by local automated evidence.
It does not mean that an external provider, national dataset, translation, or
clinical pack has been approved in every country.

"Reviewed" NICE content means curated, source-linked items with recorded review
dates. It does not establish independent clinical certification of the app or
its answers. Country-specific qualified review must be evidenced separately.

Verification below separates implementation, real-account and physical-device
evidence. Provider behaviour can change independently of an app release.

## Plain-language map

There is one T1 Arc app and one behaviour path. The maintainer's copy does not
receive a private provider, food, or Tarv1s route that public users lack.

The food expansion below describes current source changes, not a claim that
an existing GitHub APK already includes them. Check the exact APK's release
notes. Review the label values before saving; recognition is not always accurate.

| Feature | United Kingdom | United States | Japan | Other regions |
| --- | --- | --- | --- | --- |
| Glucose, measurements, dates and timezones | Regional display; canonical records | Regional display; canonical records | Regional display; canonical records | Regional display when the selected locale is supported |
| Reference-food search while typing | Bundled CoFID; offline | Bundled 5,742-food USDA Foundation/FNDDS catalogue; offline | Bundled 2,538-food MEXT catalogue; offline | Canada: 5,993 CNF foods; France: 3,483 Ciqual foods; Germany: 7,140 BLS foods; saved and user-created foods elsewhere |
| Packaged-food search | Open Food Facts after Search is pressed | Optional 409,329-food offline USDA branded catalogue; Open Food Facts after Search is pressed | Open Food Facts after Search is pressed | Open Food Facts after Search is pressed |
| Barcode scan | Saved products, then Open Food Facts | Saved products and enabled offline USDA branded catalogue, then Open Food Facts; low-rate USDA public exact-GTIN fallback after a miss | Saved products, then Open Food Facts | Saved products, then Open Food Facts |
| Commercial glucose providers | Implemented routes; UK is the regression baseline | Implemented routes; field reports still welcome | Implemented where the provider offers Japan/international service | Only explicitly supported provider regions are selectable |
| Tarv1s | Same direct BYOK flow for every build | Same direct BYOK flow for every build | Same direct BYOK flow for every build | Same direct BYOK flow for every build |
| Clinical guidance | Reviewed GB/NICE pack plus general safety | General safety; no claimed reviewed US pack | General safety; no claimed reviewed Japan pack | General safety unless a reviewed pack exists |
| Interface language | English | English with US formats | English with Japanese formats and food names | English with selected locale formatting |

“Offline” means the lookup needs neither a service account nor an API quota.
Open Food Facts calls are made directly by each phone and are rate-limited by
the caller's network/public IP. People behind the same carrier or Wi-Fi NAT may
therefore share an allowance. The USDA `DEMO_KEY` is not used for normal US
text search.

The Canadian Nutrient File 2026, Ciqual 2025 and BLS 4.0 catalogues are bundled
and prepared locally on first use for their country. The optional US branded
snapshot is dated 30 April 2026: 409,329 foods, 150,691,840 bytes installed and
40,804,016 bytes compressed in the APK. Users enable it under **More options >
Offline food catalogue**; removing it does not remove saved foods or meals. No Finnish
catalogue is included. Counts and source editions are recorded in the
[catalogue manifest](../src/data/food/country-packs.manifest.json).

## Implementation and verification

| Area | Current capability | Verification boundary |
| --- | --- | --- |
| Regional display | Country, locale, IANA timezone, glucose/measurement units and provider region are separate preferences | Automated conversion, calendar and DST tests; English interface |
| Storage and restore | Canonical values, source provenance, encrypted additive restore; current backup format 21 | Older formats remain readable; credentials and permissions are not portable; see [backup contracts](INTEGRATION_CONTRACTS.md#portable-backup-boundary) |
| LibreLinkUp | Direct follower connection, regional redirects and secure sessions | Real UK account on Pixel; other accounts/regions not equivalently checked |
| Glooko | EU/US consumer export retrieval, manual files and delayed history | Real EU account; US route experimental; undocumented consumer interface can change |
| Dexcom | Share US, International and Japan routes; separate Clarity CSV history | Contract-tested; no real-account verification claimed |
| Medtrum | Explicit EU/France follower region and source units | Contract-tested; no real-account verification claimed |
| Nightscout | Read-only glucose and bounded historical retrieval | Real Nightscout 15.0.8 server with synthetic data; no live CGM uploader verification |
| xDrip | Same-phone HTTP or remote HTTPS SGV endpoint | Real xDrip 20260301 app with synthetic readings on Android; no physical sensor/Bluetooth verification |
| Hevy | Read-only workouts, changes and reconciled Health Connect activity | Real-account connection and workout import checked |
| Health Connect | User-selected categories and origins, history/background permissions | Physical Pixel imports and automated contracts; source apps control what they write |
| Notification capture | Supported publishers/custom rules, explicit units and provenance | Parser/Android checks; not every publisher/version verified |
| Food | Offline reference packs, optional US branded pack, online products, barcode cache, manual foods/recipes/photos | Catalogues and parsing tested; user reviewed camera/barcode results; coverage and OCR accuracy are not guaranteed |
| Tarv1s | Local factual answers and optional direct OpenAI requests, same route for every user | Evidence/safety/transport tests and device use; no clinical certification |
| Phone displays | Notification, widget, optional AOD and alerts | Pixel checks; manufacturer power/privacy restrictions vary |
| Wear OS | Companion, tile, complications and five faces | Galaxy Watch 8 guided setup/update and glucose after debugging off; emulator face checks; older/other physical watches unverified |
| Android Auto | Experimental glucose glance | Native checks; no physical head-unit acceptance claimed |

See [source freshness](DATA_FRESHNESS.md) for import delays. Implementing a
connector does not establish a provider partnership, a supported public API or
successful operation with every account.

## Region-level release capability

| Region/profile | Formatting and canonical data | Food | Provider contracts | Clinical content | Interface language |
| --- | --- | --- | --- | --- | --- |
| United Kingdom | Complete | Open Food Facts plus GB-only CoFID | Implemented; existing UK behaviour is the regression baseline | Reviewed GB/NICE boundary available | English |
| United States | Complete | Open Food Facts plus 5,742 offline USDA reference foods; optional 409,329-food branded catalogue; low-rate USDA exact-GTIN fallback after a barcode miss | Dexcom/Libre implemented; Glooko US implemented as experimental beta | General safety only | English with US formatting |
| Japan | Complete | Open Food Facts plus bundled MEXT 2023 reference table | Dexcom Japan implemented; supported international provider regions remain selectable | General safety only | English UI with Japanese formatting and Japanese food search |
| Europe | Complete | GB CoFID, France Ciqual and Germany BLS reference foods; Open Food Facts context elsewhere | International/region-specific contracts implemented where offered | General safety except GB profile | English with selected locale formatting |
| Other | Complete when the platform supports the chosen locale/timezone | Canada CNF reference foods; Open Food Facts context in supported countries | User-selected supported service region only | General safety only | English with selected locale formatting |

## Verification evidence

- The quality workflow checks tracked artifacts, common secret patterns,
  documentation links, dependency licence metadata and production source
  reachability on every proposed change.
- Zero-warning lint, TypeScript, automated app tests, Expo dependency checks and
  Expo Doctor are blocking gates.
- Native phone, module, Wear and watch-face unit and release-lint tasks run from
  a freshly generated Android project.
- Regional tests cover canonical storage, display conversion, provider-region
  selection, date order, IANA timezones, daylight-saving boundaries, food
  catalogue selection and backup migration.
- The production release workflow requires explicit app and face signing
  credentials, verifies the final phone APK and creates a draft for exact-asset
  testing. The `production` environment name does not establish effective access
  protection. Approval and branch restrictions remain separate pre-signing gates;
  see the current [release status](RELEASE_STATUS.md).

Counts and device results belong in the relevant GitHub Actions run or release
notes. This document describes the maintained capability boundary rather than
freezing one dated test run as permanent evidence.

## Evidence still required outside this repository

These are validation/claim boundaries, not reasons to remove the documented
beta implementations:

1. Real non-UK accounts or sanitized fixtures would promote experimental cloud
   routes (especially US Glooko) from contract-tested to field-tested. Users can
   report safe region/error codes through the repository issue form; additional real-account reports are welcome after launch.
2. Additional national or commercial food sources still need a reusable public
   licence or contributor-supplied permission. USDA (public domain/CC0), MEXT
   (app reuse with attribution), CoFID (OGL), CNF (Open Government Licence -
   Canada), Ciqual (Etalab Open Licence 2.0), BLS (CC BY 4.0) and Open Food Facts
   (ODbL/DbCL) have implemented attribution paths. See the
   [third-party notices](../THIRD_PARTY_NOTICES.md) for source-specific terms.
3. Professional translation, linguistic review, TalkBack pronunciation and
   layout testing are needed before advertising a translated release. Locale,
   Japanese food search and regional formatting work today, but the interface
   is honestly labelled English.
4. Qualified country-specific review is needed before advertising a non-GB
   clinical pack or numeric emergency pathway. Non-GB users already receive the
   implemented generic safety path and local emergency terminology.
5. Physical Android Auto/head-unit and additional physical watch-model checks
   are useful field evidence; builds, emulators and screenshot tests prove the
   software contracts but cannot reproduce every OEM display surface.
6. Every public APK must use the same protected production signing key and pass
   an in-place update test over the previous GitHub Release. If that identity is
   unavailable or changes unexpectedly, release is blocked.
7. Root/module notices now retain Expo's notice alongside T1 Arc contributor
   changes, and CI inventories locked dependency licences and high-confidence
   secrets. Before a public tag, the repository owner must still confirm the
   right to publish every first-party contribution/bundled dataset and inspect
   repository-host, CI and release secret stores that source scanning cannot
   see.

## Public implementation evidence

- CoFID 2021 source and GOV.UK Open Government Licence terms:
  <https://www.gov.uk/government/publications/composition-of-foods-integrated-dataset-cofid>
- USDA FoodData Central API and public-domain/CC0 terms:
  <https://fdc.nal.usda.gov/api-guide/>
- MEXT Standard Tables and explicit application reuse/attribution guidance:
  <https://www.mext.go.jp/a_menu/syokuhinseibun/index.htm>
- Open Food Facts API, rate-limit and ODbL/DbCL guidance:
  <https://openfoodfacts.github.io/openfoodfacts-server/api/>
- Open-source regional contract corroboration (used as evidence, not copied):
  Nightscout Connect, pydexcom and the LibreLinkUp API client linked from the
  regional contributing guide/repository history.
