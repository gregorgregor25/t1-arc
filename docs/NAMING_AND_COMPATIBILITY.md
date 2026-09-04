# T1 Arc naming and compatibility

T1 Arc is both the product name and the basis of the permanent public technical
identity. Use it in UI copy, Android labels, screenshots, documentation, issue
templates, release notes and public APIs. Use the namespace and identifier
families frozen in
[`config/t1arc-technical-identity.json`](../config/t1arc-technical-identity.json)
for application, storage, backup, notification and Wear contracts.

Persisted and cross-process T1 Arc values are compatibility contracts, not
arbitrary branding strings. Once users have installed a public release, their
encrypted data, Android settings, backups and paired watches may depend on the
exact bytes. The authoritative runtime inventory is
[`config/t1arc-runtime-identifiers.json`](../config/t1arc-runtime-identifiers.json),
and [`tests/t1arc-runtime-identity.test.ts`](../tests/t1arc-runtime-identity.test.ts)
enforces it.

## Never rename in place

- Android application IDs and the signing identity;
- database filenames, SecureStore keys, SharedPreferences names, keystore
  aliases and native queue filenames;
- persisted source IDs, evidence algorithm versions and migration markers;
- notification channel IDs, background task names and PendingIntent identities;
- Wear data-layer paths, capability names and watch-face provider component
  names;
- backup document identifiers, encrypted-container magic or readers for
  previous backup schema versions.

A visual refresh is not a reason to migrate any of these values.

## Safe naming work

New user-visible strings, source files, local symbols and non-persisted resource
names should use T1 Arc naming. Compile-time symbols may be renamed in a focused
change when the native/JavaScript boundary is updated atomically and its tests
prove both sides agree.

## Migration standard

If a technical identifier must change for a reason beyond branding:

1. add both identifiers to the ledger and document which version emits each one;
2. read the current value first and the previous value second;
3. copy without transforming, reread and compare before marking migration done;
4. make retries idempotent and do not treat transient read failures as success;
5. retain the previous-version reader for shipped backups and mixed-version phone/watch
   pairs;
6. test an upgrade from a populated released build, including row counts,
   credentials, channels, widgets, shortcuts, Android Auto and Wear surfaces.

Do not delete a shipped value merely because a newer alias exists. The separate
one-time maintainer migration follows the same validation standard but is not a
runtime dependency of the eventual public source tree.
