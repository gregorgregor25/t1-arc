# On-device nutrition-label recognition

Local Android Expo module, autolinked from `modules/` through `expo-module.config.json`, matching the other first-party modules. No separate npm package or registration edit is needed. Builds without the native module return unavailable through the optional JavaScript bridge.

The pinned, bundled Latin model `com.google.mlkit:text-recognition:16.0.1` supports offline first use. It is **not** the Play-services downloadable-model variant. See [Google's Android integration documentation](https://developers.google.com/ml-kit/vision/text-recognition/v2/android). The initial parser supports English nutrition headings only. Google's SDK is a third-party dependency subject to its own terms; this module's first-party code is MIT-licensed.

Under [ML Kit's Terms & Privacy](https://developers.google.com/ml-kit/terms), images, recognized text, and outputs remain on-device, but the SDK sends usage/performance metrics to Google and may contact Google for updates or compatibility information. This is not a zero-telemetry dependency. The capture screen discloses the distinction before recognition; privacy and store disclosures must cover it. The first-party pipeline makes no cloud OCR request and requires no API key or paid service.

Only a UUID-named JPEG inside the dedicated app-cache `food-label-capture` directory can be read. The bridge copies the Expo camera temporary image there and removes the camera original. Native decoding is bounded to 16 MiB and a 2560-pixel longest dimension, OCR to 15 seconds, and output to 200 lines of at most 600 characters. Owned images are removed after success or failure, with JavaScript cleanup as a fallback. On native module creation, a bounded sweep removes owned images older than one hour that a process crash may have left behind; it never scans the shared Camera directory. Immediate deletion cannot be guaranteed across process death. No photo, OCR text, path, food, or nutrient is logged, sent to a cloud service, or persisted by this module. The user reviews an uncertain draft and must explicitly save My Foods; missing nutrients, ambiguous columns, and unclear serving weight stay blank.

## Validation

From generated `android/`, run `gradlew.bat :t1arc-food-label:testDebugUnitTest :t1arc-food-label:lintRelease :t1arc-food-label:assembleDebugAndroidTest`. CI includes the unit and release-lint tasks. The instrumented APK is generated under `modules/t1arc-food-label/android/build/outputs/apk/androidTest/debug/`.

The separate instrumentation APK removes the Internet permission to verify offline first use. It creates a synthetic label bitmap using Android Canvas, runs the production bundled ML Kit pipeline, checks recognized basis/nutrient text, confidence and output bounds, and verifies deletion after success/failure plus preservation of an unowned file. It refuses physical-device hardware. After confirming an explicit emulator serial, install **only the test APK** there, then run:

```
adb -s <emulator-serial> install -r <test-apk>
adb -s <emulator-serial> shell am instrument -w io.github.gregorgregor25.t1arc.foodlabel.test/io.github.gregorgregor25.t1arc.foodlabel.FoodLabelSmokeInstrumentation
```

Expect three PASS lines and `INSTRUMENTATION_CODE: -1`. The library test APK is self-instrumenting; no phone application install, camera permission, personal label, database fixture, or model download is required. JavaScript fixtures separately check parsing and temporary-file lifecycle. A successful synthetic OCR check is not a claim that all real labels are readable: all extracted fields require user review.
