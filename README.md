# T1 Arc

<p align="center">
  <img src="assets/icon.png" width="112" alt="T1 Arc app icon">
</p>

<p align="center"><strong>See the whole picture. Ask Tarv1s.</strong></p>

<p align="center">
  T1 Arc brings glucose, insulin, food, activity and wider health data together,<br>
  then lets you ask Tarv1s questions about patterns in your own records.
</p>

<p align="center">
  <img alt="Platform: Android" src="https://img.shields.io/badge/platform-Android-3DDC84">
  <img alt="Licence: MIT" src="https://img.shields.io/badge/licence-MIT-3B5CCC">
  <a href="https://github.com/gregorgregor25/t1-arc/actions/workflows/quality.yml"><img alt="Quality checks" src="https://github.com/gregorgregor25/t1-arc/actions/workflows/quality.yml/badge.svg"></a>
</p>

<p align="center">
  <strong><a href="https://github.com/gregorgregor25/t1-arc/releases/latest">Download for Android</a></strong>
  &nbsp;|&nbsp;
  <a href="docs/GETTING_STARTED.md">Installation guide</a>
  &nbsp;|&nbsp;
  <a href="docs/SCREENSHOTS.md">Screenshots</a>
  &nbsp;|&nbsp;
  <a href="https://www.reddit.com/r/T1Arc/">Reddit community</a>
</p>

> Free to use on Android 8.0 and newer. [Downloads and release support](docs/RELEASE_STATUS.md).

## Why I built it

I have lived with Type 1 diabetes for nearly 20 years. The problem I kept
running into was not a lack of data. It was that the data was split across
diabetes apps, health apps and reports that were hard to compare.

I wanted one place where I could look at glucose, insulin, meals, activity,
sleep and the rest of the day together. I also wanted to ask useful questions
without losing the evidence behind the answer. T1 Arc is the result.

The aim is simple: make personal records easier to understand, show where the
information came from, and say when the available data is not good enough to
support a conclusion.

<table>
  <tr>
    <td align="center" width="50%"><img src="docs/screenshots/tarvis.png" alt="Tarv1s answer showing average glucose, sensor coverage and supporting records"><br><strong>Ask Tarv1s</strong><br>Explore patterns across the records you already keep</td>
    <td align="center" width="50%"><img src="docs/screenshots/today.png" alt="T1 Arc Today screen with the creator’s records, shared with permission"><br><strong>See today clearly</strong><br>Glucose and daily context in one place</td>
  </tr>
</table>

T1 Arc is a local-first Android app for Type 1 diabetes. It keeps the records
behind every chart, observation and Tarv1s answer available for inspection.

T1 Arc does not calculate insulin doses, recommend treatment or replace the
official display for a medical device.

## Meet Tarv1s

Tarv1s lets you ask useful questions about the records already stored in T1
Arc. It can help you review recent lows, compare one week with another, or see
how meals, insulin and activity lined up with glucose.

Tarv1s keeps supporting dates and records attached to its answers. It should
say when the available evidence is incomplete instead of filling in the gaps.
Supported exact questions are
answered on the phone for free. Broader questions can use
an optional direct OpenAI connection with your own API key, and nothing is sent
until you choose to submit one of those questions.

The optional OpenAI connection uses **GPT-5.6 Luna**, a low-cost model. Usage is
billed by OpenAI, not T1 Arc: a worked example costs **less than half a US cent
per question**, but longer questions and answers cost more. This is an example,
not a fixed price or measured average. [See the cost breakdown](docs/TARV1S_BYOK.md#what-does-it-cost).

Tarv1s is not an insulin-dose calculator, medical device or emergency service.

**[See how Tarv1s works](docs/USING_T1_ARC.md#tarv1s)** ·
[Set it up with your own OpenAI key](docs/TARV1S_BYOK.md)

### T1 Arc demo | AI narration: elevenlabs.io

[Watch the film on the T1 Arc website](https://t1arc.com/#demo) ·
[Subtitles](docs/media/t1-arc-demo.vtt) ·
[Credits and media use](docs/media/README.md)

Music: *Signal Drift*, created with Suno. An edited walkthrough of the app,
including the creator's own records, shared with permission.

> [!IMPORTANT]
> Install T1 Arc only from this repository's official
> [Releases page](https://github.com/gregorgregor25/t1-arc/releases). Choose the **phone APK**: its name starts with `T1-Arc-v`
> and ends with `.apk`. The version number changes with each release. The automatically generated source
> archives are for contributors, not for installing the app.

## Install T1 Arc

You do not need to build anything or use a computer.

1. Open the [latest release](https://github.com/gregorgregor25/t1-arc/releases/latest)
   on the Android phone.
2. Under **Assets**, choose the **phone APK**. Its name starts with `T1-Arc-v`
   and ends with `.apk`; the version number changes with each release. You do
   not need the files with **Wear**, a watch-face name, `.sha256` or **Source code**
   in their names to install the phone app.
3. Open the download. Android may ask for permission to install apps from the
   browser or Files app you used.
4. Choose **Install**, then open T1 Arc and follow the onboarding tour.

T1 Arc supports Android 8.0 and newer. Updating is the same process: download
the newer APK and install it over the existing app. Do not uninstall first,
because uninstalling removes local app data. Read the full
[installation and update guide](docs/GETTING_STARTED.md) before replacing an
established installation.

## A look at the app

The phone screenshots show the current app in dark mode with the creator’s own
records, shared with permission. Watch previews use clearly labelled example data.

<table>
  <tr>
    <td align="center" width="50%"><img src="docs/screenshots/history.png" alt="Seven-day glucose and insulin history"><br><strong>History</strong><br>Inspect records together</td>
    <td align="center" width="50%"><img src="docs/screenshots/insights.png" alt="Weekly comparison with glucose coverage"><br><strong>Insights</strong><br>Review changes over time</td>
  </tr>
  <tr>
    <td align="center" width="50%"><img src="docs/screenshots/food-logging.png" alt="Food draft with portion controls, barcode scan and label-reading shortcuts"><br><strong>Food logging</strong><br>Search, scan and adjust portions</td>
    <td align="center" width="50%"><img src="docs/screenshots/sleep.png" alt="Recorded sleep with a seven-day chart"><br><strong>Health context</strong><br>Sleep, activity and more</td>
  </tr>
</table>

See the [full screenshot gallery](docs/SCREENSHOTS.md) for larger views of the main screens, display,
backup, privacy and health records.

## How current is the information?

**Glooko is delayed history, not live pump status.** Today’s insulin totals may
be incomplete until the pump uploads and Glooko makes those records available.
Health Connect and workout imports can also arrive later than their originating
apps. A successful refresh means the source was checked, not that new records
were available. [See source timing and recovery steps](docs/DATA_FRESHNESS.md).

## What T1 Arc can do

### Bring diabetes records together

- Show current glucose, direction, freshness and recent history.
- Put glucose, basal insulin, bolus insulin, food and context on an inspectable
  timeline.
- Connect to LibreLinkUp, Dexcom Share, Nightscout, Medtrum EasyFollow, xDrip,
  compatible glucose notifications and Glooko.
- Keep source timestamps and provenance instead of flattening everything into
  one unexplained total.
- Store supported health history in a local encrypted database.

### Make food logging practical

- Search bundled regional food catalogues while typing.
- Search packaged products and scan barcodes through Open Food Facts.
- Create personal foods, favourites, saved meals and recipes.
- Browse the full saved library, remember portions and choose how many recipe
  servings to add. Android label capture helps fill an editable food form;
  nothing is saved until you review it.
- Copy a whole meal or selected items from another day.
- Log a quick carbohydrate total without inventing other nutrition values.

### Add the rest of the day

- Read selected records from Android Health Connect.
- Import Hevy strength-workout detail using your own Hevy API key.
- Bring in Strava activities through the Strava Android app's Health Connect
  connection, without a second Strava sign-in inside T1 Arc.
- Keep the original source app attached to imported records.
- Log activity, sleep, weight, medication, insulin, ketones and notes manually.
- Compare glucose with meals, exercise, sleep and other recorded context.

### Review what changed

- Compare recent periods while showing glucose coverage and missing data.
- Link observations back to the dates, calculations and records used.
- Describe associations as things worth inspecting, not proven causes.
- Withhold an observation when the evidence is too incomplete.

### Keep glucose visible

- Optional persistent notification with lock-screen privacy controls.
- Home-screen widget.
- Optional always-on display service.
- Experimental, opt-in Android Auto glance. Follow the [Android Auto setup guide](https://t1arc.com/android-auto/).

The Wear OS companion brings glucose to your wrist. On supported Wear OS 6
watches, choose from five faces: Meridian, Chronograph, Atelier, Pace and Summit.
Browse the [watch collection](docs/design/WATCH_FACE_COLLECTION.md#the-collection).
In independent APK builds with the guided installer, open **Settings → Watch &
watch faces → Set up my watch**. The phone carries the matching companion and
guides you through the watch's one-time debugging authorisation and installation.
See [Watch setup](docs/WATCH_SETUP.md) for compatibility and installation.
Prefer a web page? Follow the [step-by-step watch guide](https://t1arc.com/watch/).

## Regional support

T1 Arc stores health values in canonical units. Region and locale settings
change display, input and provider choices without rewriting the underlying
record.

Food coverage varies by country. Reference catalogues work offline; online
product search can find additional packaged foods.

| Area | UK | US | Japan | Other regions |
| --- | --- | --- | --- | --- |
| Glucose and measurements | Regional display | Regional display | Regional display | Regional display where supported |
| Offline reference food search | CoFID | 5,742 USDA Foundation/FNDDS foods | 2,538 MEXT foods | Canada: 5,993 CNF foods; France: 3,483 Ciqual foods; Germany: 7,140 BLS foods; personal and saved foods elsewhere |
| Packaged food and barcode search | Saved products, then Open Food Facts | Saved products and an optional 409,329-food offline USDA branded catalogue, then Open Food Facts; low-rate USDA exact barcode fallback after a miss | Saved products, then Open Food Facts | Saved products, then Open Food Facts |
| Provider routes | UK is the main regression baseline | Implemented routes, with Glooko US marked experimental | Dexcom Japan and international routes where offered | Only supported service regions are selectable |
| Clinical content | Reviewed GB/NICE boundary plus general safety | General safety only | General safety only | General safety unless a reviewed pack exists |
| Interface language | English | English with US formats | English with Japanese formats and food names | English with selected locale formatting |

Canada, France and Germany's reference catalogues are prepared locally on
first use. The larger US branded catalogue is optional under **More options >
Offline food catalogue**. It needs about 151 MB of additional phone storage; its compressed
asset adds about 41 MB to builds that include it. No paid food API or personal
API key is needed. Removing the optional catalogue keeps saved foods and meals.

Not every provider route has been tested with a real account in every country.
T1 Arc labels those boundaries instead of treating a fixture as field proof.
Read the [regional capability matrix](docs/REGIONAL_CAPABILITY_MATRIX.md) for
the exact status.

## How Tarv1s uses your OpenAI key

Tarv1s works without OpenAI for supported exact questions. Broader questions
can send a bounded evidence packet directly to OpenAI and keep the supporting
dates and records attached to the answer.

Every user follows the same bring-your-own-key route:

- create a dedicated OpenAI API project and key;
- store the key in Android secure storage on the phone;
- send requests directly from the phone to the OpenAI Responses API;
- use the API project's own billing and limits.

T1 Arc has no shared maintainer key or health-data relay. Nothing is sent until
the user chooses to send a question. A ChatGPT subscription does not
automatically fund API usage. Read the [Tarv1s BYOK guide](docs/TARV1S_BYOK.md)
before enabling it.

## Privacy

T1 Arc does not run a central health-data account or relay in the normal app
path.

- Health history stays in an encrypted local database.
- Provider credentials and API keys use Android secure storage.
- Connections go directly to the service selected by the user.
- Encrypted portable backups exclude credentials, browser cookies and API keys.
- Demo records are synthetic, temporary and kept separate from personal data.
- Public bug reports must use synthetic fixtures and redacted screenshots.

Read the detailed [privacy model](PRIVACY.md) before connecting personal data.

## Help and documentation

- [Website setup and help guide](https://t1arc.com/guide/)
- [Ask the T1 Arc community on Reddit](https://www.reddit.com/r/T1Arc/)
- [Install and update T1 Arc](docs/GETTING_STARTED.md)
- [Use the main screens](docs/USING_T1_ARC.md)
- [Log food and scan barcodes](docs/FOOD_LOGGING.md)
- [Choose a region and connect data sources](docs/CONNECTIONS_AND_REGIONS.md)
- [Set up Tarv1s](docs/TARV1S_BYOK.md)
- [Set up displays, alerts and widgets](docs/DISPLAY_AND_ALERTS.md)
- [Connect a watch and choose a face](docs/WATCH_SETUP.md)
- [Set up Android Auto](https://t1arc.com/android-auto/)
- [Troubleshoot common problems](docs/TROUBLESHOOTING.md)
- [Get help or report a problem](SUPPORT.md)
- [Check current release support](docs/RELEASE_STATUS.md)
- [Browse all documentation](docs/README.md)

## Contributing

You do not need to build the app to help. A clear usability report, a guide
correction or a device check with invented data can be useful.

- [Report a bug](https://github.com/gregorgregor25/t1-arc/issues/new?template=bug.yml)
- [Suggest an improvement](https://github.com/gregorgregor25/t1-arc/issues/new?template=feature.yml)
- [Report regional compatibility](https://github.com/gregorgregor25/t1-arc/issues/new?template=regional-compatibility.yml)
- [Make a first small pull request](CONTRIBUTING.md#your-first-small-pull-request)

Good small changes include a synthetic regression test, an accessible control
label, a verified regional food alias or an example that makes a guide clearer.
Check an existing issue or describe your proposed scope before starting a larger
change. These are invitations, not a claim that a task is already assigned.

Developers should start with [CONTRIBUTING.md](CONTRIBUTING.md) and the separate
[development guide](docs/DEVELOPMENT.md). Build tools are contributor
requirements, not user installation requirements.

Please follow the [Code of Conduct](CODE_OF_CONDUCT.md). Issues and pull requests
are the source contribution routes. The [Reddit community](https://www.reddit.com/r/T1Arc/)
is also available for app questions, feedback and updates. Using the app does
not require a GitHub or Reddit account.

Never upload an unedited health export, database, API key, password, session
token or screenshot containing private information. Use synthetic data and the
regional compatibility issue template.

## Licence

T1 Arc is available under the [MIT licence](LICENSE). Third-party libraries,
datasets and inspected projects keep their own licences and attribution. See
[third-party notices](THIRD_PARTY_NOTICES.md).

## Important notice

T1 Arc is an independent personal project. It is not a medical device, does
not provide medical advice and is not a replacement for a CGM, insulin pump,
clinician or emergency service. Always use the official display and
instructions for your medical devices when making treatment decisions.

LibreLinkUp, Dexcom, Nightscout, xDrip, Medtrum, Glooko, Health Connect, Open
Food Facts, OpenAI and other named services belong to their respective owners.
Compatibility does not imply endorsement or affiliation.
