# First-release maintainer checklist

Use this with the [release procedure](RELEASING.md). It describes the checks
required for publication, not the completion status of a particular release.
Keep private device evidence, signing recovery details and internal decisions
outside the public repository.

## Source and documentation

- Review the exact default-branch commit and every reachable public Git ref.
- Exclude credentials, personal exports, databases, internal work logs and build output.
- Check README links, linked guides, screenshots, downloads and website consistency.
- Retain software, dataset, model and media licences and required attribution.
- Verify a fresh clone with `npm ci`, `npm run verify:public-source` and `npm run quality`.
- Distinguish automated, emulator and real-device evidence in capability claims.

## Signing and access

- Preserve the official phone/companion signer and separate watch-face signer.
- Verify independently recoverable encrypted key copies and compare certificates.
- Confirm effective branch and production-environment protections before adding secrets.
- Keep signing secrets out of repository files, logs and release metadata.
- Prepare the draft through the protected workflow with build and checksum records.

## Exact-artifact checks

- Test fresh onboarding and an in-place update where a previous public release exists.
- Verify backup/restore, retained data, source reconnection and Android permissions.
- Exercise logging, source refresh, background collection and offline/error states.
- Check guided watch installation, identities, face selection and new glucose
  delivery after debugging is disabled on the documented hardware.
- Verify signatures, package/version, bundled companion and native-library alignment.
- Make release notes identify the exact tested source and artifacts and untested routes.

## Publication

- Publish after an authorised maintainer reviews the completed evidence.
- Check the release, phone APK, checksums and build record from a signed-out session.
- Verify the latest-release link and in-app update metadata.
- Change prelaunch notices in the README, download guide and website at publication.
- Keep issue forms, private security reporting and the support contact working.
- Announcements are a separate decision; a draft release does not publish them.
