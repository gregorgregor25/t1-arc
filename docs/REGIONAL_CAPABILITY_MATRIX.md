# T1 Arc regional capability matrix

Updated: 2 September 2026

This is the authoritative status of the multi-region implementation. “Complete”
means the behaviour is implemented and covered by local automated evidence.
It does not mean that an external provider, national dataset, translation, or
clinical pack has been approved in every country.

The audit baseline records the state found before the regional work. Current
status describes the locally verified public-ready source; verification below
separates completed local gates from evidence that still requires an external
service, licensed content, qualified review or physical hardware.

## Plain-language map

There is one T1 Arc app and one behaviour path. The maintainer's copy does not
receive a private provider, food, or Tarv1s route that public users lack.

| Feature | United Kingdom | United States | Japan | Other regions |
| --- | --- | --- | --- | --- |
| Glucose, measurements, dates and timezones | Regional display; canonical records | Regional display; canonical records | Regional display; canonical records | Regional display when the selected locale is supported |
| Reference-food search while typing | Bundled CoFID; offline | Bundled 5,742-food USDA Foundation/FNDDS catalogue; offline | Bundled 2,538-food MEXT catalogue; offline | Saved and user-created foods |
| Packaged-food search | Open Food Facts after Search is pressed | Open Food Facts after Search is pressed | Open Food Facts after Search is pressed | Open Food Facts after Search is pressed |
| Barcode scan | Open Food Facts | Open Food Facts first; low-rate USDA public exact-GTIN fallback only after a miss | Open Food Facts | Open Food Facts |
| Commercial glucose providers | Implemented routes; UK is the regression baseline | Implemented routes; field reports still welcome | Implemented where the provider offers Japan/international service | Only explicitly supported provider regions are selectable |
| Tarv1s | Same direct BYOK flow for every build | Same direct BYOK flow for every build | Same direct BYOK flow for every build | Same direct BYOK flow for every build |
| Clinical guidance | Reviewed GB/NICE pack plus general safety | General safety; no claimed reviewed US pack | General safety; no claimed reviewed Japan pack | General safety unless a reviewed pack exists |
| Interface language | English | English with US formats | English with Japanese formats and food names | English with selected locale formatting |

“Offline” means the lookup needs neither a service account nor an API quota.
Open Food Facts calls are made directly by each phone and are rate-limited by
the caller's network/public IP. People behind the same carrier or Wi-Fi NAT may
therefore share an allowance. The USDA `DEMO_KEY` is not used for normal US
text search.

## Detailed audit

| Promised area | Audit baseline | Current status | Evidence and boundary |
| --- | --- | --- | --- |
| Regional profile, migration and backup | Partial | Complete | Independent country, locale, IANA timezone, glucose, measurement, energy, provider-region and clinical-jurisdiction preferences are current T1 Arc contracts. Portable backup v16 includes the weekly-review schedule, richer portable state and canonical imported meter-check glucose; readers for backup schemas v1–v15 remain. The one-time pre-release maintainer migration proved canonical values and regional state without making recovery-app private keys a public runtime dependency. Original ZIP/PDF/import downloads stay device-local rather than entering backups. |
| React Native glucose and measurement formatting | Partial | Complete | Glucose cards, profiles, chart ticks and evidence views format at the presentation boundary. Health, workout, weight, distance, height, elevation, speed, temperature, volume and energy values retain canonical storage and render through the regional formatter. |
| Native Android, widget, persistent notification and Android Auto | Partial | Complete in code; physical Android Auto is externally untestable here | The phone passes unit, locale and timezone metadata to the native display module. Widget, notification and Auto choose their label and converted glucose value from that metadata. A car/head-unit check is still required. |
| Wear companion, complications and watch faces | Partial | Complete in code; complete physical coverage is externally untestable here | Canonical mmol/L plus display metadata crosses the data layer. Companion, tile, complications and all three bundled faces format the value using frozen permanent T1 Arc wire/component identifiers. Current builds/tests cover the code; each face still needs a user-selected physical-device visual check. |
| Timezone, DST, travel and weekly schedules | Partial | Complete | Runtime IANA timezone replaces fixed-London analysis paths; weekly day/time/timezone is configurable and backed up. Date-only pickers remain calendar-only, while manual-record and food wall clocks resolve through one numeric timezone path that rejects nonexistent DST times and requires an explicit first/second choice for repeated times. Tests cover London and New York DST plus a half-hour zone. Provider service region remains independent of travel/device timezone. |
| Glooko | Partial | Complete in code; US route is experimental | EU and US automatic import uses publicly reachable regional consumer hosts and an observed private consumer-web exchange, not a documented public API. A new connection stores an explicitly confirmed export IANA timezone with the current credential envelope, so travel cannot reinterpret account data. Imported rows without a current account binding require explicit same-person confirmation before connection. Manual files require a date order and IANA timezone snapshotted before preview/import. Regional timestamp parsing, canonical conversion, atomic archive validation and safe region/error diagnostics are implemented. Mismatched regions or account clocks are rejected. The US route is available as a beta rather than being artificially blocked; no production-account field validation is claimed. |
| Dexcom Share and Clarity | Partial | Complete in code; live non-UK accounts externally untestable here | Share keeps International, US and Japan service selection independent of the device region. Clarity supports explicit date order/timezone and localized header/event aliases. Production account/export fixtures are still required for field validation. |
| LibreLinkUp | Partial | Complete in code; live non-UK accounts externally untestable here | International and US hosts plus Libre’s verified regional redirect remain supported. Factory timestamps provide the stable instant. A source row that supplies only an unzoned local timestamp now fails closed instead of being reinterpreted after travel; an explicit immutable source timezone is required before that fallback can be used. |
| Medtrum | Partial | Complete in code; live regional accounts externally untestable here | Service region and explicit source glucose unit are stored with the account. Import no longer guesses units from the numeric value. Production EU/France fixtures and accounts remain a field-test requirement. |
| Nightscout and xDrip | Partial | Complete in code | User-supplied/local endpoints are geography-neutral. Their glucose protocols define `sgv` values as mg/dL; T1 Arc converts that canonical input for regional presentation. Local/network configuration remains user-controlled. |
| Notification capture | Partial | Complete generic regional path; publisher coverage remains extensible | Explicit/automatic unit handling, Latin/Arabic/Persian/full-width digits, decimal punctuation, provenance, supported-app allow-listing and canonical conversion are implemented. Explicit unit-labelled values and unambiguous value-only custom views do not depend on English labels; the optional unitless labelled heuristic currently recognises English glucose/sensor/SG/BG labels. A publisher-specific failure can be added from a sanitized fixture through the regional issue/PR route without disabling generic capture. |
| Food search and barcode scanning | Partial | Complete for the principal GB/US/JP profiles; global branded fallback | Open Food Facts receives selected country/language context for text and barcode requests and caches are region-scoped. Britain adds bundled CoFID. The US adds a reproducibly generated 5,742-food offline USDA Foundation/FNDDS catalogue, so normal text search has no USDA API quota; only an exact-GTIN fallback after an Open Food Facts barcode miss uses USDA's low-rate public demo key. Japan adds a reproducibly generated 2,538-food offline MEXT catalogue. Source, licence/reuse and privacy disclosures are in the app. |
| Food portions and units | Partial | Complete | Mass, volume and household inputs include g, oz, lb, ml, regional fl oz/cup, tbsp and tsp; nutrition remains canonical per g/ml and energy follows kcal/kJ preference. |
| Food logging workflow and save path | Partial | Complete for the requested local workflow | Recent, Favourites, My Foods, Meals and Recipes are first-class library views. My Foods has durable create/edit/delete storage. A user can choose another calendar day, select a whole meal or individual foods, append or replace the current draft, preserve duplicate rows, and undo the copy before saving. Primary food writes are batched in one transaction; post-save insight work is deferred/coalesced rather than blocking the modal. |
| Health Connect, workouts and manual records | Partial | Complete | Records stay in canonical source/SI units; presentation covers regional measurement and temperature formats. Manual imperial weight converts back to kilograms before validation/storage. |
| Carb ratios and treatment profile | Complete | Complete | Ratios remain grams per unit, are interpreted against the selected analysis timezone and are not silently converted as a measurement preference. |
| Tarv1s and Insights | Partial | Complete in code | Every build uses the same direct BYOK route: the user's key is stored on that phone and both planning and answer requests go directly to OpenAI. The archived Analyst Lab and WIF/mTLS experiments cannot supersede it. Request context, ranges, recurring windows, charts, evidence and physiology presentation use locale, timezone, glucose and measurement preferences. Data/tool schemas remain canonical. |
| Clinical jurisdiction and emergency language | Partial | Complete for the reviewed UK boundary; missing elsewhere | NICE-specific reviewed knowledge is selected automatically only for GB. A non-GB user can still ask explicitly what NICE says, in which case the material stays labelled as UK guidance and states its England-and-Wales scope. Numeric UK pathways remain strictly GB-gated. Other jurisdictions receive general safety wording and local emergency terminology without borrowing UK thresholds. Reviewed US/Japan/other clinical packs require qualified external review. |
| Language and localisation | Partial | Partial | Locale choice drives numbers, dates, food request language and accessibility values. The interface is still an English release; no translated release is claimed until strings are professionally translated and reviewed. |
| Accessibility | Partial | Complete for regionalized values; broader device review remains external | Dynamic glucose/measurement accessibility labels use the same regional formatter. TalkBack, large-font, translated pronunciation and every physical screen size remain release-matrix checks. |
| Onboarding and demo data | Partial | Complete in code | Regional settings disclose the English-only UI and clinical-pack boundary; synthetic/demo dates and values use runtime locale/timezone formatting. Reviewed translated onboarding remains part of localisation work. |
| QA and release capability matrix | Missing | Complete for local implementation evidence; external rows remain explicit | This matrix separates implementation evidence from field validation. A regional issue form and contribution guide accept safe reports and evidence-based beta fixes without requiring the maintainer to recruit foreign account holders. The complete automated/native graph, whole-app Android 17 manifest and fresh public-history reproduction have passed. Physical hardware, real external accounts, professional translation and qualified non-GB clinical review remain honestly outside that local claim. |

## Region-level release capability

| Region/profile | Formatting and canonical data | Food | Provider contracts | Clinical content | Interface language |
| --- | --- | --- | --- | --- | --- |
| United Kingdom | Complete | Open Food Facts plus GB-only CoFID | Implemented; existing UK behaviour is the regression baseline | Reviewed GB/NICE boundary available | English |
| United States | Complete | Open Food Facts plus bundled 5,742-food USDA reference catalogue; low-rate USDA exact-GTIN fallback only after a barcode miss | Dexcom/Libre implemented; Glooko US implemented as experimental beta | General safety only | English with US formatting |
| Japan | Complete | Open Food Facts plus bundled MEXT 2023 reference table | Dexcom Japan implemented; supported international provider regions remain selectable | General safety only | English UI with Japanese formatting and Japanese food search |
| Europe | Complete | Open Food Facts context; no bundled national dataset except GB CoFID | International/region-specific contracts implemented where offered | General safety except GB profile | English with selected locale formatting |
| Other | Complete when the platform supports the chosen locale/timezone | Open Food Facts context | User-selected supported service region only | General safety only | English with selected locale formatting |

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
- The production release workflow accepts only protected signing credentials,
  verifies the final phone APK and creates a draft for exact-asset testing.

Counts and device results belong in the relevant GitHub Actions run or release
notes. This document describes the maintained capability boundary rather than
freezing one dated test run as permanent evidence.

## Evidence still required outside this repository

These are validation/claim boundaries, not reasons to remove the documented
beta implementations:

1. Real non-UK accounts or sanitized fixtures would promote experimental cloud
   routes (especially US Glooko) from contract-tested to field-tested. Users can
   report safe region/error codes through the repository issue form; the owner
   does not need to recruit volunteers before shipping the beta.
2. Additional national or commercial food sources still need a reusable public
   licence or contributor-supplied permission. USDA (public domain/CC0), MEXT
   (app reuse with attribution), CoFID (OGL) and Open Food Facts (ODbL/DbCL)
   already have implemented attribution paths.
3. Professional translation, linguistic review, TalkBack pronunciation and
   layout testing are needed before advertising a translated release. Locale,
   Japanese food search and regional formatting work today, but the interface
   is honestly labelled English.
4. Qualified country-specific review is needed before advertising a non-GB
   clinical pack or numeric emergency pathway. Non-GB users already receive the
   implemented generic safety path and local emergency terminology.
5. Physical Android Auto/head-unit and user-selected watch-face visual checks
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
