# T1 Arc architecture

T1 Arc is a local-first React Native/Expo Android application with native
Android modules, a Wear OS companion and three watch-face packages. Canonical
health values are stored locally; regional units and language belong at input
boundaries or presentation boundaries.

## Layers

- `src/domain/` contains canonical models, regional rules, calculations and
  evidence semantics. It should not depend on screens or native UI.
- `src/data/` owns provider adapters, SQLCipher persistence, SecureStore
  coordination, backups, background work and privacy/erase fences.
- `src/providers/` coordinates application lifecycle and runtime data sources.
- `src/components/` and `src/screens/` render state and collect explicit user
  intent; they should not invent provider or persistence semantics.
- `modules/` contains Expo native bridges for backup crypto, Glooko, glanceable
  glucose surfaces, Health Connect and notification capture.
- `wear/` contains the companion, complications, tile and independently
  installed watch faces.
- `plugins/` generates Android configuration during Expo prebuild.

## Data invariants

- Glucose is canonical mmol/L in storage; insulin is units, carbohydrate is
  grams, mass is grams/kilograms and energy is kcal unless a schema explicitly
  says otherwise.
- Provider/account region is independent from device location and travel.
- Source timestamps retain provenance; analysis uses an explicit IANA timezone.
- Imports and restores fail atomically when validation is incomplete.
- Erase/write epochs prevent stale background work from republishing deleted
  private data.
- Tarv1s and Insights consume inspectable local evidence and must not imply
  dosing advice or certainty absent from the source data.

## Compatibility boundary

The permanent T1 Arc Android identities, persisted keys, native component
names, notification channels, Wear wire paths and backup formats are frozen
compatibility contracts. They are deliberately current-product identifiers,
but they must remain stable after public release. See
[`docs/NAMING_AND_COMPATIBILITY.md`](docs/NAMING_AND_COMPATIBILITY.md) and the
machine-readable ledger before touching a persisted or cross-process value.

## Composition roots and extraction boundaries

Several high-risk files deliberately compose many already-separated domain and
repository services. Their size is visible debt, not permission to move data
semantics back into UI code or to mix refactoring with a behavioural change.
Current ownership, test seams and the safe extraction order are recorded in
[`docs/MAINTAINABILITY_BOUNDARIES.md`](docs/MAINTAINABILITY_BOUNDARIES.md).

## Verification

`npm run quality` provides zero-warning TypeScript/React lint, TypeScript and
Vitest checks. `npm run verify:public-source` checks tracked artifacts,
high-confidence secrets, environment examples and dependency licence metadata.
CI also checks Expo dependency parity and Expo Doctor. A separate Node.js 24 CI
job syntax-checks and tests the archived Tarv1s lab and enrollment services,
audits enrollment's production dependencies, and syntax-checks every Expo
prebuild plugin. CI also audits root production dependencies at high severity,
regenerates Android, runs native unit/lint tasks, and enforces release-signing
policy. The separate, explicit release workflow assembles and verifies only the
production-signed phone APK, then creates a draft GitHub Release. Wear and
watch-face projects are covered by source, unit and lint checks but are not
currently distributed as release assets. Hardware and real regional-provider
claims require separate evidence documented in the capability matrices.
