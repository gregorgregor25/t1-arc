# Release status

## Public download

The first public T1 Arc APK has not been published. Production APK release
remains on hold for exact-artifact device acceptance, production signing and
recovery, and verified GitHub release protections. The Tarv1s screenshot
regressions have passed local calculation and Android 17 interface checks. Source and community-launch
preparation can continue, but this is not an announcement that a new public APK
is ready.

The [GitHub Releases page](https://github.com/gregorgregor25/t1-arc/releases) is
the authority for public builds. A release is available only when it contains a
signed asset named `T1-Arc-vX.Y.Z.apk`, its checksum and its APK build record.
The manual in-app update check excludes drafts and GitHub prereleases.

T1 Arc is beta software. Back up before updating, keep the official display for
medical devices available, and report problems without sharing personal health
or account data.

## What the phone APK includes

- the complete phone application and embedded JavaScript bundle;
- encrypted local health storage and portable backups;
- supported glucose, provider, food, Health Connect and manual-record routes;
- persistent notification, home-screen widget and optional always-on display;
- experimental, opt-in Android Auto glance;
- regional formatting and the offline food catalogues listed for that release;
- the same direct bring-your-own-key Tarv1s route for every user.

The current source adds Canada CNF (5,993 foods), France Ciqual (3,483) and
Germany BLS (7,140) alongside GB, US and Japan reference foods. It also adds an
optional 409,329-food US branded index and on-device Android nutrition-label
reading with manual review. These changes are not a statement that an existing
GitHub APK includes them. Check its release notes and validation record. The
optional US index uses about 151 MB of additional phone storage, with about
41 MB of compressed assets included in builds that carry it.

The watch companion is a separate APK, not something the phone silently
installs. A release offers watch support only when its Assets include the
matching companion. On supported Wear OS 6 watches, the companion's bundled
faces can be selected from the phone. Older supported watches can use separate
face APKs if those assets are present. See [Watch setup](WATCH_SETUP.md).

The new face chooser is still a release candidate until its exact phone and
watch APKs have passed emulator and physical-device acceptance. Passing an XML
validator or a build is not proof of live phone-to-watch delivery.

## Current validation boundary

The source gates cover repository contents, secrets, dependency metadata,
linting, types, automated tests, Expo configuration and native Android tasks.
Representative phone interface paths have also been exercised in an Android 17
emulator using synthetic or empty data.

On 8 September 2026, Android 17 app checks confirmed the following:

- The combined seven-day question shows both average glucose and sustained-low
  counts for both periods, with separate calculation details.
- Yesterday's carbohydrates and bolus insulin are two factual totals for one
  period, not an ambiguous date comparison or an insulin recommendation.
- Empty data is reported as unavailable rather than invented zero values.
- Synthetic populated data produced the expected averages, episode counts,
  carbohydrate totals and delivered-bolus totals. These are not the owner's
  personal results or real-provider validation.
- A partial current period is no longer described as a clock change. A
  millisecond rounding difference does not produce an equal-duration warning.
- A combined history-and-dosing question declines treatment advice; an ordinary
  average-glucose question still retains its calculation and records.
- Existing conversations on the emulator remained readable after a cold reopen.

The completed local full quality run passed 4,972 tests across 364 files,
including lint and type checks. It also covers explicitly requested unsupported
nutrient and episode-duration statistics, which must not be silently omitted
from a compound answer. Automated test counts
refer to the PC test suite, not thousands of emulator interactions. Hosted CI
must also pass on the exact pushed commit. These checks are not full
physical-device acceptance.

Physical-phone acceptance must use the exact draft release APK. Testing an
earlier build does not establish that a new candidate works on that phone.

That evidence does not prove every undocumented provider contract, Android
manufacturer policy or account region. The
[regional capability matrix](REGIONAL_CAPABILITY_MATRIX.md) distinguishes code
and fixture coverage from real-account evidence.

## GitHub release preparation

The repository is currently private. Its `production` environment exists but
has no protection rules, deployment-branch restriction or signing secrets;
repository signing secrets are also absent. GitHub rejects private branch
protection and rulesets on the current plan. The prepared workflow is not a
substitute for those effective access controls.

Leave signing secrets absent and do not dispatch production preparation until
the release gates are verified. A paid plan is not required: with separate
owner approval after the source-publication audit, the source can become public
first and public protections can be configured before adding signing secrets or
publishing binaries. See the [launch checklist](PUBLIC_LAUNCH_CHECKLIST.md) and
[release procedure](RELEASING.md).

## Known limitations

- A large first Glooko export can spend several minutes processing locally with
  limited progress detail.
- Android controls notification, background, lock-screen, Accessibility and
  Health Connect permissions. The exact settings screens vary by phone.
- US Glooko automatic import is experimental until more real-account reports
  are available.
- Interface text is currently English. Locale choices change supported number,
  date, unit and food-search behaviour but are not a claim of a translated UI.
- Country-specific clinical wording is limited to the documented reviewed
  boundary. T1 Arc does not provide dosing advice.

## Update compatibility

Official APK releases use package ID `io.github.gregorgregor25.t1arc` and one
maintainer-controlled signing identity. This lets a newer official APK update
an older official APK without clearing data.

The signing key must not change. If a release cannot update the previous public
version in place, it must not be published.

## Release evidence

Every release should state:

- the app version and Android version range;
- the exact APK filename and SHA-256 checksum;
- the source commit and attached APK build record;
- important changes and data migrations;
- known limitations and any experimental provider routes;
- the result of a clean install and an update over the previous public release.

Maintainer steps are documented separately in [Releasing](RELEASING.md).
The repository owner's one-time tasks are in the
[first public launch checklist](PUBLIC_LAUNCH_CHECKLIST.md).
