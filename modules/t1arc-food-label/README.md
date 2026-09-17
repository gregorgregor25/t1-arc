# On-device nutrition-label recognition

Local Android Expo module, autolinked from `modules/` through `expo-module.config.json`, matching the other first-party modules. No separate npm package or registration edit is needed. Builds without the native module return unavailable through the optional JavaScript bridge.

The pinned, bundled Latin model `com.google.mlkit:text-recognition:16.0.1` supports offline first use. It is **not** the Play-services downloadable-model variant. See [Google's Android integration documentation](https://developers.google.com/ml-kit/vision/text-recognition/v2/android). The initial parser supports English nutrition headings only. Google's SDK is a third-party dependency subject to its own terms; this module's first-party code is MIT-licensed.

ML Kit locates text; a bundled English PP-OCRv4 model rereads the word pixels.
ONNX Runtime Android 1.24.3 runs this second recogniser entirely on-device.
`prepareFoodLabelModel` downloads the pinned 7.7 MB model during the build and
verifies SHA-256 on every build; native initialization verifies it again.
There is no runtime model download or paid API. Source, licenses and adaptation
notices ship in `assets/food-label-notices/`. The CTC/preprocessing adaptation
retains its upstream Apache-2.0 attribution.

Word crops include 12% height padding and use explicit BGR normalization. At most
160 words per pass are transcribed, with two inference threads, bounded 48-pixel
height tensors and deterministic cleanup. Numeric text is never repaired using
letter substitution or a number-only alphabet. An empty detailed pass falls back
to the overview. Title-aligned single-column tables require at least three aligned
numeric cells; printed kcal are preferred to conversion from a conflicting kJ row.

Under [ML Kit's Terms & Privacy](https://developers.google.com/ml-kit/terms), images, recognized text, and outputs remain on-device, but the SDK sends usage/performance metrics to Google and may contact Google for updates or compatibility information. This is not a zero-telemetry dependency. The capture screen discloses the distinction before recognition; privacy and store disclosures must cover it. The first-party pipeline makes no cloud OCR request and requires no API key or paid service.

Only a UUID-named JPEG inside the dedicated app-cache `food-label-capture` directory can be read. The bridge copies the Expo camera temporary image there and removes the camera original. Native decoding is bounded to 16 MiB and a 2560-pixel longest dimension, OCR to 15 seconds, and output to 200 lines of at most 600 characters. Owned images are removed after success or failure, with JavaScript cleanup as a fallback. On native module creation, a bounded sweep removes owned images older than one hour that a process crash may have left behind; it never scans the shared Camera directory. Immediate deletion cannot be guaranteed across process death. No photo, OCR text, path, food, or nutrient is logged, sent to a cloud service, or persisted by this module. The user reviews an uncertain draft and must explicitly save My Foods; missing nutrients, ambiguous columns, and unclear serving weight stay blank.

## Validation

For small labels in larger photos, recognition first locates the complete
nutrition region in a bounded overview. When this permits a smaller sampling
factor, a region decoder rereads original JPEG pixels for that table alone.
Detected competing headings and all text columns in the region are retained.
The 15-second timeout covers both passes; each pass retains the existing bitmap
and text bounds. The bridge can return `overviewLines` alongside the detailed
`lines` (at most 200 lines in each). JavaScript rejects conflicting values/bases
and never silently corrects missing decimals or substitutes letters for digits.
Lower-confidence transcriptions are separate review candidates, not form values,
until the user explicitly confirms the editable review.

From generated `android/`, run `gradlew.bat :t1arc-food-label:testDebugUnitTest :t1arc-food-label:lintRelease :t1arc-food-label:assembleDebugAndroidTest`. CI includes the unit and release-lint tasks. The instrumented APK is generated under `modules/t1arc-food-label/android/build/outputs/apk/androidTest/debug/`.

The separate instrumentation APK removes the Internet permission to verify offline first use. It creates a synthetic label bitmap using Android Canvas, runs the production bundled ML Kit pipeline, checks recognized basis/nutrient text, confidence and output bounds, and verifies deletion after success/failure plus preservation of an unowned file. It refuses physical-device hardware. After confirming an explicit emulator serial, install **only the test APK** there, then run:

```
adb -s <emulator-serial> install -r <test-apk>
adb -s <emulator-serial> shell am instrument -w io.github.gregorgregor25.t1arc.foodlabel.test/io.github.gregorgregor25.t1arc.foodlabel.FoodLabelSmokeInstrumentation
```

Expect seven PASS lines, including condensed-font recognition with a separate numeric column, an original-resolution region decode from a large synthetic image and actual OCR of 90/180/270-degree text. The library test APK is self-instrumenting; no phone application install, camera permission, personal label, database fixture, or model download is required. JavaScript fixtures separately check parsing and temporary-file lifecycle. A successful synthetic OCR check is not a claim that all real labels are readable: all extracted fields require user review.

Printed text orientation is checked separately from camera EXIF. A consensus of
at least three nutrition anchors can trigger a physically rotated reread. Small
table regions can also be reread at double scale within the existing 2560-pixel
limit; this changes recognition sampling, without claiming to restore lost detail.
The 15-second timeout covers all passes. Each output line includes up to 30 word
boxes, each with at most 80 characters. The positioned parser uses these boxes to
isolate the per-100g/ml column and avoid neighbouring serving/reference figures.
All values from that path require explicit review; ambiguous row matches, missing
units, conflicting reads and digit substitutions remain blank. Word boxes and
angles come from the documented [ML Kit Text.Line API](https://developers.google.com/android/reference/com/google/mlkit/vision/text/Text.Line).

For an explicitly authorized local real-image investigation, the emulator-only
runner also accepts `-e privateFixtures true`. Place up to five JPEGs named
`fixture-1.jpg` through `fixture-5.jpg` in the **test package's** private
`cache/qa-label-fixtures` directory using `run-as`. Recognition uses the production
pipeline; JSON results are written beside the input fixtures, never to logcat or
instrumentation output. Pull them only to ignored local QA storage for parser
comparison. Never check personal images or OCR output into the repository. Remove
the separate test APK after the investigation to clear its private fixture data.
The normal smoke test does not read these files, and the runner refuses physical
devices. This opt-in path is not included in the phone application.
