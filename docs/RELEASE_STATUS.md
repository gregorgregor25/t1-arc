# Release status

## Public download

The [GitHub Releases page](https://github.com/gregorgregor25/t1-arc/releases) is
the authority for public builds. A release is available only when it contains a
signed asset named `T1-Arc-vX.Y.Z.apk` and its checksum file.

T1 Arc is beta software. Back up before updating, keep the official display for
medical devices available, and report problems without sharing personal health
or account data.

## What the phone APK includes

- the complete phone application and embedded JavaScript bundle;
- encrypted local health storage and portable backups;
- supported glucose, provider, food, Health Connect and manual-record routes;
- persistent notification, home-screen widget and optional always-on display;
- experimental, opt-in Android Auto glance;
- regional formatting and bundled GB, US and Japan reference-food catalogues;
- the same direct bring-your-own-key Tarv1s route for every user.

The first GitHub phone release does not automatically install a Wear OS
companion or the three watch-face packages. Those projects remain in the source
and test suite, but they need a simple, supportable distribution route before
they are offered as public downloads.

## Current validation boundary

The source gates cover repository contents, secrets, dependency metadata,
linting, types, automated tests, Expo configuration and native Android tasks.
Representative phone interface paths have also been exercised in an Android 17
emulator using synthetic or empty data. Physical-phone acceptance must use the
exact draft release APK. Testing an earlier build does not establish that a new
candidate works on that phone.

That evidence does not prove every undocumented provider contract, Android
manufacturer policy or account region. The
[regional capability matrix](REGIONAL_CAPABILITY_MATRIX.md) distinguishes code
and fixture coverage from real-account evidence.

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
