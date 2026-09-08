# Preparing a signed Android release

This is a maintainer procedure. Ordinary users install the APK from GitHub
Releases and do not need any of these tools.

For the first public APK, complete the one-time
[public launch checklist](PUBLIC_LAUNCH_CHECKLIST.md) as well as this repeatable
procedure.

Check the current [release status](RELEASE_STATUS.md) before starting. Preparing
source, documentation or a draft announcement does not clear a release hold.
Obtain the owner's explicit go-ahead before production signing, builds or
release publication.

## Permanent release identity

Official phone and Wear companion releases both use package ID
`io.github.gregorgregor25.t1arc` and the same permanent app signing key. Matching
identities are also required for the Wear Data Layer connection. Android accepts
an in-place update only when the package ID and signer match the installed app.

Watch faces use a second permanent key, distinct from the app key. This applies
to the five standalone face APKs and the resource-only APKs bundled inside the
companion for Watch Face Push. Never use either development key for a public APK.

Back up both production keystores and their recovery information in at least two
secure, separate locations. Losing it means existing users cannot install a
normal update. Replacing it without a documented Android key-rotation process
must block release.

## Protect release access before adding signing secrets

An environment named `production` is not, by itself, a protected release gate.
Verify its effective deployment restrictions and approval rules before adding
signing secrets or dispatching the release workflow. The current environment
exists but is unprotected and has no signing secrets; see
[release status](RELEASE_STATUS.md) for the current boundary.

Restrict deployment to the exact reviewed default branch, protect that branch
with required quality checks, and configure required review and trusted
maintainer access. Do not select "protected branches only" when no branch has
protection: GitHub then allows every branch to deploy.

GitHub currently blocks private branch protection and rulesets on this
repository's plan. Private environment restrictions also depend on the plan;
required reviewers are public-only on Free, Pro and Team. A paid upgrade is not
a launch prerequisite: after the separate source-publication audit and owner
approval, the source can become public first, then public-repository protections
can be configured and verified before any signing secrets or public binaries
are added. Until that gate is met, leave the secrets absent and do not run the
release workflow. See [GitHub's environment availability and restrictions](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments).

Once those protections are verified, store these environment secrets there:

| Secret | Value |
| --- | --- |
| `T1ARC_RELEASE_KEYSTORE_BASE64` | Base64 encoding of the production keystore file |
| `T1ARC_RELEASE_STORE_PASSWORD` | Keystore password |
| `T1ARC_RELEASE_KEY_ALIAS` | Signing-key alias |
| `T1ARC_RELEASE_KEY_PASSWORD` | Signing-key password |
| `T1ARC_FACE_KEYSTORE_BASE64` | Base64 encoding of the separate face keystore |
| `T1ARC_FACE_STORE_PASSWORD` | Face-keystore password |
| `T1ARC_FACE_KEY_ALIAS` | Face-signing alias |
| `T1ARC_FACE_KEY_PASSWORD` | Face-signing key password |

Do not commit a keystore, password, encoded keystore or signing output. Do not
put a signing secret in release notes, workflow inputs or repository variables.

`scripts/initialize-release-signing.ps1 -Profile production` can create the two
keys outside the repository on Windows. It retains existing keys and protects
their credentials with Windows DPAPI. That local protection is not a recovery
backup: verify an encrypted recovery copy containing both keys, aliases and
passwords, then have the owner retain it independently before publication.
Record and compare the public certificate fingerprints after a recovery test.

## Prepare the version

1. Update `expo.version` and `expo.android.versionCode` in `app.json`.
2. Update the matching version in `package.json` and `package-lock.json`.
3. Confirm the version name is suitable for a tag such as `v1.7.0`.
4. Draft the notes from [the release notes template](RELEASE_NOTES_TEMPLATE.md).
5. Update user guides, known limitations, data migrations and third-party
   notices where required.
6. Merge only after the quality workflow passes on the intended release commit.

Version codes must always increase. Never reuse a public version number for a
different APK.

The workflow refuses an existing tag and accepts dispatch only from the current
default branch. Select that branch in the workflow picker and check its reviewed
commit before starting; a branch name is not an
APK identity. `app.config.js` records the checkout commit and whether local
changes exist in the app's About page. A source archive without Git reports
unknown provenance rather than inventing a commit.

Choose the GitHub release classification deliberately. The current in-app
update check and `/releases/latest` route offer only non-prerelease releases
with a `vX.Y.Z` tag and complete APK, checksum and build-record assets. Calling
the software beta does not require GitHub's prerelease flag. If the owner
chooses that flag, document that it will not appear through those routes;
do not advertise the normal update path as working for it.

## Create a draft release

1. Open **Actions** in GitHub.
2. Select **Prepare signed Android release**.
3. Choose **Run workflow** on the current default branch at the reviewed release
   commit. A dispatch from another branch or tag skips production preparation.
4. Enter the tag that matches `app.json`, for example `v1.7.0`.
5. Enter the required confirmation text.
6. Confirm the configured `production` environment approval gate appears and
   complete the required review. If the expected gate is absent, stop.

The workflow calls the existing quality workflow from the same commit, without
passing production secrets. Both the application/native job and archived-service
job must pass before the production environment job can begin. It then checks
the clean checkout again before decoding the signing keys.

The workflow builds the phone, companion and five
standalone faces. It checks the phone package, version, SDK range, embedded
bundle, native classes, permissions, ARM64 runtime and signature. It also checks
the phone/companion identity and separate face-signing policy.

The companion build generates all five bundled Push APKs and validates each
with the pinned Google validator. Package names, complication providers, resource
contents, certificates, checksums and validation tokens must pass before the
catalog is packaged. Emulator and physical-device checks remain separate gates;
an APK passing static validation does not establish that the runtime flow works.

The draft contains:

- `T1-Arc-vX.Y.Z.apk`;
- `T1-Arc-vX.Y.Z.apk.sha256`;
- `T1-Arc-vX.Y.Z.apk.build.json`, linking the source commit, package, version and
  phone and watch APK checksums;
- `T1-Arc-Wear-vX.Y.Z.apk` and its checksum;
- `T1-Arc-Meridian-vX.Y.Z.apk`, `T1-Arc-Chronograph-vX.Y.Z.apk`,
  `T1-Arc-Atelier-vX.Y.Z.apk`, `T1-Arc-Pace-vX.Y.Z.apk` and
  `T1-Arc-Summit-vX.Y.Z.apk`, each with its checksum;
- draft notes from the reviewed release-notes template, with verified build facts
  filled in and change summaries/device acceptance explicitly left for review.

The workflow never accepts the development signing identity and never creates a
public release automatically.

Tag creation is atomic and refuses to overwrite an existing ref. If draft
creation fails after the new tag was created, stop and review the failed run;
the workflow will not silently reuse that tag for another APK. Do not force-push
or move a release tag to make a retry succeed.

## Test the exact draft APK

Download the APK set from the draft release. Do not rebuild it locally for final
testing. The companion contains the five Push faces; users do not download
those internal packages separately. See [Watch setup](WATCH_SETUP.md) for the
user-facing installation choices.

At minimum:

1. install it cleanly on a supported test phone;
2. complete onboarding and open every main phone screen;
3. create, back up, erase and restore invented records;
4. install it over the previous public APK and confirm data remains;
5. restart the phone and confirm a cold launch;
6. compare the APK checksum with the attached checksum file;
7. confirm the release notes match the tested asset.
8. open **Settings > About T1 Arc** and compare the package, version and source
   revision with the build record. A production release must report a clean
   source revision, not local changes or an unknown commit.
9. install the matching companion on a supported watch, enable Wear sharing on
   the phone and verify live readings, freshness, units, colours and reconnects;
10. on Wear OS 6 or later, install each design from the phone, approve activation
    on the watch, switch designs, reselect the same design and check recovery
    after disconnecting. Confirm that installation is not reported as activation;
11. check the older supported companion path without Watch Face Push, and test
    the standalone faces on their supported Wear version;
12. verify that the shipped guides and screenshots match these exact artifacts.
13. exercise local food search, saved offline barcodes, optional-catalogue
    preparation/cancel/remove and an enabled older-revision upgrade; retain
    private foods and meals throughout;
14. check recipe serving selection, remembered portions, missing-nutrient
    presentation, label review/cancel and food-tools Back preserving the draft;
15. check the manual update flow against the intended release classification
    and complete metadata, including safe unavailable/incompatible states.

Use synthetic records on emulators or dedicated test installations. Before
touching an owner's existing installation, export and unlock a separate encrypted
backup from each app. Keep their APKs and compare backup counts and conflicting
records. Do not erase personal data to perform the synthetic restore test.

A move from a private package to the official package is not an in-place update.
Use the verified primary backup, reconcile unique records before removing either
old app, and reconnect credentials and Android permissions separately. Ordinary
backup restore is not a union of Tarv1s conversations. Verify watch delivery with
the old phone app stopped before retiring its companion.

If the first public version has no previous public APK, record that the upgrade
check begins with the next release. Keep the first signing identity unchanged.

## Publish

Edit the draft release so the first paragraph explains who should install it,
what changed and any action required before updating. Include the tested Android
versions, important limitations and provider routes that remain experimental.
Link capability documents to the exact release tag or commit, not `blob/HEAD`.

Publish only after the exact draft APK set passes the checks above. After
publication, confirm that the
[latest-release link](https://github.com/gregorgregor25/t1-arc/releases/latest)
opens the release and that the APK and checksum both download correctly.

Do not attach local databases, provider exports, device logs, test credentials,
keystores or private screenshots to a release.
