# Testing T1 Arc

This page is for contributors and maintainers. People installing a GitHub
Release do not need these tools or commands.

## Local quality checks

Use Node.js 22.13.0 or newer within Node 22 and JDK 21. From the repository
root, run:

```powershell
npm ci
npm run verify:public-source
npm run quality
npm audit --omit=dev --audit-level=high
npx expo install --check
npx --no-install expo-doctor
```

The public-source check reviews tracked artifacts, common secret patterns,
source reachability and dependency licence metadata. `npm run quality` runs
lint, type checking and the Vitest suite.

## Native Android checks

GitHub Actions regenerates the Android project and runs phone, native-module,
Wear and watch-face unit and lint tasks. The exact command list lives in
`.github/workflows/quality.yml` so the workflow remains the executable source
of truth.

Release packaging is also required to fail closed when no production signer is
configured.

## UI checks

Use synthetic data for repeatable UI checks. Cover at least:

- onboarding, cold launch, warm launch and Android Back behaviour;
- Today, History, Insights, Tarv1s, Health and Settings;
- region, locale, glucose units, timezones and colour choices;
- food search, barcode entry, personal foods, quick carbs and copying a meal;
- food-tools Back navigation with an unsaved draft, recipe serving selection,
  missing nutrients and remembered portions;
- optional food-catalogue preparation, cancellation, removal and an enabled
  older revision upgrade, without changing saved food or meal records;
- offline reuse of saved barcodes and label-camera review/cancel without saving;
- manual update checks with no release, a compatible release, missing metadata
  and a different installed package;
- backup creation, restore rejection and destructive-action confirmation;
- notification, widget, lock-screen and optional always-on display settings;
- keyboard, small-screen, large-text, TalkBack and reduced-motion behaviour;
- offline, timeout, invalid-credential and partial-import states.

An emulator can prove navigation and Android integration behaviour, but it
cannot reproduce every phone manufacturer, provider account, car or watch.
Label field evidence and fixture evidence separately.

## Release checks

Before a draft release is published, install the exact signed APK produced by
the release workflow and check:

1. a clean installation on a supported Android version;
2. an in-place update over the previous public APK without data loss;
3. onboarding and the synthetic demo;
4. backup and restore with invented records;
5. package name, version, embedded bundle and non-debuggable state;
6. a cold launch after phone restart;
7. the known limitations written in the release notes.

Never replace the production signing identity during an upgrade test. Never use
personal provider exports, credentials or health screenshots as public test
artifacts.

The complete release procedure is in [Releasing](RELEASING.md).
