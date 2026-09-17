# Watch-face previews

These are screenshots of T1 Arc's actual Watch Face Format resources running in
a Wear OS 6 emulator. All glucose readings and history are synthetic examples.
There is no owner health data in these files.

Each face has three phone-preview formats:

- `mmol`: 6.8 mmol/L, decimal point;
- `comma`: 6,8 mmol/L, decimal comma;
- `mgdl`: 123 mg/dL.

The phone chooses the matching unit and decimal format. The visible EXAMPLE
caption sits outside the image so it never overlaps the dial. These images do
not update with live glucose or the user's colour preferences.

The dial source is in `wear/designs` and `wear/watchface-*`. The emulator-only
`WatchFaceSmokeInstrumentation` gallery mode seeds example data and captures the
running faces. It is compiled into a separate test APK, not the companion people
download. After changing a dial, recapture and visually review its previews.
Do not replace these screenshots with approximate drawings or personal captures.
