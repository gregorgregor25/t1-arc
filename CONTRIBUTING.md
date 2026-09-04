# Contributing to T1 Arc

Thank you for improving T1 Arc. Changes are reviewed as health-data software:
claims need evidence, privacy boundaries are part of correctness, and existing
installations must retain their data.

## Before opening an issue

Search existing issues. Use the closest issue form and include the smallest
reproduction, app/Android/Wear versions and non-sensitive diagnostics. Never
attach credentials, tokens, email addresses, account identifiers, databases,
backups, provider exports, exact health readings or identifying screenshots.
Use invented values in examples.

Security or privacy vulnerabilities do not belong in public issues; follow
[`SECURITY.md`](SECURITY.md).

## Development

These tools are for source contributors. People using T1 Arc install the signed
APK from GitHub Releases and do not need a development environment.

Use Node.js 22, JDK 21 and an Android SDK. Install exactly from the lockfile:

```powershell
npm ci
npm run verify:public-source
npm run quality
npx expo install --check
npx --no-install expo-doctor
```

`npm run lint` is the blocking TypeScript/React safety gate and permits zero
warnings. `npm run lint:report` runs the same zero-warning rules with ordinary
reporting. `npm run verify:public-source` rejects tracked build/private-data or
signing artifacts, high-confidence secrets, unsafe environment defaults and
missing/restricted dependency licence metadata. JavaScript outside the main
TypeScript tree is covered separately: CI uses Node.js 24 to test the
archived Tarv1s lab and enrollment services, audits enrollment's production
dependencies, and syntax-checks every Expo prebuild plugin.

To reproduce the service checks locally with Node.js 24:

```powershell
Push-Location services/tarvis-lab
npm run check
npm test
Pop-Location
Push-Location services/tarvis-enrollment
npm ci
npm test
npm run check
npm audit --omit=dev --audit-level=high
Pop-Location
Get-ChildItem plugins/*.js | ForEach-Object { node --check $_.FullName }
```

SQLCipher requires a native Android build; Expo Go is not a supported runtime.
Do not install builds on another person's phone or watch without their explicit
approval.

The complete setup is in
[`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md). Production APKs are created only
through the protected maintainer procedure in
[`docs/RELEASING.md`](docs/RELEASING.md).

## Pull requests

Keep one concern per PR and explain the observed problem, the invariant being
preserved and the evidence for the result. Include tests proportional to risk.
Provider/region changes need sanitized fixtures or public contract references;
field evidence and implementation evidence must be labelled separately.

Before submitting:

- run `npm run quality` and relevant native unit/lint/build tasks;
- run `npm run verify:public-source`, Expo parity and Expo Doctor checks;
- run the bounded Node.js 24 service/plugin checks above when changing those
  JavaScript areas;
- preserve canonical stored health values and source provenance;
- keep provider/account region independent from device location;
- keep imports, restores and destructive operations atomic and retry-safe;
- add or update accessibility labels for changed interaction paths;
- avoid screenshots/logs containing personal health information;
- read [`docs/NAMING_AND_COMPATIBILITY.md`](docs/NAMING_AND_COMPATIBILITY.md)
  before changing any persisted or cross-process identifier;
- update the capability matrix without claiming translation, licensing,
  clinical review, physical hardware or production accounts that were not
  actually validated.

Regional contributions also follow
[`docs/REGIONAL_CONTRIBUTING.md`](docs/REGIONAL_CONTRIBUTING.md).

Generated Android output, APKs, local databases, provider exports and temporary
QA captures must not be committed. A PR should be reviewable without unrelated
formatting or generated-file churn.

Large composition roots have documented extraction boundaries in
[`docs/MAINTAINABILITY_BOUNDARIES.md`](docs/MAINTAINABILITY_BOUNDARIES.md).
Do not split one merely to reduce a line count: first move a narrow responsibility
behind its existing behavioural tests, keep data ownership explicit, and avoid
combining the extraction with a behaviour change.
