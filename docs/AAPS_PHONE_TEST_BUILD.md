# AAPS phone test build

The `codex/aaps-local-source` branch builds a phone APK in GitHub Actions. The
workflow runs the repository quality checks, makes an ARM64 release APK, and
uploads it as a seven-day Actions artifact. It does not create a tag, GitHub
Release, or production deployment. The `production` environment remains
restricted to `main`.

The artifact includes the APK, source identity, and SHA-256 checksums. A
mapping file is included only if Android's release minification generated one;
the current production Gradle configuration leaves minification off.

The Actions artifact uses a disposable signer. **Do not install
`aaps-intermediate.apk` on the Pixel.** It has the official package ID but
cannot update the installed T1 Arc because its certificate differs. Re-sign
the exact downloaded APK locally with the existing production app key, held
outside the repository under the Windows user's DPAPI-protected signing
directory. [Android's apksigner](https://android.googlesource.com/platform/tools/apksig/+/master/src/apksigner/java/com/android/apksigner/help_sign.txt)
replaces earlier signatures when signing an existing APK. Keep the key and
password out of Actions, the repository, logs, and the artifact.

Before wireless ADB installation, check the Actions run's source commit,
`SHA256SUMS`, APK version/code and embedded source metadata. After local
re-signing, run `scripts/verify-android-apk.ps1` on the final APK, compare its
signing certificate with the installed Pixel package, and use `adb install -r`
for an in-place update. Never uninstall the current phone app to work around
a signer or version mismatch; that would remove local data. The existing
Wear OS companion receives the same glucose protocol and does not need an
update for this phone-only test. The phone test APK omits the optional
companion installer asset; it does not alter the installed watch app.

This branch build is for device verification of AAPS broadcasts and local
phone/watch delivery. The final signed APK is kept local and is not uploaded
to a GitHub Release.
