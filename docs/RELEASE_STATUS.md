# Downloads and release support

## Download T1 Arc

Get the signed Android APK from the
[latest GitHub Release](https://github.com/gregorgregor25/t1-arc/releases/latest).
Under **Assets**, choose `T1-Arc-vX.Y.Z.apk`. The version number replaces
`X.Y.Z`; the files labelled **Source code** are for contributors.

You do not need to build the app. Follow the
[installation guide](GETTING_STARTED.md) to install or update it on your phone.

T1 Arc is beta software. Back up before updating, keep the official display for
medical devices available, and report problems without sharing personal health
or account data.

## Which download do I need?

| Download | Who needs it |
| --- | --- |
| `T1-Arc-vX.Y.Z.apk` | Everyone using T1 Arc on an Android phone |
| `T1-Arc-Wear-vX.Y.Z.apk` | People adding the companion to a Wear OS watch |
| `T1-Arc-Meridian-vX.Y.Z.apk` and the other named face APKs | People installing a separate face on Wear OS 4 or newer |
| `.sha256` files | Anyone who wants to verify a downloaded file's checksum |
| `.apk.build.json` | Contributors identifying the APK's source commit and build details |

The phone requires Android 8.0 or newer. The companion requires Wear OS 3 or
newer. On supported Wear OS 6 watches, the companion can install its bundled
faces through the phone's chooser, so separate face APKs are unnecessary.
Use phone and watch downloads from the same release.
See [Watch setup](WATCH_SETUP.md) for installation and compatibility.

## What the phone app includes

- Current glucose and an inspectable history of glucose, insulin, food and context.
- Supported provider connections, Health Connect, Hevy and manual records.
- Encrypted local health storage and portable backups.
- Food search, barcode scanning, saved foods, meals and recipes.
- On-device nutrition-label capture with an editable preview before saving.
- Tarv1s factual answers on the phone and optional broader questions through
  your own OpenAI API key.
- Persistent notification, home-screen widget and optional always-on display.
- Optional glucose alerts and an experimental Android Auto glance.
- Regional units, formats and offline reference food catalogues.

Reference food catalogues cover GB, US, Japan, Canada, France and Germany.
An optional US branded catalogue adds 409,329 foods and uses about 151 MB of
additional phone storage. See [Food logging](FOOD_LOGGING.md) and
[Regional support](REGIONAL_CAPABILITY_MATRIX.md) for coverage and limitations.

## Know which version you have

Open **Settings > About T1 Arc** for the app version, package and source revision.
**Share build details** shares that information without health records or keys.
Use those details when reporting an app problem.

A GitHub source branch is not an installed app. Each release's notes and
attached build record identify the source used for that APK. Changes to the
repository do not alter an APK already on your phone.

**Check for updates** looks for a compatible published release. It excludes
drafts and GitHub prereleases and never downloads or installs automatically.

## Known limitations

- A large first Glooko export can spend several minutes processing locally with
  limited progress detail.
- Android controls notification, background, lock-screen, Accessibility and
  Health Connect permissions. Settings and power restrictions vary by phone.
- US Glooko automatic import is experimental. Not every provider route has been
  checked with a real account in every country.
- Interface text is English. Locale choices change supported number, date,
  unit and food-search behaviour, not the interface language.
- Curated clinical references are limited to the documented GB/NICE boundary.
  This is not independent clinical certification. T1 Arc does not provide
  treatment, dosing or pump-setting advice.
- Overnight battery behaviour and alert delivery depend on the phone, settings
  and connected sources. Always retain your provider's official app and alerts.

Automated tests, emulator checks and physical-device checks establish different
things. A passing test suite does not prove every account, phone or watch
combination. The [regional capability matrix](REGIONAL_CAPABILITY_MATRIX.md)
separates implementation coverage from real-account evidence.

## Update without losing your data

Official APKs use package ID `io.github.gregorgregor25.t1arc` and a consistent
signing identity so Android can update them in place. Create an encrypted
backup, then install the new APK over the existing app. Do not uninstall first.

If Android reports a signature conflict, stop and follow the
[update guide](GETTING_STARTED.md#update-t1-arc). A private test package has its
own storage and is not an in-place update route to the official app.

## For contributors and maintainers

Release notes identify the source commit, APK checksums, important changes,
migrations, known limitations and verification performed for that release.
Do not infer exact-APK acceptance from a different development build.

The [release procedure](RELEASING.md) and
[first-launch checklist](PUBLIC_LAUNCH_CHECKLIST.md) cover signing, recovery,
GitHub protections and testing the exact assets before publication.
