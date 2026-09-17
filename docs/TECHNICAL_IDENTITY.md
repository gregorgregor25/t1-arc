# T1 Arc technical identity

The machine-readable authority is
[`config/t1arc-technical-identity.json`](../config/t1arc-technical-identity.json).
These values were frozen before the first public release so contributors do not
accidentally create incompatible application, storage, backup, notification, or
Wear identities.

## Ownership basis

The project's canonical repository is
`github.com/gregorgregor25/t1-arc`. The Android namespace uses its GitHub identity
rather than a separate web domain:
`io.github.gregorgregor25.t1arc`.

The phone and Wear companion deliberately share the same application ID because
the Wear Data Layer associates corresponding phone and watch applications by
package name and signing certificate. Each standalone watch face has a distinct
child ID.

## Build isolation

The production ID is reserved for the production-signed official GitHub APK.
Normal development uses the `.dev` suffix. Internal packaging checks use a
separate identity and must never be attached to a public Release. Fork
maintainers must set `T1ARC_FORK_APPLICATION_ID_BASE` to a reverse-DNS namespace
they control before distributing an APK.

Application-ID isolation is not a feature flag. Development, fork and official
builds execute the same app code and the same direct BYOK Tarv1s path.

## Change policy

Treat every value in the identity file as immutable after public release. Any
exception requires a versioned compatibility design, data-migration plan,
side-by-side installation proof, and a reviewed release note before code changes.
