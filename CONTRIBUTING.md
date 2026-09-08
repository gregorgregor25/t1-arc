# Contributing to T1 Arc

Thank you for improving T1 Arc. Changes are reviewed as health-data software:
claims need evidence, privacy boundaries are part of correctness, and existing
installations must retain their data.

## Before opening an issue

[Search existing issues](https://github.com/gregorgregor25/t1-arc/issues) and use
the [closest issue form](https://github.com/gregorgregor25/t1-arc/issues/new/choose).
Include the smallest
reproduction, app/Android/Wear versions and non-sensitive diagnostics. Never
attach credentials, tokens, email addresses, account identifiers, databases,
backups, provider exports, exact health readings or identifying screenshots.
Use invented values in examples.

Security or privacy vulnerabilities do not belong in public issues; follow
[`SECURITY.md`](SECURITY.md).

Follow the [Code of Conduct](CODE_OF_CONDUCT.md). Maintainer time is limited;
small, well-explained contributions are easier to review than unrelated changes
bundled together. A report does not need private logs or access to a real account.

## Your first small pull request

You can help without working on provider credentials or health-data storage:

- fix a confusing guide step and check its links against the current screen;
- add a synthetic regression fixture for an already reported problem;
- improve a control's accessible label or large-text behaviour;
- propose a regional food-name alias with a public source and a matching test.

Start with an existing issue, or open a focused issue describing the change.
For a larger feature, agree its scope before building it. Fork the repository,
create a branch for one concern, and link the issue in the pull request. A draft
PR is welcome when you want feedback before finishing.

For a docs-only change, preview the Markdown, check the affected links and UI
wording, and say what you checked. You do not need a phone or Android SDK just
to correct a guide. CI still runs the repository gates. For code, run the
relevant tests while working and the checks below before requesting review.
Explain any check you could not run instead of marking it passed.

## Development

These tools are for source contributors. People using T1 Arc install the signed
APK from GitHub Releases and do not need a development environment.

Use Node.js 22.13.0 or newer within Node 22, JDK 21 and an Android SDK.
Run these commands from the repository root, where `package.json` lives.
Install exactly from the lockfile:

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
