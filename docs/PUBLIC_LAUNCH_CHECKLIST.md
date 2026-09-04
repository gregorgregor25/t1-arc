# First public APK launch checklist

This checklist covers the one-time work required before the repository and its
first installable APK become public. It supplements the repeatable
[release procedure](RELEASING.md).

## 1. Freeze the public source snapshot

- [ ] Choose the exact reviewed commit for the first public release.
- [ ] Confirm the public snapshot contains no private data, signing material,
      local build output or obsolete public-facing project name.
- [ ] Confirm every licence and third-party dataset notice still matches the
      files distributed in that snapshot.
- [ ] Prepare a clean public branch whose reachable history contains only
      material intended for publication.
- [ ] With the repository owner present, make that branch the default and
      remove obsolete remote branches and tags that must not remain reachable.
- [ ] Clone the repository into a fresh directory and rerun the public-source
      and quality gates from the public default branch.

Changing the default branch or removing remote history is an owner-approved
repository operation. Do not treat a clean current working tree as proof that
older reachable commits are safe to publish.

## 2. Establish the permanent Android identity

- [ ] Create one production signing key specifically for T1 Arc.
- [ ] Record its alias, certificate SHA-256 fingerprint and creation date in a
      private recovery record.
- [ ] Store the keystore and recovery information in at least two separate,
      encrypted locations.
- [ ] Confirm no production signing file or password exists in Git history,
      source archives, issue attachments or workflow logs.
- [ ] Keep package ID `io.github.gregorgregor25.t1arc` unchanged for every
      official phone update.

The first published signer becomes part of the update identity. Losing or
silently replacing it prevents ordinary in-place updates.

## 3. Protect GitHub release access

- [ ] Keep the four signing values documented in [Releasing](RELEASING.md) as
      secrets in the `production` GitHub environment.
- [ ] Limit that environment to the public release branch.
- [ ] Add a required reviewer if the repository plan supports it.
- [ ] Limit workflow and release permissions to trusted maintainers.
- [ ] After the repository is public, protect the default branch and require
      the quality workflow before merge.
- [ ] Enable private vulnerability reporting and verify that the Security link
      in the issue chooser opens a private report.
- [ ] Confirm Dependabot alerts and security updates are enabled.

## 4. Confirm public service use

- [ ] Identify T1 Arc to Open Food Facts through its current API usage process
      and keep a working project contact route in network requests.
- [ ] Confirm the app does not embed a private USDA or OpenAI API key.
- [ ] Recheck Open Food Facts, USDA, CoFID and MEXT terms and attribution links
      immediately before launch.
- [ ] Keep provider routes without real-account evidence labelled experimental
      or field-tested only, as applicable.

## 5. Prepare the first version

- [ ] Select the public version name and an Android version code greater than
      every previous build using the official package ID.
- [ ] Update `app.json`, `package.json` and `package-lock.json` together.
- [ ] Fill in the [release notes template](RELEASE_NOTES_TEMPLATE.md) using only
      claims supported by the exact release commit and test evidence.
- [ ] Run `npm run verify:public-source`, `npm run quality`, Expo dependency
      checks and the documented native Android gates.
- [ ] Run the protected release workflow on the exact intended commit.

## 6. Test the exact draft asset

- [ ] Download the APK and checksum from the draft GitHub Release. Do not use a
      locally rebuilt APK for final acceptance.
- [ ] Confirm the SHA-256 checksum and verified production certificate
      fingerprint.
- [ ] Install cleanly on a supported physical phone and complete onboarding.
- [ ] Exercise every main phone screen with invented or synthetic records.
- [ ] Create, back up, erase and restore synthetic records.
- [ ] Restart the phone and confirm a cold launch.
- [ ] Confirm Android's installer identifies it as T1 Arc and the package is
      `io.github.gregorgregor25.t1arc`.
- [ ] Record that update testing begins with the second public version. From
      that release onward, every candidate must update the previous public APK
      in place without clearing data.

## 7. Publish and verify

- [ ] Edit the generated draft notes so limitations and experimental routes are
      prominent and understandable.
- [ ] Publish the repository only after the reviewed clean branch is the
      default and its old unwanted references have been handled.
- [ ] Confirm GitHub detects the MIT licence and renders the README, relative
      links, screenshots and issue forms correctly.
- [ ] Publish the already-tested draft Release.
- [ ] In a logged-out browser, verify the latest-release link, APK download,
      checksum download, documentation, issue forms and security route.
- [ ] Keep the tested APK, checksum, tag and signing fingerprint immutable.

## Honest first-release boundary

The first public phone beta does not need proof from every provider account,
country, car or watch. It does need accurate labels. The release must not claim
professional translation, country-specific clinical review, physical hardware
coverage or production-provider validation that has not happened.
