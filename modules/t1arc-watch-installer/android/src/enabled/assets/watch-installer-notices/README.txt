# Watch installer dependency notices

These dependencies are included only when T1ARC_WATCH_INSTALLER=1.

- LibADB Android 3.1.1, copyright Muntashir Al-Islam and upstream contributors.
  T1 Arc selects Apache-2.0 from its dual license; bundled upstream components
  also retain the MIT and BSD notices. Source:
  https://github.com/MuntashirAkon/libadb-android/tree/3.1.1
- Conscrypt Android 2.7.0, The Android Open Source Project and contributors,
  Apache-2.0 with the additional notices in conscrypt-LICENSE/NOTICE.
  Source: https://github.com/google/conscrypt/tree/2.7.0
- SPAKE2 Android 2.2.1, copyright 2021 Muntashir Al-Islam, LGPL-3.0.
  Unmodified source and build files:
  https://github.com/MuntashirAkon/spake2-java/tree/2.2.1
  Source archive: https://github.com/MuntashirAkon/spake2-java/archive/refs/tags/2.2.1.zip
- Bouncy Castle 1.81, the Bouncy Castle contributors, MIT license.
  Source: https://github.com/bcgit/bc-java/tree/r1rv81

The T1 Arc source and Gradle build permit rebuilding with modified dependencies.
The pins are in modules/t1arc-watch-installer/android/build.gradle; run Expo
prebuild and assembleDebug with T1ARC_WATCH_INSTALLER=1 and the explicit face
signing configuration documented in docs/WATCH_INSTALLER_DEVELOPMENT.md.
No restriction on reverse engineering for debugging changes to LGPL components
is imposed by T1 Arc. Include these notices and corresponding dependency source
access alongside any distributed independent APK. No warranty is provided.
