# Guided companion installer

The independent phone APK can carry the matching signed companion. The six-step
wizard lives under Settings → Watch & watch faces. It uses local Wi-Fi ADB only
for installation. Everyday glucose transport remains the existing Wear Data Layer.

## Build selection

Set `T1ARC_WATCH_INSTALLER=1` when building independent APKs. The GitHub signed APK
workflow sets it explicitly. Leave it unset for Play. A release bundle task fails
closed if this flag is enabled, and the disabled module contains no ADB library,
Conscrypt dependency, discovery permissions or companion asset.

The Expo config plugin registers a generated Android asset task. Each phone
variant depends on its matching Wear variant and its existing five-face catalog.
Explicit face signing is required for debug builds as well. The generator verifies
the actual companion APK's package, version and signer, then records its SHA-256.
The phone repeats identity/signature/hash checks before installation.

No keys or APKs are committed. Keep the current signing configuration; the flag
does not change the application ID or select a signing key.

## Transport and lifecycle

- `discoverAsync` returns local endpoints with separate pairing/connection ports.
  The phone's own Wi-Fi addresses are excluded. Results are potential ADB devices;
  the selected device must report the watch hardware feature before installation.
- `pairAsync` uses the user-entered six-digit code. ADB's RSA identity is encrypted
  with an Android Keystore AES key in no-backup storage. Codes are not persisted.
- `connectAsync` connects only through the phone's Wi-Fi network, validates a local
  IP address and port, and checks that the target supports the companion.
- `installAsync` accepts no path, URL, package name or shell command from JS.
  Only the verified bundled APK can be installed. It refuses downgrades, relies
  on Android's update signature enforcement, and never uninstalls or clears data.
  On retry it checks the installed version and exact APK hash before reinstalling.
- `progress` separates checking, transferring, installing and verification.
  `cancelAsync`/`disconnectAsync` close the underlying sockets. A bounded local
  relay makes libadb handshakes cancellable without changing its internal APIs.
  A package-manager operation already accepted on the watch may still complete;
  retry reconciles that state. Leaving the wizard closes the connection.
  Command completion markers avoid libadb 3.1.1's pending-close read hang;
  cancellation also interrupts blocking stream waits, and the relay explicitly
  binds IPv4 loopback to match the client.

Installation success is distinct from companion connectivity and visible glucose.
The last step asks the user to check the actual watch reading and timestamp, then
switch debugging off. Existing Watch Face Push capability checks remain in charge
of the face chooser. Older-watch face installation remains a separate operation.

## Dependencies and verification

`libadb-android:3.1.1` is used under Apache-2.0; retain its upstream notices and
the notices of its dependencies. It brings Bouncy Castle and spake2-android
(LGPL-3.0). Enabled APKs package the exact notices and source links from
`modules/t1arc-watch-installer/android/src/enabled/assets/watch-installer-notices`.
Conscrypt is pinned to 2.7.0 rather than the older version in the libadb example,
for current native-library compatibility. TLS provider configuration is confined
to libadb; this does not change the app's other HTTPS clients.

Run the repository quality suite, enabled module unit tests, phone/Wear builds
and their existing APK verifiers. Run `python scripts/verify-watch-installer.py
PHONE.apk --enabled` and `zipalign -c -P 16 -v 4 PHONE.apk`. For an installer-free
build, omit `--enabled` to assert asset/transport exclusion.

Device acceptance covers food keyboard behaviour, first pairing, remembered
pairing, incorrect codes, manual fallback, multiple targets, non-watch rejection,
fresh install, updates, interrupted installs, conflicts, and glucose delivery after
debugging is disabled. Emulator/unit checks do not replace physical-watch acceptance.

Instruction sources: [Samsung](https://developer.samsung.com/sdp/blog/en/2024/04/30/connect-galaxy-watch-to-android-studio-over-wi-fi),
[Pixel developer options](https://developer.android.com/studio/debug/dev-options),
[Wear pairing](https://developer.android.com/training/wearables/get-started/debug-wifi),
[libadb](https://github.com/MuntashirAkon/libadb-android),
[Conscrypt](https://github.com/google/conscrypt).
