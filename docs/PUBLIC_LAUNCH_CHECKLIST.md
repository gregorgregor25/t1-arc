# First public APK launch checklist

This checklist covers the one-time work required before the repository and its
first installable APK become public. It supplements the repeatable
[release procedure](RELEASING.md).

The production APK remains on hold for exact-artifact device acceptance,
production signing and recovery, and verified GitHub release protections.
Documentation, media and community drafts may be prepared, but none of those
clears the hold or authorises production signing, an APK build, publication or a
community post. Public-facing guides are written for launch; that wording does
not mean these gates have passed. Record acceptance against the exact source
commit and APK checksums, not a documentation revision.

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

- [ ] Create one permanent app key shared by the official phone and companion,
      and a different permanent key for standalone and bundled Push faces.
- [ ] Record each alias, certificate SHA-256 fingerprint and creation date in a
      private recovery record.
- [ ] Store both keystores and recovery information in at least two separate,
      encrypted locations. A Windows DPAPI credential file on the build PC alone
      does not satisfy this requirement.
- [ ] Test recovery, compare both certificate fingerprints and have the owner
      retain an independent copy before publication.
- [ ] Confirm no production signing file or password exists in Git history,
      source archives, issue attachments or workflow logs.
- [ ] Keep package ID `io.github.gregorgregor25.t1arc` unchanged for every
      official phone and companion update.

The first published signer becomes part of the update identity. Losing or
silently replacing it prevents ordinary in-place updates.

## 3. Protect GitHub release access

- [ ] Verify available protection features. The existing `production`
      environment is currently unprotected and has no signing secrets; private
      branch protection and rulesets are unavailable on the current plan.
- [ ] If private protections are unavailable, obtain separate owner approval
      to publish the audited source first, preserving the APK hold. A paid plan
      is not required if public protections are configured before adding
      signing secrets or publishing binaries.
- [ ] Protect the reviewed default branch and require its quality checks before
      merge, then verify the rules are effective.
- [ ] Restrict `production` to that exact selected branch. Do not rely on
      "protected branches only" when no branch is protected.
- [ ] Configure and verify the environment's required reviewer gate. Required
      reviewers are public-only on GitHub Free, Pro and Team.
- [ ] Limit workflow and release permissions to trusted maintainers.
- [ ] Only after those protections work, store the eight app and face signing
      values in [Releasing](RELEASING.md) as `production` environment secrets.
- [ ] Enable private vulnerability reporting and verify that the Security link
      in the issue chooser opens a private report.
- [ ] Confirm Dependabot alerts and security updates are enabled.

## 4. Confirm public service use

- [ ] Identify T1 Arc to Open Food Facts through its current API usage process
      and keep a working project contact route in network requests.
- [ ] Confirm the app does not embed a private USDA or OpenAI API key.
- [ ] Recheck Open Food Facts, USDA, CoFID, MEXT, CNF, Ciqual and BLS terms and attribution links
      immediately before launch.
- [ ] Confirm the exact build's bundled ML Kit model and diagnostics disclosure
      match the privacy guide; local recognition does not mean no SDK telemetry.
- [ ] Keep provider routes without real-account evidence labelled experimental
      or field-tested only, as applicable.

## 5. Prepare the first version

- [ ] Complete numerical synthetic-data verification of the implemented Tarv1s
      correction, rerun full quality on the exact source, and obtain the owner's
      explicit approval for production preparation after the signing and
      protection gates are met. Publication remains blocked until exact-asset
      device acceptance passes.
- [ ] Select the public version name and an Android version code greater than
      every previous build using the official package ID.
- [ ] Update `app.json`, `package.json` and `package-lock.json` together.
- [ ] Fill in the [release notes template](RELEASE_NOTES_TEMPLATE.md) using only
      claims supported by the exact release commit and test evidence.
- [ ] Link capability claims to that tag or commit. Decide whether the GitHub
      release is a prerelease: the current update checker and latest-release
      link do not offer prereleases, even though ordinary beta wording is fine.
- [ ] Run `npm run verify:public-source`, `npm run quality`, Expo dependency
      checks and the documented native Android gates.
- [ ] Run the protected release workflow on the exact intended commit.

## 6. Test the exact draft asset

- [ ] Download the phone, companion and standalone face APKs and checksums from
      the draft GitHub Release. Do not rebuild them for final acceptance.
- [ ] Confirm the SHA-256 checksum and verified production certificate
      fingerprint.
- [ ] Install cleanly on a supported physical phone and complete onboarding.
- [ ] Exercise every main phone screen with invented or synthetic records on an
      emulator or dedicated test installation.
- [ ] Verify food-tools Back preserves the draft, recipe serving choices,
      remembered portions, missing nutrients and label review/cancel.
- [ ] Test optional food-pack preparation, cancellation, removal and an enabled
      older-revision upgrade. Confirm saved foods and meals remain unchanged.
- [ ] Check saved barcode reuse offline and the manual-entry path after a miss.
- [ ] Exercise manual update checks, including unavailable/incompatible states,
      and verify the release classification plus APK/checksum/build metadata.
- [ ] Create, back up, erase and restore synthetic records in that test
      installation, never in the owner's personal-data installation.
- [ ] Restart the phone and confirm a cold launch.
- [ ] Confirm Android's installer identifies it as T1 Arc and the package is
      `io.github.gregorgregor25.t1arc`.
- [ ] Record that update testing begins with the second public version. From
      that release onward, every candidate must update the previous public APK
      in place without clearing data.
- [ ] Before an owner handover, verify separate encrypted backups and retain the
      existing APKs. Reconcile unique records and Tarv1s conversation differences
      before removing an old package.
- [ ] Install the matching companion and verify live readings with the previous
      phone app stopped. Confirm units, colours, freshness and reconnects.
- [ ] On Wear OS 6, test all five phone-selected designs, activation, repeated
      commands, disconnect recovery and manual selection after one-shot activation.
- [ ] Test the older companion path and standalone faces on supported versions.
- [ ] Check the [watch setup guide](WATCH_SETUP.md) against the actual APK assets.

## 7. Publish and verify

- [ ] Edit the generated draft notes so limitations and experimental routes are
      prominent and understandable.
- [ ] Confirm the public repository uses the reviewed clean default branch and
      its old unwanted references have been handled. If source was published
      earlier to enable release protections, recheck those protections now.
- [ ] Confirm GitHub detects the MIT licence and renders the README, relative
      links, screenshots and issue forms correctly.
- [ ] Replace stale food screenshots with reviewed synthetic captures. Verify
      the exact video, narration/music permissions and any required credits
      before attaching a public demo; no placeholder download link may ship.
- [ ] Publish the already-tested draft Release.
- [ ] In a logged-out browser, verify the latest-release link, APK download,
      checksum download, documentation, issue forms and security route.
- [ ] Keep the tested APK, checksum, tag and signing fingerprint immutable.

## Honest first-release boundary

The first public phone beta does not need proof from every provider account,
country, car or watch. It does need accurate labels. The release must not claim
professional translation, country-specific clinical review, physical hardware
coverage or production-provider validation that has not happened.
