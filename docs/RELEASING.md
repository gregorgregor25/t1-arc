# Preparing a signed Android release

This is a maintainer procedure. Ordinary users install the APK from GitHub
Releases and do not need any of these tools.

For the first public APK, complete the one-time
[public launch checklist](PUBLIC_LAUNCH_CHECKLIST.md) as well as this repeatable
procedure.

## Permanent release identity

Official phone releases use package ID `io.github.gregorgregor25.t1arc` and one
production signing key. Android accepts an in-place update only when the package
ID and signer match the installed release.

Back up the production keystore and its recovery information in at least two
secure, separate locations. Losing it means existing users cannot install a
normal update. Replacing it without a documented Android key-rotation process
must block release.

## Protected GitHub environment

Create a GitHub Actions environment named `production`. Restrict deployments to
maintainers and add approval rules before public launch. Store these environment
secrets there:

| Secret | Value |
| --- | --- |
| `T1ARC_RELEASE_KEYSTORE_BASE64` | Base64 encoding of the production keystore file |
| `T1ARC_RELEASE_STORE_PASSWORD` | Keystore password |
| `T1ARC_RELEASE_KEY_ALIAS` | Signing-key alias |
| `T1ARC_RELEASE_KEY_PASSWORD` | Signing-key password |

Do not commit a keystore, password, encoded keystore or signing output. Do not
put a signing secret in release notes, workflow inputs or repository variables.

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

The workflow refuses an existing tag. Choose the intended branch or tag in the
workflow picker and check its commit before starting; a branch name is not an
APK identity. `app.config.js` records the checkout commit and whether local
changes exist in the app's About page. A source archive without Git reports
unknown provenance rather than inventing a commit.

## Create a draft release

1. Open **Actions** in GitHub.
2. Select **Prepare signed Android release**.
3. Choose **Run workflow** on the exact release commit.
4. Enter the tag that matches `app.json`, for example `v1.7.0`.
5. Enter the required confirmation text.
6. Approve the `production` environment deployment.

The workflow reruns the release gates, creates a production-signed phone APK,
verifies its package, version, SDK range, embedded bundle, native classes,
permissions, ARM64 runtime and signature, then creates a draft GitHub Release.

The draft contains:

- `T1-Arc-vX.Y.Z.apk`;
- `T1-Arc-vX.Y.Z.apk.sha256`;
- `T1-Arc-vX.Y.Z.apk.build.json`, linking the source commit, package, version and
  APK checksum;
- generated change notes that must be edited before publication.

The workflow never accepts the development signing identity and never creates a
public release automatically.

## Test the exact draft APK

Download the APK from the draft release. Do not rebuild it locally for final
testing.

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

If the first public version has no previous public APK, record that the upgrade
check begins with the next release. Keep the first signing identity unchanged.

## Publish

Edit the draft release so the first paragraph explains who should install it,
what changed and any action required before updating. Include the tested Android
versions, important limitations and provider routes that remain experimental.

Publish only after the exact draft APK passes the checks above. After
publication, confirm that the
[latest-release link](https://github.com/gregorgregor25/t1-arc/releases/latest)
opens the release and that the APK and checksum both download correctly.

Do not attach local databases, provider exports, device logs, test credentials,
keystores or private screenshots to a release.
