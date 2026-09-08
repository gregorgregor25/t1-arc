# Development setup

This guide is for people changing T1 Arc source code. People who only want to
use the app should download the APK by following the
[installation guide](GETTING_STARTED.md).

## Requirements

- Git
- Node.js 22.13.0 or newer within Node 22
- JDK 21
- Android Studio and an Android SDK
- an Android emulator or a development device

T1 Arc uses React Native, Expo native modules, Kotlin and SQLCipher. It does not
run in Expo Go.

## Set up the source

```powershell
git clone https://github.com/gregorgregor25/t1-arc.git
Set-Location t1-arc
npm ci
npm run verify:public-source
npm run quality
npx expo install --check
npx --no-install expo-doctor
```

`npm ci` installs the exact dependency graph in `package-lock.json`. Do not use
an install command that rewrites the lockfile unless dependency changes are
part of the contribution.

Run project commands from the cloned repository root, where `package.json`
lives. Check `node --version` and `java -version` if your shell has multiple
toolchains installed. The locked React Native version does not support early
Node 22 releases. Set up the Android SDK through Android Studio before running
a native build; do not copy another developer's machine-specific SDK path.

For a first contribution, see the
[small PR guide](../CONTRIBUTING.md#your-first-small-pull-request). A docs-only
fix does not require the Android build tools.

## Run a development build

Start an emulator or connect a device that you are authorised to use, then run:

```powershell
adb devices
npx expo run:android
```

Debug builds use a development application ID and cannot be published as an
official T1 Arc release. Never install a build on another person's phone or
watch without explicit permission.

## Generated Android project

The `android` directory is generated and ignored. The source of truth is
`app.json`, the Expo config plugins, the Kotlin modules, Wear projects and the
TypeScript source in this repository.

Generate the native phone project when a native check requires it:

```powershell
npx expo prebuild --platform android --clean --no-install
```

Do not commit generated Android output, APKs, local databases, provider exports
or QA captures.

## Before a pull request

Read [Contributing](../CONTRIBUTING.md) and [Testing](TESTING.md). Changes to a
provider, region, storage contract or retained identifier require the relevant
contract tests and documentation. Use synthetic fixtures only.

Official APK creation is a maintainer task with protected production signing.
It is documented separately in [Releasing](RELEASING.md).
